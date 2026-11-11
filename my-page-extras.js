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
  let editingTaskId = null;
  let activeRequest = 0, avatarPath = '', month = new Date(new Date().getFullYear(),new Date().getMonth(),1);
  const now = new Date();
  const localISO = date => [date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');
  let selectedDay = localISO(now);
  let calendarView = 'month', calendarItems = [];
  const calendarTypes = new Set(['task','event','repair']);
  const dateText = iso => {
    if (!iso) return 'Без дати';
    const date = new Date(String(iso).slice(0,10)+'T12:00:00');
    return Number.isNaN(date.getTime()) ? String(iso) : date.toLocaleDateString('uk-UA');
  };
  const notice = (message, error = false) => {
    if (message && typeof toast === 'function') toast(message,error);
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
    const feedback = byId('myAvatarDialogFeedback');
    if (feedback && byId('myPageContactDialog')?.open) {
      feedback.textContent = message || '';
      feedback.classList.toggle('is-error',error);
    } else {
      notice(message,error);
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
    const sort=byId('myTaskSort')?.value || 'due';
    const today=localISO(new Date());
    const ranks={high:0,normal:1,low:2};
    const compareDue=(a,b)=>{
      const ad=a.due_date||'9999-12-31',bd=b.due_date||'9999-12-31';
      return ad.localeCompare(bd);
    };
    const filtered=tasks.filter(t=>filter==='all' || (filter==='open' ? t.status!=='done' : t.status==='done')).slice();
    filtered.sort((a,b)=>{
      if (filter==='all' && (a.status==='done')!==(b.status==='done')) return a.status==='done'?1:-1;
      if (sort==='priority') {
        const diff=(ranks[a.priority]??1)-(ranks[b.priority]??1);
        if(diff) return diff;
      } else if (sort==='newest') {
        const diff=(b.created_at||'').localeCompare(a.created_at||'');
        if(diff) return diff;
      }
      return compareDue(a,b)||(ranks[a.priority]??1)-(ranks[b.priority]??1)||
        (b.created_at||'').localeCompare(a.created_at||'');
    });
    if (!filtered.length) {
      host.innerHTML='<p class="my-page-empty">Завдань за вибраним фільтром немає.</p>';
      return;
    }
    host.innerHTML=filtered.map(task=>{
      const own=task.assignee_id===currentUser?.id;
      const assignee=staffNames.get(task.assignee_id);
      const label=priorities[task.priority]||'Звичайний';
      const overdue=task.status!=='done' && Boolean(task.due_date && task.due_date<today);
      return `<div class="my-page-task ${task.status==='done'?'is-done':''} ${overdue?'is-overdue':''}" data-task-id="${escapeHTML(task.id)}">
        <div class="my-page-task-line"><strong>${escapeHTML(task.title)}</strong>
          <span class="my-page-task-labels">
            ${overdue?'<span class="my-page-task-overdue">Прострочено</span>':''}
            <span class="my-page-task-priority priority-${escapeHTML(task.priority)}">${escapeHTML(label)}</span>
          </span></div>
        ${task.details?`<p>${escapeHTML(task.details)}</p>`:''}
        <div class="my-page-task-meta"><span>До: ${escapeHTML(dateText(task.due_date))}</span>
          ${!own && assignee?`<span>Працівник: ${escapeHTML(assignee)}</span>`:''}</div>
        ${window.harazdMyPageChecklist?.card(task)||''}
        <div class="my-page-task-controls">${own?`<label>Статус <select data-my-task-status="${escapeHTML(task.id)}"
          aria-label="Статус завдання">${Object.entries(taskStatuses).map(([key,text])=>`<option value="${key}" ${task.status===key?'selected':''}>${escapeHTML(text)}</option>`).join('')}</select></label>`:
          `<span class="my-page-task-readonly">${escapeHTML(taskStatuses[task.status]||task.status)}</span>`}
          ${manager && task.created_by===currentUser?.id?`<span class="my-page-task-actions"><button type="button" data-my-task-edit="${escapeHTML(task.id)}">Редагувати</button><button type="button" data-my-task-delete="${escapeHTML(task.id)}">Видалити</button></span>`:''}</div></div>`;
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
      tasks=[];window.harazdMyPageNotifications?.setTasks([]);renderCalendar();return;
    }
    tasks=response.data||[];
    staffOptions = manager && !responses[1]?.error ? responses[1].data||[] : [];
    staffNames = new Map(staffOptions.map(person=>[person.user_id,person.full_name]));
    window.harazdMyPageNotifications?.setTasks(tasks.filter(task=>task.assignee_id===currentUser?.id));
    try{
      await window.harazdMyPageChecklist?.load(tasks,{user:currentUser,manager,refresh:displayTasks});
    }catch(error){notice('Не вдалося завантажити чеклісти: '+(error?.message||error),true);}
    if(request!==activeRequest)return;
    if (byId('myTaskNew')) byId('myTaskNew').hidden = !manager;
    displayTasks();
    renderCalendar();
  }
  function openTaskForm(task = null) {
    if (!manager || !currentUser || (task && task.created_by !== currentUser.id)) return;
    const form = byId('myTaskForm');
    if (!form) return;
    form.reset();
    editingTaskId = task?.id || null;
    const select = form.elements.namedItem('assignee_id');
    select.replaceChildren();
    for (const staff of staffOptions) {
      const option = document.createElement('option');
      option.value = staff.user_id;
      option.textContent = staff.full_name;
      select.append(option);
    }
    if (task) {
      form.elements.namedItem('title').value = task.title || '';
      form.elements.namedItem('details').value = task.details || '';
      form.elements.namedItem('priority').value = task.priority || 'normal';
      form.elements.namedItem('due_date').value = task.due_date || '';
      select.value = task.assignee_id;
      byId('myTaskTitle').textContent = 'Редагувати завдання';
      byId('myTaskSubmit').textContent = 'Зберегти зміни';
      byId('myTaskDialogHint').textContent = 'Змініть інформацію про завдання. Статус працівник змінює окремо в картці.';
    } else {
      if (staffOptions.some(staff=>staff.user_id===currentUser.id)) select.value=currentUser.id;
      byId('myTaskTitle').textContent = 'Призначити завдання';
      byId('myTaskSubmit').textContent = 'Призначити';
      byId('myTaskDialogHint').textContent = 'Завдання побачить лише призначений працівник. Він зможе змінювати його статус.';
    }
    byId('myTaskFeedback').textContent = '';
    window.harazdMyPageChecklist?.fillEditor(task);
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
    try {
      window.harazdMyPageChecklist?.validateDraft();
    } catch(error) {
      byId('myTaskFeedback').textContent=error?.message||'Перевірте пункти чекліста.';
      return;
    }
    const editTask = editingTaskId ? tasks.find(task=>task.id===editingTaskId) : null;
    if (editingTaskId && (!editTask || editTask.created_by!==currentUser.id)) {
      byId('myTaskFeedback').textContent='Немає доступу до редагування цього завдання.';return;
    }
    const submit=form.querySelector('button[type=submit]');
    submit.disabled=true;
    try {
      const changes = {
        title,details:field('details'),priority:field('priority')||'normal',
        assignee_id,due_date:field('due_date')||null
      };
      let savedId=editTask?.id||null;
      if (editTask) {
        // Editing only the checklist must not require unnecessary UPDATE on the task itself.
        const taskFieldsChanged=Object.entries(changes).some(([key,value])=>
          String(value??'')!==String(editTask[key]??''));
        if(taskFieldsChanged){
          const {data,error} = await db.from('warehouse_personal_tasks')
            .update(changes).eq('id',editTask.id).eq('created_by',currentUser.id).select('id');
          if (error) throw error;
          if (!data?.length) throw Error('Не вдалося оновити завдання. Перевірте дозвіл на редагування.');
        }
      } else {
        const {data,error}=await db.from('warehouse_personal_tasks').insert({
          ...changes,status:'todo',created_by:currentUser.id
        }).select('id').single();
        if (error) throw error;
        savedId=data?.id;
        if(!savedId)throw Error('Створено завдання без ідентифікатора. Оновіть сторінку.');
      }
      let checklistError='';
      try{await window.harazdMyPageChecklist?.saveDraft(savedId);}
      catch(error){checklistError=error?.message||String(error);}
      byId('myTaskDialog').close();
      notice(checklistError?'Завдання збережено, але чекліст не оновлено: '+checklistError:
        editTask?'Завдання оновлено.':'Завдання створено.',Boolean(checklistError));
      await loadTasks(activeRequest);
    } catch(error) {
      byId('myTaskFeedback').textContent=error?.message||'Не вдалося зберегти завдання.';
    } finally {submit.disabled=false;}
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
      notice(status==='done' ? 'Завдання завершено. Переглянути його можна у фільтрі «Завершені».' : 'Статус завдання змінено.');
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
  function startOfWeek(date) {
  const value=new Date(date.getFullYear(),date.getMonth(),date.getDate(),12);
  value.setDate(value.getDate()-((value.getDay()+6)%7));
  return value;
}
  function calendarEntries() {
  const result=[],seen=new Set();
  const add=(date,type,title,description,meta={})=>{
    const iso=String(date||'').slice(0,10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return;
    const key=[iso,type,meta.id||'',meta.stage||''].join('|');
    if(seen.has(key))return;
    seen.add(key);
    result.push({date:iso,type,title,description,id:meta.id||'',stage:meta.stage||'',status:meta.status||'',detail:meta.detail||''});
  };
  for(const task of tasks) {
    if(task.assignee_id!==currentUser?.id)continue;
    add(task.due_date,'task',task.title,'Статус: '+(taskStatuses[task.status]||task.status||'—')+
      ' · Пріоритет: '+(priorities[task.priority]||'Звичайний'),
      {id:task.id,status:task.status,stage:'Завдання',detail:task.details||''});
  }
  const repairStatus={new:'Новий',pending:'Очікує',in_progress:'В ремонті',progress:'В ремонті',done:'Завершено',cancelled:'Скасовано'};
  for(const repair of repairs) {
    add(repair.due_on,'repair',repair.problem||'Ремонт обладнання',
      'Термін виконання ремонту · '+(repairStatus[repair.status]||repair.status||'Статус не вказано'),
      {id:repair.id,stage:'Ремонт',status:repair.status});
  }
  for(const event of events) {
    const period=(start,end,stage)=>{
      if (!start) return;
      const initial=new Date(String(start).slice(0,10)+'T12:00:00');
      const last=end?new Date(String(end).slice(0,10)+'T12:00:00'):initial;
      if(Number.isNaN(initial.getTime())||Number.isNaN(last.getTime()))return;
      for(let i=0,dt=new Date(initial);i<90&&dt<=last;i++,dt.setDate(dt.getDate()+1)) {
        add(localISO(dt),'event',event.name||'Подія',
          stage+(event.location?' · '+event.location:''),
          {id:event.id,stage,detail:event.client?'Замовник: '+event.client:''});
      }
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
  if(!grid||!title||!agenda)return;
  const entries=calendarEntries().filter(item=>calendarTypes.has(item.type));
  calendarItems=entries;
  for(const button of document.querySelectorAll('#my-page [data-my-calendar-type]')) {
    const enabled=calendarTypes.has(button.dataset.myCalendarType);
    button.setAttribute('aria-pressed',String(enabled));
    button.classList.toggle('is-inactive',!enabled);
  }
  const grouped=new Map();
  for(let i=0;i<entries.length;i++){
    const entry=entries[i];
    if(!grouped.has(entry.date))grouped.set(entry.date,[]);
    grouped.get(entry.date).push({item:entry,index:i});
  }
  const viewButtons=document.querySelectorAll('#my-page [data-my-calendar-view]');
  for(const button of viewButtons){
    const active=button.dataset.myCalendarView===calendarView;
    button.setAttribute('aria-pressed',String(active));
    button.classList.toggle('is-active',active);
  }
  const current=new Date(selectedDay+'T12:00:00');
  if(calendarView==='week'){
    const first=startOfWeek(current),last=new Date(first);
    last.setDate(last.getDate()+6);
    title.textContent=dateText(localISO(first))+' – '+dateText(localISO(last));
  } else title.textContent=new Intl.DateTimeFormat('uk-UA',{month:'long',year:'numeric'}).format(month);
  grid.className='my-calendar-grid is-'+calendarView;
  grid.replaceChildren();
  const types=['task','event','repair'];
  const names={task:'Завдання',event:'Події',repair:'Ремонти'};
  const addDay=(date,outside=false)=>{
    const iso=localISO(date),dayItems=grouped.get(iso)||[];
    const kinds=[...new Set(dayItems.map(({item})=>item.type))];
    const button=document.createElement('button');
    button.type='button';
    button.dataset.myCalendarDate=iso;
    button.className='my-calendar-day'+(outside?' is-outside':'')+
      (iso===selectedDay?' is-selected':'')+
      (iso===localISO(new Date())?' is-today':'');
    button.setAttribute('aria-label',dateText(iso)+(dayItems.length?' — робіт: '+dayItems.length:''));
    button.innerHTML='<span class="my-calendar-day-number">'+date.getDate()+'</span>'+
      (dayItems.length?'<span class="my-calendar-day-count">'+dayItems.length+'</span>':'')+
      (kinds.length?'<span class="my-calendar-indicators" aria-hidden="true">'+
        types.filter(type=>kinds.includes(type)).map(type=>'<i class="type-'+type+'"></i>').join('')+'</span>':'');
    grid.append(button);
  };
  const weekdayNames=['Пн','Вт','Ср','Чт','Пт','Сб','Нд'];
  if(calendarView==='month'||calendarView==='week'){
    for(const day of weekdayNames){
      const label=document.createElement('span');
      label.className='my-calendar-weekday';
      label.textContent=day;
      grid.append(label);
    }
    const first=calendarView==='week'?startOfWeek(current):startOfWeek(new Date(month.getFullYear(),month.getMonth(),1));
    const count=calendarView==='week'?7:42;
    for(let i=0;i<count;i++){
      const date=new Date(first);
      date.setDate(first.getDate()+i);
      addDay(date,calendarView==='month'&&date.getMonth()!==month.getMonth());
    }
  } else {
    const prefix=localISO(month).slice(0,7);
    const monthEntries=entries.map((item,index)=>({item,index})).filter(({item})=>item.date.slice(0,7)===prefix);
    monthEntries.sort((a,b)=>a.item.date.localeCompare(b.item.date)||types.indexOf(a.item.type)-types.indexOf(b.item.type));
    if(!monthEntries.length){
      const message=document.createElement('p');
      message.className='my-page-empty';
      message.textContent='На цей місяць немає призначених робіт.';
      grid.append(message);
    }
    for(const {item,index} of monthEntries){
      const button=document.createElement('button');
      button.type='button';
      button.dataset.myCalendarDate=item.date;
      button.className='my-calendar-list-item'+(item.date===selectedDay?' is-selected':'');
      button.innerHTML='<span class="my-calendar-list-date">'+escapeHTML(dateText(item.date))+'</span>'+
        '<span class="my-calendar-list-kind type-'+item.type+'">'+names[item.type]+'</span>'+
        '<span class="my-calendar-list-title">'+escapeHTML(item.title)+'</span>'+
        '<span class="my-calendar-list-stage">'+escapeHTML(item.description)+'</span>';
      button.setAttribute('aria-label',dateText(item.date)+': '+item.title);
      grid.append(button);
    }
  }
  const chosen=grouped.get(selectedDay)||[];
  agenda.innerHTML='<h3>'+escapeHTML(dateText(selectedDay))+
    ' <span class="my-calendar-agenda-count">'+chosen.length+(chosen.length===1?' робота':' робіт')+'</span></h3>'+
    (chosen.length?chosen.map(({item,index})=>{
      const kind=names[item.type]||'Робота';
      return '<article class="my-calendar-agenda-item type-'+item.type+'">'+
        '<div class="my-calendar-agenda-top"><span class="my-calendar-entry-type type-'+item.type+'">'+kind+'</span>'+
        (item.stage?'<span class="my-calendar-entry-stage">'+escapeHTML(item.stage)+'</span>':'')+'</div>'+
        '<strong>'+escapeHTML(item.title)+'</strong>'+
        '<small>'+escapeHTML(item.description)+'</small>'+
        (item.detail?'<p>'+escapeHTML(item.detail)+'</p>':'')+
        (item.id?'<button type="button" class="my-calendar-open" data-my-calendar-open="'+index+'">Відкрити</button>':'')+
        '</article>';
    }).join(''):'<p class="my-page-empty">На цей день немає призначених робіт.</p>');
}
  function openCalendarEntry(index) {
  const item=calendarItems[index];
  if(!item)return;
  let target=null;
  if(item.type==='task'){
    const filter=byId('myTaskFilter');
    if(filter){
      if(item.status==='done')filter.value='done';
      else if(filter.value==='done')filter.value='open';
    }
    displayTasks();
    target=Array.from(document.querySelectorAll('#myTaskList [data-task-id]'))
      .find(element=>element.dataset.taskId===item.id);
    if(!target&&filter){filter.value='all';displayTasks();target=Array.from(document.querySelectorAll('#myTaskList [data-task-id]')).find(element=>element.dataset.taskId===item.id);}
  }else{
    const container=byId(item.type==='repair'?'myPageRepairs':'myPageEvents');
    const field=item.type==='repair'?'myRepairId':'myEventId';
    target=Array.from(container?.querySelectorAll('details')||[]).find(element=>element.dataset[field]===item.id);
    if(target)target.open=true;
    if(!target)target=container;
  }
  if(target){
    target.scrollIntoView({behavior:'smooth',block:'center'});
    if(!target.hasAttribute('tabindex'))target.setAttribute('tabindex','-1');
    target.focus({preventScroll:true});
  }
}
    function setAppointments(data) {
    repairs=Array.isArray(data?.repairs)?data.repairs:[];
    events=Array.isArray(data?.events)?data.events:[];
    renderCalendar();
  }
  function changeMonth(delta) {
  if(calendarView==='week'){
    const day=new Date(selectedDay+'T12:00:00');
    day.setDate(day.getDate()+delta*7);
    selectedDay=localISO(day);
    month=new Date(day.getFullYear(),day.getMonth(),1);
  }else{
    month=new Date(month.getFullYear(),month.getMonth()+delta,1);
    selectedDay=localISO(month);
  }
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
      window.harazdMyPageNotifications?.setTasks([]);
      renderCalendar();return;
    }
    ensureAvatarControls();
    syncAvatarEditor();
    await Promise.allSettled([loadAvatar(request),loadTasks(request)]);
  }
  const root=byId('my-page');
  root?.addEventListener('click',event=>{
    if (event.target.closest('#myTaskNew')) openTaskForm();
    else if (event.target.closest('[data-my-task-edit]')) {
      const id=event.target.closest('[data-my-task-edit]').dataset.myTaskEdit;
      const task=tasks.find(item=>item.id===id);
      if (task) openTaskForm(task);
    }
    else if (event.target.closest('[data-my-task-delete]')) deleteTask(event.target.closest('[data-my-task-delete]').dataset.myTaskDelete);
    else if (event.target.closest('[data-my-calendar-view]')) {
      calendarView=event.target.closest('[data-my-calendar-view]').dataset.myCalendarView;
      renderCalendar();
    }
    else if (event.target.closest('[data-my-calendar-type]')) {
      const type=event.target.closest('[data-my-calendar-type]').dataset.myCalendarType;
      if (['task','event','repair'].includes(type)) {
        if (calendarTypes.has(type)) calendarTypes.delete(type);
        else calendarTypes.add(type);
        renderCalendar();
      }
    }
    else if (event.target.closest('[data-my-calendar-open]')) openCalendarEntry(Number(event.target.closest('[data-my-calendar-open]').dataset.myCalendarOpen));
    else if (event.target.closest('[data-my-calendar-shift]')) changeMonth(Number(event.target.closest('[data-my-calendar-shift]').dataset.myCalendarShift));
    else if (event.target.closest('#myCalendarToday')) {
      const now=new Date();month=new Date(now.getFullYear(),now.getMonth(),1);selectedDay=localISO(now);renderCalendar();
    } else if (event.target.closest('[data-my-calendar-date]')) {
      selectedDay=event.target.closest('[data-my-calendar-date]').dataset.myCalendarDate;
      const date=new Date(selectedDay+'T12:00:00');
      month=new Date(date.getFullYear(),date.getMonth(),1);
      renderCalendar();
    }
  });
  root?.addEventListener('change',event=>{
    const select=event.target.closest('[data-my-task-status]');
    if (select) updateTaskStatus(select.dataset.myTaskStatus,select.value,select);
  });
  byId('myTaskFilter')?.addEventListener('change',displayTasks);
  byId('myTaskSort')?.addEventListener('change',displayTasks);
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
  byId('myTaskDialog')?.addEventListener('close',()=>{editingTaskId=null;});
  window.harazdMyPageExtras={load,setAppointments,decorateStaffList,restoreAvatar:()=>paintAvatar(activeRequest)};
})();
