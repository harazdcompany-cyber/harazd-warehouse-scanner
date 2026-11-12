'use strict';
(() => {
  const el = id => document.getElementById(id);
  const statusLabels = {planned:'Планується',preparation:'Підготовка',installation:'Монтаж',live:'Проведення',dismantling:'Демонтаж',done:'Завершено',cancelled:'Скасовано'};
  const activeStatuses = new Set(['preparation','installation','live','dismantling']);
  const safe = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const dateText = value => value ? new Date(value + 'T12:00:00').toLocaleDateString('uk-UA') : '—';
  const periodText = (start,end) => start ? dateText(start)+(end && end!==start?' – '+dateText(end):'') : '—';
  let records = [], editingId = null, busy = false, activeDetailId = null;
  let eventStaffReady = false, eventStaffRequestId = 0, detailStaffRequestId = 0;
  const canCreate = () => typeof staffAllowed === 'function' && staffAllowed('events_create');
  const canEdit = () => typeof staffAllowed === 'function' && staffAllowed('events_edit');
  const authorized = () => typeof session !== 'undefined' && !!session?.user?.id;
  const notice = message => { el('eventNotice').textContent = message || ''; };
  const periods = [
    ['Складські роботи до події','warehouse_start_date','warehouse_end_date'],
    ['Монтаж','setup_date','setup_end_date'],
    ['Подія','event_date','event_end_date'],
    ['Демонтаж','teardown_date','teardown_end_date'],
    ['Складські роботи після події','post_warehouse_start_date','post_warehouse_end_date']
  ];

  function ensureDetailsDialog() {
    if (el('eventDetailsDialog')) return;
    const dialog = document.createElement('dialog');
    dialog.id = 'eventDetailsDialog';
    dialog.className = 'event-dialog event-details-dialog';
    dialog.setAttribute('aria-labelledby', 'eventDetailsTitle');
    dialog.innerHTML = `
      <div class="event-details-shell">
        <div class="event-dialog-heading event-details-heading">
          <div>
            <div class="event-view-eyebrow">ІВЕНТ / ДЕТАЛІ</div>
            <h2 id="eventDetailsTitle">Івент</h2>
          </div>
          <button type="button" id="eventDetailsClose" aria-label="Закрити">✕</button>
        </div>
        <div id="eventDetailsBody"></div>
      </div>`;
    document.body.appendChild(dialog);
  }

  function detailMarkup(e) {
    const eventStatus = safe(statusLabels[e.status] || e.status);
    const eventDate = periodText(e.event_date, e.event_end_date);
    const notes = String(e.notes || '').trim();
    return `
      <div class="event-view">
        <section class="event-view-hero">
          <div class="event-view-hero-main">
            <div class="event-view-kicker">Картка івенту</div>
            <h3>${safe(e.name)}</h3>
            <div class="event-card-meta event-view-meta"><span>◷ ${eventDate}</span><span>⌖ ${safe(e.location || 'Місце не вказано')}</span></div>
            <div class="event-view-client">${safe(e.client || 'Замовника не вказано')}</div>
          </div>
          <div class="event-view-status"><span class="event-state event-state-${safe(e.status)}">${eventStatus}</span></div>
        </section>

        <section class="event-view-section">
          <h3>Періоди робіт</h3>
          <div class="event-period-cards">
            ${periods.map(([label,start,end]) => `
              <div class="event-period-card">
                <small>${label}</small>
                <strong>${periodText(e[start], e[end])}</strong>
              </div>`).join('')}
          </div>
        </section>

        <section class="event-view-section">
          <h3>Основна інформація</h3>
          <div class="event-detail-grid event-detail-grid-modal">
            <div><small>Назва заходу</small><strong>${safe(e.name)}</strong></div>
            <div><small>Статус</small><strong>${eventStatus}</strong></div>
            <div><small>Замовник</small><strong>${safe(e.client || '—')}</strong></div>
            <div><small>Місто / локація</small><strong>${safe(e.location || '—')}</strong></div>
          </div>
          <div class="event-detail-notes${notes ? '' : ' is-empty'}"><small>Примітки</small><p>${notes ? safe(notes) : '—'}</p></div>
        </section>

        <section class="event-view-section event-detail-staff">
          <h3>Персонал</h3>
          <div id="eventDetailsStaff" aria-live="polite">Завантаження…</div>
        </section>

        <section class="event-view-section event-load-section">
          <div class="event-load-heading">
            <div>
              <h3>Лист погрузки</h3>
              <span class="event-load-caption">План обладнання для цього івенту</span>
            </div>
            <div class="event-view-actions">
              ${canEdit() ? `<button type="button" class="primary" data-event-detail-edit="${safe(e.id)}">Редагувати</button>` : ''}
            </div>
          </div>
          <div class="event-loading-list" id="eventDetailsEquipment" aria-live="polite">Завантаження обладнання…</div>
        </section>
      </div>`;
  }

  function openDetails(record) {
    if (!record) return;
    ensureDetailsDialog();
    const dialog = el('eventDetailsDialog');
    const title = el('eventDetailsTitle');
    const body = el('eventDetailsBody');
    activeDetailId = record.id;
    title.textContent = record.name || 'Івент';
    body.innerHTML = detailMarkup(record);
    if (!dialog.open) dialog.showModal();
    loadDetailStaff(record.id, ++detailStaffRequestId);
    const host = el('eventDetailsEquipment');
    if (host) window.harazdEventEquipment?.mountInline(record.id, host);
  }

  async function loadDetailStaff(eventId, requestId) {
    const host = el('eventDetailsStaff');
    if (!host) return;
    try {
      const [staff, assigned] = await Promise.all([
        db.rpc('warehouse_event_assignable_staff'),
        db.from('warehouse_event_staff').select('user_id').eq('event_id', eventId)
      ]);
      if (staff.error) throw staff.error;
      if (assigned.error) throw assigned.error;
      if (requestId !== detailStaffRequestId || activeDetailId !== eventId ||
          !el('eventDetailsDialog')?.open || el('eventDetailsStaff') !== host) return;
      const assignedIds = new Set((assigned.data || []).map(row => String(row.user_id)));
      if (!assignedIds.size) {
        host.textContent = 'Працівників не призначено';
        return;
      }
      const people = (staff.data || []).filter(person => assignedIds.has(String(person.user_id)));
      const missing = Math.max(0, assignedIds.size - new Set(people.map(person => String(person.user_id))).size);
      host.innerHTML = people.map(person =>
        `<div class="event-detail-staff-person">${safe(person.full_name || 'Працівник')}${person.position ? ` <span>· ${safe(person.position)}</span>` : ''}</div>`
      ).join('') + (missing ? '<div class="event-detail-staff-unavailable">Деякі призначені працівники недоступні.</div>' : '');
    } catch (error) {
      if (requestId !== detailStaffRequestId || activeDetailId !== eventId ||
          !el('eventDetailsDialog')?.open || el('eventDetailsStaff') !== host) return;
      host.textContent = 'Не вдалося завантажити призначених працівників';
      console.warn('Event detail staff:', error);
    }
  }

  function closeDetails() {
    const dialog = el('eventDetailsDialog');
    window.harazdEventEquipment?.unmountInline();
    activeDetailId = null;
    detailStaffRequestId++;
    if (dialog?.open) dialog.close();
  }

  const item = e => `
    <article class="event-card" data-event-card="${safe(e.id)}" tabindex="0" role="button" aria-label="Відкрити івент ${safe(e.name)}">
      <div class="event-card-head"><strong>${safe(e.name)}</strong><span class="event-state event-state-${safe(e.status)}">${safe(statusLabels[e.status] || e.status)}</span></div>
      <div class="event-card-meta"><span>◷ ${periodText(e.event_date,e.event_end_date)}</span><span><span class="event-card-location-icon" aria-hidden="true">⌖</span><span class="event-card-location-label">Локація:</span> ${safe(e.location||'Місце не вказано')}</span></div>
      <div class="event-client">${safe(e.client||'Замовника не вказано')}</div>
      <div class="event-period-summary">${periods.filter(([,start]) => e[start]).map(([label,start,end]) => `<div><span>${label}</span><strong>${periodText(e[start],e[end])}</strong></div>`).join('')}</div>
      <div class="event-card-foot"><small>${safe(e.location || '')}</small><div class="event-card-actions">${canEdit() ? `<button type="button" data-event-edit="${safe(e.id)}">Редагувати</button>` : ''}<button type="button" class="primary" data-event-open="${safe(e.id)}">Відкрити</button></div></div>
    </article>`;

  function render() {
    el('eventAdd').hidden = !canCreate();
    const q = el('eventSearch').value.trim().toLocaleLowerCase('uk-UA');
    const status = el('eventStatusFilter').value;
    const filtered = records.filter(e => (!status || e.status === status) && (!q || [e.name,e.client,e.location,e.notes].some(v => String(v || '').toLocaleLowerCase('uk-UA').includes(q))));
    const sort = el('eventSort').value;
    filtered.sort((a,b) => sort === 'name' ? a.name.localeCompare(b.name,'uk') : sort === 'newest' ? String(b.created_at||'').localeCompare(String(a.created_at||'')) : (a.event_date||'9999-12-31').localeCompare(b.event_date||'9999-12-31'));
    el('eventAllCount').textContent = records.length;
    el('eventActiveCount').textContent = records.filter(e => activeStatuses.has(e.status)).length;
    el('eventDoneCount').textContent = records.filter(e => e.status === 'done').length;
    el('eventCards').innerHTML = filtered.length ? filtered.map(item).join('') : '<div class="panel event-empty">Івентів не знайдено. Створіть перший захід або змініть фільтри.</div>';
    if (activeDetailId) {
      const record = records.find(x => x.id === activeDetailId);
      if (record && el('eventDetailsDialog')?.open) openDetails(record);
      else if (!record) closeDetails();
    }
  }

  async function load() {
    if (!authorized() || !db || busy) return;
    notice('Завантаження івентів…');
    const {data,error} = await db.from('warehouse_events').select('*').order('event_date',{ascending:true});
    if (error) {
      notice(error.code === '42P01' || error.code === 'PGRST205' ? 'Спочатку виконайте SQL-файл SETUP_EVENTS_V49_34.sql у Supabase.' : 'Не вдалося отримати івенти: ' + error.message);
      el('eventCards').innerHTML = '';
      return;
    }
    records = data || [];
    notice('');
    render();
  }

  async function loadEventStaff(record, requestId) {
    const host = el('eventAssignedStaff');
    eventStaffReady = false;
    host.textContent = 'Завантаження призначень…';
    if (!canEdit()) {
      host.textContent = 'Призначати працівників можуть користувачі з правом редагування івентів.';
      return;
    }
    try {
      const [staff,assigned] = await Promise.all([
        db.rpc('warehouse_event_assignable_staff'),
        record ? db.from('warehouse_event_staff').select('user_id').eq('event_id',record.id) : Promise.resolve({data:[],error:null})
      ]);
      if (staff.error) throw staff.error;
      if (assigned.error) throw assigned.error;
      if (requestId !== eventStaffRequestId || !el('eventDialog').open) return;
      const ids = new Set((assigned.data||[]).map(x=>x.user_id));
      const people = staff.data || [];
      host.innerHTML = people.length ? people.map(person => `<label><input type="checkbox" value="${safe(person.user_id)}" ${ids.has(person.user_id)?'checked':''}><span>${safe(person.full_name)}${person.position?` · ${safe(person.position)}`:''}</span></label>`).join('') : '<p class="muted">Немає активних працівників для призначення.</p>';
      eventStaffReady = true;
    } catch (err) {
      if (requestId !== eventStaffRequestId) return;
      host.textContent = 'Не вдалося завантажити список працівників. Спочатку виконайте SETUP_MY_PAGE_EVENT_ASSIGNMENTS.sql. Збереження івенту залишиться доступним без зміни призначень.';
      console.warn('Event staff:',err);
    }
  }

  function open(record=null) {
    if (!(record ? canEdit() : canCreate())) return;
    editingId = record?.id || null;
    const form = el('eventForm');
    form.reset();
    for (const name of ['name','client','location','warehouse_start_date','warehouse_end_date','setup_date','setup_end_date','event_date','event_end_date','teardown_date','teardown_end_date','post_warehouse_start_date','post_warehouse_end_date','status','notes']) {
      if (record && form.elements[name]) form.elements[name].value = record[name] || (name === 'status' ? 'planned' : '');
    }
    el('eventDialogTitle').textContent = record ? 'Редагувати івент' : 'Новий івент';
    el('eventFormNotice').textContent = '';
    el('eventSave').disabled = false;
    el('eventDialog').showModal();
    loadEventStaff(record,++eventStaffRequestId);
  }

  async function save(evt) {
    evt.preventDefault();
    if (busy || !authorized() || !(editingId ? canEdit() : canCreate())) return;
    const form = evt.currentTarget, fd = new FormData(form);
    const get = k => String(fd.get(k) || '').trim();
    const name = get('name'), date = get('event_date');
    if (!name || !date) return;
    const validationPeriods = [
      {name:'Складські роботи',start:'warehouse_start_date',end:'warehouse_end_date'},
      {name:'Монтаж',start:'setup_date',end:'setup_end_date'},
      {name:'Подія',start:'event_date',end:'event_end_date'},
      {name:'Демонтаж',start:'teardown_date',end:'teardown_end_date'},
      {name:'Складські роботи після події',start:'post_warehouse_start_date',end:'post_warehouse_end_date'}
    ];
    const dates = {};
    let previousEnd = null;
    for (const period of validationPeriods) {
      const start = get(period.start), end = get(period.end);
      if (end && !start) { el('eventFormNotice').textContent = `Для періоду «${period.name}» спочатку вкажіть початкову дату.`; return; }
      if (start && end && end < start) { el('eventFormNotice').textContent = `Для періоду «${period.name}» дата завершення раніше початку.`; return; }
      if (start && previousEnd && start < previousEnd) { el('eventFormNotice').textContent = `Період «${period.name}» починається раніше завершення попереднього етапу.`; return; }
      if (start) previousEnd = end || start;
      dates[period.start] = start || null;
      dates[period.end] = end || null;
    }
    const payload = {name, client:get('client'), location:get('location'), ...dates, status:get('status'), notes:get('notes')};
    busy = true; el('eventSave').disabled = true; el('eventFormNotice').textContent = 'Збереження…';
    try {
      const operation = editingId ? db.from('warehouse_events').update(payload).eq('id',editingId) : db.from('warehouse_events').insert({...payload, created_by:session.user.id});
      const {data:saved,error} = await operation.select('id').single();
      if (error) throw error;
      if (eventStaffReady && canEdit()) {
        const selected = [...el('eventAssignedStaff').querySelectorAll('input[type="checkbox"]:checked')].map(input=>input.value);
        const {error:assignmentError} = await db.rpc('warehouse_set_event_staff',{p_event_id:saved.id,p_user_ids:selected});
        if (assignmentError) {
          el('eventFormNotice').textContent = 'Подію збережено, але призначення не оновлено: ' + assignmentError.message;
          await load();
          return;
        }
      }
      el('eventDialog').close();
      busy = false;
      await load();
    } catch(err) {
      el('eventFormNotice').textContent = 'Не вдалося зберегти: ' + (err?.message || String(err));
    } finally {
      busy = false;
      el('eventSave').disabled = false;
    }
  }

  ensureDetailsDialog();
  el('eventAdd').addEventListener('click', () => open());
  el('eventClose').addEventListener('click', () => el('eventDialog').close());
  el('eventCancel').addEventListener('click', () => el('eventDialog').close());
  el('eventDialog').addEventListener('close',()=>{eventStaffRequestId++;eventStaffReady=false;});
  el('eventForm').addEventListener('submit', save);
  ['eventSearch','eventStatusFilter','eventSort'].forEach(id => el(id).addEventListener(id === 'eventSearch' ? 'input' : 'change', render));

  el('eventCards').addEventListener('click', event => {
    const edit = event.target.closest('[data-event-edit]');
    if (edit) {
      event.stopPropagation();
      const record = records.find(x => x.id === edit.dataset.eventEdit);
      if (record) open(record);
      return;
    }
    const openBtn = event.target.closest('[data-event-open]');
    if (openBtn) {
      event.stopPropagation();
      const record = records.find(x => x.id === openBtn.dataset.eventOpen);
      if (record) openDetails(record);
      return;
    }
    const card = event.target.closest('[data-event-card]');
    if (!card) return;
    const record = records.find(x => x.id === card.dataset.eventCard);
    if (record) openDetails(record);
  });

  el('eventCards').addEventListener('keydown', event => {
    if (event.target.closest('button')) return;
    const card = event.target.closest('[data-event-card]');
    if (!card) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      const record = records.find(x => x.id === card.dataset.eventCard);
      if (record) openDetails(record);
    }
  });

  el('eventDetailsClose').addEventListener('click', closeDetails);
  el('eventDetailsDialog').addEventListener('close', () => {
    window.harazdEventEquipment?.unmountInline();
    activeDetailId = null;
  });
  el('eventDetailsBody').addEventListener('click', event => {
    const edit = event.target.closest('[data-event-detail-edit]');
    if (!edit) return;
    const record = records.find(x => x.id === edit.dataset.eventDetailEdit);
    closeDetails();
    if (record) open(record);
  });

  window.harazdEvents = {load};
})();
