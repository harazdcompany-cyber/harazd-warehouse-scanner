/* HARAZD WAREHOUSE — My Page: private avatars, assigned tasks, personal calendar. */
(function HARAZDMyPageExtras() {
  'use strict';
  const byId = id => document.getElementById(id);
  const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const BUCKET = 'warehouse-avatars';
  const priorities = {low:'Низький',normal:'Звичайний',high:'Високий'};
  const taskStatuses = {todo:'Очікує',in_progress:'В роботі',done:'Завершено'};
  let currentUser = null, currentProfile = null, manager = false;
  let tasks = [], staffNames = new Map(), staffOptions = [], repairs = [], events = [];
  let activeRequest = 0, avatarPath = '', month = new Date(new Date().getFullYear(),new Date().getMonth(),1);
  const now = new Date();
  const localISO = date => [date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');
  let selectedDay = localISO(now);
  const dateText = iso => {
    if (!iso) return 'Без дати';
    const date = new Date(String(iso).slice(0,10)+'T12:00:00');
    return Number.isNaN(date.getTime()) ? String(iso) : date.toLocaleDateString('uk-UA');
  };
  const notice = (message, error = false) => {
    const host = byId('myExtrasNotice');
    if (!host) return;
    host.textContent = message || '';
    host.classList.toggle('is-error',error);
  };
  const managerAllowed = profile => Boolean(profile && profile.status==='active' && (profile.role==='admin' || profile.permissions?.personnel_manage === true));
  function initials() {
    return (currentProfile?.full_name || currentUser?.user_metadata?.full_name || '?')
      .trim().split(/\s+/).slice(0,2).map(word=>word.charAt(0)).join('').toUpperCase();
  }
  function ensureAvatarControls() {
    const identity = document.querySelector('#myPageProfile .my-page-identity');
    const avatar = identity?.querySelector('.my-page-avatar');
    if (!identity || !avatar || !currentUser) return null;
    let wrap = identity.querySelector('.my-page-avatar-wrap');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.className = 'my-page-avatar-wrap';
      avatar.parentNode.insertBefore(wrap,avatar);
      wrap.appendChild(avatar);
    }
    return avatar;
  }
  function syncAvatarEditor() {
    const preview = byId('myAvatarDialogPreview');
    if (!preview) return;
    const image = document.querySelector('#myPageProfile .my-page-avatar img');
    if (image) {
      const clone = image.cloneNode(false);
      clone.alt = 'Фото профілю';
      preview.replaceChildren(clone);
    } else {
      preview.replaceChildren();
      preview.textContent = initials();
    }
    const pick = byId('myAvatarPick'), remove = byId('myAvatarRemove');
    const isActive = currentProfile?.status === 'active';
    if (pick) pick.textContent = avatarPath ? 'Змінити фото' : 'Додати фото';
    if (pick && !pick.dataset.uploading) pick.disabled = !isActive;
    if (remove) remove.hidden = !avatarPath || !isActive;
  }
  function avatarNotice(message, error = false) {
    notice(message,error);
    const feedback = byId('myAvatarDialogFeedback');
    if (feedback) {
      feedback.textContent = message || '';
      feedback.classList.toggle('is-error',error);
    }
  }
    async function paintAvatar(request) {
    const avatar = ensureAvatarControls();
    if (!avatar) return;
    avatar.replaceChildren();
    avatar.textContent = initials();
    syncAvatarEditor();
    if (!avatarPath) return;
    const path = avatarPath;
    const {data,error} = await db.storage.from(BUCKET).createSignedUrl(path,3600);
    if (error) {notice('Не вдалося завантажити фото профілю: '+error.message,true);return;}
    if (request !== activeRequest || avatarPath !== path || !avatar.isConnected) return;
    const image = document.createElement('img');
    image.alt = 'Фото профілю';
    image.className = 'my-page-avatar-image';
    image.src = data.signedUrl;
    image.onerror = () => {image.remove();avatar.textContent = initials();syncAvatarEditor();};
    avatar.replaceChildren(image);
    syncAvatarEditor();
  }
  async function loadAvatar(request) {
    const {data,error} = await db.from('warehouse_staff_avatar')
      .select('photo_path').eq('user_id',currentUser.id).maybeSingle();
    if (request !== activeRequest) return;
    if (error) {
      notice('Для фотографії профілю потрібно виконати SETUP_MY_PAGE_AVATARS_TASKS.sql.',true);
      return;
    }
    avatarPath = data?.photo_path || '';
    await paintAvatar(request);
  }
  function loadImage(file) {
    return new Promise((resolve,reject)=>{
      const url=URL.createObjectURL(file),image=new Image();
      image.onload=()=>{URL.revokeObjectURL(url);resolve(image);};
      image.onerror=()=>{URL.revokeObjectURL(url);reject(Error('Неможливо відкрити зображення.'));};
      image.src=url;
    });
  }
  async function prepareAvatar(file) {
    if (!['image/jpeg','image/png','image/webp'].includes(file.type)) throw Error('Підтримуються JPG, PNG та WEBP.');
    if (file.size > 10*1024*1024) throw Error('Виберіть фото розміром до 10 МБ.');
    const image=await loadImage(file);
    const w=image.naturalWidth,h=image.naturalHeight;
    if (!w || !h) throw Error('Невірний розмір зображення.');
    const canvas=document.createElement('canvas');canvas.width=512;canvas.height=512;
    const ctx=canvas.getContext('2d',{alpha:false});
    if (!ctx) throw Error('Не вдалося підготувати фото.');
    ctx.fillStyle='#ffffff';ctx.fillRect(0,0,512,512);
    const crop=Math.min(w,h);
    ctx.drawImage(image,Math.round((w-crop)/2),Math.round((h-crop)/2),crop,crop,0,0,512,512);
    return await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('Помилка підготовки фото.')),'image/jpeg',.88));
  }
  async function uploadAvatar(file) {
    if (!currentUser || currentProfile?.status!=='active') return;
    const button=byId('myAvatarPick');
    if (button) {button.disabled=true;button.dataset.uploading='1';}
    const originalUser=currentUser.id,request=activeRequest,old=avatarPath;
    let path='';
    try {
      avatarNotice('Обробляємо фото профілю…');
      const blob=await prepareAvatar(file);
      path=originalUser+'/avatar-'+crypto.randomUUID()+'.jpg';
      const upload=await db.storage.from(BUCKET).upload(path,blob,{contentType:'image/jpeg',cacheControl:'3600',upsert:false});
      if (upload.error) throw upload.error;
      const updated=await db.from('warehouse_staff_avatar').upsert(
        {user_id:originalUser,photo_path:path,updated_at:new Date().toISOString()},{onConflict:'user_id'});
      if (updated.error) throw updated.error;
      if (request !== activeRequest || currentUser?.id !== originalUser) return;
      avatarPath=path;
      await paintAvatar(request);
      avatarNotice('Фото профілю оновлено.');
      if (old && old!==path) db.storage.from(BUCKET).remove([old]).catch(()=>{});
    } catch(error) {
      if (path) db.storage.from(BUCKET).remove([path]).catch(()=>{});
      avatarNotice(error?.message || 'Помилка завантаження фото.',true);
    } finally {if (button) {button.disabled=false;delete button.dataset.uploading;} syncAvatarEditor();}
  }
  async function removeAvatar() {
    if (!avatarPath || !currentUser) return;
    const old=avatarPath;
    const {error}=await db.from('warehouse_staff_avatar').delete().eq('user_id',currentUser.id);
    if (error) return avatarNotice('Помилка видалення фото: '+error.message,true);
    avatarPath='';
    await paintAvatar(activeRequest);
    db.storage.from(BUCKET).remove([old]).catch(()=>{});
    avatarNotice('Фото профілю прибрано.');
  }
  async function decorateStaffList(visibleStaff) {
    if (!Array.isArray(visibleStaff) || !visibleStaff.length || typeof db==='undefined') return;
    const cards = Array.from(document.querySelectorAll('#staffList .staff-card'));
    const ids = visibleStaff.map(staff=>staff.user_id).filter(Boolean);
    if (!cards.length || !ids.length) return;
    const {data,error} = await db.from('warehouse_staff_avatar').select('user_id,photo_path').in('user_id',ids);
    if (error) return;
    const photos = new Map((data||[]).map(item=>[item.user_id,item.photo_path]));
    for (let i=0;i<visibleStaff.length;i++) {
      const avatar = cards[i]?.querySelector('.staff-avatar');
      const path = photos.get(visibleStaff[i].user_id);
      if (!avatar?.isConnected || !path) continue;
      const {data:signed,error:signError} = await db.storage.from(BUCKET).createSignedUrl(path,3600);
      if (signError || !avatar.isConnected) continue;
      const image=document.createElement('img');
      image.alt='Фото '+visibleStaff[i].full_name;
      image.className='my-page-staff-avatar-image';
      image.src=signed.signedUrl;
      avatar.replaceChildren(image);
    }
  }
  function displayTasks() {
    const host=byId('myTaskList');
    if (!host) return;
    const filter=byId('myTaskFilter')?.value || 'open';
    const filtered=tasks.filter(t=>filter==='all' || (filter==='open' ? t.status!=='done' : t.status==='done'));
    if (!filtered.length) {host.innerHTML='<p class="my-page-empty">Завдань за вибраним фільтром немає.</p>';return;}
    host.innerHTML=filtered.map(task=>{
      const own = task.assignee_id===currentUser?.id;
      const assignee = staffNames.get(task.assignee_id);
      const label = priorities[task.priority]||'Звичайний';
      return `<div class="my-page-task ${task.status==='done'?'is-done':''}" data-task-id="${escapeHTML(task.id)}">
        <div class="my-page-task-line"><strong>${escapeHTML(task.title)}</strong>
          <span class="my-page-task-priority priority-${escapeHTML(task.priority)}">${escapeHTML(label)}</span></div>
        ${task.details?`<p>${escapeHTML(task.details)}</p>`:''}
        <div class="my-page-task-meta"><span>До: ${escapeHTML(dateText(task.due_date))}</span>
          ${!own && assignee?`<span>Працівник: ${escapeHTML(assignee)}</span>`:''}</div>
        <div class="my-page-task-controls">${own?`<label>Статус <select data-my-task-status="${escapeHTML(task.id)}"
          aria-label="Статус завдання">${Object.entries(taskStatuses).map(([key,text])=>`<option value="${key}" ${task.status===key?'selected':''}>${escapeHTML(text)}</option>`).join('')}</select></label>`:
          `<span class="my-page-task-readonly">${escapeHTML(taskStatuses[task.status]||task.status)}</span>`}
          ${manager && task.created_by===currentUser?.id?`<button type="button" data-my-task-delete="${escapeHTML(task.id)}">Видалити</button>`:''}</div></div>`;
    }).join('');
  }
  async function loadTasks(request) {
    const host=byId('myTaskList');if(host)host.innerHTML='<p class="my-page-empty">Завантаження завдань…</p>';
    const queries=[db.from('warehouse_personal_tasks').select('id,assignee_id,created_by,title,details,priority,status,due_date,created_at').order('created_at',{ascending:false}).limit(150)];
    if (manager) queries.push(db.from('warehouse_staff').select('user_id,full_name').eq('status','active').order('full_name'));
    const responses=await Promise.all(queries);
    if (request!==activeRequest) return;
    const response=responses[0];
    if (response.error) {
      if(host)host.innerHTML='<p class="my-page-empty">Завдання недоступні. Спочатку виконайте SQL-оновлення.</p>';
      tasks=[];renderCalendar();return;
    }
    tasks=response.data||[];
    staffOptions = manager && !responses[1]?.error ? responses[1].data||[] : [];
    staffNames = new Map(staffOptions.map(person=>[person.user_id,person.full_name]));
    if (byId('myTaskNew')) byId('myTaskNew').hidden = !manager;
    displayTasks();
    renderCalendar();
  }
  function openTaskForm() {
    if (!manager || !currentUser) return;
    const form=byId('myTaskForm');if(!form)return;
    form.reset();
    const select=form.elements.namedItem('assignee_id');
    select.replaceChildren();
    for (const staff of staffOptions) {
      const option=document.createElement('option');option.value=staff.user_id;option.textContent=staff.full_name;
      select.append(option);
    }
    if (staffOptions.some(staff=>staff.user_id===currentUser.id)) select.value=currentUser.id;
    byId('myTaskFeedback').textContent='';
    byId('myTaskDialog').showModal();
  }
  async function saveTask(event) {
    event.preventDefault();
    if (!manager || !currentUser) return;
    const form=event.currentTarget,field=name=>String(form.elements.namedItem(name)?.value||'').trim();
    const title=field('title'),assignee_id=field('assignee_id');
    if (!title || title.length>160 || !staffOptions.some(person=>person.user_id===assignee_id)) {
      byId('myTaskFeedback').textContent='Вкажіть назву та активного працівника.';return;
    }
    const submit=form.querySelector('button[type=submit]');
    submit.disabled=true;
    try {
      const {error}=await db.from('warehouse_personal_tasks').insert({
        title,details:field('details'),priority:field('priority')||'normal',status:'todo',
        assignee_id,created_by:currentUser.id,due_date:field('due_date')||null
      });
      if (error) throw error;
      byId('myTaskDialog').close();
      notice('Завдання створено.');
      await loadTasks(activeRequest);
    } catch(error) {byId('myTaskFeedback').textContent=error?.message||'Не вдалося створити завдання.';}
    finally {submit.disabled=false;}
  }
  async function updateTaskStatus(id,status,select) {
    const task=tasks.find(t=>t.id===id);
    if (!task || task.assignee_id!==currentUser?.id || !Object.keys(taskStatuses).includes(status)) return;
    const old=task.status;
    select.disabled=true;
    try {
      const {error}=await db.rpc('warehouse_set_my_task_status',{p_task_id:id,p_status:status});
      if(error)throw error;
      task.status=status;displayTasks();renderCalendar();
      notice('Статус завдання змінено.');
    }catch(error){select.value=old;notice(error?.message||'Помилка зміни статусу.',true);}
    finally {select.disabled=false;}
  }
  async function deleteTask(id) {
    const task=tasks.find(t=>t.id===id);
    if(!manager || !task || task.created_by!==currentUser?.id) return;
    if(!confirm('Видалити завдання «'+task.title+'»?')) return;
    const {error}=await db.from('warehouse_personal_tasks').delete().eq('id',id);
    if(error)return notice('Не вдалося видалити завдання: '+error.message,true);
    tasks=tasks.filter(x=>x.id!==id);
    displayTasks();renderCalendar();notice('Завдання видалено.');
  }
  function calendarEntries() {
    const result=[];
    const add = (date,type,title,description,status='') => {
      if (date && /^\d{4}-\d{2}-\d{2}$/.test(String(date).slice(0,10))) result.push({
        date:String(date).slice(0,10),type,title,description,status
      });
    };
    for (const task of tasks) {
      if (task.assignee_id === currentUser?.id) add(task.due_date,'task',task.title,'Термін завдання · '+(taskStatuses[task.status]||task.status),task.status);
    }
    for (const repair of repairs) {
      add(repair.due_on,'repair',repair.problem || 'Ремонт обладнання','Термін ремонту');
    }
    for (const event of events) {
      const period=(start,end,label)=>{
        if (!start) return;
        const initial=new Date(String(start).slice(0,10)+'T12:00:00');
        const limit=end ? new Date(String(end).slice(0,10)+'T12:00:00') : initial;
        if(Number.isNaN(initial.getTime()) || Number.isNaN(limit.getTime())) return;
        for(let i=0,dt=new Date(initial);i<90 && dt<=limit;i++,dt.setDate(dt.getDate()+1))
          add(localISO(dt),'event',event.name||'Подія',label+(event.location?' · '+event.location:''));
      };
      period(event.warehouse_start_date,event.warehouse_end_date,'Складські роботи до події');
      period(event.setup_date,event.setup_end_date,'Монтаж');
      period(event.event_date,event.event_end_date,'Подія');
      period(event.teardown_date,event.teardown_end_date,'Демонтаж');
      period(event.post_warehouse_start_date,event.post_warehouse_end_date,'Складські роботи після події');
    }
    return result;
  }
  function renderCalendar() {
    const grid=byId('myCalendarGrid'),title=byId('myCalendarTitle'),agenda=byId('myCalendarAgenda');
    if (!grid || !title || !agenda) return;
    title.textContent=new Intl.DateTimeFormat('uk-UA',{month:'long',year:'numeric'}).format(month);
    const entries=calendarEntries();
    const grouped=new Map();
    for (const entry of entries) {
      if (!grouped.has(entry.date)) grouped.set(entry.date,[]);
      grouped.get(entry.date).push(entry);
    }
    const start=new Date(month.getFullYear(),month.getMonth(),1);
    start.setDate(1-((start.getDay()+6)%7));
    const weekdays=['Пн','Вт','Ср','Чт','Пт','Сб','Нд'];
    grid.innerHTML=weekdays.map(text=>`<span class="my-calendar-weekday">${text}</span>`).join('');
    for (let i=0;i<42;i++) {
      const day=new Date(start);day.setDate(start.getDate()+i);
      const iso=localISO(day),count=(grouped.get(iso)||[]).length;
      const button=document.createElement('button');button.type='button';
      button.dataset.myCalendarDate=iso;
      button.className='my-calendar-day'+(day.getMonth()!==month.getMonth()?' is-outside':'')+
        (iso===selectedDay?' is-selected':'')+(iso===localISO(new Date())?' is-today':'');
      button.setAttribute('aria-label',dateText(iso)+(count?' — записів: '+count:''));
      button.innerHTML='<span>'+day.getDate()+'</span>'+(count?'<i aria-hidden="true">'+Math.min(count,9)+(count>9?'+':'')+'</i>':'');
      grid.append(button);
    }
    const chosen=grouped.get(selectedDay)||[];
    agenda.innerHTML='<h3>'+escapeHTML(dateText(selectedDay))+'</h3>'+
      (chosen.length?chosen.map(item=>`<div class="my-calendar-agenda-item type-${escapeHTML(item.type)}">
        <strong>${escapeHTML(item.title)}</strong><small>${escapeHTML(item.description)}</small></div>`).join(''):
        '<p class="my-page-empty">На цей день немає призначених робіт.</p>');
  }
  function setAppointments(data) {
    repairs=Array.isArray(data?.repairs)?data.repairs:[];
    events=Array.isArray(data?.events)?data.events:[];
    renderCalendar();
  }
  function changeMonth(delta) {
    month=new Date(month.getFullYear(),month.getMonth()+delta,1);
    selectedDay=localISO(new Date(month.getFullYear(),month.getMonth(),1));
    renderCalendar();
  }
  async function load(context) {
    const request=++activeRequest;
    currentUser=context?.user||null;currentProfile=context?.profile||null;
    avatarPath='';tasks=[];repairs=[];events=[];staffNames=new Map();staffOptions=[];
    manager=managerAllowed(currentProfile);
    if (byId('myTaskNew')) byId('myTaskNew').hidden=!manager;
    if (!currentUser || currentProfile?.status!=='active') {
      if(byId('myTaskList')) byId('myTaskList').innerHTML='<p class="my-page-empty">Немає активного профілю працівника.</p>';
      renderCalendar();return;
    }
    ensureAvatarControls();
    syncAvatarEditor();
    await Promise.allSettled([loadAvatar(request),loadTasks(request)]);
  }
  const root=byId('my-page');
  root?.addEventListener('click',event=>{
    if (event.target.closest('#myTaskNew')) openTaskForm();
    else if (event.target.closest('[data-my-task-delete]')) deleteTask(event.target.closest('[data-my-task-delete]').dataset.myTaskDelete);
    else if (event.target.closest('[data-my-calendar-shift]')) changeMonth(Number(event.target.closest('[data-my-calendar-shift]').dataset.myCalendarShift));
    else if (event.target.closest('#myCalendarToday')) {
      const now=new Date();month=new Date(now.getFullYear(),now.getMonth(),1);selectedDay=localISO(now);renderCalendar();
    } else if (event.target.closest('[data-my-calendar-date]')) {
      selectedDay=event.target.closest('[data-my-calendar-date]').dataset.myCalendarDate;renderCalendar();
    }
  });
  root?.addEventListener('change',event=>{
    const select=event.target.closest('[data-my-task-status]');
    if (select) updateTaskStatus(select.dataset.myTaskStatus,select.value,select);
  });
  byId('myTaskFilter')?.addEventListener('change',displayTasks);
  byId('myAvatarPick')?.addEventListener('click',()=>byId('myAvatarFile')?.click());
  byId('myAvatarRemove')?.addEventListener('click',removeAvatar);
  byId('myPageProfile')?.addEventListener('click',event=>{
    if (event.target.closest('#myPageEditProfile')) {
      const feedback=byId('myAvatarDialogFeedback');
      if (feedback) {feedback.textContent='';feedback.classList.remove('is-error');}
      syncAvatarEditor();
    }
  });
  byId('myAvatarFile')?.addEventListener('change',async event=>{
    const file=event.target.files?.[0];event.target.value='';if(file)await uploadAvatar(file);
  });
  byId('myTaskForm')?.addEventListener('submit',saveTask);
  byId('myTaskCancel')?.addEventListener('click',()=>byId('myTaskDialog').close());
  window.harazdMyPageExtras={load,setAppointments,decorateStaffList,restoreAvatar:()=>paintAvatar(activeRequest)};
})();
