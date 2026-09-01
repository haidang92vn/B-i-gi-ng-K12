
let currentStep = 1;
let state = { direction: "lesson", generated: null, project: null };
let saveTimer = null;
const authGate = document.getElementById('authGate');
const authForm = document.getElementById('authForm');
const authEmailInput = document.getElementById('authEmail');
const authPasswordInput = document.getElementById('authPassword');
const authMessage = document.getElementById('authMessage');
async function ensureAuth(){const r=await fetch('/api/v1/me');if(r.ok)authGate.classList.add('hidden');}
async function apiMessage(response){try{const body=await response.json();return typeof body.detail==='string'?body.detail:'';}catch{return '';}}
authForm.onsubmit=async e=>{e.preventDefault();const email=authEmailInput.value.trim(),password=authPasswordInput.value;if(password.length<12){authMessage.textContent='Mật khẩu cần tối thiểu 12 ký tự.';return;}authMessage.textContent='Đang xác thực…';const body=JSON.stringify({email,password});let r=await fetch('/api/v1/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body});if(r.ok){authGate.classList.add('hidden');return;}if(r.status!==401){authMessage.textContent=(await apiMessage(r))||'Không thể kết nối máy chủ. Vui lòng thử lại.';return;}r=await fetch('/api/v1/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body});if(r.ok){authGate.classList.add('hidden');return;}if(r.status===409){authMessage.textContent='Email này đã được đăng ký; vui lòng kiểm tra lại mật khẩu.';return;}authMessage.textContent=(await apiMessage(r))||'Không thể tạo tài khoản. Vui lòng thử lại.';};ensureAuth();
async function loadLibrary(){const r=await fetch('/api/v1/projects');if(!r.ok)return;const items=await r.json();libraryList.innerHTML=items.length?items.map(p=>`<article class="library-item"><strong>${escapeHtml(p.title)}</strong><small>${p.status} • phiên bản ${p.revision}</small><div class="library-actions"><button onclick="openProject('${p.id}')">Mở</button><button onclick="copyProject('${p.id}')">Nhân bản</button><button onclick="archiveProject('${p.id}')">Lưu trữ</button><button onclick="deleteProject('${p.id}')">Xóa</button></div></article>`).join(''):'<p class="hint">Chưa có bài giảng nào.</p>';}
libraryBtn.onclick=()=>{libraryDrawer.classList.add('open');loadLibrary();};closeLibraryBtn.onclick=()=>libraryDrawer.classList.remove('open');
newLessonBtn.onclick=()=>{libraryDrawer.classList.remove('open');state={direction:'lesson',generated:null,project:null};location.reload();};
async function openProject(id){const r=await fetch(`/api/v1/projects/${id}`);if(!r.ok)return;state.project=await r.json();const c=state.project.course;state.direction=c.metadata.direction;lessonTitle.value=c.metadata.title;state.generated={course:c,direction_name:{lesson:'Bài học mới',review:'Ôn tập – củng cố',advanced:'Nâng cao – mở rộng'}[c.metadata.direction],objectives:c.objectives.map(x=>x.text),sections:c.slides.map(s=>({id:s.id,title:s.title,content:s.blocks.find(b=>b.type==='text')?.text||'',note:s.speaker_notes||''})),quizzes:c.question_bank.map(q=>({id:q.id,question:q.question,options:q.options,answer:q.correct_answer,quiz_type:q.type,selected:q.selected}))};renderAI();renderReview();renderQuiz();libraryDrawer.classList.remove('open');setStep(4);}
const credentialsBtn = document.getElementById('credentialsBtn');
const credentialsDrawer = document.getElementById('credentialsDrawer');
const credentialsList = document.getElementById('credentialsList');
const credentialForm = document.getElementById('credentialForm');
const credentialProvider = document.getElementById('credentialProvider');
const credentialSecret = document.getElementById('credentialSecret');
const credentialModel = document.getElementById('credentialModel');
const generationProvider = document.getElementById('provider');
const generationCredential = document.getElementById('generationCredential');
let savedCredentials = [];
function refreshGenerationCredentials(){const provider=generationProvider.value;const choices=savedCredentials.filter(x=>x.provider===provider);generationCredential.disabled=provider==='mock';generationCredential.innerHTML=provider==='mock'?'<option value="">Mock AI không cần API key</option>':(choices.length?choices.map(x=>`<option value="${x.id}">${escapeHtml(x.label||x.provider)} •••• ${x.secret_last4}${x.model_default?` (${escapeHtml(x.model_default)})`:''}</option>`).join(''):'<option value="">Chưa có key phù hợp — mở AI API để thêm</option>');}
async function loadCredentials(){const r=await fetch('/api/v1/ai/credentials');if(!r.ok)return;savedCredentials=await r.json();credentialsList.innerHTML=savedCredentials.map(x=>`<article class="library-item"><strong>${escapeHtml(x.label||x.provider)}</strong><small>${x.provider} • •••• ${x.secret_last4} ${escapeHtml(x.model_default||'')}</small><div class="library-actions"><button onclick="revokeCredential('${x.id}')">Hủy key</button></div></article>`).join('')||'<p class="hint">Chưa có API key.</p>';refreshGenerationCredentials();}
async function revokeCredential(id){if(!confirm('Hủy API key này? Key sẽ không thể dùng lại.'))return;const r=await fetch(`/api/v1/ai/credentials/${id}`,{method:'DELETE'});if(r.ok)await loadCredentials();else alert((await apiMessage(r))||'Không thể hủy API key.');}
credentialsBtn.onclick=()=>{credentialsDrawer.classList.add('open');loadCredentials();};document.getElementById('closeCredentialsBtn').onclick=()=>credentialsDrawer.classList.remove('open');credentialForm.onsubmit=async e=>{e.preventDefault();const r=await fetch('/api/v1/ai/credentials',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({provider:credentialProvider.value,secret:credentialSecret.value,model_default:credentialModel.value||null})});if(r.ok){credentialSecret.value='';credentialModel.value='';await loadCredentials();}else{alert((await apiMessage(r))||'Không thể lưu API key.');}};generationProvider.onchange=refreshGenerationCredentials;loadCredentials();
async function copyProject(id){await fetch(`/api/v1/projects/${id}/duplicate`,{method:'POST'});loadLibrary();}async function archiveProject(id){await fetch(`/api/v1/projects/${id}/archive`,{method:'POST'});loadLibrary();}async function deleteProject(id){if(confirm('Xóa bài giảng này?')){await fetch(`/api/v1/projects/${id}`,{method:'DELETE'});loadLibrary();}}

