
let currentStep = 1;
let state = { direction: "lesson", generated: null };

const titles = ["Nhập nội dung bài học","Chọn định hướng","AI tạo nội dung","Giáo viên duyệt","Chọn dạng Quiz","Dựng bài giảng","Cấu hình SCORM","Kiểm tra & xuất"];

function setStep(n){
  currentStep = Math.max(1, Math.min(8,n));
  document.querySelectorAll(".page").forEach(x=>x.classList.toggle("active",Number(x.dataset.page)===currentStep));
  document.querySelectorAll(".step").forEach(x=>x.classList.toggle("active",Number(x.dataset.step)===currentStep));
  document.getElementById("pageTitle").textContent = titles[currentStep-1];
  document.getElementById("footerStep").textContent = `Bước ${currentStep}/8`;
  document.getElementById("backBtn").disabled = currentStep===1;
  document.getElementById("nextBtn").textContent = currentStep===8 ? "Hoàn tất" : "Tiếp tục →";
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
    provider:document.getElementById("provider").value,
    api_key:document.getElementById("apiKey").value || null
  };
  try{
    const r=await fetch("/api/generate",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
    if(!r.ok) throw new Error("Không gọi được dịch vụ tạo nội dung.");
    state.generated=await r.json();
    renderAI(); renderReview(); renderQuiz();
  }catch(e){
    document.getElementById("aiOutput").innerHTML=`<strong>Lỗi</strong><p>${escapeHtml(e.message)}</p>`;
  }finally{
    btn.disabled=false; btn.textContent="Tạo lại bằng AI";
  }
}
document.getElementById("generateBtn").onclick=generateAI;

function renderAI(){
  const g=state.generated;
  document.getElementById("aiOutput").className="";
  document.getElementById("aiOutput").innerHTML=`
  <div class="ai-summary">
    <div class="summary-card"><span class="eyebrow">MỤC TIÊU</span><h3>${escapeHtml(g.direction_name)}</h3><ul>${g.objectives.map(x=>`<li>${escapeHtml(x)}</li>`).join("")}</ul></div>
    <div class="summary-card"><span class="eyebrow">CẤU TRÚC ĐỀ XUẤT</span>${g.sections.map((s,i)=>`<h3>${i+1}. ${escapeHtml(s.title)}</h3><p>${escapeHtml(s.content).slice(0,180)}...</p>`).join("")}<div class="hint">${escapeHtml(g.notice)}</div></div>
  </div>`;
}

function renderReview(){
  const g=state.generated;if(!g)return;
  document.getElementById("reviewArea").className="";
  document.getElementById("reviewArea").innerHTML=`
    <div class="review-objectives"><h3>Mục tiêu bài học</h3>${g.objectives.map((o,i)=>`<input data-obj="${i}" value="${escapeHtml(o)}">`).join("")}</div>
    ${g.sections.map((s,i)=>`<div class="review-section"><div class="row"><input data-sec-title="${i}" value="${escapeHtml(s.title)}"><textarea data-sec-content="${i}">${escapeHtml(s.content)}</textarea></div></div>`).join("")}
  `;
  document.querySelectorAll("[data-obj]").forEach(el=>el.addEventListener("input",()=>{g.objectives[Number(el.dataset.obj)]=el.value;}));
  document.querySelectorAll("[data-sec-title]").forEach(el=>el.addEventListener("input",()=>{g.sections[Number(el.dataset.secTitle)].title=el.value;}));
  document.querySelectorAll("[data-sec-content]").forEach(el=>el.addEventListener("input",()=>{g.sections[Number(el.dataset.secContent)].content=el.value;}));
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
  document.querySelectorAll("[data-qcheck]").forEach(el=>el.addEventListener("change",()=>{g.quizzes[Number(el.dataset.qcheck)].selected=el.checked;updateQuizCount();}));
  document.querySelectorAll("[data-qtype]").forEach(el=>el.addEventListener("change",()=>{g.quizzes[Number(el.dataset.qtype)].quiz_type=el.value;}));
  updateQuizCount();
}
function updateQuizCount(){
  const count=state.generated?state.generated.quizzes.filter(q=>q.selected).length:0;
  document.getElementById("quizCount").textContent=`${count} câu được chọn`;
}
document.getElementById("selectAll").onclick=()=>{if(!state.generated)return;state.generated.quizzes.forEach(q=>q.selected=true);renderQuiz();};

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
