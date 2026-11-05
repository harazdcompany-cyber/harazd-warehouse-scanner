'use strict';
// Stage 1: event metadata only. Inventory and dispatch are intentionally unaffected.
(() => {
  const el = id => document.getElementById(id);
  const statusLabels = {planned:'Планується',preparation:'Підготовка',installation:'Монтаж',live:'Проведення',dismantling:'Демонтаж',done:'Завершено',cancelled:'Скасовано'};
  const activeStatuses = new Set(['preparation','installation','live','dismantling']);
  const safe = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const dateText = value => value ? new Date(value + 'T12:00:00').toLocaleDateString('uk-UA') : '—';
  const periodText = (start,end) => start ? dateText(start)+(end && end!==start?' – '+dateText(end):'') : '—';
  let records = [], editingId = null, busy = false;
  const canCreate = () => typeof staffAllowed === 'function' && staffAllowed('events_create');
  const canEdit = () => typeof staffAllowed === 'function' && staffAllowed('events_edit');
  const authorized = () => typeof session !== 'undefined' && !!session?.user?.id;
  const notice = (message) => {el('eventNotice').textContent=message || '';};
  let expandedId = null;
  const periods = [['Складські роботи до події','warehouse_start_date','warehouse_end_date'],['Монтаж','setup_date','setup_end_date'],['Подія','event_date','event_end_date'],['Демонтаж','teardown_date','teardown_end_date'],['Складські роботи після події','post_warehouse_start_date','post_warehouse_end_date']];
  const details = e => `<div class="event-expanded" id="event-expanded-panel" data-expanded-event="${safe(e.id)}">
    <section class="event-expanded-section"><h3>Основна інформація</h3><div class="event-detail-grid">
      <div><small>Назва заходу</small><strong>${safe(e.name)}</strong></div>
      <div><small>Замовник</small><strong>${safe(e.client || '—')}</strong></div>
      <div><small>Місто / локація</small><strong>${safe(e.location || '—')}</strong></div>
      <div><small>Статус</small><strong>${safe(statusLabels[e.status] || e.status)}</strong></div>
    </div>${e.notes ? `<div class="event-detail-notes"><small>Примітки</small><p>${safe(e.notes)}</p></div>` : ''}
    <h4>Періоди робіт</h4><div class="event-detail-periods">${periods.map(([label,start,end])=>`<div><span>${label}</span><strong>${periodText(e[start],e[end])}</strong></div>`).join('')}</div>
    </section>
    <section class="event-expanded-section event-load-section"><div class="event-load-heading"><h3>Лист погрузки</h3><span class="event-load-caption">План обладнання для заходу</span></div>
      <div class="event-loading-list" id="eventInlineEquipment" aria-live="polite">Завантаження обладнання…</div>
    </section>
  </div>`;
  const item = e => {
    const expanded = e.id === expandedId;
    return `<article class="event-card${expanded?' event-card-expanded':''}" data-event-card="${safe(e.id)}"><div class="event-card-head"><strong>${safe(e.name)}</strong><span class="event-state event-state-${safe(e.status)}">${safe(statusLabels[e.status]||e.status)}</span></div>
      <div class="event-card-meta"><span>◷ ${periodText(e.event_date,e.event_end_date)}</span><span>⌖ ${safe(e.location||'Місце не вказано')}</span></div>
      <div class="event-client">${safe(e.client||'Замовника не вказано')}</div>
      ${!expanded ? `<div class="event-period-summary">${periods.filter(([,start])=>e[start]).map(([label,start,end])=>`<div><span>${label}</span><strong>${periodText(e[start],e[end])}</strong></div>`).join('')}</div>`:''}
      <div class="event-card-foot"><small>${safe(e.location||'')}</small><div class="event-card-actions">${canEdit()?`<button type="button" data-event-edit="${safe(e.id)}">Редагувати</button>`:''}<button type="button" aria-expanded="${expanded}" data-event-toggle="${safe(e.id)}">${expanded?'Згорнути ▲':'Розгорнути ▼'}</button></div></div>
      ${expanded?details(e):''}
    </article>`;
  };
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
    if (expandedId && filtered.some(e => e.id === expandedId)) {
      const host = el('eventInlineEquipment');
      if(host) window.harazdEventEquipment?.mountInline(expandedId,host);
    }
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
    for (const name of ['name','client','location','warehouse_start_date','warehouse_end_date','setup_date','setup_end_date','event_date','event_end_date','teardown_date','teardown_end_date','post_warehouse_start_date','post_warehouse_end_date','status','notes']) {
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
    const periods=[
      {name:'Складські роботи',start:'warehouse_start_date',end:'warehouse_end_date'},
      {name:'Монтаж',start:'setup_date',end:'setup_end_date'},
      {name:'Подія',start:'event_date',end:'event_end_date'},
      {name:'Демонтаж',start:'teardown_date',end:'teardown_end_date'},
      {name:'Складські роботи після події',start:'post_warehouse_start_date',end:'post_warehouse_end_date'}
    ];
    const dates={};
    let previousEnd=null;
    for (const period of periods) {
      const start=get(period.start), end=get(period.end);
      if (end && !start) {
        el('eventFormNotice').textContent=`Для періоду «${period.name}» спочатку вкажіть початкову дату.`;
        return;
      }
      if (start && end && end < start) {
        el('eventFormNotice').textContent=`Для періоду «${period.name}» дата завершення раніше початку.`;
        return;
      }
      // No end date means a one-day period. Keep old records with empty ends compatible.
      if (start && previousEnd && start < previousEnd) {
        el('eventFormNotice').textContent=`Період «${period.name}» починається раніше завершення попереднього етапу.`;
        return;
      }
      if (start) previousEnd=end||start;
      dates[period.start]=start||null;
      dates[period.end]=end||null;
    }
    const payload={name,client:get('client'),location:get('location'),...dates,status:get('status'),notes:get('notes')};
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
    const edit = event.target.closest('[data-event-edit]');
    if(edit) {const record=records.find(x=>x.id===edit.dataset.eventEdit);if(record)open(record);return;}
    // Loading-list interactions must not collapse the card.
    if(event.target.closest('.event-expanded'))return;
    const card = event.target.closest('[data-event-card]');
    if(!card)return;
    const id=card.dataset.eventCard;
    expandedId=expandedId===id ? null : id;
    window.harazdEventEquipment?.unmountInline();
    render();
  });
  window.harazdEvents={load};
})();
