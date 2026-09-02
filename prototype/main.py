
from fastapi import Cookie, Depends, FastAPI, File, HTTPException, Response, UploadFile, status
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse, StreamingResponse
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from typing import Any, List, Literal, Optional
from pathlib import Path
from datetime import datetime, timezone
import hashlib, hmac, io, os, secrets, zipfile, html, json, re
from xml.etree import ElementTree
from sqlalchemy import select, text, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from prototype.course_models import Block, Course, Question, Slide, new_course
from prototype.auth import COOKIE_NAME, current_session, new_session, normalise_email, password_hasher, set_session_cookie
from prototype.credentials import decrypt, encrypt
from prototype.persistence import AICredential, AnalyticsImport, AuthSession, ExportRecord, GenerationRun, LearningAnalytics, MediaAsset, OAuthIdentity, Project, ProjectShare, School, SchoolMembership, SharedQuestion, SourceMaterial, User, create_schema, make_session_factory
from prototype.analytics import AnalyticsImportError, aggregate_events, aggregate_insights, normalize_rows, parse_report
from prototype.google_oauth import GOOGLE_ATTEMPT_COOKIE, GOOGLE_ATTEMPT_MAX_AGE, GoogleOAuthError, authorization_url, config_from_env, decode_attempt, encode_attempt, exchange_code, new_attempt
from prototype.providers import ProviderError, ProviderResult, media_provider_for, provider_for
from prototype.media import SCORM_VIDEO_WARNING_BYTES, extension_for_mime, validate_media_upload, validate_media_url
from prototype.sources import extract_text, validate_upload
from prototype.storage import Storage
from prototype.logging_config import configure_logging
from prototype.quality import analyze_course

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "app"

if os.getenv("APP_ENV", "development").lower() not in {"production", "prod"}:
    BASE_DIR.joinpath("storage").mkdir(exist_ok=True)
engine, SessionLocal = make_session_factory()
if os.getenv("APP_ENV", "development").lower() not in {"production", "prod"}:
    create_schema(engine)

app = FastAPI(title="AI SCORM Studio Demo")
storage = Storage()
configure_logging()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@app.get("/healthz")
def healthz():
    """Liveness probe: the API process is accepting requests."""
    return {"status": "ok"}


@app.get("/readyz")
def readyz(db: Session = Depends(get_db)):
    """Readiness probe: core persistent dependencies are reachable."""
    dependencies: dict[str, str] = {}
    try:
        db.execute(text("SELECT 1"))
        dependencies["database"] = "ok"
    except Exception:
        dependencies["database"] = "unavailable"
    try:
        dependencies["object_storage"] = storage.healthcheck()
    except Exception:
        dependencies["object_storage"] = "unavailable"
    if "unavailable" in dependencies.values():
        raise HTTPException(status_code=503, detail={"status": "not_ready", "dependencies": dependencies})
    return {"status": "ok", "dependencies": dependencies}


def current_teacher(session_token: str | None = Cookie(default=None, alias=COOKIE_NAME), db: Session = Depends(get_db)) -> User:
    authenticated = current_session(db, session_token)
    if authenticated is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required.")
    return authenticated[0]


