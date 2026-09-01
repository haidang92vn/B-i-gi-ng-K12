
from fastapi import Cookie, Depends, FastAPI, HTTPException, Response, status
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, Field
from typing import List, Literal, Optional
from pathlib import Path
import io, zipfile, html, json, re
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from prototype.course_models import Course, new_course
from prototype.auth import COOKIE_NAME, current_session, new_session, normalise_email, password_hasher, set_session_cookie
from prototype.persistence import AuthSession, Project, User, create_schema, make_session_factory

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "app"

BASE_DIR.joinpath("storage").mkdir(exist_ok=True)
engine, SessionLocal = make_session_factory()
create_schema(engine)

app = FastAPI(title="AI SCORM Studio Demo")


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

class GenerateRequest(BaseModel):
    title: str
    source: str
    direction: str = "lesson"
    provider: str = "mock"
    api_key: Optional[str] = None

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

    qbase = source_sentences[:6] if len(source_sentences) >= 6 else (source_sentences * 6)[:6]
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
            "selected": True
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

@app.post("/api/generate")
def generate(req: GenerateRequest):
    # Demo: không lưu API key. Production sẽ thay bằng provider adapter server-side.
    return make_mock_content(req)


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
    API.Initialize("");
    const status = API.GetValue("cmi.completion_status");
    if (!status || status === "unknown" || status === "not attempted") {
      API.SetValue("cmi.completion_status","incomplete");
      API.Commit("");
    }
    return true;
  } catch(e){ return false; }
}
function scormSet(k,v){ if(API){ try { API.SetValue(k,String(v)); API.Commit(""); } catch(e){} } }
function scormGet(k){ if(API){ try { return API.GetValue(k) || ""; } catch(e){} } return ""; }
function scormFinish(){ if(API){ try { API.Commit(""); API.Terminate(""); } catch(e){} } }
window.addEventListener("load", scormInit);
window.addEventListener("beforeunload", scormFinish);
'''

def build_course_html(req: ExportRequest):
    title = html.escape(req.title)
    direction = html.escape(req.direction)

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
        slides.append(f'''
          <section class="slide" data-slide="{idx}">
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
        "resume": req.resume
    }
    answers = {q.id: q.answer for q in selected}

    return f'''<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{title}</title>
<style>
:root{{--bg:#f5f7fb;--card:#fff;--ink:#152033;--muted:#6b7280;--accent:#3157d5;}}
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
</style>
<script src="runtime.js"></script>
</head>
<body>
<div class="shell">
  <main class="stage">{''.join(slides)}</main>
  <div class="toolbar">
    <button id="prev" onclick="go(-1)">← Trước</button>
    <div class="progress"><div id="bar" class="bar"></div></div>
    <span id="count"></span>
    <div class="spacer"></div>
    <button id="next" onclick="go(1)">Tiếp →</button>
  </div>
</div>
<script>
const CFG = {json.dumps(data, ensure_ascii=False)};
const ANSWERS = {json.dumps(answers, ensure_ascii=False)};
const slides = [...document.querySelectorAll(".slide")];
let current = 0;

function show(i){{
  current = Math.max(0, Math.min(i, slides.length-1));
  slides.forEach((s,n)=>s.classList.toggle("active",n===current));
  document.getElementById("count").textContent = `${{current+1}} / ${{slides.length}}`;
  document.getElementById("bar").style.width = `${{((current+1)/slides.length)*100}}%`;
  document.getElementById("prev").disabled = current===0;
  document.getElementById("next").disabled = current===slides.length-1;
  scormSet("cmi.location", current);
  const progress = Math.round(((current+1)/slides.length)*100);
  scormSet("cmi.progress_measure", progress/100);
  if(progress >= CFG.completion) scormSet("cmi.completion_status","completed");
}}
function go(delta){{ show(current+delta); }}

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
  scormSet("cmi.completion_status","completed");
  scormSet("cmi.success_status", score >= CFG.passing ? "passed" : "failed");
  document.getElementById("quizResult").textContent =
    `Kết quả: ${{score}}/100 — ${{score >= CFG.passing ? "Đạt" : "Chưa đạt"}}`;
}}

window.addEventListener("load",()=>{{
  let resume = 0;
  if(CFG.resume){{
    const loc = parseInt(scormGet("cmi.location") || "0",10);
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

@app.get("/")
def home():
    return FileResponse(STATIC_DIR / "index.html")

app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
