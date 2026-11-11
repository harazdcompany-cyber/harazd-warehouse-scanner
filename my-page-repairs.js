/* HARAZD WAREHOUSE — My Page only: secure self-service repair updates. */
(() => {
  'use strict';
  const byId = id => document.getElementById(id);
  const BUCKET = 'repair-photos';
  const TYPES = new Set(['image/jpeg','image/png','image/webp']);
  const STATUSES = new Set(['new','diagnostics','waiting','progress','done','cancelled']);
  const dateISO = date => [date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');
  const safe = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const notice = (message,error=false) => {if (typeof toast==='function') toast(message,error);};
  let repairs=new Map(), equipmentById=new Map(), user=null, profile=null;
  let activeId='',busy=false,loaded=false,token=0, existing=[],selected=[],objectUrls=[];

  function feedback(message='',error=false) {
    const target=byId('myPageRepairFeedback');
    if(target){target.textContent=message;target.classList.toggle('is-error',error);}
  }
  function clearUrls() {
    objectUrls.forEach(url=>URL.revokeObjectURL(url));
    objectUrls=[];
  }
  function clearSelection() {
    clearUrls();
    selected=[];
    const input=byId('myPageRepairPhotoInput');
    if(input)input.value='';
  }
  function reset() {
    token++;
    user=null;
    profile=null;
    repairs=new Map();
    equipmentById=new Map();
    existing=[];
    loaded=false;
    activeId='';
    if(!busy && byId('myPageRepairDialog')?.open) byId('myPageRepairDialog').close();
    clearSelection();
  }
  function setRepairs(data) {
    repairs=new Map((data?.repairs||[]).filter(item=>item.id).map(item=>[String(item.id),item]));
    equipmentById=data?.equipmentById||new Map();
    user=data?.user||null;
    profile=data?.profile||null;
  }
  function toggleCompletion() {
    const form=byId('myPageRepairForm');
    const done=form.elements.namedItem('status').value==='done';
    const wrap=byId('myPageRepairCompletionWrap');
    wrap.hidden=!done;
    const date=form.elements.namedItem('completed_on');
    date.required=done;
    if(done&&!date.value)date.value=dateISO(new Date());
    byId('myPageRepairFinish').hidden=done;
  }
  function renderPhotos() {
    const host=byId('myPageRepairPhotoList');
    if(!host)return;
    clearUrls();
    host.replaceChildren();
    const photos=[
      ...existing.map(item=>({src:item.url,label:'Фото ремонту',file:false})),
      ...selected.map(file=>{
        const src=URL.createObjectURL(file);
        objectUrls.push(src);
        return {src,label:file.name,file:true};
      })
    ];
    if(!photos.length){
      const empty=document.createElement('p');
      empty.className='my-page-empty';
      empty.textContent='Фотографій поки немає.';
      host.append(empty);
    }
    for(const photo of photos){
      const link=document.createElement('a');
      link.className='my-page-repair-photo-thumb';
      link.href=photo.src;
      link.target='_blank';
      link.rel='noopener noreferrer';
      link.title=photo.file?'Нове фото: '+photo.label:'Відкрити фото ремонту';
      const img=document.createElement('img');
      img.src=photo.src;
      img.alt=photo.label;
      img.loading='lazy';
      link.append(img);
      if(photo.file){
        const mark=document.createElement('span');
        mark.textContent='Нове';
        link.append(mark);
      }
      host.append(link);
    }
    const caption=document.createElement('small');
    caption.className='my-page-repair-photo-count';
    caption.textContent=photos.length+' / 10 фото';
    host.append(caption);
    const pick=byId('myPageRepairPhotoInput');
    if(pick)pick.disabled=photos.length>=10||busy;
  }
  async function loadPhotos(id,request) {
    const response=await db.rpc('warehouse_my_repair_photos',{p_job_id:id});
    if(response.error)throw response.error;
    const list=Array.isArray(response.data)?response.data:[];
    const results=await Promise.all(list.map(async photo=>{
      const {data,error}=await db.storage.from(BUCKET).createSignedUrl(photo.storage_path,3600);
      return {...photo,url:error?'':data?.signedUrl||''};
    }));
    if(request!==token||activeId!==id)return;
    existing=results.filter(item=>/^https:\/\/[^\s"'<>]+$/i.test(item.url));
    renderPhotos();
  }
  async function openRepair(id) {
    if(busy||!user||profile?.status!=='active')return;
    const job=repairs.get(String(id));
    if(!job)return;
    const form=byId('myPageRepairForm'),dialog=byId('myPageRepairDialog');
    if(!form||!dialog)return;
    const request=++token;
    activeId=String(id);
    loaded=false;existing=[];clearSelection();
    form.reset();
    form.elements.namedItem('status').value=STATUSES.has(job.status)?job.status:'new';
    form.elements.namedItem('notes').value=job.notes||'';
    form.elements.namedItem('completed_on').value=job.completed_on||'';
    const eq=equipmentById.get(String(job.equipment_id))||{};
    byId('myPageRepairEquipment').textContent=(eq.name||job.problem||'Ремонт обладнання')+
      (eq.eq_id?' · '+eq.eq_id:'')+(job.due_on?' · до '+job.due_on:'');
    toggleCompletion();
    byId('myPageRepairSubmit').disabled=true;
    feedback('Завантажуємо дані ремонту та фотографії…');
    if(!dialog.open)dialog.showModal();
    try {
      const response=await db.rpc('warehouse_get_my_repair',{p_job_id:id});
      if(response.error)throw response.error;
      if(request!==token||activeId!==id)return;
      const current=response.data;
      if(!current)throw Error('Ремонт більше не доступний.');
      form.elements.namedItem('status').value=STATUSES.has(current.status)?current.status:'new';
      form.elements.namedItem('notes').value=current.notes||'';
      form.elements.namedItem('completed_on').value=current.completed_on||'';
      toggleCompletion();
      loaded=true;
      byId('myPageRepairSubmit').disabled=false;
      feedback('');
      try {
        await loadPhotos(id,request);
      } catch(error) {
        if(request===token)feedback('Не вдалося завантажити фото: '+(error.message||error),true);
      }
    } catch(error) {
      if(request!==token)return;
      feedback('Не вдалося відкрити ремонт: '+(error?.message||error)+
        '. Перевірте SETUP_MY_PAGE_REPAIR_CONTROL.sql у Supabase.',true);
    }
  }
  function handlePhotoSelection(event) {
    const files=Array.from(event.target.files||[]);
    event.target.value='';
    if(!activeId||!loaded||busy)return;
    let error='';
    for(const file of files){
      if(!TYPES.has(file.type)){error='Підтримуються тільки JPG, PNG, WEBP.';continue;}
      if(file.size>10*1024*1024){error='Розмір кожного фото — не більше 10 МБ.';continue;}
      if(existing.length+selected.length>=10){error='Максимум 10 фотографій.';break;}
      selected.push(file);
    }
    renderPhotos();
    feedback(error,!!error);
  }
  async function uploadPhoto(id,file) {
    const extension=file.type==='image/png'?'png':file.type==='image/webp'?'webp':'jpg';
    const path=id+'/'+crypto.randomUUID()+'.'+extension;
    const storage=db.storage.from(BUCKET);
    const upload=await storage.upload(path,file,{contentType:file.type,cacheControl:'3600',upsert:false});
    if(upload.error)throw upload.error;
    try{
      const result=await db.rpc('warehouse_add_my_repair_photo',{p_job_id:id,p_storage_path:path});
      if(result.error)throw result.error;
    }catch(error){
      try {await storage.remove([path]);} catch(cleanupError) {console.warn('Photo cleanup',cleanupError);}
      throw error;
    }
  }
  async function saveRepair(event) {
    event.preventDefault();
    if(busy||!activeId||!loaded||!user||profile?.status!=='active')return;
    const id=activeId,form=byId('myPageRepairForm');
    const status=form.elements.namedItem('status').value;
    const notes=form.elements.namedItem('notes').value.trim();
    const completed=form.elements.namedItem('completed_on').value;
    if(!STATUSES.has(status)||notes.length>5000||(status==='done'&&!completed)){
      feedback('Перевірте статус, дату завершення й примітки.',true);return;
    }
    busy=true;
    const saveButton=byId('myPageRepairSubmit');
    saveButton.disabled=true;
    byId('myPageRepairFinish').disabled=true;
    byId('myPageRepairClose').disabled=true;
    byId('myPageRepairCancel').disabled=true;
    feedback('Зберігаємо ремонт…');
    let statusSaved=false;
    const failed=[];
    try{
      const {error}=await db.rpc('warehouse_update_my_repair',{
        p_job_id:id,p_status:status,p_notes:notes,p_completed_on:status==='done'?completed:null
      });
      if(error)throw error;
      statusSaved=true;
      for(const file of selected) {
        try{await uploadPhoto(id,file);}
        catch(photoError){failed.push(file.name+': '+(photoError?.message||photoError));}
      }
      byId('myPageRepairDialog').close();
      clearSelection();
      if(window.harazdMyPage?.load)await window.harazdMyPage.load();
      notice(failed.length?
        'Ремонт збережено, але не всі фото додано: '+failed.join('; '):
        status==='done'?'Ремонт завершено.':'Зміни ремонту збережено.',failed.length>0);
    }catch(error){
      feedback('Не вдалося зберегти ремонт: '+(error?.message||error),true);
    }finally{
      busy=false;
      saveButton.disabled=false;
      byId('myPageRepairFinish').disabled=false;
      byId('myPageRepairClose').disabled=false;
      byId('myPageRepairCancel').disabled=false;
    }
  }
  function closeDialog(){
    if(busy)return;
    byId('myPageRepairDialog').close();
  }
  byId('myPageRepairs')?.addEventListener('click',event=>{
    const button=event.target.closest('[data-my-repair-manage]');
    if(button)openRepair(button.dataset.myRepairManage);
  });
  byId('myPageRepairForm')?.addEventListener('submit',saveRepair);
  byId('myPageRepairPhotoInput')?.addEventListener('change',handlePhotoSelection);
  byId('myPageRepairForm')?.elements.namedItem('status')?.addEventListener('change',toggleCompletion);
  byId('myPageRepairClose')?.addEventListener('click',closeDialog);
  byId('myPageRepairCancel')?.addEventListener('click',closeDialog);
  byId('myPageRepairFinish')?.addEventListener('click',()=>{
    if(busy||!loaded||!confirm('Позначити цей ремонт завершеним?'))return;
    const form=byId('myPageRepairForm');
    form.elements.namedItem('status').value='done';
    if(!form.elements.namedItem('completed_on').value)form.elements.namedItem('completed_on').value=dateISO(new Date());
    toggleCompletion();
    form.requestSubmit();
  });
  byId('myPageRepairDialog')?.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
  byId('myPageRepairDialog')?.addEventListener('close',()=>{
    token++;
    activeId='';
    loaded=false;
    existing=[];
    clearSelection();
    feedback('');
  });
  window.harazdMyPageRepairs={setRepairs,reset};
})();
