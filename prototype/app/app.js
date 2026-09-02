
let currentStep = 1;
let state = { direction: "lesson", generated: null, project: null };
let saveTimer = null;
const authGate = document.getElementById('authGate');
const authForm = document.getElementById('authForm');
const authEmailInput = document.getElementById('authEmail');
const authPasswordInput = document.getElementById('authPassword');
const authMessage = document.getElementById('authMessage');
async function ensureAuth(){const r=await fetch('/api/v1/me');if(r.ok)authGate.classList.add('hidden');else if(new URLSearchParams(location.search).get('auth_error')==='google')authMessage.textContent='Không thể đăng nhập Google. Hãy thử lại hoặc dùng email/mật khẩu.';}
async function apiMessage(response){try{const body=await response.json();return typeof body.detail==='string'?body.detail:'';}catch{return '';}}
authForm.onsubmit=async e=>{e.preventDefault();const email=authEmailInput.value.trim(),password=authPasswordInput.value;if(password.length<12){authMessage.textContent='Mật khẩu cần tối thiểu 12 ký tự.';return;}authMessage.textContent='Đang xác thực…';const body=JSON.stringify({email,password});let r=await fetch('/api/v1/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body});if(r.ok){authGate.classList.add('hidden');return;}if(r.status!==401){authMessage.textContent=(await apiMessage(r))||'Không thể kết nối máy chủ. Vui lòng thử lại.';return;}r=await fetch('/api/v1/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body});if(r.ok){authGate.classList.add('hidden');return;}if(r.status===409){authMessage.textContent='Email này đã được đăng ký; vui lòng kiểm tra lại mật khẩu.';return;}authMessage.textContent=(await apiMessage(r))||'Không thể tạo tài khoản. Vui lòng thử lại.';};ensureAuth();
document.getElementById('googleLoginBtn').onclick=()=>{location.assign('/api/v1/auth/google/start');};
const accessLabels={owner:'Chủ sở hữu',editor:'Có thể chỉnh sửa',viewer:'Chỉ xem'};
function canEditProject(){return !state.project||state.project.access_level!=='viewer';}
function applyProjectAccess(){const viewer=!canEditProject();[lessonTitle,sourceText,sourceFile,generationProvider,generationCredential,document.getElementById('generateBtn'),document.getElementById('selectAll')].forEach(el=>{if(el)el.disabled=viewer;});document.querySelectorAll('.direction-card').forEach(card=>card.classList.toggle('disabled',viewer));}
async function loadLibrary(){const r=await fetch('/api/v1/projects');if(!r.ok)return;const items=await r.json();libraryList.innerHTML=items.length?items.map(p=>{const access=p.access_level||'owner';const ownerActions=access==='owner'?`<button onclick="shareProject('${p.id}')">Chia sẻ</button><button onclick="archiveProject('${p.id}')">Lưu trữ</button><button onclick="deleteProject('${p.id}')">Xóa</button>`:'';return `<article class="library-item"><strong>${escapeHtml(p.title)}</strong><small>${p.status} • phiên bản ${p.revision} • ${accessLabels[access]}</small><div class="library-actions"><button onclick="openProject('${p.id}')">Mở</button><button onclick="copyProject('${p.id}')">Nhân bản</button>${ownerActions}</div></article>`;}).join(''):'<p class="hint">Chưa có bài giảng nào.</p>';}
libraryBtn.onclick=()=>{libraryDrawer.classList.add('open');loadLibrary();};closeLibraryBtn.onclick=()=>libraryDrawer.classList.remove('open');
newLessonBtn.onclick=()=>{libraryDrawer.classList.remove('open');state={direction:'lesson',generated:null,project:null};location.reload();};
function hydrateProject(project){state.project=project;const c=project.course;state.direction=c.metadata.direction;lessonTitle.value=c.metadata.title;state.generated={course:c,direction_name:{lesson:'Bài học mới',review:'Ôn tập – củng cố',advanced:'Nâng cao – mở rộng'}[c.metadata.direction],objectives:c.objectives.map(x=>x.text),sections:c.slides.map(s=>({id:s.id,title:s.title,content:s.blocks.find(b=>b.type==='text')?.text||'',mediaBlocks:s.blocks.filter(b=>b.type!=='text'),note:s.speaker_notes||'',status:s.status,layout:s.layout})),quizzes:c.question_bank.map(q=>({id:q.id,question:q.question,options:q.options,answer:q.correct_answer,quiz_type:q.type,selected:q.selected,score:q.score,difficulty:q.difficulty,objective_ids:q.objective_ids||[],explanation:q.explanation||'',feedback_correct:q.feedback_correct||'',feedback_incorrect:q.feedback_incorrect||''}))};applyProjectAccess();}
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
const schoolBtn=document.getElementById('schoolBtn'),schoolDrawer=document.getElementById('schoolDrawer'),schoolList=document.getElementById('schoolList'),schoolForm=document.getElementById('schoolForm'),schoolMemberForm=document.getElementById('schoolMemberForm'),schoolMembers=document.getElementById('schoolMembers');
let schools=[],selectedSchoolId=null;
function schoolRoleLabel(role){return role==='school_admin'?'Quản trị trường':'Giáo viên';}
async function loadSchoolMembers(){const school=schools.find(x=>x.id===selectedSchoolId);if(!school){schoolMembers.innerHTML='';schoolMemberForm.hidden=true;return;}const r=await fetch(`/api/v1/schools/${school.id}/members`);if(!r.ok){schoolMembers.innerHTML='<p class="hint">Không thể tải thành viên.</p>';return;}const members=await r.json();const admin=school.role==='school_admin';schoolMemberForm.hidden=!admin;schoolMembers.innerHTML=`<h3>Thành viên của ${escapeHtml(school.name)}</h3>${members.map(member=>`<article class="library-item"><strong>${escapeHtml(member.full_name||member.email)}</strong><small>${escapeHtml(member.email)} • ${schoolRoleLabel(member.role)}</small>${admin?`<div class="library-actions"><button class="danger" onclick="removeSchoolMember('${member.user_id}')">Gỡ</button></div>`:''}</article>`).join('')}`;}
async function loadSchools(){const r=await fetch('/api/v1/schools');if(!r.ok){schoolList.innerHTML='<p class="hint">Không thể tải nhóm trường.</p>';return;}schools=await r.json();if(!schools.some(x=>x.id===selectedSchoolId))selectedSchoolId=schools[0]?.id||null;schoolList.innerHTML=schools.length?schools.map(s=>`<button class="library-item ${s.id===selectedSchoolId?'selected-school':''}" onclick="selectSchool('${s.id}')"><strong>${escapeHtml(s.name)}</strong><small>${schoolRoleLabel(s.role)}</small></button>`).join(''):'<p class="hint">Chưa có nhóm trường. Tạo một nhóm để mời giáo viên đã đăng ký.</p>';await loadSchoolMembers();}
async function selectSchool(id){selectedSchoolId=id;await loadSchools();}
async function removeSchoolMember(userId){if(!selectedSchoolId||!confirm('Gỡ thành viên này khỏi nhóm trường?'))return;const r=await fetch(`/api/v1/schools/${selectedSchoolId}/members/${userId}`,{method:'DELETE'});if(!r.ok)alert((await apiMessage(r))||'Không thể gỡ thành viên.');await loadSchools();}
schoolBtn.onclick=()=>{schoolDrawer.classList.add('open');loadSchools();};document.getElementById('closeSchoolBtn').onclick=()=>schoolDrawer.classList.remove('open');
schoolForm.onsubmit=async event=>{event.preventDefault();const input=document.getElementById('schoolName'),r=await fetch('/api/v1/schools',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:input.value.trim()})});if(!r.ok){alert((await apiMessage(r))||'Không thể tạo nhóm trường.');return;}input.value='';await loadSchools();};
schoolMemberForm.onsubmit=async event=>{event.preventDefault();if(!selectedSchoolId)return;const email=document.getElementById('schoolMemberEmail'),role=document.getElementById('schoolMemberRole'),r=await fetch(`/api/v1/schools/${selectedSchoolId}/members`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:email.value.trim(),role:role.value})});if(!r.ok){alert((await apiMessage(r))||'Không thể thêm thành viên. Người được mời cần đăng ký trước.');return;}email.value='';await loadSchools();};
const analyticsBtn=document.getElementById('analyticsBtn'),analyticsDrawer=document.getElementById('analyticsDrawer'),analyticsSchool=document.getElementById('analyticsSchool'),analyticsImportForm=document.getElementById('analyticsImportForm'),analyticsUpload=document.getElementById('analyticsUpload'),analyticsImportStatus=document.getElementById('analyticsImportStatus'),analyticsDashboard=document.getElementById('analyticsDashboard'),analyticsImports=document.getElementById('analyticsImports');
let analyticsSchools=[];
function analyticsPercent(value){return value==null?'—':`${Math.round(value*100)}%`;}
function analyticsNumber(value){return value==null?'—':Number(value).toLocaleString('vi-VN',{maximumFractionDigits:1});}
function renderAnalyticsSummary(summary,insights){analyticsDashboard.className='analytics-dashboard';const cards=[['Dòng dữ liệu',analyticsNumber(summary.event_count)],['Người học (ẩn danh)',analyticsNumber(summary.learner_count)],['Hoàn thành TB',analyticsPercent(summary.completion_ratio)],['Điểm TB',analyticsPercent(summary.score_ratio)],['Tỷ lệ đúng',analyticsPercent(summary.correct_ratio)],['Thời lượng TB',summary.average_duration_minutes==null?'—':`${analyticsNumber(summary.average_duration_minutes)} phút`]];analyticsDashboard.innerHTML=`<div class="analytics-metrics">${cards.map(([label,value])=>`<article class="analytics-metric"><strong>${escapeHtml(value)}</strong><small>${escapeHtml(label)}</small></article>`).join('')}</div><h3>Theo bài học</h3><div class="analytics-lessons">${summary.lessons.length?summary.lessons.map(item=>`<article class="analytics-lesson"><strong>${escapeHtml(item.lesson_title||item.lesson_external_id)}</strong><p>${item.event_count} lượt • hoàn thành ${analyticsPercent(item.completion_ratio)} • điểm ${analyticsPercent(item.score_ratio)} • đúng ${analyticsPercent(item.correct_ratio)}</p></article>`).join(''):'<p class="hint">Chưa có dữ liệu.</p>'}</div><h3>Gợi ý từ số liệu tổng hợp</h3><div class="hint">${(insights.insights||[]).map(escapeHtml).join('<br>')}</div><p class="hint">${escapeHtml(insights.privacy_note||summary.privacy_note||'')}</p>`;}
async function loadAnalytics(){const r=await fetch('/api/v1/schools');if(!r.ok){analyticsImportStatus.textContent='Hãy đăng nhập để xem analytics.';return;}analyticsSchools=await r.json();const previous=analyticsSchool.value;analyticsSchool.innerHTML=analyticsSchools.length?analyticsSchools.map(s=>`<option value="${s.id}">${escapeHtml(s.name)} • ${schoolRoleLabel(s.role)}</option>`).join(''):'<option value="">Chưa có nhóm trường</option>';if(previous&&analyticsSchools.some(s=>s.id===previous))analyticsSchool.value=previous;await refreshAnalytics();}
async function refreshAnalytics(){const school=analyticsSchools.find(s=>s.id===analyticsSchool.value);if(!school){analyticsImportForm.hidden=true;analyticsDashboard.className='analytics-dashboard hint';analyticsDashboard.textContent='Chưa có nhóm trường.';analyticsImports.textContent='';return;}const isAdmin=school.role==='school_admin';analyticsImportForm.hidden=!isAdmin;analyticsImportStatus.textContent=isAdmin?'Quản trị trường có thể nhập báo cáo đã ẩn danh.':'Giáo viên chỉ xem số liệu tổng hợp, không xem báo cáo gốc.';const [summaryResponse,insightsResponse,importsResponse]=await Promise.all([fetch(`/api/v1/schools/${school.id}/analytics/summary`),fetch(`/api/v1/schools/${school.id}/analytics/insights`),isAdmin?fetch(`/api/v1/schools/${school.id}/analytics/imports`):Promise.resolve(null)]);if(summaryResponse.ok&&insightsResponse.ok)renderAnalyticsSummary(await summaryResponse.json(),await insightsResponse.json());else{analyticsDashboard.className='analytics-dashboard hint';analyticsDashboard.textContent='Không thể tải dashboard.';}if(importsResponse&&importsResponse.ok){const imports=await importsResponse.json();analyticsImports.innerHTML=imports.length?`<h3>Lịch sử nhập</h3>${imports.map(item=>`<article class="library-item"><strong>${escapeHtml(item.original_filename)}</strong><small>${item.accepted_row_count}/${item.row_count} dòng hợp lệ; loại ${item.rejected_row_count} dòng</small></article>`).join('')}`:'<p class="hint">Chưa có lần nhập nào.</p>';}else analyticsImports.textContent='';}
analyticsBtn.onclick=()=>{analyticsDrawer.classList.add('open');loadAnalytics();};document.getElementById('closeAnalyticsBtn').onclick=()=>analyticsDrawer.classList.remove('open');analyticsSchool.onchange=refreshAnalytics;
analyticsImportForm.onsubmit=async event=>{event.preventDefault();const school=analyticsSchools.find(s=>s.id===analyticsSchool.value),file=analyticsUpload.files[0];if(!school||!file)return;const form=new FormData();form.append('upload',file);analyticsImportStatus.textContent='Đang kiểm tra, ẩn danh và nhập báo cáo…';const r=await fetch(`/api/v1/schools/${school.id}/analytics/imports`,{method:'POST',body:form});if(!r.ok){analyticsImportStatus.textContent=(await apiMessage(r))||'Không thể nhập báo cáo.';return;}const result=await r.json();analyticsUpload.value='';analyticsImportStatus.textContent=`Đã nhập ${result.accepted_row_count}/${result.row_count} dòng; không lưu báo cáo gốc.`;await refreshAnalytics();};
const questionLibraryBtn=document.getElementById('questionLibraryBtn'),questionLibraryDrawer=document.getElementById('questionLibraryDrawer'),sharedQuestionSchool=document.getElementById('sharedQuestionSchool'),sharedQuestionForm=document.getElementById('sharedQuestionForm'),sharedQuestionSource=document.getElementById('sharedQuestionSource'),sharedQuestionList=document.getElementById('sharedQuestionList');
let questionLibrarySchools=[],questionLibraryUserId=null;
const sharedStatusLabels={draft:'Nháp',submitted:'Chờ duyệt',published:'Đã công bố',rejected:'Cần chỉnh sửa'};
function refreshSharedQuestionSources(){const canPublish=Boolean(state.project&&state.generated&&canEditProject());sharedQuestionForm.hidden=!canPublish;if(!canPublish){sharedQuestionSource.innerHTML='<option>Hãy mở bài giảng có quyền chỉnh sửa.</option>';return;}sharedQuestionSource.innerHTML=state.generated.quizzes.map((q,index)=>`<option value="${q.id}">Câu ${index+1}: ${escapeHtml(q.question).slice(0,90)}</option>`).join('')||'<option>Chưa có câu hỏi trong bài giảng.</option>';}
async function loadSharedQuestions(){const schoolId=sharedQuestionSchool.value;if(!schoolId){sharedQuestionList.innerHTML='<p class="hint">Chưa có nhóm trường. Hãy tạo hoặc tham gia một nhóm trước.</p>';return;}const r=await fetch(`/api/v1/shared-questions?school_id=${encodeURIComponent(schoolId)}`);if(!r.ok){sharedQuestionList.innerHTML='<p class="hint">Không thể tải thư viện câu hỏi.</p>';return;}const items=await r.json(),role=questionLibrarySchools.find(s=>s.id===schoolId)?.role;sharedQuestionList.innerHTML=items.length?items.map(item=>{const canReview=role==='school_admin'&&item.status==='submitted';const canSubmit=item.submitted_by_user_id===questionLibraryUserId&&(item.status==='draft'||item.status==='rejected');const canUse=item.status==='published'&&state.project&&canEditProject();const answer=typeof item.question.correct_answer==='string'?item.question.correct_answer:JSON.stringify(item.question.correct_answer);return `<article class="library-item"><strong>${escapeHtml(item.question.question)}</strong><small>${escapeHtml(item.subject)} • ${escapeHtml(item.grade)} • ${escapeHtml(item.topic)} • ${sharedStatusLabels[item.status]}</small><p class="shared-question-meta">Độ khó: ${difficultyLabels[item.question.difficulty]} • Đáp án: ${escapeHtml(answer)}<br>Mục tiêu: ${item.learning_objectives.map(escapeHtml).join('; ')}<br>Người gửi: ${escapeHtml(item.submitted_by_name||'Giáo viên')}${item.reviewed_by_name?` • Người duyệt: ${escapeHtml(item.reviewed_by_name)}`:''}</p><div class="library-actions">${canSubmit?`<button onclick="submitSharedQuestion('${item.id}')">Gửi duyệt</button>`:''}${canReview?`<button onclick="reviewSharedQuestion('${item.id}','published')">Duyệt</button><button class="danger" onclick="reviewSharedQuestion('${item.id}','rejected')">Từ chối</button>`:''}${canUse?`<button onclick="useSharedQuestion('${item.id}')">Dùng trong bài đang mở</button>`:''}</div></article>`;}).join(''):'<p class="hint">Chưa có câu hỏi phù hợp với quyền của bạn.</p>';}
async function loadQuestionLibrary(){const [schoolResponse,userResponse]=await Promise.all([fetch('/api/v1/schools'),fetch('/api/v1/me')]);if(!schoolResponse.ok||!userResponse.ok){sharedQuestionList.innerHTML='<p class="hint">Hãy đăng nhập để dùng thư viện câu hỏi.</p>';return;}questionLibrarySchools=await schoolResponse.json();questionLibraryUserId=(await userResponse.json()).id;sharedQuestionSchool.innerHTML=questionLibrarySchools.length?questionLibrarySchools.map(s=>`<option value="${s.id}">${escapeHtml(s.name)} • ${schoolRoleLabel(s.role)}</option>`).join(''):'<option value="">Chưa có nhóm trường</option>';refreshSharedQuestionSources();await loadSharedQuestions();}
async function submitSharedQuestion(id){const r=await fetch(`/api/v1/shared-questions/${id}/submit`,{method:'POST'});if(!r.ok)alert((await apiMessage(r))||'Không thể gửi duyệt.');await loadSharedQuestions();}
async function reviewSharedQuestion(id,decision){if(decision==='rejected'&&!confirm('Từ chối câu hỏi này để giáo viên chỉnh sửa?'))return;const r=await fetch(`/api/v1/shared-questions/${id}/review`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({decision})});if(!r.ok)alert((await apiMessage(r))||'Không thể duyệt câu hỏi.');await loadSharedQuestions();}
async function useSharedQuestion(id){if(!state.project||!canEditProject())return;const r=await fetch(`/api/v1/projects/${state.project.id}/shared-questions/${id}/add`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({expected_revision:state.project.revision,selected:true})});if(!r.ok){alert((await apiMessage(r))||'Không thể thêm câu hỏi vào bài giảng.');return;}hydrateProject(await r.json());renderReview();renderQuiz();setStep(5);await loadSharedQuestions();}
questionLibraryBtn.onclick=()=>{questionLibraryDrawer.classList.add('open');loadQuestionLibrary();};document.getElementById('closeQuestionLibraryBtn').onclick=()=>questionLibraryDrawer.classList.remove('open');sharedQuestionSchool.onchange=loadSharedQuestions;
sharedQuestionForm.onsubmit=async event=>{event.preventDefault();if(!state.project||!canEditProject())return;const sourceId=sharedQuestionSource.value,subject=document.getElementById('sharedQuestionSubject'),grade=document.getElementById('sharedQuestionGrade'),topic=document.getElementById('sharedQuestionTopic'),objectives=document.getElementById('sharedQuestionObjectives');const r=await fetch(`/api/v1/projects/${state.project.id}/questions/${sourceId}/shared-draft`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({school_id:sharedQuestionSchool.value,subject:subject.value.trim(),grade:grade.value.trim(),topic:topic.value.trim(),learning_objectives:objectives.value.split('\\n').map(x=>x.trim()).filter(Boolean)})});if(!r.ok){alert((await apiMessage(r))||'Không thể lưu nháp câu hỏi.');return;}topic.value='';objectives.value='';await loadSharedQuestions();};
async function shareProject(id){const email=prompt('Email giáo viên đã đăng ký (cùng nhóm trường):');if(!email)return;const accessLevel=confirm('Chọn OK để cấp quyền chỉnh sửa; Cancel để chỉ xem.')?'editor':'viewer';const r=await fetch(`/api/v1/projects/${id}/shares`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:email.trim(),access_level:accessLevel})});if(!r.ok){alert((await apiMessage(r))||'Không thể chia sẻ. Hãy kiểm tra người nhận đã cùng nhóm trường.');return;}alert(`Đã chia sẻ với quyền ${accessLabels[accessLevel]}. `);await loadLibrary();}
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
  if(currentStep===6){refreshPreview();loadMedia();}
  if(currentStep===8) refreshExportName();
}
document.querySelectorAll(".step").forEach(btn=>btn.addEventListener("click",()=>setStep(Number(btn.dataset.step))));
document.getElementById("backBtn").onclick=()=>setStep(currentStep-1);
document.getElementById("nextBtn").onclick=()=>{ if(currentStep<8) setStep(currentStep+1); };