const titles = ["Nhập nội dung bài học","Chọn định hướng","AI tạo nội dung","Giáo viên duyệt","Chọn dạng Quiz","Dựng bài giảng","Cấu hình SCORM","Kiểm tra & xuất"];

function setStep(n){
  currentStep = Math.max(1, Math.min(8,n));
  document.querySelectorAll(".page").forEach(x=>x.classList.toggle("active",Number(x.dataset.page)===currentStep));
  document.querySelectorAll(".step").forEach(x=>x.classList.toggle("active",Number(x.dataset.step)===currentStep));
  document.getElementById("pageTitle").textContent = titles[currentStep-1];
  document.getElementById("footerStep").textContent = `Bước ${currentStep}/8`;
  document.getElementById("backBtn").disabled = currentStep===1;
  document.getElementById("nextBtn").textContent = currentStep===8 ? "Hoàn tất" : "Tiếp tục →";
  if(currentStep===3) loadCredentials();
  if(currentStep===6) refreshPreview();
  if(currentStep===8) refreshExportName();
}
document.querySelectorAll(".step").forEach(btn=>btn.addEventListener("click",()=>setStep(Number(btn.dataset.step))));
document.getElementById("backBtn").onclick=()=>setStep(currentStep-1);
document.getElementById("nextBtn").onclick=()=>{ if(currentStep<8) setStep(currentStep+1); };

