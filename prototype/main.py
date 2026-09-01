
from fastapi import Cookie, Depends, FastAPI, File, HTTPException, Response, UploadFile, status
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, HTMLResponse, StreamingResponse
from pydantic import BaseModel, Field, ValidationError
from typing import List, Literal, Optional
from pathlib import Path
import io, zipfile, html, json, re
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from prototype.course_models import Course, Slide, new_course
from prototype.auth import COOKIE_NAME, current_session, new_session, normalise_email, password_hasher, set_session_cookie
from prototype.credentials import decrypt, encrypt
from prototype.persistence import AICredential, AuthSession, GenerationRun, Project, SourceMaterial, User, create_schema, make_session_factory
from prototype.providers import ProviderError, ProviderResult, provider_for
from prototype.sources import extract_text, validate_upload
from prototype.storage import Storage

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "app"

BASE_DIR.joinpath("storage").mkdir(exist_ok=True)
engine, SessionLocal = make_session_factory()
create_schema(engine)

app = FastAPI(title="AI SCORM Studio Demo")
storage = Storage()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


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

class SourceResponse(BaseModel):
    id: str; original_name: str; mime_type: str; byte_size: int; extracted_text: str | None
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

class RenameProjectRequest(BaseModel):
    title: str = Field(min_length=1, max_length=300)


class ProjectResponse(BaseModel):
    id: str
    title: str
    status: str
    revision: int
    course: Course


def serialize_project(project: Project) -> ProjectResponse:
    return ProjectResponse(
        id=project.id, title=project.title, status=project.status,
        revision=project.revision, course=Course.model_validate(project.course_json),
    )