document.querySelectorAll(".direction-card").forEach(card=>{
  card.addEventListener("click",()=>{
    if(!canEditProject())return;
    document.querySelectorAll(".direction-card").forEach(c=>c.classList.remove("selected"));
    card.classList.add("selected");
    card.querySelector("input").checked = true;
    state.direction = card.querySelector("input").value;
  });
});

function escapeHtml(s=""){return String(s).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));}

async function generateAI(){
  if(state.project&&!canEditProject()){alert('Bạn chỉ có quyền xem. Hãy nhân bản bài giảng nếu muốn tạo phiên bản riêng.');return;}
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
    blocks:[{id:`${s.id || `s${i+1}`}-text`,type:"text",text:s.content,settings:{}},...(s.mediaBlocks||[])],
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
  applyProjectAccess();
  state.generated.course=state.project.course;
  state.generated.sections=state.project.course.slides.map(s=>({id:s.id,title:s.title,content:s.blocks.find(b=>b.type==='text')?.text||'',mediaBlocks:s.blocks.filter(b=>b.type!=='text'),note:s.speaker_notes||'',status:s.status,layout:s.layout}));
}

function scheduleSave(){
  if(!state.project||!canEditProject())return;
  clearTimeout(saveTimer);
  setSaveStatus("Chưa lưu — đang chờ thao tác dừng lại…","pending");
  saveTimer=setTimeout(()=>persistGenerated().catch(error=>setSaveStatus(error.message||"Không thể lưu thay đổi. Nội dung vẫn còn trên màn hình.","error")),700);
}