document.querySelectorAll(".direction-card").forEach(card=>{
  card.addEventListener("click",()=>{
    document.querySelectorAll(".direction-card").forEach(c=>c.classList.remove("selected"));
    card.classList.add("selected");
    card.querySelector("input").checked = true;
    state.direction = card.querySelector("input").value;
  });
});

function escapeHtml(s=""){return String(s).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));}

async function generateAI(){
  const btn=document.getElementById("generateBtn");
  btn.disabled=true; btn.textContent="Đang tạo...";
  const payload={
    title:document.getElementById("lessonTitle").value || "Bài học",
    source:document.getElementById("sourceText").value,
    direction:state.direction,
    provider:generationProvider.value,
    credential_id:generationCredential.value || null
  };
  try{
    const r=await fetch("/api/generate",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
    if(!r.ok) throw new Error((await apiMessage(r))||"Không gọi được dịch vụ tạo nội dung.");
    state.generated=await r.json();
    await createProjectFromGenerated();
    renderAI(); renderReview(); renderQuiz();
  }catch(e){
    document.getElementById("aiOutput").innerHTML=`<strong>Lỗi</strong><p>${escapeHtml(e.message)}</p>`;
  }finally{
    btn.disabled=false; btn.textContent="Tạo lại bằng AI";
  }
}
document.getElementById("generateBtn").onclick=generateAI;
sourceFile.onchange=async()=>{if(!sourceFile.files[0]||!state.project){sourceFileStatus.textContent='Hãy tạo hoặc mở một bài giảng trước khi tải học liệu.';return;}const form=new FormData();form.append('upload',sourceFile.files[0]);const r=await fetch(`/api/v1/projects/${state.project.id}/sources`,{method:'POST',body:form});const data=await r.json();if(r.ok){sourceFileStatus.textContent=`Đã tải ${data.original_name}.`;if(data.extracted_text)sourceText.value=data.extracted_text;}else sourceFileStatus.textContent=data.detail||'Không tải được tệp.';};

function syncCanonicalCourse(){
  const g=state.generated;if(!g || !g.course)return null;
  const course=g.course;
  course.metadata.title=document.getElementById("lessonTitle").value || "Bài học";
  course.metadata.direction=state.direction;
  course.objectives=g.objectives.map((text,i)=>({id:`o${i+1}`,text}));
  course.slides=g.sections.map((s,i)=>({
    id:s.id || `s${i+1}`,title:s.title,layout:"content",status:"edited",
    blocks:[{id:`${s.id || `s${i+1}`}-text`,type:"text",text:s.content,settings:{}}],
    speaker_notes:s.note || null
  }));
  course.question_bank=g.quizzes.map(q=>({
    id:q.id,type:q.quiz_type,question:q.question,options:q.options || [],
    correct_answer:q.answer,selected:Boolean(q.selected),score:1,difficulty:"understand",
    objective_ids:[],settings:{},explanation:null,feedback_correct:null,feedback_incorrect:null
  }));
  return course;
}

async function createProjectFromGenerated(){
  const course=syncCanonicalCourse();
  const payload={title:course.metadata.title,direction:state.direction,course,generation_id:state.generated.generation?.id||null};
  const response=await fetch("/api/v1/projects",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
  if(!response.ok) throw new Error("Không thể lưu bản nháp bài giảng.");
  state.project=await response.json();
  state.generated.course=state.project.course;
}

function scheduleSave(){
  if(!state.project)return;
  clearTimeout(saveTimer);
  saveTimer=setTimeout(()=>persistGenerated().catch(()=>{}),700);
}

async function persistGenerated(){
  if(!state.project)return;
  const course=syncCanonicalCourse();
  const expected=state.project.revision;
  course.revision=expected+1;
  const response=await fetch(`/api/v1/projects/${state.project.id}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({expected_revision:expected,course})});
  if(response.status===409) throw new Error("Bản nháp đã được cập nhật ở phiên khác. Hãy tải lại bài giảng.");
  if(!response.ok) throw new Error("Không thể lưu thay đổi bài giảng.");
  state.project=await response.json();
  state.generated.course=state.project.course;
}

function renderAI(){
  const g=state.generated;
  const usage=g.generation&&((g.generation.input_tokens!=null||g.generation.output_tokens!=null)?` • ${g.generation.input_tokens||0} vào / ${g.generation.output_tokens||0} ra token`:'');
  document.getElementById("aiOutput").className="";
  document.getElementById("aiOutput").innerHTML=`
  <div class="ai-summary">
    <div class="summary-card"><span class="eyebrow">MỤC TIÊU</span><h3>${escapeHtml(g.direction_name)}</h3><ul>${g.objectives.map(x=>`<li>${escapeHtml(x)}</li>`).join("")}</ul></div>
    <div class="summary-card"><span class="eyebrow">CẤU TRÚC ĐỀ XUẤT</span>${g.sections.map((s,i)=>`<h3>${i+1}. ${escapeHtml(s.title)}</h3><p>${escapeHtml(s.content).slice(0,180)}...</p>`).join("")}<div class="hint">${escapeHtml(g.notice)}${escapeHtml(usage||'')}</div></div>
  </div>`;
}

function renderReview(){
  const g=state.generated;if(!g)return;
  document.getElementById("reviewArea").className="";
  document.getElementById("reviewArea").innerHTML=`
    <div class="review-objectives"><h3>Mục tiêu bài học</h3>${g.objectives.map((o,i)=>`<input data-obj="${i}" value="${escapeHtml(o)}">`).join("")}</div>
    ${g.sections.map((s,i)=>`<div class="review-section"><div class="row"><input data-sec-title="${i}" value="${escapeHtml(s.title)}"><textarea data-sec-content="${i}">${escapeHtml(s.content)}</textarea></div><button class="ghost" onclick="regenerateSection(${i})">Tạo lại phần này</button></div>`).join("")}
  `;
  document.querySelectorAll("[data-obj]").forEach(el=>el.addEventListener("input",()=>{g.objectives[Number(el.dataset.obj)]=el.value;scheduleSave();}));
  document.querySelectorAll("[data-sec-title]").forEach(el=>el.addEventListener("input",()=>{g.sections[Number(el.dataset.secTitle)].title=el.value;scheduleSave();}));
  document.querySelectorAll("[data-sec-content]").forEach(el=>el.addEventListener("input",()=>{g.sections[Number(el.dataset.secContent)].content=el.value;scheduleSave();}));
}

async function regenerateSection(index){
  if(!state.project){alert('Hãy lưu bản nháp bài giảng trước.');return;}
  const section=state.generated.sections[index];
  const response=await fetch(`/api/v1/projects/${state.project.id}/slides/${section.id}/regenerate`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({source:sourceText.value||'Nội dung bài học do giáo viên cung cấp.',provider:generationProvider.value,credential_id:generationCredential.value||null,expected_revision:state.project.revision})});
  if(!response.ok){alert((await apiMessage(response))||'Không thể tạo lại phần này.');return;}
  state.project=await response.json();
  const slide=state.project.course.slides.find(x=>x.id===section.id);
  section.title=slide.title;section.content=slide.blocks.find(x=>x.type==='text')?.text||'';section.note=slide.speaker_notes||'';
  state.generated.course=state.project.course;renderAI();renderReview();
}

const quizTypeLabels={single:"Một đáp án",multiple:"Nhiều đáp án",truefalse:"Đúng / Sai",fill:"Điền từ",matching:"Ghép đôi",ordering:"Sắp xếp",dragdrop:"Kéo thả",image:"Chọn hình ảnh"};

function renderQuiz(){
  const g=state.generated;if(!g)return;
  const area=document.getElementById("quizArea");area.className="";
  area.innerHTML=g.quizzes.map((q,i)=>`
    <div class="quiz-card">
      <div class="quiz-card-top">
        <input type="checkbox" data-qcheck="${i}" ${q.selected?"checked":""}>
        <strong>${escapeHtml(q.question)}</strong>
        <select data-qtype="${i}">${Object.entries(quizTypeLabels).map(([k,v])=>`<option value="${k}" ${q.quiz_type===k?"selected":""}>${v}</option>`).join("")}</select>
      </div>
      <p>Đáp án gợi ý: ${escapeHtml(q.answer)}</p>
    </div>`).join("");
  document.querySelectorAll("[data-qcheck]").forEach(el=>el.addEventListener("change",()=>{g.quizzes[Number(el.dataset.qcheck)].selected=el.checked;updateQuizCount();scheduleSave();}));
  document.querySelectorAll("[data-qtype]").forEach(el=>el.addEventListener("change",()=>{g.quizzes[Number(el.dataset.qtype)].quiz_type=el.value;scheduleSave();}));
  updateQuizCount();
}
function updateQuizCount(){
  const count=state.generated?state.generated.quizzes.filter(q=>q.selected).length:0;
  document.getElementById("quizCount").textContent=`${count} câu được chọn`;
}
document.getElementById("selectAll").onclick=()=>{if(!state.generated)return;state.generated.quizzes.forEach(q=>q.selected=true);renderQuiz();scheduleSave();};

function refreshPreview(){
  const title=document.getElementById("lessonTitle").value||"Bài học";
  const g=state.generated;
  const p=document.getElementById("coursePreview");
  if(!g){p.innerHTML=`<span class="eyebrow">BẢN XEM TRƯỚC</span><h3>${escapeHtml(title)}</h3><p>Hãy tạo và duyệt nội dung AI trước.</p>`;return;}
  const first=g.sections[0];
  p.innerHTML=`<span class="eyebrow">${escapeHtml(g.direction_name)}</span><h3>${escapeHtml(title)}</h3><p><strong>${escapeHtml(first.title)}</strong></p><p>${escapeHtml(first.content)}</p>`;
}

function slugName(s){return (s||"Bai_hoc").normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/đ/g,"d").replace(/Đ/g,"D").replace(/[^A-Za-z0-9]+/g,"_").replace(/^_+|_+$/g,"");}
function refreshExportName(){document.getElementById("exportName").textContent=`${slugName(document.getElementById("lessonTitle").value)}_SCORM2004.zip`;}

async function exportScorm(){
  const status=document.getElementById("exportStatus");
  if(!state.generated){status.textContent="Chưa có nội dung để xuất. Hãy chạy Task 03 trước.";return;}
  try{await persistGenerated();}catch(e){status.textContent=e.message;return;}
  const payload={
    title:document.getElementById("lessonTitle").value||"Bài học",
    direction:state.generated.direction_name,
    objectives:state.generated.objectives,
    sections:state.generated.sections,
    quizzes:state.generated.quizzes,
    passing_score:Number(document.getElementById("passingScore").value||70),
    completion_percent:Number(document.getElementById("completionPercent").value||90),
    resume:document.getElementById("resumeToggle").checked
  };
  status.textContent="Đang tạo gói SCORM 2004...";
  try{
    const r=await fetch("/api/export-scorm",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
    if(!r.ok) throw new Error("Không tạo được gói SCORM.");
    const blob=await r.blob();
    const cd=r.headers.get("content-disposition")||"";
    const match=cd.match(/filename="([^"]+)"/);
    const name=match?match[1]:"lesson_SCORM2004.zip";
    const a=document.createElement("a");
    const url=URL.createObjectURL(blob);a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),2000);
    status.textContent=`Đã tạo ${name}. Có thể kiểm thử rồi upload lên K12Online.`;
  }catch(e){status.textContent=e.message;}
}
document.getElementById("exportBtn").onclick=exportScorm;
setStep(1);
