/* HARAZD WAREHOUSE — checklists for existing personal tasks only. */
(() => {
  'use strict';
  const byId=id=>document.getElementById(id);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const TABLE='warehouse_task_checklist';
  let checklistByTask=new Map(), user=null, manager=false, refresh=()=>{}, available=false, loadSerial=0;

  async function load(taskList,context={}) {
    const serial=++loadSerial;
    user=context.user||null;
    manager=Boolean(context.manager);
    refresh=context.refresh||(()=>{});
    checklistByTask=new Map();
    available=false;
    const help=byId('myTaskChecklistHelp');
    if(!user||!Array.isArray(taskList)||!taskList.length){available=true;return;}
    const ids=[...new Set(taskList.map(t=>t.id).filter(Boolean))];
    const records=[];
    let error=null;
    for(let start=0;start<ids.length;start+=60){
      const {data,error:err}=await db.from(TABLE)
        .select('id,task_id,title,position,done')
        .in('task_id',ids.slice(start,start+60))
        .order('position',{ascending:true}).limit(1000);
      if(serial!==loadSerial)return;
      if(err){error=err;break;}
      records.push(...data||[]);
    }
    if(error){
      if(help)help.textContent='Чеклісти недоступні. Виконайте SETUP_MY_PAGE_NOTIFICATIONS_CHECKLISTS.sql.';
      return;
    }
    for(const item of records){
      const id=String(item.task_id);
      if(!checklistByTask.has(id))checklistByTask.set(id,[]);
      checklistByTask.get(id).push(item);
    }
    for(const items of checklistByTask.values())items.sort((a,b)=>a.position-b.position);
    available=true;
    if(help)help.textContent='Кожен пункт з нового рядка · максимум 30 пунктів по 240 символів.';
  }
  function card(task) {
    const items=checklistByTask.get(String(task.id))||[];
    if(!items.length)return '';
    const completed=items.filter(x=>x.done).length;
    const own=task.assignee_id===user?.id;
    return '<div class="my-task-checklist">'+
      '<div class="my-task-checklist-summary"><strong>Чекліст</strong><span>'+completed+' із '+items.length+' виконано</span></div>'+
      '<div class="my-task-checklist-track" role="progressbar" aria-label="Виконання чекліста" aria-valuemin="0" aria-valuemax="'+items.length+'" aria-valuenow="'+completed+'">'+
        '<span style="width:'+Math.round(completed/items.length*100)+'%"></span></div>'+
      '<div class="my-task-checklist-items">'+items.map(item=>
        '<label class="my-task-checklist-item'+(item.done?' is-done':'')+'">'+
        '<input type="checkbox" data-my-checklist-toggle="'+esc(item.id)+'"'+(item.done?' checked':'')+(own?'':' disabled')+'>'+
        '<span>'+esc(item.title)+'</span></label>'
      ).join('')+'</div></div>';
  }
  function fillEditor(task) {
    const field=byId('myTaskChecklistDraft'),help=byId('myTaskChecklistHelp');
    if(!field)return;
    field.value=(checklistByTask.get(String(task?.id||''))||[]).map(x=>x.title).join('\n');
    field.disabled=!available;
    if(help)help.textContent=available?
      'Кожен пункт з нового рядка · максимум 30 пунктів по 240 символів.':
      'Для чеклістів потрібно виконати SETUP_MY_PAGE_NOTIFICATIONS_CHECKLISTS.sql.';
  }
  async function saveDraft(taskId) {
    const field=byId('myTaskChecklistDraft');
    if(!available||!field||field.disabled) {
      if(field?.value?.trim())throw Error('Чеклісти недоступні: виконайте SQL-оновлення.');
      return;
    }
    const titles=field.value.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
    if(titles.length>30||titles.some(x=>x.length>240)){
      throw Error('Дозволено до 30 пунктів чекліста по 240 символів.');
    }
    const current=checklistByTask.get(String(taskId))||[];
    // Edit by position to retain completion flags even when a title changes.
    for(let i=0;i<Math.min(titles.length,current.length);i++){
      if(titles[i]===current[i].title&&i===current[i].position)continue;
      const result=await db.from(TABLE).update({title:titles[i],position:i}).eq('id',current[i].id);
      if(result.error)throw result.error;
    }
    for(let i=titles.length;i<current.length;i++){
      const result=await db.from(TABLE).delete().eq('id',current[i].id);
      if(result.error)throw result.error;
    }
    if(titles.length>current.length){
      const rows=titles.slice(current.length).map((title,j)=>({task_id:taskId,title,position:current.length+j}));
      const result=await db.from(TABLE).insert(rows);
      if(result.error)throw result.error;
    }
  }
  byId('myTaskList')?.addEventListener('change',async event=>{
    const field=event.target.closest('[data-my-checklist-toggle]');
    if(!field||!available||!user)return;
    const itemId=field.dataset.myChecklistToggle;
    let item,taskId;
    for(const [id,list] of checklistByTask){
      item=list.find(row=>row.id===itemId);
      if(item){taskId=id;break;}
    }
    if(!item)return;
    const before=Boolean(item.done);
    const expected=Boolean(field.checked);
    if(before===expected)return;
    field.disabled=true;
    try{
      const {error}=await db.rpc('warehouse_set_my_checklist_done',{p_item_id:itemId,p_done:expected});
      if(error)throw error;
      item.done=expected;
      refresh();
    }catch(error){
      field.checked=before;
      if(typeof toast==='function')toast('Не вдалося оновити чекліст: '+(error?.message||error),true);
    }finally{field.disabled=false;}
  });
  window.harazdMyPageChecklist={load,card,fillEditor,saveDraft};
})();