function setSaveStatus(message,type="saved"){const target=document.getElementById("editorSaveStatus");if(!target)return;target.textContent=message;target.dataset.state=type;}

async function persistGenerated(){
  if(!state.project)return;
  if(!canEditProject())throw new Error('Bạn chỉ có quyền xem bài giảng này.');
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
  if(!canEditProject()){document.querySelectorAll('#reviewArea input,#reviewArea textarea,#reviewArea select,#reviewArea button').forEach(el=>el.disabled=true);setSaveStatus('Chế độ chỉ xem — bạn có thể xem trước, kiểm tra và xuất bản sao SCORM.','saved');}
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
  if(!canEditProject())area.querySelectorAll('input,textarea,select,button').forEach(el=>el.disabled=true);
  updateQuizCount();
}
function addQuiz(){state.generated.quizzes.push({id:editorId("question"),question:"Câu hỏi mới",options:["Phương án đúng","Phương án khác"],answer:"Phương án đúng",quiz_type:"single",selected:true,score:1,difficulty:"understand",objective_ids:[],explanation:"",feedback_correct:"Chính xác.",feedback_incorrect:"Hãy xem lại nội dung bài học."});renderQuiz();scheduleSave();}
function deleteQuiz(index){if(!confirm("Xóa câu hỏi này khỏi ngân hàng?"))return;state.generated.quizzes.splice(index,1);renderQuiz();updateQuizCount();scheduleSave();}
function updateQuizCount(){
  const count=state.generated?state.generated.quizzes.filter(q=>q.selected).length:0;
  document.getElementById("quizCount").textContent=`${count} câu được chọn`;
}
document.getElementById("selectAll").onclick=()=>{if(!state.generated||!canEditProject())return;state.generated.quizzes.forEach(q=>q.selected=true);renderQuiz();scheduleSave();};

