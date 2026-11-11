/* HARAZD WAREHOUSE — in-app My Page notifications for assigned work. */
(() => {
  'use strict';
  const byId=id=>document.getElementById(id);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const TABLE='warehouse_my_notification_state';
  const typeLabels={task:'Завдання',event:'Подія',repair:'Ремонт'};
  let user=null,active=false,taskReady=false,assignmentsReady=false;
  let tasks=[],repairs=[],events=[],rows=[],validSources=new Map(),serial=0;
  let loading=false,errorMessage='';

  function sourceKey(type,id){return type+':'+id;}
  function dateLabel(value){
    if(!value)return '';
    const date=new Date(value.slice(0,10)+'T12:00:00');
    return Number.isNaN(date.getTime())?value.slice(0,10):date.toLocaleDateString('uk-UA');
  }
  function snapshots(){
    if(!user)return [];
    const sources=new Map();
    function add(type,id,title,dateKey){
      const stringId=String(id||'');
      if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(stringId))return;
      sources.set(sourceKey(type,stringId),{
        user_id:user.id,source_type:type,source_id:stringId,
        title:String(title||typeLabels[type]).trim().slice(0,240)||typeLabels[type],
        date_key:String(dateKey||'').slice(0,180)
      });
    }
    for(const task of tasks)if(task.assignee_id===user.id)
      add('task',task.id,task.title,task.due_date||'');
    for(const repair of repairs)
      add('repair',repair.id,repair.problem||'Ремонт обладнання',repair.due_on||'');
    for(const item of events)
      add('event',item.id,item.name||'Подія',[
        item.warehouse_start_date,item.warehouse_end_date,item.setup_date,item.setup_end_date,
        item.event_date,item.event_end_date,item.teardown_date,item.teardown_end_date,
        item.post_warehouse_start_date,item.post_warehouse_end_date
      ].map(x=>x||'').join('|'));
    return [...sources.values()];
  }
  function updateCount(){
    const badge=byId('myPageNotificationCount');
    const button=byId('myPageNotificationToggle');
    const unread=rows.filter(r=>!r.read_at).length;
    if(badge){badge.hidden=unread===0;badge.textContent=unread>99?'99+':String(unread);}
    if(button)button.setAttribute('aria-label','Сповіщення'+(unread?' — непрочитаних: '+unread:''));
    const readAll=byId('myPageNotificationReadAll');
    if(readAll)readAll.disabled=unread===0;
  }
  function render(){
    updateCount();
    const host=byId('myPageNotificationList');
    if(!host)return;
    if(!active){
      host.innerHTML='<p class="my-page-empty">Потрібен активний профіль працівника.</p>';
      return;
    }
    if(errorMessage){
      host.innerHTML='<p class="my-page-notification-error">'+esc(errorMessage)+'</p>';
      return;
    }
    if(loading && !rows.length){
      host.innerHTML='<p class="my-page-empty">Оновлюємо сповіщення…</p>';
      return;
    }
    if(!rows.length){
      host.innerHTML='<p class="my-page-empty">Нових сповіщень немає.</p>';
      return;
    }
    const ordered=[...rows].sort((a,b)=>{
      if(Boolean(a.read_at)!==Boolean(b.read_at))return a.read_at?1:-1;
      return String(b.changed_at||'').localeCompare(a.changed_at||'');
    });
    host.innerHTML=ordered.slice(0,60).map(row=>{
      const source=typeLabels[row.source_type]||'Робота';
      const updated=row.change_kind==='deadline_changed';
      const due=row.date_key?.split('|').find(Boolean)||'';
      return '<button type="button" class="my-page-notification-item'+(row.read_at?' is-read':'')+'"'+
        ' data-my-notification-source="'+esc(row.source_type)+'" data-my-notification-id="'+esc(row.source_id)+'">'+
        '<span class="my-page-notification-type type-'+esc(row.source_type)+'">'+esc(source)+'</span>'+
        '<strong>'+esc(row.title)+'</strong>'+
        '<small>'+(updated?'Змінено термін або дати робіт':'Нове призначення')+
        (due?' · '+esc(dateLabel(due)):'')+'</small></button>';
    }).join('');
  }
  function load(context){
    serial++;
    user=context?.user||null;
    active=Boolean(user&&context?.profile?.status==='active');
    tasks=[];repairs=[];events=[];rows=[];validSources=new Map();
    taskReady=false;assignmentsReady=false;loading=false;errorMessage='';
    const panel=byId('myPageNotificationPanel'),toggle=byId('myPageNotificationToggle');
    if(panel)panel.hidden=true;
    if(toggle)toggle.setAttribute('aria-expanded','false');
    render();
  }
  function setTasks(list){
    tasks=Array.isArray(list)?list:[];
    taskReady=true;
    if(active&&assignmentsReady)sync();
  }
  function setAssignments(data){
    repairs=Array.isArray(data?.repairs)?data.repairs:[];
    events=Array.isArray(data?.events)?data.events:[];
    assignmentsReady=true;
    if(active&&taskReady)sync();
  }
  async function sync(){
    if(!active||!taskReady||!assignmentsReady)return;
    const request=++serial,uid=user.id;
    loading=true;errorMessage='';render();
    try {
      const current=snapshots();
      const lookup=new Map(current.map(s=>[sourceKey(s.source_type,s.source_id),s]));
      const {data,error}=await db.from(TABLE).select('*').eq('user_id',uid)
        .order('changed_at',{ascending:false}).limit(500);
      if(error)throw error;
      if(request!==serial||uid!==user?.id)return;
      const previous=new Map((data||[]).map(r=>[sourceKey(r.source_type,r.source_id),r]));
      for(const item of current){
        const old=previous.get(sourceKey(item.source_type,item.source_id));
        if(old && old.date_key===item.date_key)continue;
        const row={...item,change_kind:old?'deadline_changed':'assigned',
          changed_at:new Date().toISOString(),read_at:null};
        const result=await db.from(TABLE).upsert(row,{onConflict:'user_id,source_type,source_id'});
        if(result.error)throw result.error;
        if(request!==serial||uid!==user?.id)return;
      }
      const loaded=await db.from(TABLE).select('*').eq('user_id',uid)
        .order('changed_at',{ascending:false}).limit(500);
      if(loaded.error)throw loaded.error;
      if(request!==serial||uid!==user?.id)return;
      validSources=lookup;
      rows=(loaded.data||[]).filter(r=>lookup.has(sourceKey(r.source_type,r.source_id)));
    }catch(error){
      if(request!==serial)return;
      errorMessage='Сповіщення недоступні. Виконайте SETUP_MY_PAGE_NOTIFICATIONS_CHECKLISTS.sql. '+(error?.message||'');
    }finally{
      if(request===serial){loading=false;render();}
    }
  }
  async function markOne(type,id){
    if(!user)return;
    const target=rows.find(row=>row.source_type===type&&row.source_id===id);
    if(!target||target.read_at)return;
    const stamp=new Date().toISOString();
    const result=await db.from(TABLE).update({read_at:stamp})
      .eq('user_id',user.id).eq('source_type',type).eq('source_id',id);
    if(result.error){
      if(typeof toast==='function')toast('Не вдалося позначити сповіщення прочитаним.',true);
      return;
    }
    target.read_at=stamp;render();
  }
  async function markAll(){
    if(!user||!rows.some(row=>!row.read_at))return;
    const stamp=new Date().toISOString();
    const result=await db.from(TABLE).update({read_at:stamp})
      .eq('user_id',user.id).is('read_at',null);
    if(result.error){
      if(typeof toast==='function')toast('Не вдалося позначити сповіщення прочитаними.',true);
      return;
    }
    rows.forEach(row=>{row.read_at=row.read_at||stamp;});
    render();
  }
  function navigate(type,id){
    let target=null;
    if(type==='task'){
      const filter=byId('myTaskFilter');
      if(filter){filter.value='all';filter.dispatchEvent(new Event('change',{bubbles:true}));}
      target=Array.from(document.querySelectorAll('#myTaskList [data-task-id]'))
        .find(el=>el.dataset.taskId===id);
    }else{
      const host=byId(type==='repair'?'myPageRepairs':'myPageEvents');
      const key=type==='repair'?'myRepairId':'myEventId';
      target=Array.from(host?.querySelectorAll('details')||[]).find(el=>el.dataset[key]===id);
      if(target)target.open=true;
    }
    if(target){
      const panel=byId('myPageNotificationPanel'),toggle=byId('myPageNotificationToggle');
      if(panel)panel.hidden=true;
      if(toggle)toggle.setAttribute('aria-expanded','false');
      target.scrollIntoView({behavior:'smooth',block:'center'});
      if(!target.hasAttribute('tabindex'))target.setAttribute('tabindex','-1');
      target.focus({preventScroll:true});
    }
  }
  byId('myPageNotificationToggle')?.addEventListener('click',()=>{
    const panel=byId('myPageNotificationPanel'),button=byId('myPageNotificationToggle');
    if(!panel)return;
    panel.hidden=!panel.hidden;
    button.setAttribute('aria-expanded',String(!panel.hidden));
  });
  byId('myPageNotificationList')?.addEventListener('click',event=>{
    const item=event.target.closest('[data-my-notification-source]');
    if(!item)return;
    const type=item.dataset.myNotificationSource,id=item.dataset.myNotificationId;
    markOne(type,id);
    navigate(type,id);
  });
  byId('myPageNotificationReadAll')?.addEventListener('click',markAll);
  byId('myPageNotificationRefresh')?.addEventListener('click',()=>{
    if(!loading)window.harazdMyPage?.load();
  });
  window.harazdMyPageNotifications={load,setTasks,setAssignments};
})();
