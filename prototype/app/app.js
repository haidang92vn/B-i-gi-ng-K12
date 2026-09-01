
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
function hydrateProject(project){state.project=project;const c=project.course;state.direction=c.metadata.direction;lessonTitle.value=c.metadata.title;state.generated={course:c,direction_name:{lesson:'Bài học mới',review:'Ôn tập – củng cố',advanced:'Nâng cao – mở rộng'}[c.metadata.direction],objectives:c.objectives.map(x=>x.text),sections:c.slides.map(s=>({id:s.id,title:s.title,content:s.blocks.find(b=>b.type==='text')?.text||'',note:s.speaker_notes||'',status:s.status,layout:s.layout})),quizzes:c.question_bank.map(q=>({id:q.id,question:q.question,options:q.options,answer:q.correct_answer,quiz_type:q.type,selected:q.selected,score:q.score,difficulty:q.difficulty,objective_ids:q.objective_ids||[],explanation:q.explanation||'',feedback_correct:q.feedback_correct||'',feedback_incorrect:q.feedback_incorrect||''}))};}
async function openProject(id){const r=await fetch(`/api/v1/projects/${id}`);if(!r.ok)return;hydrateProject(await r.json());renderAI();renderReview();renderQuiz();libraryDrawer.classList.remove('open');setStep(4);}
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
    id:s.id || `s${i+1}`,title:s.title,layout:s.layout||"content",status:s.status||"ai_draft",
    blocks:[{id:`${s.id || `s${i+1}`}-text`,type:"text",text:s.content,settings:{}}],
    speaker_notes:s.note || null
  }));
  course.question_bank=g.quizzes.map(q=>({
    id:q.id,type:q.quiz_type,question:q.question,options:q.options || [],
    correct_answer:q.answer,selected:Boolean(q.selected),score:Number(q.score??1),difficulty:q.difficulty||"understand",
    objective_ids:q.objective_ids||[],settings:{},explanation:q.explanation||null,feedback_correct:q.feedback_correct||null,feedback_incorrect:q.feedback_incorrect||null
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
  state.generated.sections=state.project.course.slides.map(s=>({id:s.id,title:s.title,content:s.blocks.find(b=>b.type==='text')?.text||'',note:s.speaker_notes||'',status:s.status,layout:s.layout}));
}

function scheduleSave(){
  if(!state.project)return;
  clearTimeout(saveTimer);
  setSaveStatus("Chưa lưu — đang chờ thao tác dừng lại…","pending");
  saveTimer=setTimeout(()=>persistGenerated().catch(error=>setSaveStatus(error.message||"Không thể lưu thay đổi. Nội dung vẫn còn trên màn hình.","error")),700);
}

function setSaveStatus(message,type="saved"){const target=document.getElementById("editorSaveStatus");if(!target)return;target.textContent=message;target.dataset.state=type;}

async function persistGenerated(){
  if(!state.project)return;
  setSaveStatus("Đang lưu bản nháp…","pending");
  const course=syncCanonicalCourse();
  const expected=state.project.revision;
  course.revision=expected+1;
  const response=await fetch(`/api/v1/projects/${state.project.id}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({expected_revision:expected,course})});
  if(response.status===409) throw new Error("Bản nháp đã được cập nhật ở phiên khác. Hãy tải lại bài giảng.");
  if(!response.ok) throw new Error("Không thể lưu thay đổi bài giảng.");
  state.project=await response.json();
  state.generated.course=state.project.course;
  setSaveStatus(`Đã lưu phiên bản ${state.project.revision}.`,"saved");
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
  const layouts={content:"Nội dung",two_column:"Hai cột",callout:"Điểm nhấn",quiz:"Câu hỏi"};
  document.getElementById("reviewArea").className="";
  document.getElementById("reviewArea").innerHTML=`
    <div class="review-objectives"><h3>Mục tiêu bài học</h3>${g.objectives.map((o,i)=>`<input data-obj="${i}" value="${escapeHtml(o)}">`).join("")}</div>
    <div class="editor-toolbar"><strong>${g.sections.length} slide</strong><button class="ghost" onclick="addSection()">+ Thêm slide</button></div>
    ${g.sections.map((s,i)=>`<div class="review-section"><div class="editor-section-head"><strong>Slide ${i+1}</strong><div class="editor-controls"><select data-sec-layout="${i}">${Object.entries(layouts).map(([id,label])=>`<option value="${id}" ${s.layout===id?"selected":""}>${label}</option>`).join("")}</select><select data-sec-status="${i}"><option value="ai_draft" ${s.status==="ai_draft"?"selected":""}>AI nháp</option><option value="edited" ${s.status==="edited"?"selected":""}>Đã sửa</option><option value="approved" ${s.status==="approved"?"selected":""}>Đã duyệt</option></select></div></div><div class="row"><input data-sec-title="${i}" value="${escapeHtml(s.title)}"><textarea data-sec-content="${i}">${escapeHtml(s.content)}</textarea></div><div class="editor-actions"><button class="ghost" onclick="moveSection(${i},-1)" ${i===0?"disabled":""}>↑</button><button class="ghost" onclick="moveSection(${i},1)" ${i===g.sections.length-1?"disabled":""}>↓</button><button class="ghost" onclick="duplicateSection(${i})">Nhân bản</button><button class="ghost" onclick="regenerateSection(${i})" ${s.status==="approved"?"disabled":""}>Tạo lại phần này</button><button class="ghost danger" onclick="deleteSection(${i})">Xóa</button></div></div>`).join("")}
  `;
  document.querySelectorAll("[data-obj]").forEach(el=>el.addEventListener("input",()=>{g.objectives[Number(el.dataset.obj)]=el.value;scheduleSave();}));
  document.querySelectorAll("[data-sec-title]").forEach(el=>el.addEventListener("input",()=>{const s=g.sections[Number(el.dataset.secTitle)];s.title=el.value;markEdited(s);scheduleSave();}));
  document.querySelectorAll("[data-sec-content]").forEach(el=>el.addEventListener("input",()=>{const s=g.sections[Number(el.dataset.secContent)];s.content=el.value;markEdited(s);scheduleSave();}));
  document.querySelectorAll("[data-sec-layout]").forEach(el=>el.addEventListener("change",()=>{const s=g.sections[Number(el.dataset.secLayout)];s.layout=el.value;markEdited(s);scheduleSave();}));
  document.querySelectorAll("[data-sec-status]").forEach(el=>el.addEventListener("change",()=>{g.sections[Number(el.dataset.secStatus)].status=el.value;scheduleSave();renderReview();}));
}

function editorId(prefix){return `${prefix}-${globalThis.crypto?.randomUUID?globalThis.crypto.randomUUID():Date.now().toString(36)}`;}
function markEdited(section){if(section.status!=="approved")section.status="edited";}
function addSection(){const g=state.generated;g.sections.push({id:editorId("slide"),title:"Slide mới",content:"Nhập nội dung cho slide này.",note:"",status:"edited",layout:"content"});renderReview();scheduleSave();}
function duplicateSection(index){const original=state.generated.sections[index];state.generated.sections.splice(index+1,0,{...original,id:editorId("slide"),title:`${original.title} (bản sao)`,status:"edited"});renderReview();scheduleSave();}
function deleteSection(index){if(!confirm("Xóa slide này?"))return;state.generated.sections.splice(index,1);renderReview();scheduleSave();}
function moveSection(index,offset){const sections=state.generated.sections,target=index+offset;if(target<0||target>=sections.length)return;[sections[index],sections[target]]=[sections[target],sections[index]];renderReview();scheduleSave();}

async function regenerateSection(index){
  if(!state.project){alert('Hãy lưu bản nháp bài giảng trước.');return;}
  const section=state.generated.sections[index];
  const response=await fetch(`/api/v1/projects/${state.project.id}/slides/${section.id}/regenerate`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({source:sourceText.value||'Nội dung bài học do giáo viên cung cấp.',provider:generationProvider.value,credential_id:generationCredential.value||null,expected_revision:state.project.revision})});
  if(!response.ok){alert((await apiMessage(response))||'Không thể tạo lại phần này.');return;}
  state.project=await response.json();
  const slide=state.project.course.slides.find(x=>x.id===section.id);
  section.title=slide.title;section.content=slide.blocks.find(x=>x.type==='text')?.text||'';section.note=slide.speaker_notes||'';section.status=slide.status;section.layout=slide.layout;
  state.generated.course=state.project.course;setSaveStatus(`Đã tạo lại slide và lưu phiên bản ${state.project.revision}.`,"saved");renderAI();renderReview();
}

const quizTypeLabels={single:"Một đáp án",multiple:"Nhiều đáp án",truefalse:"Đúng / Sai",fill:"Điền từ",matching:"Ghép đôi",ordering:"Sắp xếp",dragdrop:"Kéo thả",image:"Chọn hình ảnh"};
const difficultyLabels={recognize:"Nhận biết",understand:"Thông hiểu",apply:"Vận dụng",advanced:"Nâng cao"};
function answerForEditor(value){return typeof value==="string"?value:JSON.stringify(value);}
function parseEditorAnswer(value,type){if(type==="multiple"||type==="ordering"||type==="matching"){try{return JSON.parse(value);}catch{return value.split(/\n|,/).map(x=>x.trim()).filter(Boolean);}}return value;}

function renderQuiz(){
  const g=state.generated;if(!g)return;
  const area=document.getElementById("quizArea");area.className="";
  area.innerHTML=`<div class="editor-toolbar"><strong>${g.quizzes.length} câu trong ngân hàng</strong><button class="ghost" onclick="addQuiz()">+ Thêm câu hỏi</button></div>${g.quizzes.map((q,i)=>`
    <div class="quiz-card">
      <div class="quiz-card-top">
        <input type="checkbox" data-qcheck="${i}" ${q.selected?"checked":""}>
        <select data-qtype="${i}">${Object.entries(quizTypeLabels).map(([k,v])=>`<option value="${k}" ${q.quiz_type===k?"selected":""}>${v}</option>`).join("")}</select>
        <select data-qdifficulty="${i}">${Object.entries(difficultyLabels).map(([k,v])=>`<option value="${k}" ${q.difficulty===k?"selected":""}>${v}</option>`).join("")}</select>
        <input class="score-input" data-qscore="${i}" type="number" min="0" step="0.5" value="${Number(q.score??1)}" title="Điểm">
      </div>
      <label>Câu hỏi<textarea data-qquestion="${i}">${escapeHtml(q.question)}</textarea></label>
      <label>Phương án (mỗi dòng một phương án)<textarea data-qoptions="${i}">${escapeHtml((q.options||[]).join("\n"))}</textarea></label>
      <label>Đáp án đúng${["multiple","matching","ordering"].includes(q.quiz_type)?" (JSON hoặc mỗi dòng một giá trị)":""}<textarea data-qanswer="${i}">${escapeHtml(answerForEditor(q.answer))}</textarea></label>
      <div class="quiz-grid"><label>Giải thích<textarea data-qexplanation="${i}">${escapeHtml(q.explanation||"")}</textarea></label><label>Phản hồi đúng<textarea data-qcorrect="${i}">${escapeHtml(q.feedback_correct||"")}</textarea></label><label>Phản hồi cần cải thiện<textarea data-qincorrect="${i}">${escapeHtml(q.feedback_incorrect||"")}</textarea></label></div>
      <fieldset class="objective-links"><legend>Liên kết mục tiêu</legend>${g.objectives.map((objective,objectiveIndex)=>`<label><input type="checkbox" data-qobjective="${i}" value="o${objectiveIndex+1}" ${(q.objective_ids||[]).includes(`o${objectiveIndex+1}`)?"checked":""}> ${escapeHtml(objective)}</label>`).join("")}</fieldset>
      <div class="editor-actions"><button class="ghost danger" onclick="deleteQuiz(${i})">Xóa câu hỏi</button></div>
    </div>`).join("")}`;
  document.querySelectorAll("[data-qcheck]").forEach(el=>el.addEventListener("change",()=>{g.quizzes[Number(el.dataset.qcheck)].selected=el.checked;updateQuizCount();scheduleSave();}));
  document.querySelectorAll("[data-qtype]").forEach(el=>el.addEventListener("change",()=>{g.quizzes[Number(el.dataset.qtype)].quiz_type=el.value;scheduleSave();renderQuiz();}));
  document.querySelectorAll("[data-qdifficulty]").forEach(el=>el.addEventListener("change",()=>{g.quizzes[Number(el.dataset.qdifficulty)].difficulty=el.value;scheduleSave();}));
  document.querySelectorAll("[data-qscore]").forEach(el=>el.addEventListener("input",()=>{g.quizzes[Number(el.dataset.qscore)].score=Math.max(0,Number(el.value)||0);scheduleSave();}));
  document.querySelectorAll("[data-qquestion]").forEach(el=>el.addEventListener("input",()=>{g.quizzes[Number(el.dataset.qquestion)].question=el.value;scheduleSave();}));
  document.querySelectorAll("[data-qoptions]").forEach(el=>el.addEventListener("input",()=>{g.quizzes[Number(el.dataset.qoptions)].options=el.value.split("\n").map(x=>x.trim()).filter(Boolean);scheduleSave();}));
  document.querySelectorAll("[data-qanswer]").forEach(el=>el.addEventListener("input",()=>{const q=g.quizzes[Number(el.dataset.qanswer)];q.answer=parseEditorAnswer(el.value,q.quiz_type);scheduleSave();}));
  document.querySelectorAll("[data-qexplanation]").forEach(el=>el.addEventListener("input",()=>{g.quizzes[Number(el.dataset.qexplanation)].explanation=el.value;scheduleSave();}));
  document.querySelectorAll("[data-qcorrect]").forEach(el=>el.addEventListener("input",()=>{g.quizzes[Number(el.dataset.qcorrect)].feedback_correct=el.value;scheduleSave();}));
  document.querySelectorAll("[data-qincorrect]").forEach(el=>el.addEventListener("input",()=>{g.quizzes[Number(el.dataset.qincorrect)].feedback_incorrect=el.value;scheduleSave();}));
  document.querySelectorAll("[data-qobjective]").forEach(el=>el.addEventListener("change",()=>{const q=g.quizzes[Number(el.dataset.qobjective)],id=el.value;q.objective_ids=el.checked?[...new Set([...(q.objective_ids||[]),id])]:q.objective_ids.filter(x=>x!==id);scheduleSave();}));
  updateQuizCount();
}
function addQuiz(){state.generated.quizzes.push({id:editorId("question"),question:"Câu hỏi mới",options:["Phương án đúng","Phương án khác"],answer:"Phương án đúng",quiz_type:"single",selected:true,score:1,difficulty:"understand",objective_ids:[],explanation:"",feedback_correct:"Chính xác.",feedback_incorrect:"Hãy xem lại nội dung bài học."});renderQuiz();scheduleSave();}
function deleteQuiz(index){if(!confirm("Xóa câu hỏi này khỏi ngân hàng?"))return;state.generated.quizzes.splice(index,1);renderQuiz();updateQuizCount();scheduleSave();}
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
document.getElementById("openPlayerBtn").onclick=()=>{if(!state.project){alert("Hãy tạo và lưu bản nháp bài giảng trước.");return;}window.open(`/api/v1/projects/${state.project.id}/player`,"_blank","noopener");};

function slugName(s){return (s||"Bai_hoc").normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/đ/g,"d").replace(/Đ/g,"D").replace(/[^A-Za-z0-9]+/g,"_").replace(/^_+|_+$/g,"");}
function refreshExportName(){document.getElementById("exportName").textContent=`${slugName(document.getElementById("lessonTitle").value)}_SCORM2004.zip`;loadExportHistory();}
async function loadExportHistory(){const r=await fetch('/api/v1/exports');if(!r.ok)return;const items=await r.json();document.getElementById('exportHistory').innerHTML=items.length?items.map(x=>`<div>${escapeHtml(x.filename)} • ${x.byte_size} bytes • ${escapeHtml(x.status)}</div>`).join(''):'Chưa có lịch sử export.';}

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
    resume:document.getElementById("resumeToggle").checked,
    project_id:state.project?.id||null
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
    status.textContent=`Đã tạo ${name}. Có thể kiểm thử rồi upload lên K12Online.`;loadExportHistory();
  }catch(e){status.textContent=e.message;}
}
document.getElementById("exportBtn").onclick=exportScorm;
setStep(1);