class ProjectCreateRequest(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    direction: Literal["lesson", "review", "advanced"] = "lesson"
    course: Course | None = None
    generation_id: str | None = None


class RegisterRequest(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=12, max_length=256)
    full_name: str | None = Field(default=None, max_length=200)
    school_name: str | None = Field(default=None, max_length=200)


class LoginRequest(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=1, max_length=256)


class TeacherResponse(BaseModel):
    id: str
    email: str
    full_name: str | None
    school_name: str | None


class SchoolCreateRequest(BaseModel):
    name: str = Field(min_length=2, max_length=200)


class SchoolResponse(BaseModel):
    id: str
    name: str
    role: Literal["school_admin", "teacher"]


class SchoolMemberRequest(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    role: Literal["school_admin", "teacher"] = "teacher"


class SchoolMemberResponse(BaseModel):
    user_id: str
    email: str
    full_name: str | None
    role: Literal["school_admin", "teacher"]


class AnalyticsImportResponse(BaseModel):
    id: str
    school_id: str
    source_type: Literal["k12online_report"]
    original_filename: str
    row_count: int
    accepted_row_count: int
    rejected_row_count: int
    error_summary: dict[str, int]
    created_at: datetime | None


class AnalyticsLessonSummary(BaseModel):
    lesson_external_id: str
    lesson_title: str | None
    event_count: int
    completion_ratio: float | None
    score_ratio: float | None
    correct_ratio: float | None


class AnalyticsSummaryResponse(BaseModel):
    event_count: int
    learner_count: int
    completion_ratio: float | None
    score_ratio: float | None
    correct_ratio: float | None
    average_duration_minutes: float | None
    lessons: list[AnalyticsLessonSummary]
    privacy_note: str


class AnalyticsInsightsResponse(BaseModel):
    method: Literal["deterministic_aggregate"]
    insights: list[str]
    privacy_note: str


class ProjectShareRequest(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    access_level: Literal["viewer", "editor"]


class ProjectShareResponse(BaseModel):
    user_id: str
    email: str
    full_name: str | None
    access_level: Literal["viewer", "editor"]


class SharedQuestionContent(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["single", "multiple", "truefalse", "fill", "matching", "ordering", "dragdrop", "image"]
    question: str = Field(min_length=5, max_length=4000)
    difficulty: Literal["recognize", "understand", "apply", "advanced"]
    correct_answer: Any
    options: list[str] = Field(default_factory=list, max_length=20)
    recommended_score: float = Field(default=1, ge=0, le=100)
    explanation: str | None = Field(default=None, max_length=4000)
    feedback_correct: str | None = Field(default=None, max_length=2000)
    feedback_incorrect: str | None = Field(default=None, max_length=2000)


class SharedQuestionCreateRequest(BaseModel):
    school_id: str = Field(min_length=1, max_length=36)
    subject: str = Field(min_length=2, max_length=100)
    grade: str = Field(min_length=1, max_length=50)
    topic: str = Field(min_length=2, max_length=200)
    learning_objectives: list[str] = Field(min_length=1, max_length=12)
    question: SharedQuestionContent


class SharedQuestionFromProjectRequest(BaseModel):
    school_id: str = Field(min_length=1, max_length=36)
    subject: str = Field(min_length=2, max_length=100)
    grade: str = Field(min_length=1, max_length=50)
    topic: str = Field(min_length=2, max_length=200)
    learning_objectives: list[str] = Field(min_length=1, max_length=12)


class SharedQuestionReviewRequest(BaseModel):
    decision: Literal["published", "rejected"]


class SharedQuestionImportRequest(BaseModel):
    expected_revision: int = Field(ge=1)
    selected: bool = True


class SharedQuestionResponse(BaseModel):
    id: str
    school_id: str
    subject: str
    grade: str
    topic: str
    learning_objectives: list[str]
    question: SharedQuestionContent
    status: Literal["draft", "submitted", "published", "rejected"]
    submitted_by_user_id: str
    submitted_by_name: str | None
    reviewed_by_user_id: str | None
    reviewed_by_name: str | None
    reviewed_at: datetime | None

class SourceResponse(BaseModel):
    id: str; original_name: str; mime_type: str; byte_size: int; extracted_text: str | None


class MediaUrlRequest(BaseModel):
    kind: Literal["image", "audio", "video"]
    url: str = Field(min_length=12, max_length=2000)
    label: str = Field(min_length=1, max_length=255)
    rights_confirmed: bool = False


class MediaImageRequest(BaseModel):
    prompt: str = Field(min_length=5, max_length=4000)
    provider: Literal["mock", "openai", "gemini"] = "mock"
    credential_id: str | None = None


class MediaTTSRequest(BaseModel):
    text: str = Field(min_length=1, max_length=4096)
    voice: str = Field(default="alloy", min_length=2, max_length=40)
    provider: Literal["mock", "openai", "gemini"] = "mock"
    credential_id: str | None = None


class MediaAttachRequest(BaseModel):
    asset_id: str = Field(min_length=1, max_length=36)
    expected_revision: int = Field(ge=1)


class MediaResponse(BaseModel):
    id: str
    project_id: str
    slide_id: str | None
    kind: Literal["image", "audio", "video"]
    source_type: Literal["upload", "url", "generated", "tts"]
    original_name: str
    mime_type: str
    byte_size: int
    prompt: str | None
    provider: str | None
    model: str | None
    rights_confirmed: bool
    status: str
    content_url: str
    warning: str | None = None
class CredentialCreateRequest(BaseModel):
    provider: Literal["openai", "gemini"]
    secret: str = Field(min_length=8, max_length=500)
    label: str | None = Field(default=None, max_length=100)
    model_default: str | None = Field(default=None, max_length=100)
class CredentialResponse(BaseModel):
    id: str; provider: str; label: str | None; secret_last4: str; model_default: str | None; status: str
class CredentialUpdateRequest(BaseModel):
    label: str | None = Field(default=None, max_length=100)
    secret: str | None = Field(default=None, min_length=8, max_length=500)
    model_default: str | None = Field(default=None, max_length=100)


class ProjectUpdateRequest(BaseModel):
    expected_revision: int = Field(ge=1)
    course: Course
    generation_id: str | None = None

class RenameProjectRequest(BaseModel):
    title: str = Field(min_length=1, max_length=300)


class ProjectResponse(BaseModel):
    id: str
    title: str
    status: str
    revision: int
    course: Course
    access_level: Literal["owner", "viewer", "editor"] = "owner"


def serialize_project(project: Project, access_level: Literal["owner", "viewer", "editor"] = "owner") -> ProjectResponse:
    return ProjectResponse(
        id=project.id, title=project.title, status=project.status,
        revision=project.revision, course=Course.model_validate(project.course_json), access_level=access_level,
    )


def serialize_teacher(user: User) -> TeacherResponse:
    return TeacherResponse(id=user.id, email=user.email, full_name=user.full_name, school_name=user.school_name)


def membership_for(db: Session, school_id: str, user_id: str) -> SchoolMembership | None:
    return db.scalar(select(SchoolMembership).where(SchoolMembership.school_id == school_id, SchoolMembership.user_id == user_id))


def require_school_admin(db: Session, school_id: str, user: User) -> SchoolMembership:
    membership = membership_for(db, school_id, user.id)
    if membership is None or membership.role != "school_admin":
        raise HTTPException(status_code=403, detail="School administrator permission required.")
    return membership


def shared_school_ids(db: Session, first_user_id: str, second_user_id: str) -> set[str]:
    first = set(db.scalars(select(SchoolMembership.school_id).where(SchoolMembership.user_id == first_user_id)).all())
    second = set(db.scalars(select(SchoolMembership.school_id).where(SchoolMembership.user_id == second_user_id)).all())
    return first & second


def require_school_membership(db: Session, school_id: str, user: User) -> SchoolMembership:
    membership = membership_for(db, school_id, user.id)
    if membership is None:
        raise HTTPException(status_code=404, detail="School not found.")
    return membership


def analytics_pseudonym_key() -> bytes:
    configured = os.getenv("ANALYTICS_PSEUDONYM_KEY")
    if configured and configured != "replace_with_long_random_value":
        return configured.encode("utf-8")
    if os.getenv("APP_ENV", "development").lower() in {"production", "prod"}:
        raise HTTPException(status_code=503, detail="ANALYTICS_PSEUDONYM_KEY is required in production.")
    # This is intentionally public, development-only behavior. Production must configure a secret.
    return b"ai-scorm-studio-development-analytics-key"


def serialise_analytics_import(item: AnalyticsImport) -> AnalyticsImportResponse:
    return AnalyticsImportResponse(
        id=item.id, school_id=item.school_id, source_type="k12online_report", original_filename=item.original_filename,
        row_count=item.row_count, accepted_row_count=item.accepted_row_count, rejected_row_count=item.rejected_row_count,
        error_summary=dict(item.error_summary_json or {}), created_at=item.created_at,
    )


def analytics_summary_for_school(db: Session, school_id: str) -> dict[str, Any]:
    events = db.scalars(select(LearningAnalytics).where(LearningAnalytics.school_id == school_id)).all()
    return aggregate_events(events)


def bootstrap_google_school_admin(db: Session, user: User) -> None:
    """Assign the explicitly configured first Google account as school admin, once verified."""
    admin_email = normalise_email(os.getenv("GOOGLE_BOOTSTRAP_ADMIN_EMAIL", ""))
    school_name = " ".join(os.getenv("GOOGLE_BOOTSTRAP_SCHOOL_NAME", "").split())
    if not admin_email and not school_name:
        return
    if not admin_email or not school_name:
        raise HTTPException(status_code=503, detail="Google administrator bootstrap configuration is incomplete.")
    if not hmac.compare_digest(user.email, admin_email):
        return
    school = db.scalar(select(School).where(School.name == school_name))
    if school is None:
        school = School(name=school_name, created_by_user_id=user.id)
        db.add(school)
        db.flush()
    membership = membership_for(db, school.id, user.id)
    if membership is None:
        db.add(SchoolMembership(school_id=school.id, user_id=user.id, role="school_admin"))
    else:
        membership.role = "school_admin"


def cleaned_learning_objectives(values: list[str]) -> list[str]:
    cleaned = [" ".join(value.split()) for value in values if value and value.strip()]
    if not cleaned:
        raise HTTPException(status_code=422, detail="At least one learning objective is required.")
    if any(len(value) > 500 for value in cleaned):
        raise HTTPException(status_code=422, detail="Learning objectives must be at most 500 characters.")
    return list(dict.fromkeys(cleaned))


def cleaned_label(value: str, *, field_name: str) -> str:
    cleaned = " ".join(value.split())
    if not cleaned:
        raise HTTPException(status_code=422, detail=f"{field_name} is required.")
    return cleaned


def serialise_shared_question(item: SharedQuestion, db: Session) -> SharedQuestionResponse:
    author = db.get(User, item.submitted_by_user_id)
    reviewer = db.get(User, item.reviewed_by_user_id) if item.reviewed_by_user_id else None
    return SharedQuestionResponse(
        id=item.id, school_id=item.school_id, subject=item.subject, grade=item.grade, topic=item.topic,
        learning_objectives=list(item.learning_objectives or []),
        question=SharedQuestionContent.model_validate(item.question_json), status=item.status,
        submitted_by_user_id=item.submitted_by_user_id, submitted_by_name=author.full_name if author else None,
        reviewed_by_user_id=item.reviewed_by_user_id, reviewed_by_name=reviewer.full_name if reviewer else None,
        reviewed_at=item.reviewed_at,
    )


def create_shared_question(
    db: Session,
    *,
    user: User,
    school_id: str,
    subject: str,
    grade: str,
    topic: str,
    learning_objectives: list[str],
    question: SharedQuestionContent,
) -> SharedQuestion:
    require_school_membership(db, school_id, user)
    item = SharedQuestion(
        school_id=school_id,
        subject=cleaned_label(subject, field_name="Subject"),
        grade=cleaned_label(grade, field_name="Grade"),
        topic=cleaned_label(topic, field_name="Topic"),
        learning_objectives=cleaned_learning_objectives(learning_objectives),
        question_json=question.model_dump(mode="json"),
        status="draft",
        submitted_by_user_id=user.id,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


def project_with_access(db: Session, project_id: str, user: User, *, require_edit: bool = False) -> tuple[Project, Literal["owner", "viewer", "editor"]]:
    project = db.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found.")
    if project.owner_user_id == user.id:
        return project, "owner"
    share = db.scalar(select(ProjectShare).where(ProjectShare.project_id == project_id, ProjectShare.user_id == user.id))
    if share is None:
        raise HTTPException(status_code=404, detail="Project not found.")
    if not shared_school_ids(db, project.owner_user_id, user.id):
        raise HTTPException(status_code=404, detail="Project not found.")
    if require_edit and share.access_level != "editor":
        raise HTTPException(status_code=403, detail="Edit permission required for this project.")
    return project, share.access_level  # type: ignore[return-value]


@app.post("/api/v1/auth/register", response_model=TeacherResponse, status_code=status.HTTP_201_CREATED)
def register(payload: RegisterRequest, response: Response, db: Session = Depends(get_db)):
    email = normalise_email(payload.email)
    if "@" not in email:
        raise HTTPException(status_code=422, detail="A valid email is required.")
    if db.scalar(select(User.id).where(User.email == email)) is not None:
        raise HTTPException(status_code=409, detail="Email is already registered.")
    user = User(email=email, password_hash=password_hasher.hash(payload.password), full_name=payload.full_name, school_name=payload.school_name)
    db.add(user)
    db.flush()
    token = new_session(db, user)
    db.commit()
    db.refresh(user)
    set_session_cookie(response, token)
    return serialize_teacher(user)


@app.get("/api/v1/auth/google/start")
def start_google_login():
    try:
        config = config_from_env()
        attempt = new_attempt()
        response = RedirectResponse(authorization_url(config, attempt), status_code=status.HTTP_307_TEMPORARY_REDIRECT)
        response.set_cookie(
            GOOGLE_ATTEMPT_COOKIE,
            encode_attempt(attempt),
            httponly=True,
            secure=os.getenv("APP_ENV", "development").lower() in {"production", "prod"},
            samesite="lax",
            max_age=GOOGLE_ATTEMPT_MAX_AGE,
            path="/api/v1/auth/google",
        )
        return response
    except GoogleOAuthError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.get("/api/v1/auth/google/callback")
def finish_google_login(
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    attempt_cookie: str | None = Cookie(default=None, alias=GOOGLE_ATTEMPT_COOKIE),
    db: Session = Depends(get_db),
):
    response = RedirectResponse("/?auth_error=google", status_code=status.HTTP_303_SEE_OTHER)
    response.delete_cookie(GOOGLE_ATTEMPT_COOKIE, path="/api/v1/auth/google")
    if error or not code or not state:
        return response
    try:
        config = config_from_env()
        attempt = decode_attempt(attempt_cookie)
        if not hmac.compare_digest(state, attempt.state):
            raise GoogleOAuthError("Google sign-in state did not match.")
        profile = exchange_code(config, attempt, code)
    except GoogleOAuthError:
        return response

    identity = db.scalar(select(OAuthIdentity).where(OAuthIdentity.provider == "google", OAuthIdentity.subject == profile.subject))
    if identity is not None:
        user = db.get(User, identity.user_id)
        if user is None or user.status != "active":
            return response
        identity.last_authenticated_at = datetime.now(timezone.utc)
    else:
        user = db.scalar(select(User).where(User.email == profile.email))
        if user is None:
            # A random unusable local-password hash satisfies the existing account model. Google is
            # the only credential for this account; no provider token is persisted.
            user = User(
                email=profile.email,
                password_hash=password_hasher.hash(secrets.token_urlsafe(48)),
                full_name=profile.full_name,
                status="active",
            )
            db.add(user)
            db.flush()
        elif user.status != "active":
            return response
        identity = OAuthIdentity(user_id=user.id, provider="google", subject=profile.subject)
        db.add(identity)
    bootstrap_google_school_admin(db, user)
    user.last_login_at = datetime.now(timezone.utc)
    token = new_session(db, user)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        return response
    response = RedirectResponse("/", status_code=status.HTTP_303_SEE_OTHER)
    response.delete_cookie(GOOGLE_ATTEMPT_COOKIE, path="/api/v1/auth/google")
    set_session_cookie(response, token)
    return response


@app.post("/api/v1/auth/login", response_model=TeacherResponse)
def login(payload: LoginRequest, response: Response, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.email == normalise_email(payload.email)))
    if user is None or not password_hasher.verify(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password.")
    user.last_login_at = __import__("datetime").datetime.now(__import__("datetime").timezone.utc)
    token = new_session(db, user)
    db.commit()
    set_session_cookie(response, token)
    return serialize_teacher(user)


@app.post("/api/v1/auth/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(response: Response, session_token: str | None = Cookie(default=None, alias=COOKIE_NAME), db: Session = Depends(get_db)):
    authenticated = current_session(db, session_token)
    if authenticated:
        authenticated[1].revoked_at = __import__("datetime").datetime.now(__import__("datetime").timezone.utc)
        db.commit()
    response.delete_cookie(COOKIE_NAME, path="/")

@app.post("/api/v1/auth/refresh", response_model=TeacherResponse)
def refresh_session(response: Response, session_token: str | None = Cookie(default=None, alias=COOKIE_NAME), db: Session = Depends(get_db)):
    authenticated = current_session(db, session_token)
    if authenticated is None:
        raise HTTPException(status_code=401, detail="Authentication required.")
    user, old_session = authenticated
    old_session.revoked_at = __import__("datetime").datetime.now(__import__("datetime").timezone.utc)
    token = new_session(db, user); db.commit(); set_session_cookie(response, token)
    return serialize_teacher(user)


@app.get("/api/v1/me", response_model=TeacherResponse)
def me(user: User = Depends(current_teacher)):
    return serialize_teacher(user)


@app.get("/api/v1/schools", response_model=list[SchoolResponse])
def list_schools(user: User = Depends(current_teacher), db: Session = Depends(get_db)):
    memberships = db.scalars(select(SchoolMembership).where(SchoolMembership.user_id == user.id)).all()
    result: list[SchoolResponse] = []
    for membership in memberships:
        school = db.get(School, membership.school_id)
        if school is not None:
            result.append(SchoolResponse(id=school.id, name=school.name, role=membership.role))
    return result


@app.post("/api/v1/schools", response_model=SchoolResponse, status_code=status.HTTP_201_CREATED)
def create_school(payload: SchoolCreateRequest, user: User = Depends(current_teacher), db: Session = Depends(get_db)):
    name = " ".join(payload.name.split())
    if db.scalar(select(School.id).where(School.name == name)) is not None:
        raise HTTPException(status_code=409, detail="A school with this name already exists.")
    school = School(name=name, created_by_user_id=user.id)
    db.add(school)
    db.flush()
    db.add(SchoolMembership(school_id=school.id, user_id=user.id, role="school_admin"))
    db.commit()
    return SchoolResponse(id=school.id, name=school.name, role="school_admin")


@app.get("/api/v1/schools/{school_id}/members", response_model=list[SchoolMemberResponse])
def list_school_members(school_id: str, user: User = Depends(current_teacher), db: Session = Depends(get_db)):
    if membership_for(db, school_id, user.id) is None:
        raise HTTPException(status_code=404, detail="School not found.")
    memberships = db.scalars(select(SchoolMembership).where(SchoolMembership.school_id == school_id)).all()
    result: list[SchoolMemberResponse] = []
    for membership in memberships:
        member = db.get(User, membership.user_id)
        if member is not None:
            result.append(SchoolMemberResponse(user_id=member.id, email=member.email, full_name=member.full_name, role=membership.role))
    return result


@app.put("/api/v1/schools/{school_id}/members", response_model=SchoolMemberResponse)
def add_or_update_school_member(school_id: str, payload: SchoolMemberRequest, user: User = Depends(current_teacher), db: Session = Depends(get_db)):
    require_school_admin(db, school_id, user)
    if db.get(School, school_id) is None:
        raise HTTPException(status_code=404, detail="School not found.")
    member = db.scalar(select(User).where(User.email == normalise_email(payload.email)))
    if member is None:
        raise HTTPException(status_code=404, detail="Teacher must register an account before being added to a school.")
    membership = membership_for(db, school_id, member.id)
    if membership is None:
        membership = SchoolMembership(school_id=school_id, user_id=member.id, role=payload.role)
        db.add(membership)
    else:
        membership.role = payload.role
    db.commit()
    return SchoolMemberResponse(user_id=member.id, email=member.email, full_name=member.full_name, role=membership.role)


@app.delete("/api/v1/schools/{school_id}/members/{member_user_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_school_member(school_id: str, member_user_id: str, user: User = Depends(current_teacher), db: Session = Depends(get_db)):
    require_school_admin(db, school_id, user)
    membership = membership_for(db, school_id, member_user_id)
    if membership is None:
        raise HTTPException(status_code=404, detail="School member not found.")
    if membership.role == "school_admin":
        admin_count = len(db.scalars(select(SchoolMembership.id).where(SchoolMembership.school_id == school_id, SchoolMembership.role == "school_admin")).all())
        if admin_count <= 1:
            raise HTTPException(status_code=409, detail="A school must retain at least one administrator.")
    db.delete(membership)
    db.commit()


@app.get("/api/v1/schools/{school_id}/analytics/imports", response_model=list[AnalyticsImportResponse])
def list_analytics_imports(school_id: str, user: User = Depends(current_teacher), db: Session = Depends(get_db)):
    require_school_admin(db, school_id, user)
    rows = db.scalars(
        select(AnalyticsImport)
        .where(AnalyticsImport.school_id == school_id)
        .order_by(AnalyticsImport.created_at.desc())
    ).all()
    return [serialise_analytics_import(item) for item in rows]


@app.post("/api/v1/schools/{school_id}/analytics/imports", response_model=AnalyticsImportResponse, status_code=status.HTTP_201_CREATED)
async def import_k12online_analytics_report(
    school_id: str,
    upload: UploadFile = File(...),
    user: User = Depends(current_teacher),
    db: Session = Depends(get_db),
):
    """Import a CSV/XLSX report without retaining the original report or learner identifier."""
    require_school_admin(db, school_id, user)
    filename = Path(upload.filename or "k12online-report").name
    if len(filename) > 255:
        raise HTTPException(status_code=422, detail="Tên tệp quá dài.")
    raw = await upload.read()
    source_hash = hashlib.sha256(raw).hexdigest()
    if db.scalar(select(AnalyticsImport.id).where(AnalyticsImport.school_id == school_id, AnalyticsImport.source_sha256 == source_hash)):
        raise HTTPException(status_code=409, detail="Báo cáo này đã được nhập cho nhóm trường. Không lưu tệp gốc hoặc tạo bản sao dữ liệu.")
    try:
        raw_rows, mapping = parse_report(filename, upload.content_type, raw)
        normalized, errors = normalize_rows(raw_rows, mapping, pseudonym_key=analytics_pseudonym_key())
    except AnalyticsImportError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    item = AnalyticsImport(
        school_id=school_id,
        imported_by_user_id=user.id,
        original_filename=filename,
        source_sha256=source_hash,
        row_count=len(raw_rows),
        accepted_row_count=len(normalized),
        rejected_row_count=len(raw_rows) - len(normalized),
        mapping_json={field: header for field, header in mapping.items() if field != "learner_identifier"},
        error_summary_json=errors,
    )
    db.add(item)
    db.flush()
    db.add_all([LearningAnalytics(import_id=item.id, school_id=school_id, **event) for event in normalized])
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Báo cáo này đã được nhập cho nhóm trường.") from exc
    db.refresh(item)
    return serialise_analytics_import(item)


@app.get("/api/v1/schools/{school_id}/analytics/summary", response_model=AnalyticsSummaryResponse)
def get_analytics_summary(school_id: str, user: User = Depends(current_teacher), db: Session = Depends(get_db)):
    # Teachers can see school-level aggregates, but never raw report rows or learner-level data.
    require_school_membership(db, school_id, user)
    summary = analytics_summary_for_school(db, school_id)
    return AnalyticsSummaryResponse(
        **summary,
        privacy_note="Chỉ hiển thị số liệu tổng hợp theo trường/bài học; không trả về tên, email hay mã học viên gốc.",
    )


@app.get("/api/v1/schools/{school_id}/analytics/insights", response_model=AnalyticsInsightsResponse)
def get_analytics_insights(school_id: str, user: User = Depends(current_teacher), db: Session = Depends(get_db)):
    require_school_membership(db, school_id, user)
    summary = analytics_summary_for_school(db, school_id)
    return AnalyticsInsightsResponse(
        method="deterministic_aggregate",
        insights=aggregate_insights(summary),
        privacy_note="Gợi ý được tính từ chỉ số tổng hợp ẩn danh, không dùng để chấm điểm, xếp loại hoặc ra quyết định tự động về học sinh/giáo viên.",
    )


@app.get("/api/v1/shared-questions", response_model=list[SharedQuestionResponse])
def list_shared_questions(school_id: str, user: User = Depends(current_teacher), db: Session = Depends(get_db)):
    membership = require_school_membership(db, school_id, user)
    candidates = db.scalars(
        select(SharedQuestion)
        .where(SharedQuestion.school_id == school_id)
        .order_by(SharedQuestion.updated_at.desc())
    ).all()
    visible = [
        item for item in candidates
        if item.status == "published" or item.submitted_by_user_id == user.id or membership.role == "school_admin"
    ]
    return [serialise_shared_question(item, db) for item in visible]


@app.post("/api/v1/shared-questions", response_model=SharedQuestionResponse, status_code=status.HTTP_201_CREATED)
def create_shared_question_endpoint(payload: SharedQuestionCreateRequest, user: User = Depends(current_teacher), db: Session = Depends(get_db)):
    item = create_shared_question(
        db, user=user, school_id=payload.school_id, subject=payload.subject, grade=payload.grade,
        topic=payload.topic, learning_objectives=payload.learning_objectives, question=payload.question,
    )
    return serialise_shared_question(item, db)


@app.post("/api/v1/shared-questions/{shared_question_id}/submit", response_model=SharedQuestionResponse)
def submit_shared_question(shared_question_id: str, user: User = Depends(current_teacher), db: Session = Depends(get_db)):
    item = db.get(SharedQuestion, shared_question_id)
    if item is None or item.submitted_by_user_id != user.id:
        raise HTTPException(status_code=404, detail="Shared question not found.")
    require_school_membership(db, item.school_id, user)
    if item.status not in {"draft", "rejected"}:
        raise HTTPException(status_code=409, detail="Only a draft or rejected question can be submitted.")
    item.status, item.reviewed_by_user_id, item.reviewed_at = "submitted", None, None
    db.commit()
    db.refresh(item)
    return serialise_shared_question(item, db)


@app.post("/api/v1/shared-questions/{shared_question_id}/review", response_model=SharedQuestionResponse)
def review_shared_question(shared_question_id: str, payload: SharedQuestionReviewRequest, user: User = Depends(current_teacher), db: Session = Depends(get_db)):
    item = db.get(SharedQuestion, shared_question_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Shared question not found.")
    require_school_admin(db, item.school_id, user)
    if item.status != "submitted":
        raise HTTPException(status_code=409, detail="Only a submitted question can be reviewed.")
    if item.submitted_by_user_id == user.id:
        raise HTTPException(status_code=403, detail="A different school administrator must review this question.")
    item.status = payload.decision
    item.reviewed_by_user_id = user.id
    item.reviewed_at = __import__("datetime").datetime.now(__import__("datetime").timezone.utc)
    db.commit()
    db.refresh(item)
    return serialise_shared_question(item, db)


@app.post("/api/v1/projects/{project_id}/questions/{question_id}/shared-draft", response_model=SharedQuestionResponse, status_code=status.HTTP_201_CREATED)
def create_shared_question_from_project(
    project_id: str,
    question_id: str,
    payload: SharedQuestionFromProjectRequest,
    user: User = Depends(current_teacher),
    db: Session = Depends(get_db),
):
    project, _ = project_with_access(db, project_id, user, require_edit=True)
    course = Course.model_validate(project.course_json)
    source_question = next((item for item in course.question_bank if item.id == question_id), None)
    if source_question is None:
        raise HTTPException(status_code=404, detail="Question not found in this project.")
    question = SharedQuestionContent(
        type=source_question.type, question=source_question.question, difficulty=source_question.difficulty,
        correct_answer=source_question.correct_answer, options=source_question.options,
        recommended_score=source_question.score, explanation=source_question.explanation,
        feedback_correct=source_question.feedback_correct, feedback_incorrect=source_question.feedback_incorrect,
    )
    item = create_shared_question(
        db, user=user, school_id=payload.school_id, subject=payload.subject, grade=payload.grade,
        topic=payload.topic, learning_objectives=payload.learning_objectives, question=question,
    )
    return serialise_shared_question(item, db)


@app.post("/api/v1/projects/{project_id}/shared-questions/{shared_question_id}/add", response_model=ProjectResponse)
def add_shared_question_to_project(
    project_id: str,
    shared_question_id: str,
    payload: SharedQuestionImportRequest,
    user: User = Depends(current_teacher),
    db: Session = Depends(get_db),
):
    project, access = project_with_access(db, project_id, user, require_edit=True)
    item = db.get(SharedQuestion, shared_question_id)
    if item is None or item.status != "published":
        raise HTTPException(status_code=404, detail="Published shared question not found.")
    require_school_membership(db, item.school_id, user)
    if project.revision != payload.expected_revision:
        raise HTTPException(status_code=409, detail={"code": "COURSE_REVISION_CONFLICT", "message": "The project was updated in another session."})
    shared = SharedQuestionContent.model_validate(item.question_json)
    course = Course.model_validate(project.course_json)
    course.question_bank.append(Question(
        id=str(__import__("uuid").uuid4()), type=shared.type, question=shared.question,
        selected=payload.selected, score=shared.recommended_score, difficulty=shared.difficulty,
        correct_answer=shared.correct_answer, options=shared.options, explanation=shared.explanation,
        feedback_correct=shared.feedback_correct, feedback_incorrect=shared.feedback_incorrect,
    ))
    course.revision = payload.expected_revision + 1
    result = db.execute(
        update(Project)
        .where(Project.id == project_id, Project.revision == payload.expected_revision)
        .values(course_json=course.model_dump(mode="json"), revision=course.revision)
    )
    if result.rowcount != 1:
        db.rollback()
        raise HTTPException(status_code=409, detail={"code": "COURSE_REVISION_CONFLICT", "message": "The project was updated in another session."})
    db.commit()
    return get_project(project_id, user, db)


def credential_response(item: AICredential) -> CredentialResponse:
    return CredentialResponse(id=item.id, provider=item.provider, label=item.label, secret_last4=item.secret_last4, model_default=item.model_default, status=item.status)

@app.get("/api/v1/ai/credentials", response_model=list[CredentialResponse])
def list_credentials(user: User = Depends(current_teacher), db: Session = Depends(get_db)):
    return [credential_response(x) for x in db.scalars(select(AICredential).where(AICredential.user_id == user.id, AICredential.status == "active")).all()]

@app.post("/api/v1/ai/credentials", response_model=CredentialResponse, status_code=status.HTTP_201_CREATED)
def create_credential(payload: CredentialCreateRequest, user: User = Depends(current_teacher), db: Session = Depends(get_db)):
    item = AICredential(user_id=user.id, provider=payload.provider, label=payload.label, encrypted_secret=encrypt(payload.secret), secret_last4=payload.secret[-4:], model_default=payload.model_default)
    db.add(item); db.commit(); db.refresh(item)
    return credential_response(item)

@app.patch("/api/v1/ai/credentials/{credential_id}", response_model=CredentialResponse)
def update_credential(credential_id: str, payload: CredentialUpdateRequest, user: User = Depends(current_teacher), db: Session = Depends(get_db)):
    item = db.scalar(select(AICredential).where(AICredential.id == credential_id, AICredential.user_id == user.id, AICredential.status == "active"))
    if item is None:
        raise HTTPException(status_code=404, detail="Credential not found.")
    if "label" in payload.model_fields_set:
        item.label = payload.label
    if "model_default" in payload.model_fields_set:
        item.model_default = payload.model_default
    if payload.secret is not None:
        item.encrypted_secret, item.secret_last4 = encrypt(payload.secret), payload.secret[-4:]
    db.commit(); db.refresh(item)
    return credential_response(item)

@app.delete("/api/v1/ai/credentials/{credential_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_credential(credential_id: str, user: User = Depends(current_teacher), db: Session = Depends(get_db)):
    item = db.scalar(select(AICredential).where(AICredential.id == credential_id, AICredential.user_id == user.id))
    if item is None: raise HTTPException(status_code=404, detail="Credential not found.")
    item.status = "revoked"; db.commit()

class GenerateRequest(BaseModel):
    title: str
    source: str
    direction: Literal["lesson", "review", "advanced"] = "lesson"
    provider: Literal["mock", "openai", "gemini"] = "mock"
    credential_id: str | None = None


class RegenerateSlideRequest(BaseModel):
    source: str = Field(min_length=1, max_length=24000)
    provider: Literal["mock", "openai", "gemini"] = "mock"
    credential_id: str | None = None
    expected_revision: int = Field(ge=1)

class QuizItem(BaseModel):
    id: str
    question: str
    options: List[str] = []
    answer: Any = ""
    quiz_type: str = "single"
    selected: bool = True
    settings: dict[str, Any] = Field(default_factory=dict)

class ExportRequest(BaseModel):
    title: str
    direction: str
    objectives: List[str]
    sections: List[dict]
    quizzes: List[QuizItem]
    passing_score: int = 70
    completion_percent: int = 90
    resume: bool = True
    navigation_mode: Literal["free", "sequential", "restricted"] = "free"
    show_menu: bool = True
    primary_color: str | None = None
    require_quiz: bool = True
    project_id: str | None = None
    media_by_id: dict[str, dict[str, str]] = Field(default_factory=dict)

def compact_sentences(text: str):
    text = re.sub(r"\s+", " ", text or "").strip()
    if not text:
        return []
    chunks = re.split(r"(?<=[.!?。])\s+|[;\n]+", text)
    return [c.strip(" -•") for c in chunks if len(c.strip()) > 12]

def make_mock_content(req: GenerateRequest):
    source_sentences = compact_sentences(req.source)
    if not source_sentences:
        source_sentences = [
            "Nội dung bài học sẽ được giáo viên cung cấp.",
            "Hệ thống phân tích nội dung và tổ chức thành các phần học ngắn.",
            "Các câu hỏi được sinh ra để kiểm tra mức độ hiểu bài."
        ]

    direction_names = {
        "lesson": "Bài học mới",
        "review": "Ôn tập – củng cố",
        "advanced": "Nâng cao – mở rộng",
    }
    direction_name = direction_names.get(req.direction, "Bài học mới")

    objectives = [
        f"Nắm được các ý chính của chủ đề “{req.title or 'Bài học'}”.",
        "Vận dụng kiến thức để trả lời câu hỏi và xử lý tình huống.",
        f"Hoàn thành hoạt động theo định hướng: {direction_name}."
    ]

    if req.direction == "review":
        objectives[1] = "Hệ thống hóa kiến thức trọng tâm và nhận diện lỗi thường gặp."
    elif req.direction == "advanced":
        objectives[1] = "Phân tích, liên hệ và vận dụng kiến thức ở mức độ nâng cao."

    section_titles = {
        "lesson": ["Khởi động", "Kiến thức trọng tâm", "Ví dụ – vận dụng", "Củng cố"],
        "review": ["Gợi nhớ kiến thức", "Hệ thống hóa", "Luyện tập", "Tổng kết"],
        "advanced": ["Đặt vấn đề", "Mở rộng kiến thức", "Thử thách vận dụng", "Kết luận"],
    }
    titles = section_titles.get(req.direction, section_titles["lesson"])

    sections = []
    for i, t in enumerate(titles):
        a = source_sentences[(i * 2) % len(source_sentences)]
        b = source_sentences[(i * 2 + 1) % len(source_sentences)] if len(source_sentences) > 1 else a
        sections.append({
            "id": f"s{i+1}",
            "title": t,
            "content": f"{a}\n\n{b}",
            "note": "AI gợi ý – giáo viên có thể sửa trực tiếp."
        })

    qbase = source_sentences[:8] if len(source_sentences) >= 8 else (source_sentences * 8)[:8]
    quizzes = []
    type_cycle = ["single", "multiple", "truefalse", "fill", "matching", "ordering"]
    for i, s in enumerate(qbase):
        stem = s[:120].rstrip(".")
        quizzes.append({
            "id": f"q{i+1}",
            "question": f"Câu {i+1}: Nhận định nào phù hợp nhất với nội dung “{stem}”?",
            "options": [
                "Phương án đúng theo nội dung bài học",
                "Phương án gây nhiễu 1",
                "Phương án gây nhiễu 2",
                "Phương án gây nhiễu 3"
            ],
            "answer": "Phương án đúng theo nội dung bài học",
            "quiz_type": type_cycle[i % len(type_cycle)],
            "selected": i < 4
        })

    generated = {
        "direction_name": direction_name,
        "objectives": objectives,
        "sections": sections,
        "quizzes": quizzes,
        "notice": "DEMO đang dùng Mock AI. Khi triển khai thật, thay adapter này bằng API cá nhân của giáo viên ở phía backend."
    }
    course_data = new_course(req.title or "Bài học", req.direction).model_dump(mode="json")
    course_data["objectives"] = [{"id": f"o{i+1}", "text": text} for i, text in enumerate(objectives)]
    course_data["slides"] = [
        {
            "id": section["id"], "title": section["title"], "layout": "content",
            "status": "ai_draft",
            "blocks": [{"id": f"{section['id']}-text", "type": "text", "text": section["content"], "settings": {}}],
            "speaker_notes": section["note"],
        }
        for section in sections
    ]
    course_data["question_bank"] = [
        {
            "id": quiz["id"], "type": quiz["quiz_type"], "question": quiz["question"],
            "options": quiz["options"], "correct_answer": quiz["answer"], "selected": quiz["selected"],
            "score": 1, "difficulty": "understand", "objective_ids": [], "settings": {},
        }
        for quiz in quizzes
    ]
    generated["course"] = Course.model_validate(course_data).model_dump(mode="json")
    return generated

def generation_prompt(req: GenerateRequest) -> str:
    strategies = {
        "lesson": "Đi từ khởi động, hình thành kiến thức, ví dụ/vận dụng đến củng cố.",
        "review": "Gợi nhớ kiến thức, hệ thống hóa, luyện tập theo lỗi thường gặp và tổng kết.",
        "advanced": "Đặt vấn đề, mở rộng khái niệm, thử thách vận dụng và kết luận mở rộng.",
    }
    return f"""Bạn là chuyên gia thiết kế bài giảng K-12 bằng tiếng Việt.
Tạo MỘT đối tượng JSON Course hợp lệ theo JSON Schema được cung cấp.
Chủ đề: {req.title!r}
Định hướng: {req.direction}
Nội dung nguồn: {req.source[:24000]}

Chiến lược: {strategies[req.direction]}
Yêu cầu tối thiểu: 3 mục tiêu, 4 slide có khối text và 4 câu hỏi. Nội dung
chính xác theo nguồn, phù hợp học sinh; tạo ít nhất 6 câu hỏi nhưng chỉ chọn
4 câu đầu cho quiz cuối; các slide có status ai_draft. Không thêm Markdown,
lời giải thích hay thuộc tính ngoài schema. Dùng tiếng Việt."""


def generated_response(course: Course, provider: str) -> dict:
    direction_name = {"lesson": "Bài học mới", "review": "Ôn tập – củng cố", "advanced": "Nâng cao – mở rộng"}[course.metadata.direction]
    sections = []
    for slide in course.slides:
        block = next((item for item in slide.blocks if item.type == "text"), None)
        sections.append({"id": slide.id, "title": slide.title, "content": block.text if block and block.text else "", "note": slide.speaker_notes or "AI gợi ý – giáo viên có thể sửa trực tiếp."})
    quizzes = [{"id": item.id, "question": item.question, "options": item.options,
                "answer": item.correct_answer, "quiz_type": item.type, "selected": item.selected,
                "settings": item.settings}
               for item in course.question_bank]
    return {"direction_name": direction_name, "objectives": [item.text for item in course.objectives],
            "sections": sections, "quizzes": quizzes, "course": course.model_dump(mode="json"),
            "notice": f"Đã tạo nội dung bằng {provider}. Giáo viên cần duyệt trước khi xuất bản."}


def provider_payload(result: ProviderResult | dict) -> tuple[dict, dict]:
    if isinstance(result, ProviderResult):
        return result.payload, result.metadata
    # Keeps test doubles and future adapter implementations backwards compatible.
    return result, {}


def generation_metadata(provider: str, metadata: dict, retries: int = 0) -> dict:
    safe = {key: metadata.get(key) for key in ("model", "request_id", "input_tokens", "output_tokens") if metadata.get(key) is not None}
    safe.update({"provider": provider, "retries": retries})
    return safe


def generate_real_content(req: GenerateRequest, credential: AICredential) -> dict:
    adapter = provider_for(credential.provider, api_key=decrypt(credential.encrypted_secret), model=credential.model_default)
    prompt = generation_prompt(req)
    last_error: Exception | None = None
    for attempt in range(2):
        try:
            payload, metadata = provider_payload(adapter.generate_structured(prompt=prompt, schema=Course.model_json_schema()))
            course = Course.model_validate(payload)
            course.metadata.title = req.title or course.metadata.title
            course.metadata.direction = req.direction
            course.revision = 1
            if len(course.objectives) < 3 or len(course.slides) < 4 or len(course.question_bank) < 4:
                raise ValueError("Course does not meet the minimum authoring requirements.")
            generated = generated_response(course, credential.provider)
            generated["generation"] = generation_metadata(credential.provider, metadata, retries=attempt)
            return generated
        except ProviderError:
            raise
        except (ValidationError, ValueError, TypeError) as exc:
            last_error = exc
            prompt += "\nLần trước bị từ chối vì không đúng schema hoặc thiếu mục bắt buộc. Hãy trả lại JSON Course hợp lệ, đầy đủ."
    raise HTTPException(status_code=502, detail="AI trả về dữ liệu chưa hợp lệ sau 2 lần thử. Hãy thử lại.") from last_error


def record_generation(db: Session, *, user_id: str, operation: str, metadata: dict, project_id: str | None = None) -> GenerationRun:
    run = GenerationRun(user_id=user_id, project_id=project_id, provider=metadata["provider"], model=metadata.get("model"),
                        request_id=metadata.get("request_id"), input_tokens=metadata.get("input_tokens"),
                        output_tokens=metadata.get("output_tokens"), operation=operation, metadata_json=metadata)
    db.add(run)
    return run


def selected_credential(provider: str, credential_id: str | None, user: User, db: Session) -> AICredential:
    if not credential_id:
        raise HTTPException(status_code=422, detail="Hãy chọn API key đã lưu cho nhà cung cấp này.")
    credential = db.scalar(select(AICredential).where(
        AICredential.id == credential_id, AICredential.user_id == user.id,
        AICredential.provider == provider, AICredential.status == "active",
    ))
    if credential is None:
        raise HTTPException(status_code=404, detail="Không tìm thấy API key đang hoạt động.")
    return credential


@app.post("/api/generate")
def generate(req: GenerateRequest, user: User = Depends(current_teacher), db: Session = Depends(get_db)):
    if req.provider == "mock":
        generated = make_mock_content(req)
        generated["generation"] = {"provider": "mock", "model": "mock", "retries": 0}
    else:
        try:
            generated = generate_real_content(req, selected_credential(req.provider, req.credential_id, user, db))
        except ProviderError as exc:
            raise HTTPException(status_code=502, detail="Không thể gọi AI. Hãy kiểm tra API key, model và hạn mức rồi thử lại.") from exc
    run = record_generation(db, user_id=user.id, operation="course", metadata=generated["generation"])
    db.commit(); db.refresh(run)
    generated["generation"]["id"] = run.id
    return generated


def mock_regenerated_slide(slide: Slide, source: str) -> Slide:
    sentences = compact_sentences(source) or ["Giáo viên cần bổ sung nội dung nguồn cho phần này."]
    content = "\n\n".join(sentences[:2])
    data = slide.model_dump(mode="json")
    data["status"] = "ai_draft"
    data["blocks"] = [{"id": f"{slide.id}-text", "type": "text", "text": content, "settings": {}}]
    data["speaker_notes"] = "AI đã tạo lại riêng phần này; giáo viên cần duyệt trước khi xuất bản."
    return Slide.model_validate(data)


def regenerate_real_slide(req: RegenerateSlideRequest, course: Course, slide: Slide, credential: AICredential) -> tuple[Slide, dict]:
    adapter = provider_for(credential.provider, api_key=decrypt(credential.encrypted_secret), model=credential.model_default)
    prompt = f"""Tạo lại RIÊNG một slide cho bài giảng K-12 tiếng Việt. Trả về đúng một JSON Slide theo schema.
Định hướng bài: {course.metadata.direction}; tiêu đề bài: {course.metadata.title!r}.
Slide hiện tại: {slide.model_dump_json()}
Nguồn để tham chiếu: {req.source}
Giữ nguyên id slide {slide.id!r}; đặt status là ai_draft; có ít nhất một block text. Không sửa các slide khác và không thêm Markdown."""
    last_error: Exception | None = None
    for attempt in range(2):
        try:
            payload, metadata = provider_payload(adapter.generate_structured(prompt=prompt, schema=Slide.model_json_schema()))
            regenerated = Slide.model_validate(payload)
            regenerated.id, regenerated.status = slide.id, "ai_draft"
            if not any(block.type == "text" and block.text for block in regenerated.blocks):
                raise ValueError("Regenerated slide does not contain text.")
            return regenerated, generation_metadata(credential.provider, metadata, retries=attempt)
        except ProviderError:
            raise
        except (ValidationError, ValueError, TypeError) as exc:
            last_error = exc
            prompt += "\nLần trước sai schema. Chỉ trả về JSON Slide hợp lệ với block text."
    raise HTTPException(status_code=502, detail="AI trả về slide chưa hợp lệ sau 2 lần thử. Hãy thử lại.") from last_error


@app.post("/api/v1/projects/{project_id}/slides/{slide_id}/regenerate", response_model=ProjectResponse)
def regenerate_slide(project_id: str, slide_id: str, payload: RegenerateSlideRequest, user: User = Depends(current_teacher), db: Session = Depends(get_db)):
    project, _ = project_with_access(db, project_id, user, require_edit=True)
    if project.revision != payload.expected_revision:
        raise HTTPException(status_code=409, detail={"code": "COURSE_REVISION_CONFLICT", "message": "The project was updated in another session."})
    course = Course.model_validate(project.course_json)
    index = next((i for i, item in enumerate(course.slides) if item.id == slide_id), None)
    if index is None:
        raise HTTPException(status_code=404, detail="Slide not found.")
    current_slide = course.slides[index]
    if current_slide.status == "approved":
        raise HTTPException(status_code=409, detail="Slide đã được duyệt; hệ thống sẽ không tự ghi đè.")
    if payload.provider == "mock":
        regenerated, metadata = mock_regenerated_slide(current_slide, payload.source), {"provider": "mock", "model": "mock", "retries": 0}
    else:
        try:
            regenerated, metadata = regenerate_real_slide(payload, course, current_slide, selected_credential(payload.provider, payload.credential_id, user, db))
        except ProviderError as exc:
            raise HTTPException(status_code=502, detail="Không thể gọi AI. Hãy kiểm tra API key, model và hạn mức rồi thử lại.") from exc
    course.slides[index] = regenerated
    course.revision = payload.expected_revision + 1
    result = db.execute(update(Project).where(Project.id == project_id, Project.revision == payload.expected_revision).values(
        course_json=course.model_dump(mode="json"), revision=course.revision, schema_version=course.schema_version,
    ))
    if result.rowcount != 1:
        db.rollback()
        raise HTTPException(status_code=409, detail={"code": "COURSE_REVISION_CONFLICT", "message": "The project was updated in another session."})
    record_generation(db, user_id=user.id, project_id=project_id, operation="slide_regenerate", metadata=metadata)
    db.commit()
    return get_project(project_id, user, db)


@app.get("/api/v1/projects", response_model=list[ProjectResponse])
def list_projects(user: User = Depends(current_teacher), db: Session = Depends(get_db)):
    owned = db.scalars(select(Project).where(Project.owner_user_id == user.id).order_by(Project.updated_at.desc())).all()
    shared = db.execute(
        select(Project, ProjectShare.access_level)
        .join(ProjectShare, ProjectShare.project_id == Project.id)
        .where(ProjectShare.user_id == user.id)
        .order_by(Project.updated_at.desc())
    ).all()
    projects = [(project, "owner") for project in owned] + [
        (project, share.access_level)
        for project, share in shared
        if shared_school_ids(db, project.owner_user_id, user.id)
    ]
    projects.sort(key=lambda item: item[0].updated_at or __import__("datetime").datetime.min, reverse=True)
    return [serialize_project(project, access) for project, access in projects]


@app.post("/api/v1/projects", response_model=ProjectResponse, status_code=status.HTTP_201_CREATED)
def create_project(payload: ProjectCreateRequest, user: User = Depends(current_teacher), db: Session = Depends(get_db)):
    course = payload.course or new_course(payload.title, payload.direction)
    if course.revision != 1:
        raise HTTPException(status_code=422, detail="A newly created project must start at revision 1.")
    if course.metadata.title != payload.title:
        course.metadata.title = payload.title
    project = Project(
        id=course.id, owner_user_id=user.id, title=course.metadata.title,
        status="active", course_json=course.model_dump(mode="json"),
        schema_version=course.schema_version, revision=course.revision,
    )
    db.add(project)
    if payload.generation_id:
        run = db.scalar(select(GenerationRun).where(GenerationRun.id == payload.generation_id, GenerationRun.user_id == user.id, GenerationRun.project_id.is_(None)))
        if run is not None:
            run.project_id = project.id
    try:
        db.commit()
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="A project with this course id already exists.") from exc
    db.refresh(project)
    return serialize_project(project)


@app.get("/api/v1/projects/{project_id}", response_model=ProjectResponse)
def get_project(project_id: str, user: User = Depends(current_teacher), db: Session = Depends(get_db)):
    project, access = project_with_access(db, project_id, user)
    return serialize_project(project, access)


@app.get("/api/v1/projects/{project_id}/shares", response_model=list[ProjectShareResponse])
def list_project_shares(project_id: str, user: User = Depends(current_teacher), db: Session = Depends(get_db)):
    project = db.scalar(select(Project).where(Project.id == project_id, Project.owner_user_id == user.id))
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found.")
    shares = db.scalars(select(ProjectShare).where(ProjectShare.project_id == project.id)).all()
    result: list[ProjectShareResponse] = []
    for share in shares:
        teacher = db.get(User, share.user_id)
        if teacher is not None:
            result.append(ProjectShareResponse(user_id=teacher.id, email=teacher.email, full_name=teacher.full_name, access_level=share.access_level))
    return result


@app.put("/api/v1/projects/{project_id}/shares", response_model=ProjectShareResponse)
def add_or_update_project_share(project_id: str, payload: ProjectShareRequest, user: User = Depends(current_teacher), db: Session = Depends(get_db)):
    project = db.scalar(select(Project).where(Project.id == project_id, Project.owner_user_id == user.id))
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found.")
    teacher = db.scalar(select(User).where(User.email == normalise_email(payload.email)))
    if teacher is None:
        raise HTTPException(status_code=404, detail="Teacher account not found.")
    if teacher.id == user.id:
        raise HTTPException(status_code=422, detail="Project owners already have full access.")
    if not shared_school_ids(db, user.id, teacher.id):
        raise HTTPException(status_code=422, detail="Projects can only be shared with a teacher in the same school.")
    share = db.scalar(select(ProjectShare).where(ProjectShare.project_id == project_id, ProjectShare.user_id == teacher.id))
    if share is None:
        share = ProjectShare(project_id=project_id, user_id=teacher.id, access_level=payload.access_level, granted_by_user_id=user.id)
        db.add(share)
    else:
        share.access_level = payload.access_level
        share.granted_by_user_id = user.id
    db.commit()
    return ProjectShareResponse(user_id=teacher.id, email=teacher.email, full_name=teacher.full_name, access_level=share.access_level)


@app.delete("/api/v1/projects/{project_id}/shares/{shared_user_id}", status_code=status.HTTP_204_NO_CONTENT)
def revoke_project_share(project_id: str, shared_user_id: str, user: User = Depends(current_teacher), db: Session = Depends(get_db)):
    if db.scalar(select(Project.id).where(Project.id == project_id, Project.owner_user_id == user.id)) is None:
        raise HTTPException(status_code=404, detail="Project not found.")
    share = db.scalar(select(ProjectShare).where(ProjectShare.project_id == project_id, ProjectShare.user_id == shared_user_id))
    if share is None:
        raise HTTPException(status_code=404, detail="Project share not found.")
    db.delete(share)
    db.commit()


@app.patch("/api/v1/projects/{project_id}", response_model=ProjectResponse)
def update_project(project_id: str, payload: ProjectUpdateRequest, user: User = Depends(current_teacher), db: Session = Depends(get_db)):
    project_with_access(db, project_id, user, require_edit=True)
    if payload.course.id != project_id:
        raise HTTPException(status_code=422, detail="course.id must match the project id.")
    if payload.course.revision != payload.expected_revision + 1:
        raise HTTPException(status_code=422, detail="course.revision must be exactly one greater than expected_revision.")

    result = db.execute(
        update(Project)
        .where(
            Project.id == project_id,
            Project.revision == payload.expected_revision,
        )
        .values(
            title=payload.course.metadata.title,
            course_json=payload.course.model_dump(mode="json"),
            schema_version=payload.course.schema_version,
            revision=payload.course.revision,
        )
    )
    if result.rowcount != 1:
        db.rollback()
        existing = db.get(Project, project_id)
        if existing is None:
            raise HTTPException(status_code=404, detail="Project not found.")
        raise HTTPException(status_code=409, detail={"code": "COURSE_REVISION_CONFLICT", "message": "The project was updated in another session."})
    if payload.generation_id:
        run = db.scalar(select(GenerationRun).where(GenerationRun.id == payload.generation_id, GenerationRun.user_id == user.id, GenerationRun.project_id.is_(None)))
        if run is not None:
            run.project_id = project_id
    db.commit()
    return get_project(project_id, user, db)

@app.post("/api/v1/projects/{project_id}/duplicate", response_model=ProjectResponse, status_code=status.HTTP_201_CREATED)
def duplicate_project(project_id: str, user: User = Depends(current_teacher), db: Session = Depends(get_db)):
    source = get_project(project_id, user, db)
    course = source.course.model_copy(deep=True)
    course.id = str(__import__("uuid").uuid4()); course.revision = 1
    course.metadata.title = f"{course.metadata.title} (bản sao)"
    project = Project(id=course.id, owner_user_id=user.id, title=course.metadata.title, status="active", course_json=course.model_dump(mode="json"), schema_version=course.schema_version, revision=1)
    db.add(project); db.commit(); db.refresh(project)
    return serialize_project(project)

@app.post("/api/v1/projects/{project_id}/archive", response_model=ProjectResponse)
def archive_project(project_id: str, user: User = Depends(current_teacher), db: Session = Depends(get_db)):
    project = db.scalar(select(Project).where(Project.id == project_id, Project.owner_user_id == user.id))
    if project is None: raise HTTPException(status_code=404, detail="Project not found.")
    project.status = "archived"; db.commit(); db.refresh(project)
    return serialize_project(project)

@app.delete("/api/v1/projects/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_project(project_id: str, user: User = Depends(current_teacher), db: Session = Depends(get_db)):
    project = db.scalar(select(Project).where(Project.id == project_id, Project.owner_user_id == user.id))
    if project is None: raise HTTPException(status_code=404, detail="Project not found.")
    db.delete(project); db.commit()

@app.post("/api/v1/projects/{project_id}/sources", response_model=SourceResponse, status_code=status.HTTP_201_CREATED)
async def upload_source(project_id: str, upload: UploadFile = File(...), user: User = Depends(current_teacher), db: Session = Depends(get_db)):
    project, _ = project_with_access(db, project_id, user, require_edit=True)
    content = await upload.read()
    try: validate_upload(upload.filename or "", upload.content_type or "", content)
    except ValueError as exc: raise HTTPException(status_code=422, detail=str(exc)) from exc
    import hashlib, uuid
    key = f"users/{user.id}/projects/{project_id}/source/{uuid.uuid4()}-{hashlib.sha256((upload.filename or '').encode()).hexdigest()[:12]}"
    storage.put(key, content, upload.content_type or "application/octet-stream")
    source = SourceMaterial(user_id=user.id, project_id=project_id, original_name=upload.filename or "source", mime_type=upload.content_type or "", byte_size=len(content), storage_key=key, extracted_text=extract_text(upload.content_type or "", content))
    db.add(source); db.commit(); db.refresh(source)
    return SourceResponse(id=source.id, original_name=source.original_name, mime_type=source.mime_type, byte_size=source.byte_size, extracted_text=source.extracted_text)

@app.get("/api/v1/projects/{project_id}/sources", response_model=list[SourceResponse])
def list_sources(project_id: str, user: User = Depends(current_teacher), db: Session = Depends(get_db)):
    project_with_access(db, project_id, user)
    return [SourceResponse(id=x.id, original_name=x.original_name, mime_type=x.mime_type, byte_size=x.byte_size, extracted_text=x.extracted_text) for x in db.scalars(select(SourceMaterial).where(SourceMaterial.project_id == project_id)).all()]


def media_warning(item: MediaAsset) -> str | None:
    if item.kind == "video" and item.byte_size > SCORM_VIDEO_WARNING_BYTES:
        return "Video lớn hơn 25 MB: sẽ làm SCORM ZIP nặng; cân nhắc nén, chia nhỏ hoặc dùng URL HTTPS được LMS cho phép."
    if item.source_type == "url":
        return "URL ngoài không được sao chép vào SCORM; cần kiểm tra quyền sử dụng và khả năng truy cập của LMS trước khi xuất."
    return None


def serialise_media(item: MediaAsset) -> MediaResponse:
    return MediaResponse(
        id=item.id, project_id=item.project_id, slide_id=item.slide_id, kind=item.kind, source_type=item.source_type,
        original_name=item.original_name, mime_type=item.mime_type, byte_size=item.byte_size, prompt=item.prompt,
        provider=item.provider, model=item.model, rights_confirmed=item.rights_confirmed, status=item.status,
        content_url=f"/api/v1/media/{item.id}/content", warning=media_warning(item),
    )


def require_slide(project: Project, slide_id: str) -> Course:
    course = Course.model_validate(project.course_json)
    if not any(slide.id == slide_id for slide in course.slides):
        raise HTTPException(status_code=404, detail="Slide not found.")
    return course


def create_media_asset(db: Session, *, project_id: str, user_id: str, slide_id: str | None, kind: str,
                       source_type: str, original_name: str, mime_type: str, content: bytes | None = None,
                       external_url: str | None = None, prompt: str | None = None, provider: str | None = None,
                       model: str | None = None, rights_confirmed: bool = False) -> MediaAsset:
    import uuid
    asset = MediaAsset(user_id=user_id, project_id=project_id, slide_id=slide_id, kind=kind, source_type=source_type,
                       original_name=original_name, mime_type=mime_type, byte_size=len(content or b""),
                       external_url=external_url, prompt=prompt, provider=provider, model=model,
                       rights_confirmed=rights_confirmed, status="draft")
    if content is not None:
        asset.storage_key = f"users/{user_id}/projects/{project_id}/media/{uuid.uuid4()}{extension_for_mime(mime_type)}"
        storage.put(asset.storage_key, content, mime_type)
    db.add(asset)
    return asset


@app.post("/api/v1/projects/{project_id}/media/upload", response_model=MediaResponse, status_code=status.HTTP_201_CREATED)
async def upload_media(project_id: str, slide_id: str, rights_confirmed: bool, upload: UploadFile = File(...),
                       user: User = Depends(current_teacher), db: Session = Depends(get_db)):
    project, _ = project_with_access(db, project_id, user, require_edit=True)
    require_slide(project, slide_id)
    if not rights_confirmed:
        raise HTTPException(status_code=422, detail="Cần xác nhận quyền sử dụng ảnh, âm thanh hoặc video trước khi tải lên.")
    content = await upload.read()
    try:
        kind = validate_media_upload(upload.filename or "", upload.content_type or "", content)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    asset = create_media_asset(db, project_id=project_id, user_id=user.id, slide_id=slide_id, kind=kind,
                               source_type="upload", original_name=upload.filename or "media", mime_type=upload.content_type or "",
                               content=content, rights_confirmed=True)
    db.commit(); db.refresh(asset)
    return serialise_media(asset)


@app.post("/api/v1/projects/{project_id}/media/url", response_model=MediaResponse, status_code=status.HTTP_201_CREATED)
def add_media_url(project_id: str, slide_id: str, payload: MediaUrlRequest, user: User = Depends(current_teacher), db: Session = Depends(get_db)):
    project, _ = project_with_access(db, project_id, user, require_edit=True)
    require_slide(project, slide_id)
    if not payload.rights_confirmed:
        raise HTTPException(status_code=422, detail="Cần xác nhận quyền sử dụng media trước khi lưu URL.")
    try:
        validate_media_url(payload.url, payload.kind)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    mime_type = {"image": "image/*", "audio": "audio/*", "video": "video/*"}[payload.kind]
    asset = create_media_asset(db, project_id=project_id, user_id=user.id, slide_id=slide_id, kind=payload.kind,
                               source_type="url", original_name=payload.label, mime_type=mime_type,
                               external_url=payload.url, rights_confirmed=True)
    db.commit(); db.refresh(asset)
    return serialise_media(asset)


def run_media_provider(provider: str, credential_id: str | None, user: User, db: Session):
    if provider == "mock":
        return media_provider_for("mock"), None
    credential = selected_credential(provider, credential_id, user, db)
    return media_provider_for(provider, api_key=decrypt(credential.encrypted_secret)), credential


@app.post("/api/v1/projects/{project_id}/slides/{slide_id}/image", response_model=MediaResponse, status_code=status.HTTP_201_CREATED)
def generate_slide_image(project_id: str, slide_id: str, payload: MediaImageRequest, user: User = Depends(current_teacher), db: Session = Depends(get_db)):
    project, _ = project_with_access(db, project_id, user, require_edit=True)
    require_slide(project, slide_id)
    try:
        adapter, _ = run_media_provider(payload.provider, payload.credential_id, user, db)
        generated = adapter.generate_image(prompt=payload.prompt)
    except (ProviderError, ValueError) as exc:
        raise HTTPException(status_code=502, detail="Không thể tạo ảnh. Hãy kiểm tra API key, model và hạn mức rồi thử lại.") from exc
    asset = create_media_asset(db, project_id=project_id, user_id=user.id, slide_id=slide_id, kind="image",
                               source_type="generated", original_name="ai-image.png", mime_type=generated.mime_type,
                               content=generated.content, prompt=payload.prompt, provider=payload.provider,
                               model=generated.metadata.get("model"), rights_confirmed=True)
    record_generation(db, user_id=user.id, project_id=project_id, operation="media_image",
                      metadata={"provider": payload.provider, **generated.metadata})
    db.commit(); db.refresh(asset)
    return serialise_media(asset)


@app.post("/api/v1/projects/{project_id}/slides/{slide_id}/tts", response_model=MediaResponse, status_code=status.HTTP_201_CREATED)
def generate_slide_tts(project_id: str, slide_id: str, payload: MediaTTSRequest, user: User = Depends(current_teacher), db: Session = Depends(get_db)):
    project, _ = project_with_access(db, project_id, user, require_edit=True)
    require_slide(project, slide_id)
    try:
        adapter, _ = run_media_provider(payload.provider, payload.credential_id, user, db)
        # Alloy is the default shown for OpenAI. Use a Gemini-compatible default when the teacher
        # has not changed it; custom voices still pass through the provider adapter untouched.
        voice = "Kore" if payload.provider == "gemini" and payload.voice.lower() == "alloy" else payload.voice
        generated = adapter.synthesize_speech(text=payload.text, voice=voice)
    except (ProviderError, ValueError) as exc:
        raise HTTPException(status_code=502, detail="Không thể tạo giọng đọc. Hãy kiểm tra API key, model, giọng đọc và hạn mức rồi thử lại.") from exc
    asset = create_media_asset(db, project_id=project_id, user_id=user.id, slide_id=slide_id, kind="audio",
                               source_type="tts", original_name="slide-tts" + extension_for_mime(generated.mime_type), mime_type=generated.mime_type,
                               content=generated.content, prompt=payload.text, provider=payload.provider,
                               model=generated.metadata.get("model"), rights_confirmed=True)
    record_generation(db, user_id=user.id, project_id=project_id, operation="media_tts",
                      metadata={"provider": payload.provider, **generated.metadata})
    db.commit(); db.refresh(asset)
    return serialise_media(asset)


@app.get("/api/v1/projects/{project_id}/media", response_model=list[MediaResponse])
def list_media(project_id: str, user: User = Depends(current_teacher), db: Session = Depends(get_db)):
    project_with_access(db, project_id, user)
    items = db.scalars(select(MediaAsset).where(MediaAsset.project_id == project_id).order_by(MediaAsset.created_at.desc())).all()
    return [serialise_media(item) for item in items]


@app.get("/api/v1/media/{asset_id}/content")
def media_content(asset_id: str, user: User = Depends(current_teacher), db: Session = Depends(get_db)):
    asset = db.get(MediaAsset, asset_id)
    if asset is None:
        raise HTTPException(status_code=404, detail="Media not found.")
    project_with_access(db, asset.project_id, user)
    if asset.external_url:
        return RedirectResponse(asset.external_url, status_code=status.HTTP_307_TEMPORARY_REDIRECT)
    if not asset.storage_key:
        raise HTTPException(status_code=404, detail="Media content is unavailable.")
    return StreamingResponse(io.BytesIO(storage.get(asset.storage_key)), media_type=asset.mime_type)


@app.post("/api/v1/projects/{project_id}/slides/{slide_id}/media", response_model=ProjectResponse)
def attach_media(project_id: str, slide_id: str, payload: MediaAttachRequest, user: User = Depends(current_teacher), db: Session = Depends(get_db)):
    project, _ = project_with_access(db, project_id, user, require_edit=True)
    if project.revision != payload.expected_revision:
        raise HTTPException(status_code=409, detail={"code": "COURSE_REVISION_CONFLICT", "message": "The project was updated in another session."})
    asset = db.scalar(select(MediaAsset).where(MediaAsset.id == payload.asset_id, MediaAsset.project_id == project_id))
    if asset is None:
        raise HTTPException(status_code=404, detail="Media asset not found in this project.")
    course = require_slide(project, slide_id)
    slide = next(item for item in course.slides if item.id == slide_id)
    if not any(block.asset_id == asset.id for block in slide.blocks):
        slide.blocks.append(Block(id=f"asset-{asset.id}", type=asset.kind, asset_id=asset.id, settings={"source_type": asset.source_type}))
    course.revision = payload.expected_revision + 1
    result = db.execute(update(Project).where(Project.id == project_id, Project.revision == payload.expected_revision).values(
        course_json=course.model_dump(mode="json"), revision=course.revision, schema_version=course.schema_version,
    ))
    if result.rowcount != 1:
        db.rollback()
        raise HTTPException(status_code=409, detail={"code": "COURSE_REVISION_CONFLICT", "message": "The project was updated in another session."})
    asset.status = "attached"
    db.commit()
    return get_project(project_id, user, db)

def scorm_manifest(title: str, asset_paths: list[str] | None = None):
    safe_title = html.escape(title)
    media_files = "".join(f'      <file href="{html.escape(path, quote=True)}"/>\n' for path in (asset_paths or []))
    return f'''<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="AI_SCORM_STUDIO_DEMO"
 xmlns="http://www.imsglobal.org/xsd/imscp_v1p1"
 xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_v1p3"
 xmlns:adlseq="http://www.adlnet.org/xsd/adlseq_v1p3"
 xmlns:adlnav="http://www.adlnet.org/xsd/adlnav_v1p3"
 xmlns:imsss="http://www.imsglobal.org/xsd/imsss"
 xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <metadata>
    <schema>ADL SCORM</schema>
    <schemaversion>2004 4th Edition</schemaversion>
  </metadata>
  <organizations default="ORG-1">
    <organization identifier="ORG-1">
      <title>{safe_title}</title>
      <item identifier="ITEM-1" identifierref="RES-1">
        <title>{safe_title}</title>
      </item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="RES-1" type="webcontent" adlcp:scormType="sco" href="index.html">
      <file href="index.html"/>
      <file href="runtime.js"/>
{media_files}
    </resource>
  </resources>
</manifest>'''


def validate_scorm_package(files: dict[str, bytes], *, passing_score: int, completion_percent: int) -> list[str]:
    """Return deterministic package errors; an empty list means export-ready."""
    errors: list[str] = []
    required = {"imsmanifest.xml", "index.html", "runtime.js"}
    missing = required - set(files)
    if missing:
        errors.append(f"Missing root files: {', '.join(sorted(missing))}.")
    if not 0 <= passing_score <= 100:
        errors.append("Passing score must be between 0 and 100.")
    if not 0 <= completion_percent <= 100:
        errors.append("Completion percentage must be between 0 and 100.")
    manifest = files.get("imsmanifest.xml", b"")
    try:
        root = ElementTree.fromstring(manifest)
        resources = [node for node in root.iter() if node.tag.endswith("resource")]
        sco = next((node for node in resources if node.attrib.get("{http://www.adlnet.org/xsd/adlcp_v1p3}scormType") == "sco"), None)
        if sco is None or sco.attrib.get("href") != "index.html":
            errors.append("Manifest must declare index.html as a SCORM SCO launch resource.")
        for node in root.iter():
            href = node.attrib.get("href")
            if href and (href.startswith(("/", "file:", "http:")) or ".." in href):
                errors.append(f"Unsafe manifest reference: {href}.")
            if href and href not in files:
                errors.append(f"Manifest reference is missing from ZIP: {href}.")
    except ElementTree.ParseError:
        errors.append("imsmanifest.xml is not valid XML.")
    if b"API_1484_11" not in files.get("runtime.js", b""):
        errors.append("SCORM 2004 runtime adapter is missing.")
    if b"runtime.js" not in files.get("index.html", b""):
        errors.append("Player does not reference runtime.js.")
    return errors

def runtime_js():
    return r'''
let API = null;
let sessionStartedAt = 0;
const runtimeAdapter = {
  initialize(){ return API ? API.Initialize("") : "false"; },
  get(key){ return API ? (API.GetValue(key) || "") : ""; },
  set(key,value){ if(API) API.SetValue(key,String(value)); },
  commit(){ if(API) API.Commit(""); },
  terminate(){ if(API) API.Terminate(""); }
};
function findAPI(win) {
  let tries = 0;
  while (win && tries < 20) {
    if (win.API_1484_11) return win.API_1484_11;
    if (win.parent && win.parent !== win) win = win.parent; else break;
    tries++;
  }
  if (window.opener) {
    try { if (window.opener.API_1484_11) return window.opener.API_1484_11; } catch(e) {}
  }
  return null;
}
function scormInit(){
  API = findAPI(window);
  if (!API) return false;
  try {
    runtimeAdapter.initialize();
    const status = runtimeAdapter.get("cmi.completion_status");
    if (!status || status === "unknown" || status === "not attempted") {
      runtimeAdapter.set("cmi.completion_status","incomplete");
      runtimeAdapter.commit();
    }
    sessionStartedAt = Date.now();
    return true;
  } catch(e){ return false; }
}
function scormSet(k,v){ if(API){ try { runtimeAdapter.set(k,v); runtimeAdapter.commit(); } catch(e){} } }
function scormGet(k){ if(API){ try { return runtimeAdapter.get(k); } catch(e){} } return ""; }
function scormSuspend(state){ scormSet("cmi.suspend_data",JSON.stringify(state)); }
function scormResume(){ try { return JSON.parse(scormGet("cmi.suspend_data")||"{}"); } catch(e){ return {}; } }
function scormDuration(ms){ const seconds=Math.max(0,Math.floor(ms/1000)); return `PT${Math.floor(seconds/3600)}H${Math.floor(seconds%3600/60)}M${seconds%60}S`; }
function scormFinish(){ if(API){ try { if(sessionStartedAt) runtimeAdapter.set("cmi.session_time",scormDuration(Date.now()-sessionStartedAt)); runtimeAdapter.commit(); runtimeAdapter.terminate(); } catch(e){} } }
window.addEventListener("load", scormInit);
window.addEventListener("beforeunload", scormFinish);
'''

def export_request_from_course(course: Course, media_by_id: dict[str, dict[str, str]] | None = None) -> ExportRequest:
    media_by_id = media_by_id or {}
    return ExportRequest(
        title=course.metadata.title, direction=course.metadata.direction,
        objectives=[item.text for item in course.objectives],
        sections=[{"id": slide.id, "title": slide.title, "layout": slide.layout,
                   "content": next((block.text for block in slide.blocks if block.type == "text"), ""),
                   "media": [{"id": block.asset_id, "kind": block.type, **media_by_id[block.asset_id]}
                             for block in slide.blocks if block.asset_id and block.asset_id in media_by_id]}
                  for slide in course.slides],
        quizzes=[QuizItem(id=item.id, question=item.question, options=item.options,
                          answer=item.correct_answer, quiz_type=item.type, selected=item.selected,
                          settings=item.settings) for item in course.question_bank],
        passing_score=course.completion.passing_score, completion_percent=course.completion.viewed_percent,
        resume=course.scorm.resume, navigation_mode=course.navigation.mode,
        show_menu=course.navigation.show_menu, primary_color=course.theme.primary_color, require_quiz=course.completion.require_quiz,
        media_by_id=media_by_id,
    )


def json_for_script(value: object) -> str:
    """Embed data in a script without allowing authored text to end the tag."""
    return json.dumps(value, ensure_ascii=False).replace("<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026").replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")


def build_course_html(req: ExportRequest):
    title = html.escape(req.title)
    direction = html.escape(req.direction)
    primary_color = req.primary_color if req.primary_color and re.fullmatch(r"#[0-9A-Fa-f]{3,8}", req.primary_color) else "#3157d5"

    slides = []
    slides.append(f'''
      <section class="slide active" data-slide="0">
        <div class="eyebrow">AI SCORM Studio • {direction}</div>
        <h1>{title}</h1>
        <p class="lead">Bài giảng SCORM 2004 được tạo từ nội dung đã được giáo viên duyệt.</p>
        <div class="card">
          <h3>Mục tiêu</h3>
          <ul>{''.join(f"<li>{html.escape(x)}</li>" for x in req.objectives)}</ul>
        </div>
      </section>
    ''')

    for idx, s in enumerate(req.sections, start=1):
        content = html.escape(str(s.get("content",""))).replace("\n", "<br>")
        layout = re.sub(r"[^a-z0-9_-]", "", str(s.get("layout", "content")).lower()) or "content"
        media_html = []
        for media in s.get("media", []):
            source = str(media.get("src", ""))
            kind = str(media.get("kind", ""))
            label = html.escape(str(media.get("label", "Học liệu minh họa")))
            if not source or kind not in {"image", "audio", "video"}:
                continue
            safe_src = html.escape(source, quote=True)
            if kind == "image":
                media_html.append(f'<figure class="media image"><img src="{safe_src}" alt="{label}"><figcaption>{label}</figcaption></figure>')
            elif kind == "audio":
                media_html.append(f'<figure class="media audio"><figcaption>{label}</figcaption><audio controls preload="metadata" src="{safe_src}">Trình duyệt không hỗ trợ âm thanh.</audio></figure>')
            else:
                media_html.append(f'<figure class="media video"><video controls preload="metadata" src="{safe_src}">Trình duyệt không hỗ trợ video.</video><figcaption>{label}</figcaption></figure>')
        slides.append(f'''
          <section class="slide layout-{layout}" data-slide="{idx}">
            <div class="eyebrow">Nội dung {idx}</div>
            <h2>{html.escape(str(s.get("title","Phần học")))}</h2>
            <div class="content">{content}</div>
            {''.join(media_html)}
          </section>
        ''')

    selected = [q for q in req.quizzes if q.selected]
    quiz_index = len(slides)
    quiz_html = []
    for i, q in enumerate(selected):
        opts = q.options or ["Đúng", "Sai"]
        inputs = []
        if q.quiz_type == "multiple":
            for opt in opts:
                inputs.append(f'<label><input type="checkbox" name="{q.id}" value="{html.escape(opt)}"> {html.escape(opt)}</label>')
        elif q.quiz_type == "fill":
            inputs.append(f'<input class="fill" name="{q.id}" placeholder="Nhập câu trả lời">')
        elif q.quiz_type == "dragdrop":
            inputs.append(f'<div class="drag-bank">{''.join(f"<button type=\"button\" class=\"drag-token\" draggable=\"true\" data-value=\"{html.escape(opt, quote=True)}\">{html.escape(opt)}</button>" for opt in opts)}</div><div class="drop-zone" data-question="{q.id}" aria-label="Vùng thả đáp án">Kéo các thẻ vào đây theo thứ tự đúng</div>')
        elif q.quiz_type == "ordering":
            inputs.append(f'<div class="drag-bank">{''.join(f"<button type=\"button\" class=\"drag-token\" draggable=\"true\" data-value=\"{html.escape(opt, quote=True)}\">{html.escape(opt)}</button>" for opt in opts)}</div><div class="drop-zone" data-question="{q.id}" aria-label="Vùng sắp xếp đáp án">Kéo các thẻ vào đây theo thứ tự đúng</div>')
        elif q.quiz_type == "matching":
            pairs = q.answer if isinstance(q.answer, dict) else {}
            right_values = list(dict.fromkeys([str(value) for value in pairs.values()] + opts))
            for left in pairs:
                inputs.append(f'<label class="matching-option"><span>{html.escape(str(left))}</span><select data-match-left="{html.escape(str(left), quote=True)}"><option value="">Chọn đáp án</option>{''.join(f"<option value=\"{html.escape(value, quote=True)}\">{html.escape(value)}</option>" for value in right_values)}</select></label>')
        elif q.quiz_type == "image":
            image_options = q.settings.get("image_options", []) if isinstance(q.settings, dict) else []
            for item in image_options:
                if not isinstance(item, dict):
                    continue
                option_id, asset_id = str(item.get("id", "")), str(item.get("asset_id", ""))
                asset = req.media_by_id.get(asset_id, {})
                source = str(asset.get("src", "")) if asset.get("kind") == "image" else ""
                label = str(item.get("label") or asset.get("label") or option_id)
                if option_id and source:
                    inputs.append(f'<label class="image-option"><input type="radio" name="{q.id}" value="{html.escape(option_id, quote=True)}"><img src="{html.escape(source, quote=True)}" alt="{html.escape(label)}"><span>{html.escape(label)}</span></label>')
            if not inputs:
                inputs.append('<p class="quiz-warning">Giáo viên chưa gắn đủ ảnh cho câu hỏi này.</p>')
        else:
            for opt in opts:
                inputs.append(f'<label><input type="radio" name="{q.id}" value="{html.escape(opt)}"> {html.escape(opt)}</label>')
        quiz_html.append(f'''
          <div class="question" data-id="{q.id}" data-type="{q.quiz_type}">
            <div class="qmeta">{html.escape(q.quiz_type)}</div>
            <strong>{html.escape(q.question)}</strong>
            <div class="options">{''.join(inputs)}</div>
          </div>
        ''')

    if selected:
        slides.append(f'''
          <section class="slide" data-slide="{quiz_index}">
            <div class="eyebrow">Bài kiểm tra</div>
            <h2>Quiz cuối bài</h2>
            {''.join(quiz_html)}
            <button class="primary" onclick="submitQuiz()">Nộp bài</button>
            <div id="quizResult"></div>
          </section>
        ''')

    data = {
        "slideCount": len(slides),
        "quizCount": len(selected),
        "passing": req.passing_score,
        "completion": req.completion_percent,
        "resume": req.resume, "navigationMode": req.navigation_mode, "showMenu": req.show_menu, "requireQuiz": req.require_quiz
    }
    answers = {q.id: q.answer for q in selected}

    return f'''<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{title}</title>
<style>
:root{{--bg:#f5f7fb;--card:#fff;--ink:#152033;--muted:#6b7280;--accent:{primary_color};}}
*{{box-sizing:border-box}}
body{{margin:0;font-family:Inter,system-ui,Arial,sans-serif;background:var(--bg);color:var(--ink)}}
.shell{{min-height:100vh;display:grid;grid-template-rows:1fr auto}}
.stage{{max-width:1000px;width:100%;margin:auto;padding:32px}}
.slide{{display:none;background:var(--card);border-radius:24px;padding:42px;box-shadow:0 18px 60px rgba(20,30,50,.10);min-height:520px}}
.slide.active{{display:block}}
.eyebrow{{font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--accent);font-size:12px}}
h1{{font-size:44px;margin:12px 0}} h2{{font-size:34px}} .lead{{font-size:20px;color:var(--muted)}}
.card,.question{{background:#f8f9fd;border:1px solid #e5e7ef;border-radius:18px;padding:20px;margin-top:20px}}
.content{{font-size:20px;line-height:1.7;white-space:normal}} .options{{display:grid;gap:10px;margin-top:14px}}
.media{{margin:22px 0 0;padding:14px;border:1px solid #e5e7ef;border-radius:16px;background:#f8f9fd}}.media img,.media video{{display:block;max-width:100%;max-height:420px;border-radius:10px;margin:auto}}.media audio{{width:100%;margin-top:8px}}.media figcaption{{font-size:13px;color:var(--muted);margin-top:8px}}
.options label{{background:#fff;border:1px solid #dde2ee;border-radius:12px;padding:12px;cursor:pointer}}
.drag-bank{{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}}.drag-token{{border:1px solid #b9c7f4;background:#fff;border-radius:10px;padding:9px 12px;cursor:grab;color:var(--ink)}}.drop-zone{{min-height:58px;border:2px dashed #9aacf4;border-radius:12px;padding:10px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;color:var(--muted)}}.drop-zone.drag-over{{background:#eef2ff}}.drop-zone .drag-token{{cursor:grab}}.image-option{{display:grid;grid-template-columns:22px minmax(0,150px) 1fr;gap:10px;align-items:center}}.image-option img{{width:150px;height:96px;object-fit:cover;border-radius:9px;border:1px solid #dde2ee}}.quiz-warning{{color:#9a6500}}
.fill{{width:100%;padding:12px;border-radius:10px;border:1px solid #cfd5e2}}
.qmeta{{font-size:11px;text-transform:uppercase;color:var(--muted);margin-bottom:8px}}
.toolbar{{display:flex;gap:12px;align-items:center;padding:16px 24px;background:#fff;border-top:1px solid #e7eaf1;position:sticky;bottom:0}}
.toolbar button,.primary{{border:0;border-radius:12px;padding:11px 18px;font-weight:700;cursor:pointer}}
.primary,#next{{background:var(--accent);color:#fff}} #prev{{background:#eef1f7}} .spacer{{flex:1}}
.progress{{height:8px;background:#e6e9f0;border-radius:99px;overflow:hidden;width:min(360px,35vw)}} .bar{{height:100%;background:var(--accent);width:0}}.matching-option{{display:grid;grid-template-columns:1fr 1fr;gap:12px;align-items:center}}.matching-option select{{padding:10px;border-radius:10px;border:1px solid #cfd5e2;background:#fff}}
#quizResult{{font-weight:700;margin-top:16px}}
.menu{{position:fixed;left:16px;top:16px;width:220px;max-height:calc(100vh - 32px);overflow:auto;background:#fff;border:1px solid #e5e7ef;border-radius:14px;padding:10px;box-shadow:0 12px 35px rgba(20,30,50,.12)}}.menu button{{display:block;width:100%;border:0;background:transparent;padding:9px;text-align:left;border-radius:8px;cursor:pointer}}.menu button.active{{background:#edf1ff;color:var(--accent);font-weight:700}}.fullscreen{{background:#eef1f7}}.layout-two_column .content{{columns:2;column-gap:32px}}.layout-callout .content{{border-left:5px solid var(--accent);padding-left:20px}}@media(max-width:760px){{.stage{{padding:14px}}.slide{{padding:24px;min-height:calc(100vh - 88px)}}h1{{font-size:32px}}h2{{font-size:27px}}.toolbar{{padding:12px;gap:8px}}.progress{{width:80px}}.menu{{display:none}}.layout-two_column .content{{columns:1}}}}
</style>
<script src="runtime.js"></script>
</head>
<body>
<div class="shell">
  <aside id="menu" class="menu"></aside>
  <main class="stage">{''.join(slides)}</main>
  <div class="toolbar">
    <button id="prev" onclick="go(-1)">← Trước</button>
    <div class="progress"><div id="bar" class="bar"></div></div>
    <span id="count"></span>
    <div class="spacer"></div>
    <button class="fullscreen" onclick="toggleFullscreen()">Toàn màn hình</button>
    <button id="next" onclick="go(1)">Tiếp →</button>
  </div>
</div>
<script>
const CFG = {json_for_script(data)};
const ANSWERS = {json_for_script(answers)};
const slides = [...document.querySelectorAll(".slide")];
let current = 0;
let highestVisited = 0;
let quizSubmitted = false;

function show(i){{
  if(CFG.navigationMode === "sequential" && i > highestVisited + 1) return;
  if(CFG.navigationMode === "restricted" && Math.abs(i-current) > 1) return;
  current = Math.max(0, Math.min(i, slides.length-1));
  highestVisited = Math.max(highestVisited,current);
  slides.forEach((s,n)=>s.classList.toggle("active",n===current));
  document.getElementById("count").textContent = `${{current+1}} / ${{slides.length}}`;
  document.getElementById("bar").style.width = `${{((current+1)/slides.length)*100}}%`;
  document.querySelector(".progress").hidden = !CFG.showProgress;
  document.getElementById("prev").disabled = current===0;
  document.getElementById("next").disabled = current===slides.length-1;
  scormSet("cmi.location", current);
  scormSuspend({{location:current,highestVisited}});
  const progress = Math.round(((current+1)/slides.length)*100);
  scormSet("cmi.progress_measure", progress/100);
  updateCompletion(progress);
  renderMenu();
}}
function go(delta){{ show(current+delta); }}
function renderMenu(){{
  const menu=document.getElementById("menu");
  menu.hidden=!CFG.showMenu;
  if(!CFG.showMenu) return;
  menu.innerHTML=slides.map((slide,index)=>`<button class="${{index===current?"active":""}}" ${{index>highestVisited&&CFG.navigationMode!=="free"?"disabled":""}} onclick="show(${{index}})">Slide ${{index+1}}</button>`).join("");
}}
function toggleFullscreen(){{if(!document.fullscreenElement)document.documentElement.requestFullscreen?.();else document.exitFullscreen?.();}}
function updateCompletion(progress){{if(progress >= CFG.completion && (!CFG.requireQuiz || quizSubmitted))scormSet("cmi.completion_status","completed");}}
let draggingToken=null;
document.addEventListener("dragstart",event=>{{if(event.target.classList.contains("drag-token"))draggingToken=event.target;}});
document.addEventListener("dragover",event=>{{const zone=event.target.closest(".drop-zone");if(zone){{event.preventDefault();zone.classList.add("drag-over");}}}});
document.addEventListener("dragleave",event=>{{event.target.closest(".drop-zone")?.classList.remove("drag-over");}});
document.addEventListener("drop",event=>{{const zone=event.target.closest(".drop-zone");if(zone&&draggingToken){{event.preventDefault();zone.classList.remove("drag-over");zone.appendChild(draggingToken);draggingToken=null;}}}});
function norm(value){{return String(value??"").trim().toLocaleLowerCase();}}
function sameAnswer(type,value,answer){{
  if(type==="multiple"){{const left=[...value].map(norm).sort(),right=(Array.isArray(answer)?answer:[answer]).map(norm).sort();return JSON.stringify(left)===JSON.stringify(right);}}
  if(type==="ordering"||type==="dragdrop"){{const right=Array.isArray(answer)?answer:[answer];return JSON.stringify(value.map(norm))===JSON.stringify(right.map(norm));}}
  if(type==="matching"){{const left=Object.entries(value).map(([key,item])=>[norm(key),norm(item)]).sort(),right=Object.entries(answer||{{}}).map(([key,item])=>[norm(key),norm(item)]).sort();return JSON.stringify(left)===JSON.stringify(right);}}
  return norm(value)===norm(answer);
}}

function submitQuiz(){{
  let correct=0;
  const questions=[...document.querySelectorAll(".question")];
  questions.forEach(q=>{{
    const id=q.dataset.id, type=q.dataset.type, answer=ANSWERS[id];
    let value="";
    if(type==="multiple"){{
      value=[...q.querySelectorAll("input:checked")].map(x=>x.value);
    }} else if(type==="dragdrop"||type==="ordering"){{
      value=[...q.querySelectorAll(".drop-zone .drag-token")].map(x=>x.dataset.value);
    }} else if(type==="matching"){{
      value=Object.fromEntries([...q.querySelectorAll("[data-match-left]")].map(x=>[x.dataset.matchLeft,x.value]));
    }} else {{
      const el=q.querySelector("input:checked") || q.querySelector(".fill");
      value=el ? el.value.trim() : "";
    }}
    if(sameAnswer(type,value,answer)) correct++;
  }});
  const score = questions.length ? Math.round(correct/questions.length*100) : 100;
  scormSet("cmi.score.raw", score);
  scormSet("cmi.score.min", 0);
  scormSet("cmi.score.max", 100);
  scormSet("cmi.score.scaled", score/100);
  scormSet("cmi.success_status", score >= CFG.passing ? "passed" : "failed");
  quizSubmitted = true;
  updateCompletion(Math.round(((current+1)/slides.length)*100));
  document.getElementById("quizResult").textContent =
    `Kết quả: ${{score}}/100 — ${{score >= CFG.passing ? "Đạt" : "Chưa đạt"}}`;
}}

window.addEventListener("load",()=>{{
  let resume = 0;
  if(CFG.resume){{
    const state=scormResume();
    const loc = parseInt((state.location ?? scormGet("cmi.location") ?? "0"),10);
    if(!Number.isNaN(loc)) resume = loc;
  }}
  show(resume);
}});
</script>
</body>
</html>'''

@app.post("/api/export-scorm")
def export_scorm(req: ExportRequest, user: User = Depends(current_teacher), db: Session = Depends(get_db)):
    effective = req
    files: dict[str, bytes] = {"runtime.js": runtime_js().encode()}
    warnings: list[str] = []
    if req.project_id:
        project, _ = project_with_access(db, req.project_id, user)
        course = Course.model_validate(project.course_json)
        referenced_ids = {block.asset_id for slide in course.slides for block in slide.blocks if block.asset_id}
        referenced_ids.update(str(item.get("asset_id")) for question in course.question_bank if question.type == "image" for item in question.settings.get("image_options", []) if isinstance(item, dict) and item.get("asset_id"))
        assets = db.scalars(select(MediaAsset).where(MediaAsset.project_id == project.id, MediaAsset.id.in_(referenced_ids))).all() if referenced_ids else []
        media_by_id: dict[str, dict[str, str]] = {}
        asset_paths: list[str] = []
        for asset in assets:
            if asset.external_url:
                media_by_id[asset.id] = {"src": asset.external_url, "kind": asset.kind, "label": asset.original_name}
            elif asset.storage_key:
                path = f"assets/{asset.id}{extension_for_mime(asset.mime_type)}"
                try:
                    files[path] = storage.get(asset.storage_key)
                except Exception as exc:
                    raise HTTPException(status_code=422, detail=f"Không thể đọc media {asset.original_name} để đóng gói SCORM.") from exc
                asset_paths.append(path)
                media_by_id[asset.id] = {"src": path, "kind": asset.kind, "label": asset.original_name}
            warning = media_warning(asset)
            if warning:
                warnings.append(warning)
        image_asset_ids = {str(item.get("asset_id")) for question in course.question_bank if question.type == "image" for item in question.settings.get("image_options", []) if isinstance(item, dict) and item.get("asset_id")}
        unresolved_image_assets = sorted(asset_id for asset_id in image_asset_ids if media_by_id.get(asset_id, {}).get("kind") != "image")
        if unresolved_image_assets:
            raise HTTPException(status_code=422, detail={"code": "QUIZ_IMAGE_ASSET_MISSING", "message": "Một hoặc nhiều ảnh lựa chọn chưa có asset ảnh hợp lệ.", "asset_ids": unresolved_image_assets})
        effective = export_request_from_course(course, media_by_id)
        effective.passing_score, effective.completion_percent, effective.resume = req.passing_score, req.completion_percent, req.resume
        effective.project_id = project.id
        files["imsmanifest.xml"] = scorm_manifest(effective.title, asset_paths).encode()
    else:
        files["imsmanifest.xml"] = scorm_manifest(effective.title).encode()
    files["index.html"] = build_course_html(effective).encode()
    errors = validate_scorm_package(files, passing_score=effective.passing_score, completion_percent=effective.completion_percent)
    if errors:
        raise HTTPException(status_code=422, detail={"code": "SCORM_PACKAGE_INVALID", "errors": errors})
    mem = io.BytesIO()
    with zipfile.ZipFile(mem, "w", zipfile.ZIP_DEFLATED) as z:
        for name, content in files.items(): z.writestr(name, content)
    safe = re.sub(r"[^A-Za-z0-9_-]+", "_", effective.title).strip("_") or "bai_giang"
    filename = f"{safe}_SCORM2004.zip"
    package = mem.getvalue()
    storage_key = f"users/{user.id}/exports/{__import__('uuid').uuid4()}-{filename}"
    storage.put(storage_key, package, "application/zip")
    record = ExportRecord(user_id=user.id, project_id=effective.project_id, filename=filename, storage_key=storage_key, byte_size=len(package), validation_json={"errors": [], "warnings": warnings})
    db.add(record); db.commit()
    mem.seek(0)
    return StreamingResponse(
        mem,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"', "X-Export-Id": record.id, "X-SCORM-Warning-Count": str(len(warnings))}
    )


@app.get("/api/v1/exports")
def list_exports(user: User = Depends(current_teacher), db: Session = Depends(get_db)):
    return [{"id": item.id, "project_id": item.project_id, "filename": item.filename, "byte_size": item.byte_size, "status": item.status, "created_at": item.created_at} for item in db.scalars(select(ExportRecord).where(ExportRecord.user_id == user.id).order_by(ExportRecord.created_at.desc())).all()]


@app.get("/api/v1/projects/{project_id}/player", response_class=HTMLResponse)
def preview_player(project_id: str, user: User = Depends(current_teacher), db: Session = Depends(get_db)):
    project, _ = project_with_access(db, project_id, user)
    course = Course.model_validate(project.course_json)
    referenced_ids = {block.asset_id for slide in course.slides for block in slide.blocks if block.asset_id}
    referenced_ids.update(str(item.get("asset_id")) for question in course.question_bank if question.type == "image" for item in question.settings.get("image_options", []) if isinstance(item, dict) and item.get("asset_id"))
    assets = db.scalars(select(MediaAsset).where(MediaAsset.project_id == project.id, MediaAsset.id.in_(referenced_ids))).all() if referenced_ids else []
    media_by_id = {asset.id: {"src": asset.external_url or f"/api/v1/media/{asset.id}/content", "kind": asset.kind, "label": asset.original_name} for asset in assets}
    return HTMLResponse(build_course_html(export_request_from_course(course, media_by_id)))


@app.get("/api/v1/projects/{project_id}/quality-check")
@app.post("/api/v1/projects/{project_id}/quality-check")
def quality_check(project_id: str, user: User = Depends(current_teacher), db: Session = Depends(get_db)):
    """Return deterministic, non-blocking authoring guidance for an accessible project."""
    project, _ = project_with_access(db, project_id, user)
    return analyze_course(Course.model_validate(project.course_json))

@app.get("/")
def home():
    return FileResponse(STATIC_DIR / "index.html")

app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
