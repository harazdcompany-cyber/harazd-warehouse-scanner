'use strict';
// Stage 1: event metadata only. Inventory and dispatch are intentionally unaffected.
(() => {
  const el = id => document.getElementById(id);
  const statusLabels = {planned:'Планується',preparation:'Підготовка',installation:'Монтаж',live:'Проведення',dismantling:'Демонтаж',done:'Завершено',cancelled:'Скасовано'};
  const activeStatuses = new Set(['preparation','installation','live','dismantling']);
  const safe = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const dateText = value => value ? new Date(value + 'T12:00:00').toLocaleDateString('uk-UA') : '—';
  let records = [], editingId = null, busy = false;
  const canCreate = () => typeof staffAllowed === 'function' && staffAllowed('events_create');
  const canEdit = () => typeof staffAllowed === 'function' && staffAllowed('events_edit');
  const authorized = () => typeof session !== 'undefined' && !!session?.user?.id;
  const notice = (message) => {el('eventNotice').textContent=message || '';};
  const item = e => `<article class="event-card"><div class="event-card-head"><strong>${safe(e.name)}</strong><span class="event-state event-state-${safe(e.status)}">${safe(statusLabels[e.status]||e.status)}</span></div><div class="event-card-meta"><span>◷ ${dateText(e.event_date)}</span><span>⌖ ${safe(e.location||'Місце не вказано')}</span></div><div class="event-client">${safe(e.client||'Замовника не вказано')}</div>${e.notes?`<p class="event-notes">${safe(e.notes)}</p>`:''}<div class="event-card-foot"><small>${e.setup_date?'Монтаж: '+dateText(e.setup_date):''}${e.setup_date&&e.teardown_date?' · ':''}${e.teardown_date?'Демонтаж: '+dateText(e.teardown_date):''}</small>${canEdit()?`<button type="button" data-event-edit="${safe(e.id)}">Редагувати</button>`:''}</div></article>`;
  function render() {
    el('eventAdd').hidden=!canCreate();
    const q=el('eventSearch').value.trim().toLocaleLowerCase('uk-UA');
    const status=el('eventStatusFilter').value;
    const filtered=records.filter(e => (!status||e.status===status)&&(!q||[e.name,e.client,e.location,e.notes].some(v=>String(v||'').toLocaleLowerCase('uk-UA').includes(q))));
    const sort=el('eventSort').value;
    filtered.sort((a,b)=>sort==='name'?a.name.localeCompare(b.name,'uk'):sort==='newest'?String(b.created_at||'').localeCompare(String(a.created_at||'')):(a.event_date||'9999-12-31').localeCompare(b.event_date||'9999-12-31'));
    el('eventAllCount').textContent=records.length;
    el('eventActiveCount').textContent=records.filter(e=>activeStatuses.has(e.status)).length;
    el('eventDoneCount').textContent=records.filter(e=>e.status==='done').length;
    el('eventCards').innerHTML=filtered.length?filtered.map(item).join(''):'<div class="panel event-empty">Івентів не знайдено. Створіть перший захід або змініть фільтри.</div>';
  }
  async function load() {
    if (!authorized() || !db) return;
    if (busy) return;
    notice('Завантаження івентів…');
    const {data,error}=await db.from('warehouse_events').select('*').order('event_date',{ascending:true});
    if (error) {
      notice(error.code==='42P01' || error.code==='PGRST205' ? 'Спочатку виконайте SQL-файл SETUP_EVENTS_V49_34.sql у Supabase.' : 'Не вдалося отримати івенти: '+error.message);
      el('eventCards').innerHTML='';
      return;
    }
    records=data||[];
    notice('');
    render();
  }
  function open(record=null) {
    if (!(record?canEdit():canCreate())) return;
    editingId=record?.id||null;
    const form=el('eventForm');form.reset();
    for (const name of ['name','client','location','setup_date','event_date','teardown_date','status','notes']) {
      if (record && form.elements[name]) form.elements[name].value=record[name]|| (name==='status'?'planned':'');
    }
    el('eventDialogTitle').textContent=record?'Редагувати івент':'Новий івент';
    el('eventFormNotice').textContent='';
    el('eventSave').disabled=false;
    el('eventDialog').showModal();
  }
  async function save(evt) {
    evt.preventDefault();
    if (busy || !authorized() || !(editingId?canEdit():canCreate())) return;
    const form=evt.currentTarget, fd=new FormData(form);
    const get=k=>String(fd.get(k)||'').trim();
    const name=get('name'), date=get('event_date');
    if(!name || !date) return;
    const setup=get('setup_date'), teardown=get('teardown_date');
    if((setup&&setup>date)||(teardown&&teardown<date)){
      el('eventFormNotice').textContent='Перевірте порядок дат: монтаж → захід → демонтаж.';return;
    }
    const payload={name,client:get('client'),location:get('location'),setup_date:setup||null,event_date:date,teardown_date:teardown||null,status:get('status'),notes:get('notes')};
    busy=true;el('eventSave').disabled=true;el('eventFormNotice').textContent='Збереження…';
    try {
      const operation=editingId?db.from('warehouse_events').update(payload).eq('id',editingId):db.from('warehouse_events').insert({...payload,created_by:session.user.id});
      const {error}=await operation;
      if(error)throw error;
      el('eventDialog').close();
      busy=false;
      await load();
    } catch(err) {
      el('eventFormNotice').textContent='Не вдалося зберегти: '+(err?.message||String(err));
    } finally {busy=false;el('eventSave').disabled=false;}
  }
  el('eventAdd').addEventListener('click',()=>open());
  el('eventClose').addEventListener('click',()=>el('eventDialog').close());
  el('eventCancel').addEventListener('click',()=>el('eventDialog').close());
  el('eventForm').addEventListener('submit',save);
  ['eventSearch','eventStatusFilter','eventSort'].forEach(id=>el(id).addEventListener(id==='eventSearch'?'input':'change',render));
  el('eventCards').addEventListener('click',event=>{
    const btn=event.target.closest('[data-event-edit]');
    if(btn) {const record=records.find(x=>x.id===btn.dataset.eventEdit);if(record)open(record);}
  });
  window.harazdEvents={load};
})();