function refreshPreview(){
  const title=document.getElementById("lessonTitle").value||"Bài học";
  const g=state.generated;
  const p=document.getElementById("coursePreview");
  if(!g){p.innerHTML=`<span class="eyebrow">BẢN XEM TRƯỚC</span><h3>${escapeHtml(title)}</h3><p>Hãy tạo và duyệt nội dung AI trước.</p>`;return;}
  const first=g.sections[0];
  p.innerHTML=`<span class="eyebrow">${escapeHtml(g.direction_name)}</span><h3>${escapeHtml(title)}</h3><p><strong>${escapeHtml(first.title)}</strong></p><p>${escapeHtml(first.content)}</p>`;
}
document.getElementById("openPlayerBtn").onclick=()=>{if(!state.project){alert("Hãy tạo và lưu bản nháp bài giảng trước.");return;}window.open(`/api/v1/projects/${state.project.id}/player`,"_blank","noopener");};

function mediaSlideOptions(){
  const select=document.getElementById('mediaSlideSelect');
  if(!state.generated){select.innerHTML='<option value="">Chưa có slide</option>';return;}
  const previous=select.value;
  select.innerHTML=state.generated.sections.map((slide,index)=>`<option value="${escapeHtml(slide.id)}">Slide ${index+1}: ${escapeHtml(slide.title)}</option>`).join('');
  if([...select.options].some(option=>option.value===previous))select.value=previous;
}
function mediaPreview(item){const source=escapeHtml(item.content_url),label=escapeHtml(item.original_name);if(item.kind==='image')return `<img src="${source}" alt="${label}">`;if(item.kind==='audio')return `<audio controls preload="metadata" src="${source}"></audio>`;return `<video controls preload="metadata" src="${source}"></video>`;}
function setMediaStatus(message,type='hint'){const target=document.getElementById('mediaStatus');target.className=type;target.textContent=message;}
function setMediaControlsDisabled(disabled){document.querySelectorAll('#imageForm button,#ttsForm button,#mediaUploadForm button,#mediaUrlForm button,#mediaSlideSelect').forEach(el=>el.disabled=disabled);}
async function loadMedia(){
  mediaSlideOptions();const area=document.getElementById('mediaList');
  if(!state.project){area.innerHTML='';setMediaStatus('Hãy tạo hoặc mở bài giảng trước để thêm media.');setMediaControlsDisabled(true);return;}
  setMediaControlsDisabled(!canEditProject());
  const response=await fetch(`/api/v1/projects/${state.project.id}/media`);
  if(!response.ok){setMediaStatus('Không thể tải danh sách media.','error');return;}
  const items=await response.json();
  setMediaStatus(items.length?`${items.length} media đã lưu. Xem thử trước rồi chọn gắn vào slide.`:'Chưa có media cho bài giảng này.');
  area.innerHTML=items.map(item=>`<article class="media-item"><strong>${escapeHtml(item.original_name)}</strong><small>${escapeHtml(item.source_type)} • ${Math.round(item.byte_size/1024)} KB • ${escapeHtml(item.status)}</small>${mediaPreview(item)}${item.warning?`<p>${escapeHtml(item.warning)}</p>`:''}${item.status!=='attached'&&canEditProject()?`<button class="primary" onclick="attachMedia('${item.id}','${item.slide_id||''}')">Gắn vào slide</button>`:''}</article>`).join('');
}
async function mediaRequest(url,options,successMessage){
  setMediaStatus('Đang tạo/tải media…');
  const response=await fetch(url,options);
  if(!response.ok){setMediaStatus((await apiMessage(response))||'Không thể xử lý media.','error');return null;}
  const item=await response.json();setMediaStatus(successMessage);await loadMedia();return item;
}
function selectedMediaSlide(){const id=document.getElementById('mediaSlideSelect').value;if(!state.project||!id){setMediaStatus('Hãy tạo bài giảng và chọn slide trước.','error');return null;}return id;}
document.getElementById('imageForm').onsubmit=async event=>{event.preventDefault();const slide=selectedMediaSlide();if(!slide)return;await mediaRequest(`/api/v1/projects/${state.project.id}/slides/${slide}/image`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt:document.getElementById('imagePrompt').value,provider:generationProvider.value,credential_id:generationCredential.value||null})},'Ảnh đã tạo. Hãy xem thử và gắn vào slide khi phù hợp.');};
document.getElementById('ttsForm').onsubmit=async event=>{event.preventDefault();const slide=selectedMediaSlide();if(!slide)return;await mediaRequest(`/api/v1/projects/${state.project.id}/slides/${slide}/tts`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:document.getElementById('ttsText').value,voice:document.getElementById('ttsVoice').value||'alloy',provider:generationProvider.value,credential_id:generationCredential.value||null})},'Giọng đọc đã tạo. Hãy nghe thử và gắn vào slide khi phù hợp.');};
document.getElementById('mediaUploadForm').onsubmit=async event=>{event.preventDefault();const slide=selectedMediaSlide(),file=document.getElementById('mediaUpload').files[0];if(!slide||!file)return;const data=new FormData();data.append('upload',file);await mediaRequest(`/api/v1/projects/${state.project.id}/media/upload?slide_id=${encodeURIComponent(slide)}&rights_confirmed=${document.getElementById('uploadRights').checked}`,{method:'POST',body:data},'Đã tải tệp. Hãy xem thử và gắn vào slide khi phù hợp.');};
document.getElementById('mediaUrlForm').onsubmit=async event=>{event.preventDefault();const slide=selectedMediaSlide();if(!slide)return;await mediaRequest(`/api/v1/projects/${state.project.id}/media/url?slide_id=${encodeURIComponent(slide)}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind:document.getElementById('mediaUrlKind').value,url:document.getElementById('mediaUrl').value,label:document.getElementById('mediaUrlLabel').value,rights_confirmed:document.getElementById('urlRights').checked})},'Đã lưu URL. Hãy xem thử và gắn vào slide khi phù hợp.');};
async function attachMedia(assetId,slideId){if(!state.project||!slideId)return;const response=await fetch(`/api/v1/projects/${state.project.id}/slides/${slideId}/media`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({asset_id:assetId,expected_revision:state.project.revision})});if(!response.ok){setMediaStatus((await apiMessage(response))||'Không thể gắn media vào slide.','error');return;}hydrateProject(await response.json());setMediaStatus('Đã gắn media vào course.json và lưu phiên bản mới.');refreshPreview();await loadMedia();}

function slugName(s){return (s||"Bai_hoc").normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/đ/g,"d").replace(/Đ/g,"D").replace(/[^A-Za-z0-9]+/g,"_").replace(/^_+|_+$/g,"");}
function refreshExportName(){document.getElementById("exportName").textContent=`${slugName(document.getElementById("lessonTitle").value)}_SCORM2004.zip`;loadExportHistory();}
async function loadExportHistory(){const r=await fetch('/api/v1/exports');if(!r.ok)return;const items=await r.json();document.getElementById('exportHistory').innerHTML=items.length?items.map(x=>`<div>${escapeHtml(x.filename)} • ${x.byte_size} bytes • ${escapeHtml(x.status)}</div>`).join(''):'Chưa có lịch sử export.';}
function renderQualityReport(report){
  const target=document.getElementById('qualityReport'),summary=report.summary,findings=report.findings||[];
  target.className='quality-report';
  target.innerHTML=`<div class="quality-summary"><strong>Điểm sẵn sàng: ${Number(report.score)}/100</strong><span>${summary.warnings} cảnh báo • ${summary.info} gợi ý • ${summary.checked_slides} slide • ${summary.checked_questions} câu hỏi</span></div>${findings.length?`<div class="quality-findings">${findings.map(item=>`<article class="quality-finding ${escapeHtml(item.severity)}"><b>${item.severity==='warning'?'Cần xử lý':'Gợi ý'}</b><div><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.message)}</p><small>${escapeHtml(item.suggestion)}</small></div></article>`).join('')}</div>`:'<p class="quality-clear">Không có cảnh báo. Giáo viên vẫn cần kiểm tra tính chính xác chuyên môn trước khi xuất.</p>'}`;
}
async function runQualityCheck(){
  const target=document.getElementById('qualityReport'),button=document.getElementById('qualityCheckBtn');
  if(!state.project||!state.generated){target.className='quality-report hint';target.textContent='Hãy tạo và lưu bài giảng trước khi kiểm tra.';return;}
  button.disabled=true;button.textContent='Đang kiểm tra…';target.className='quality-report hint';target.textContent='Đang lưu và rà soát phiên bản hiện tại…';
  try{
    if(canEditProject())await persistGenerated();
    const response=await fetch(`/api/v1/projects/${state.project.id}/quality-check`);
    if(!response.ok)throw new Error((await apiMessage(response))||'Không thể kiểm tra chất lượng.');
    renderQualityReport(await response.json());
  }catch(error){target.className='quality-report error';target.textContent=error.message||'Không thể kiểm tra chất lượng.';}
  finally{button.disabled=false;button.textContent='Kiểm tra chất lượng';}
}
document.getElementById('qualityCheckBtn').onclick=runQualityCheck;

async function exportScorm(){
  const status=document.getElementById("exportStatus");
  if(!state.generated){status.textContent="Chưa có nội dung để xuất. Hãy chạy Task 03 trước.";return;}
  if(canEditProject())try{await persistGenerated();}catch(e){status.textContent=e.message;return;}
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
