'use strict';
// Equipment documents: private Supabase Storage bucket + RLS-protected metadata.
(()=>{
 const BUCKET='equipment-documents', MAX=20*1024*1024;
 let activeId=null, loading=false, refreshNeeded=false;
 const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const allowed=new Set(['application/pdf','image/jpeg','image/png','image/webp','text/plain','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']);
 const panel=()=>document.getElementById('equipmentDocsPanel');
 function fail(e){toast('Документи: '+(e?.message||String(e)),true)}
 window.harazdDocsOpen=x=>{
  activeId=x.id;
  const b=document.getElementById('equipmentDocsToggle'),p=panel();
  if(!b||!p)return;
  p.hidden=true;b.textContent='Документи ▾';
  b.onclick=()=>{p.hidden=!p.hidden;b.textContent=p.hidden?'Документи ▾':'Документи ▴';if(!p.hidden)load(x.id)};
 };
 async function load(id){
  if(id!==activeId)return;if(loading){refreshNeeded=true;return;}loading=true;const p=panel();p.innerHTML='<p class="muted">Завантаження документів…</p>';
  try{
   const {data,error}=await db.from('equipment_documents').select('id,equipment_id,title,document_type,file_name,file_path,file_size,created_at').eq('equipment_id',id).order('created_at',{ascending:false});if(error)throw error;
   if(id!==activeId)return;
   p.innerHTML=`<div class="equipment-docs-list">${data.length?data.map(d=>`<div class="equipment-doc-row"><div><strong>${escape(d.title)}</strong><small>${escape(d.document_type||'Інший')} · ${escape(d.file_name)} · ${(d.file_size/1048576).toFixed(2)} МБ</small></div><div class="equipment-doc-actions"><button type="button" data-doc-open="${escape(d.id)}">Переглянути</button><button type="button" data-doc-download="${escape(d.id)}">Завантажити</button><button type="button" class="equipment-doc-danger" data-doc-delete="${escape(d.id)}">Видалити</button></div></div>`).join(''):'<p class="muted">Документів поки немає.</p>'}</div><form id="equipmentDocForm" class="equipment-doc-form"><h4>Додати документ</h4><div class="equipment-doc-fields"><label>Назва документа<input name="title" maxlength="150" required placeholder="Наприклад: Технічний паспорт"></label><label>Тип документа<select name="document_type"><option>Технічний паспорт</option><option>Інструкція</option><option>Сертифікат</option><option>Гарантія</option><option>Інший</option></select></label><label class="equipment-doc-file">Файл (до 20 МБ)<input name="file" type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.txt,.doc,.docx,.xls,.xlsx" required></label></div><button type="submit" class="primary">＋ Додати документ</button></form>`;
   p.querySelector('form').onsubmit=e=>upload(e,id);
   p.onclick=e=>{const b=e.target.closest('[data-doc-open],[data-doc-download],[data-doc-delete]');if(!b)return;const d=data.find(x=>x.id===(b.dataset.docOpen||b.dataset.docDownload||b.dataset.docDelete));if(!d)return;if(b.dataset.docDelete)remove(d,id);else open(d,!!b.dataset.docDownload)};
  }catch(e){p.innerHTML='<p class="muted">Не вдалося завантажити документи. Перевірте SQL-налаштування.</p>';fail(e)}finally{loading=false;if(refreshNeeded){refreshNeeded=false;if(id===activeId)load(id)}}
 }
 async function upload(e,id){e.preventDefault();const form=e.currentTarget,button=form.querySelector('[type=submit]'),fd=new FormData(form),file=fd.get('file');if(!(file instanceof File)||!file.size)return;
  if(file.size>MAX||!allowed.has(file.type)){toast('Дозволені PDF, зображення, TXT, Word та Excel до 20 МБ',true);return}
  button.disabled=true;let path=null, metadataSaved=false;
  try{
   const ext=(file.name.split('.').pop()||'bin').toLowerCase();path=`${id}/${crypto.randomUUID()}.${ext}`;
   const up=await db.storage.from(BUCKET).upload(path,file,{contentType:file.type,upsert:false});if(up.error)throw up.error;
   const result=await db.from('equipment_documents').insert({equipment_id:id,title:String(fd.get('title')).trim(),document_type:String(fd.get('document_type')),file_name:file.name,file_path:path,file_size:file.size,mime_type:file.type}).select('id');if(result.error)throw result.error;
   if(!result.data?.length)throw Error('Збереження документа не підтверджено');metadataSaved=true;
   toast('Документ додано');await load(id);
  }catch(err){if(path&&!metadataSaved){const cleanup=await db.storage.from(BUCKET).remove([path]);if(cleanup.error)toast('Не вдалося прибрати незбережений файл: '+cleanup.error.message,true)}fail(err)}finally{button.disabled=false}
 }
 async function open(d,download){try{const {data,error}=await db.storage.from(BUCKET).createSignedUrl(d.file_path,60,{download:download?d.file_name:undefined});if(error)throw error;const a=document.createElement('a');a.href=data.signedUrl;a.target='_blank';a.rel='noopener noreferrer';if(download)a.download=d.file_name;document.body.append(a);a.click();a.remove()}catch(e){fail(e)}}
 async function remove(d,id){if(!confirm(`Видалити документ «${d.title}»?`))return;try{
  const result=await db.from('equipment_documents').delete().eq('id',d.id).select('id');
  if(result.error)throw result.error;
  if(result.data?.length!==1)throw Error('Видалення запису не підтверджено');
  const refs=await db.from('equipment_documents').select('id').eq('file_path',d.file_path).limit(1);
  if(!refs.error&&!(refs.data||[]).length){const storage=await db.storage.from(BUCKET).remove([d.file_path]);if(storage.error)console.warn('Не вдалося прибрати файл без посилань:',storage.error);}
  toast('Документ видалено');await load(id);
 }catch(e){fail(e)}}
 // Document staging for the add/edit equipment form. Upload only after equipment has a persistent ID.
 const pending=[];
 const fileInput=document.getElementById('equipmentDocFiles');
 const pendingBox=document.getElementById('equipmentDocPending');
 const addBtn=document.getElementById('equipmentDocAdd');
 function renderPending(){if(!pendingBox)return;pendingBox.replaceChildren();pending.forEach((entry,i)=>{
  const row=document.createElement('div');row.className='equipment-doc-pending-row';
  const title=document.createElement('input');title.value=entry.title;title.placeholder='Назва документа';title.maxLength=150;title.setAttribute('aria-label','Назва документа');title.addEventListener('input',()=>entry.title=title.value);
  const type=document.createElement('select');type.setAttribute('aria-label','Тип документа');['Технічний паспорт','Інструкція','Сертифікат','Гарантія','Інший'].forEach(v=>{const o=document.createElement('option');o.textContent=v;type.append(o)});type.value=entry.type;type.addEventListener('change',()=>entry.type=type.value);
  const name=document.createElement('small');name.textContent=entry.file.name+' · '+(entry.file.size/1048576).toFixed(2)+' МБ';
  const del=document.createElement('button');del.type='button';del.textContent='Видалити';del.addEventListener('click',()=>{pending.splice(i,1);renderPending()});
  row.append(title,type,name,del);pendingBox.append(row);
 });}
 if(addBtn&&fileInput){addBtn.addEventListener('click',()=>fileInput.click());fileInput.addEventListener('change',()=>{
  for(const file of fileInput.files){if(file.size>MAX||!allowed.has(file.type)){fail(new Error('Недопустимий файл: '+file.name+' (максимум 20 МБ)'));continue}pending.push({file,title:file.name.replace(/\.[^.]+$/,''),type:'Інший'})}
  fileInput.value='';renderPending();
 });}
 window.harazdDocsResetPending=()=>{pending.length=0;if(fileInput)fileInput.value='';renderPending()};
 window.harazdDocsUploadPending=()=>pending.length>0;
 window.harazdDocsSavePending=async ids=>{
  const targets=[...new Set((Array.isArray(ids)?ids:[ids]).filter(Boolean))];
  let ok=0,failed=0,error='';
  if(!targets.length)return {ok,failed:pending.length,error:'Не знайдено одиниць обладнання'};
  for(const entry of [...pending]){
   let path=null;
   try{
    if(!entry.title.trim())throw Error('Заповніть назву документа: '+entry.file.name);
    const ext=(entry.file.name.split('.').pop()||'bin').toLowerCase();
    path=`${targets[0]}/${crypto.randomUUID()}.${ext}`;
    const up=await db.storage.from(BUCKET).upload(path,entry.file,{contentType:entry.file.type,upsert:false});
    if(up.error)throw up.error;
    const rows=targets.map(id=>({equipment_id:id,title:entry.title.trim(),document_type:entry.type,file_name:entry.file.name,file_path:path,file_size:entry.file.size,mime_type:entry.file.type}));
    const inserted=await db.from('equipment_documents').insert(rows).select('id,equipment_id');
    if(inserted.error)throw inserted.error;
    if((inserted.data||[]).length!==targets.length)throw Error('Не підтверджено зв’язок з усіма одиницями');
    ok+=targets.length;
    const index=pending.indexOf(entry);if(index!==-1)pending.splice(index,1);
   }catch(e){
    failed++;error=e.message||String(e);
    if(path){const refs=await db.from('equipment_documents').select('id').eq('file_path',path).limit(1);
     if(!refs.error&&!(refs.data||[]).length)await db.storage.from(BUCKET).remove([path]).catch(()=>{});}
   }
  }
  renderPending();return {ok,failed,error};
 };
})();
