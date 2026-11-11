/* HARAZD WAREHOUSE — checklists for existing personal tasks only. */
(() => {
  'use strict';
  const byId=id=>document.getElementById(id);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const TABLE='warehouse_task_checklist';
  let checklistByTask=new Map(), user=null, manager=false, refresh=()=>{}, available=false, loadSerial=0;
  let editorRows=[], editingIndex=null, editorTaskId=null;

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
    for(let start=0;start<ids.length;start+=25){
      const {data,error:err}=await db.from(TABLE)
        .select('id,task_id,title,position,done')
        .in('task_id',ids.slice(start,start+25))
        .order('position',{ascending:true}).limit(1000);
      if(serial!==loadSerial)return;
      if(err){error=err;break;}
      records.push(...(data||[]));
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
    if(help)help.textContent='До 30 пунктів по 240 символів. Додавайте кнопкою «+ Додати пункт».';
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
  function assigneeIsMe(){
    return Boolean(user?.id && byId('myTaskForm')?.elements.namedItem('assignee_id')?.value===user.id);
  }
  function renderEditor(){
    const host=byId('myTaskChecklistRows'),help=byId('myTaskChecklistHelp'),add=byId('myTaskChecklistAdd');
    if(!host)return;
    const mayComplete=assigneeIsMe();
    host.innerHTML=editorRows.length?editorRows.map((row,i)=>
      '<div class="my-task-checklist-editor-item">'+
      '<span class="my-task-checklist-editor-title">'+esc(row.title)+'</span>'+
      '<label class="my-task-checklist-editor-checkbox" title="'+(mayComplete?'Відмітити виконання':'Позначати виконання може призначений працівник')+'">'+
      '<input type="checkbox" data-my-checklist-editor-done="'+i+'"'+(row.done?' checked':'')+(mayComplete?'':' disabled')+'>'+
      '<span>Виконано</span></label>'+
      '<button type="button" data-my-checklist-editor-edit="'+i+'" aria-label="Редагувати пункт">✎</button>'+
      '<button type="button" data-my-checklist-editor-remove="'+i+'" aria-label="Видалити пункт">×</button>'+
      '</div>').join(''):
      '<p class="my-task-checklist-editor-empty">Пунктів ще немає. Натисніть «+ Додати пункт».</p>';
    if(add)add.disabled=!available||editorRows.length>=30;
    if(help)help.textContent=available?
      'До 30 пунктів по 240 символів. Галочку може відмічати призначений працівник.':
      'Для чеклістів потрібно виконати SETUP_MY_PAGE_NOTIFICATIONS_CHECKLISTS.sql.';
  }
  function cancelInput(){
    const wrap=byId('myTaskChecklistAddRow'),input=byId('myTaskChecklistInput');
    editingIndex=null;
    if(input)input.value='';
    if(wrap)wrap.hidden=true;
    const add=byId('myTaskChecklistAdd');
    if(add)add.hidden=false;
  }
  function openInput(index=null){
    if(!available)return;
    if(index===null&&editorRows.length>=30)return;
    editingIndex=index;
    const wrap=byId('myTaskChecklistAddRow'),input=byId('myTaskChecklistInput');
    if(!wrap||!input)return;
    wrap.hidden=false;
    input.value=index===null?'':editorRows[index]?.title||'';
    const confirm=byId('myTaskChecklistConfirm');
    if(confirm)confirm.textContent=index===null?'Підтвердити':'Зберегти пункт';
    byId('myTaskChecklistAdd').hidden=true;
    input.focus();
  }
  function confirmInput(){
    const input=byId('myTaskChecklistInput');
    if(!input)return;
    const value=input.value.trim();
    if(!value){
      input.setCustomValidity('Введіть назву пункту.');
      input.reportValidity();
      return;
    }
    if(value.length>240)return;
    if(editingIndex!==null){
      if(!editorRows[editingIndex])return;
      editorRows[editingIndex].title=value;
    }else{
      if(editorRows.length>=30)return;
      editorRows.push({id:null,title:value,done:false});
    }
    cancelInput();
    renderEditor();
  }
  function fillEditor(task){
    editorTaskId=task?.id||null;
    editorRows=(checklistByTask.get(String(editorTaskId||''))||[]).map(item=>({
      id:item.id,title:item.title,done:Boolean(item.done)
    }));
    cancelInput();
    renderEditor();
  }
  function validateDraft(){
    const input=byId('myTaskChecklistInput'),wrap=byId('myTaskChecklistAddRow');
    if(wrap&&!wrap.hidden&&input?.value.trim()){
      throw Error('Спочатку підтвердьте новий пункт чекліста.');
    }
    if(editorRows.length>30||editorRows.some(row=>!row.title.trim()||row.title.length>240)){
      throw Error('Дозволено до 30 пунктів чекліста по 240 символів.');
    }
    return editorRows.length;
  }
  async function saveDraft(taskId){
    validateDraft();
    if(!available){
      if(editorRows.length)throw Error('Чеклісти недоступні: виконайте SQL-оновлення.');
      return;
    }
    const current=checklistByTask.get(String(editorTaskId||taskId))||[];
    const existing=new Map(current.map(x=>[x.id,x]));
    const wanted=new Set(editorRows.map(x=>x.id).filter(Boolean));
    for(const row of current){
      if(wanted.has(row.id))continue;
      const {error}=await db.from(TABLE).delete().eq('id',row.id);
      if(error)throw error;
    }
    for(let i=0;i<editorRows.length;i++){
      const row=editorRows[i],old=existing.get(row.id);
      if(!old)continue;
      if(row.title!==old.title||i!==old.position){
        const {error}=await db.from(TABLE).update({title:row.title,position:i}).eq('id',row.id);
        if(error)throw error;
      }
      if(row.done!==Boolean(old.done)){
        if(!assigneeIsMe())throw Error('Позначати виконання може лише призначений працівник.');
        const {error}=await db.rpc('warehouse_set_my_checklist_done',{p_item_id:row.id,p_done:row.done});
        if(error)throw error;
      }
    }
    const newRows=editorRows.map((row,i)=>({...row,position:i})).filter(row=>!row.id);
    if(newRows.length){
      const {data,error}=await db.from(TABLE).insert(newRows.map(row=>({
        task_id:taskId,title:row.title,position:row.position
      }))).select('id,position');
      if(error)throw error;
      if(!Array.isArray(data)||data.length!==newRows.length)throw Error('Не вдалося отримати нові пункти чекліста.');
      for(const row of newRows){
        if(!row.done)continue;
        if(!assigneeIsMe())throw Error('Позначати виконання може лише призначений працівник.');
        const saved=data.find(item=>item.position===row.position);
        if(!saved?.id)throw Error('Не вдалося знайти збережений пункт чекліста.');
        const {error:doneError}=await db.rpc('warehouse_set_my_checklist_done',{
          p_item_id:saved.id,p_done:true
        });
        if(doneError)throw doneError;
      }
    }
  }
  byId('myTaskChecklistAdd')?.addEventListener('click',()=>openInput());
  byId('myTaskChecklistConfirm')?.addEventListener('click',confirmInput);
  byId('myTaskChecklistCancel')?.addEventListener('click',cancelInput);
  byId('myTaskChecklistInput')?.addEventListener('input',event=>{
    event.target.setCustomValidity('');
  });
  byId('myTaskChecklistInput')?.addEventListener('keydown',event=>{
    if(event.key==='Enter'){event.preventDefault();confirmInput();}
    if(event.key==='Escape'){event.preventDefault();cancelInput();}
  });
  byId('myTaskForm')?.elements.namedItem('assignee_id')?.addEventListener('change',renderEditor);
  byId('myTaskChecklistRows')?.addEventListener('click',event=>{
    const edit=event.target.closest('[data-my-checklist-editor-edit]');
    const remove=event.target.closest('[data-my-checklist-editor-remove]');
    if(edit){
      openInput(Number(edit.dataset.myChecklistEditorEdit));
    }else if(remove){
      editorRows.splice(Number(remove.dataset.myChecklistEditorRemove),1);
      cancelInput();renderEditor();
    }
  });
  byId('myTaskChecklistRows')?.addEventListener('change',event=>{
    const checkbox=event.target.closest('[data-my-checklist-editor-done]');
    if(!checkbox||!assigneeIsMe())return;
    const row=editorRows[Number(checkbox.dataset.myChecklistEditorDone)];
    if(row)row.done=Boolean(checkbox.checked);
  });
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
  window.harazdMyPageChecklist={load,card,fillEditor,saveDraft,validateDraft};
})();