def serialize_teacher(user: User) -> TeacherResponse:
    return TeacherResponse(id=user.id, email=user.email, full_name=user.full_name, school_name=user.school_name)


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
    answer: str = ""
    quiz_type: str = "single"
    selected: bool = True

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
                "answer": str(item.correct_answer), "quiz_type": item.type, "selected": item.selected}
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
    project = db.scalar(select(Project).where(Project.id == project_id, Project.owner_user_id == user.id))
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found.")
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
    result = db.execute(update(Project).where(Project.id == project_id, Project.owner_user_id == user.id, Project.revision == payload.expected_revision).values(
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
    """List only the current demo teacher's projects.

    Milestone 02 replaces this fixed demo identity with authenticated user
    resolution; callers never supply an owner id themselves.
    """
    projects = db.scalars(
        select(Project).where(Project.owner_user_id == user.id).order_by(Project.updated_at.desc())
    ).all()
    return [serialize_project(project) for project in projects]


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
    project = db.scalar(select(Project).where(Project.id == project_id, Project.owner_user_id == user.id))
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found.")
    return serialize_project(project)


@app.patch("/api/v1/projects/{project_id}", response_model=ProjectResponse)
def update_project(project_id: str, payload: ProjectUpdateRequest, user: User = Depends(current_teacher), db: Session = Depends(get_db)):
    if payload.course.id != project_id:
        raise HTTPException(status_code=422, detail="course.id must match the project id.")
    if payload.course.revision != payload.expected_revision + 1:
        raise HTTPException(status_code=422, detail="course.revision must be exactly one greater than expected_revision.")

    result = db.execute(
        update(Project)
        .where(
            Project.id == project_id,
            Project.owner_user_id == user.id,
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
        existing = db.scalar(select(Project.id).where(Project.id == project_id, Project.owner_user_id == user.id))
        if existing is None:
            raise HTTPException(status_code=404, detail="Project not found.")
        raise HTTPException(status_code=409, detail={"code": "COURSE_REVISION_CONFLICT", "message": "The project was updated in another session."})
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
    project = db.scalar(select(Project).where(Project.id == project_id, Project.owner_user_id == user.id))
    if project is None: raise HTTPException(status_code=404, detail="Project not found.")
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
    return [SourceResponse(id=x.id, original_name=x.original_name, mime_type=x.mime_type, byte_size=x.byte_size, extracted_text=x.extracted_text) for x in db.scalars(select(SourceMaterial).where(SourceMaterial.project_id == project_id, SourceMaterial.user_id == user.id)).all()]

def scorm_manifest(title: str):
    safe_title = html.escape(title)
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
    </resource>
  </resources>
</manifest>'''

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

def export_request_from_course(course: Course) -> ExportRequest:
    return ExportRequest(
        title=course.metadata.title, direction=course.metadata.direction,
        objectives=[item.text for item in course.objectives],
        sections=[{"id": slide.id, "title": slide.title, "layout": slide.layout,
                   "content": next((block.text for block in slide.blocks if block.type == "text"), "")}
                  for slide in course.slides],
        quizzes=[QuizItem(id=item.id, question=item.question, options=item.options,
                          answer=json.dumps(item.correct_answer, ensure_ascii=False) if not isinstance(item.correct_answer, str) else item.correct_answer,
                          quiz_type=item.type, selected=item.selected) for item in course.question_bank],
        passing_score=course.completion.passing_score, completion_percent=course.completion.viewed_percent,
        resume=course.scorm.resume, navigation_mode=course.navigation.mode,
        show_menu=course.navigation.show_menu, primary_color=course.theme.primary_color, require_quiz=course.completion.require_quiz,
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
        slides.append(f'''
          <section class="slide layout-{layout}" data-slide="{idx}">
            <div class="eyebrow">Nội dung {idx}</div>
            <h2>{html.escape(str(s.get("title","Phần học")))}</h2>
            <div class="content">{content}</div>
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
        else:
            for opt in opts:
                inputs.append(f'<label><input type="radio" name="{q.id}" value="{html.escape(opt)}"> {html.escape(opt)}</label>')
        quiz_html.append(f'''
          <div class="question" data-id="{q.id}" data-answer="{html.escape(q.answer)}" data-type="{q.quiz_type}">
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
.options label{{background:#fff;border:1px solid #dde2ee;border-radius:12px;padding:12px;cursor:pointer}}
.fill{{width:100%;padding:12px;border-radius:10px;border:1px solid #cfd5e2}}
.qmeta{{font-size:11px;text-transform:uppercase;color:var(--muted);margin-bottom:8px}}
.toolbar{{display:flex;gap:12px;align-items:center;padding:16px 24px;background:#fff;border-top:1px solid #e7eaf1;position:sticky;bottom:0}}
.toolbar button,.primary{{border:0;border-radius:12px;padding:11px 18px;font-weight:700;cursor:pointer}}
.primary,#next{{background:var(--accent);color:#fff}} #prev{{background:#eef1f7}} .spacer{{flex:1}}
.progress{{height:8px;background:#e6e9f0;border-radius:99px;overflow:hidden;width:min(360px,35vw)}} .bar{{height:100%;background:var(--accent);width:0}}
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

function show(i){{
  if(CFG.navigationMode === "sequential" && i > highestVisited + 1) return;
  if(CFG.navigationMode === "restricted" && Math.abs(i-current) > 1) return;
  current = Math.max(0, Math.min(i, slides.length-1));
  highestVisited = Math.max(highestVisited,current);
  slides.forEach((s,n)=>s.classList.toggle("active",n===current));
  document.getElementById("count").textContent = `${{current+1}} / ${{slides.length}}`;
  document.getElementById("bar").style.width = `${{((current+1)/slides.length)*100}}%`;
  document.getElementById("prev").disabled = current===0;
  document.getElementById("next").disabled = current===slides.length-1;
  scormSet("cmi.location", current);
  scormSuspend({{location:current,highestVisited}});
  const progress = Math.round(((current+1)/slides.length)*100);
  scormSet("cmi.progress_measure", progress/100);
  if(progress >= CFG.completion) scormSet("cmi.completion_status","completed");
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

function submitQuiz(){{
  let correct=0;
  const questions=[...document.querySelectorAll(".question")];
  questions.forEach(q=>{{
    const id=q.dataset.id, type=q.dataset.type, answer=ANSWERS[id];
    let value="";
    if(type==="multiple"){{
      value=[...q.querySelectorAll("input:checked")].map(x=>x.value).join("|");
    }} else {{
      const el=q.querySelector("input:checked") || q.querySelector(".fill");
      value=el ? el.value.trim() : "";
    }}
    if(value.toLowerCase() === String(answer).trim().toLowerCase()) correct++;
  }});
  const score = questions.length ? Math.round(correct/questions.length*100) : 100;
  scormSet("cmi.score.raw", score);
  scormSet("cmi.score.min", 0);
  scormSet("cmi.score.max", 100);
  scormSet("cmi.score.scaled", score/100);
  scormSet("cmi.success_status", score >= CFG.passing ? "passed" : "failed");
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
def export_scorm(req: ExportRequest):
    mem = io.BytesIO()
    with zipfile.ZipFile(mem, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("imsmanifest.xml", scorm_manifest(req.title))
        z.writestr("index.html", build_course_html(req))
        z.writestr("runtime.js", runtime_js())
    mem.seek(0)
    safe = re.sub(r"[^A-Za-z0-9_-]+", "_", req.title).strip("_") or "bai_giang"
    return StreamingResponse(
        mem,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{safe}_SCORM2004.zip"'}
    )


@app.get("/api/v1/projects/{project_id}/player", response_class=HTMLResponse)
def preview_player(project_id: str, user: User = Depends(current_teacher), db: Session = Depends(get_db)):
    project = db.scalar(select(Project).where(Project.id == project_id, Project.owner_user_id == user.id))
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found.")
    return HTMLResponse(build_course_html(export_request_from_course(Course.model_validate(project.course_json))))

@app.get("/")
def home():
    return FileResponse(STATIC_DIR / "index.html")

app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
