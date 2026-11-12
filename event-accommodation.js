/* One accommodation record per event, edited alongside the event. */
(() => {
  'use strict';
  const safe = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let detailGeneration = 0, editorGeneration = 0, editor = null;
  const dateText = value => {
    if (!value) return '';
    const date = new Date(String(value).slice(0,10) + 'T12:00:00');
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString('uk-UA');
  };
  const hasData = record => Boolean(record && (record.hotel_name || record.check_in || record.check_out || record.address || record.guest_count != null));

  function fallbackCopy(text, host) {
    const field = document.createElement('textarea');
    field.value = text;
    field.readOnly = true;
    field.tabIndex = -1;
    field.setAttribute('aria-hidden', 'true');
    Object.assign(field.style, {position:'fixed',top:'0',left:'0',width:'1px',height:'1px',opacity:'0'});
    (host.closest('dialog') || document.body).appendChild(field);
    try {
      field.focus({preventScroll:true});
      field.select();
      field.setSelectionRange(0, field.value.length);
      return document.execCommand('copy');
    } catch (_) {
      return false;
    } finally {
      field.remove();
    }
  }

  function mount(eventId, host) {
    const request = ++detailGeneration;
    const current = () => request === detailGeneration && host.isConnected;
    host.textContent = 'Завантаження…';
    Promise.resolve(db.from('warehouse_event_accommodation')
      .select('hotel_name,check_in,check_out,address,guest_count').eq('event_id',eventId).maybeSingle())
      .then(({data,error}) => {
        if (error) throw error;
        if (!current()) return;
        if (!hasData(data)) {host.textContent = 'Інформацію ще не додано.';return;}
        const start = dateText(data.check_in), end = dateText(data.check_out);
        const stay = start || end ? (start || '—') + ' – ' + (end || '—') : '—';
        host.innerHTML = `<div class="event-accommodation-grid">
          <div><small>Назва готелю</small><strong>${safe(data.hotel_name || '—')}</strong></div>
          <div><small>Термін проживання</small><strong>${safe(stay)}</strong></div>
          <div><small>Адреса помешкання</small><div class="event-accommodation-address"><strong>${safe(data.address || '—')}</strong>${data.address ? '<button type="button" class="event-accommodation-copy" data-accommodation-copy aria-label="Скопіювати адресу" title="Скопіювати адресу"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="11" height="11" rx="2"></rect><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"></path></svg></button>' : ''}</div><span class="event-accommodation-copy-status" role="status" aria-live="polite"></span></div>
          <div><small>Кількість осіб</small><strong>${data.guest_count == null ? '—' : safe(data.guest_count)}</strong></div>
        </div>`;
        const copy = host.querySelector('[data-accommodation-copy]');
        if (copy) copy.addEventListener('click', async () => {
          let copied = false;
          try {
            if (navigator.clipboard?.writeText) {
              await navigator.clipboard.writeText(String(data.address));
              copied = true;
            }
          } catch (_) { /* Fall back to selection-based copy. */ }
          if (!copied) copied = fallbackCopy(String(data.address), host);
          if (current()) {
            const status = host.querySelector('.event-accommodation-copy-status');
            if (status) status.textContent = copied ? 'Адресу скопійовано' : 'Не вдалося скопіювати адресу';
          }
        });
      }).catch(error => {
        if (!current()) return;
        host.textContent = error?.code === '42P01' || error?.code === 'PGRST205'
          ? 'Потрібно завершити налаштування проживання для івентів.'
          : 'Не вдалося завантажити інформацію про проживання.';
        console.warn('Event accommodation:', error);
      });
  }

  function mountEditor(eventId, host) {
    const request = ++editorGeneration;
    editor = {request,host,ready:false,touched:false};
    host.textContent = 'Завантаження…';
    const query = eventId
      ? db.from('warehouse_event_accommodation').select('hotel_name,check_in,check_out,address,guest_count').eq('event_id',eventId).maybeSingle()
      : db.from('warehouse_event_accommodation').select('event_id').limit(1);
    Promise.resolve(query).then(({data,error}) => {
      if (error) throw error;
      if (!editor || editor.request !== request || !host.isConnected) return;
      const row = eventId ? (data || {}) : {};
      host.innerHTML = `<div class="event-accommodation-editor-fields">
        <label>Назва готелю<input data-accommodation="hotel_name" type="text" maxlength="200" value="${safe(row.hotel_name || '')}" placeholder="Назва готелю"></label>
        <label>Проживання з<input data-accommodation="check_in" type="date" value="${safe(row.check_in || '')}"></label>
        <label>Проживання до<input data-accommodation="check_out" type="date" value="${safe(row.check_out || '')}"></label>
        <label>Адреса помешкання<input data-accommodation="address" type="text" maxlength="500" value="${safe(row.address || '')}" placeholder="Адреса"></label>
        <label>Кількість осіб на розміщення<input data-accommodation="guest_count" type="number" min="0" max="9999" step="1" inputmode="numeric" value="${row.guest_count == null ? '' : safe(row.guest_count)}" placeholder="Кількість осіб"></label>
      </div>`;
      editor.ready = true;
    }).catch(error => {
      if (!editor || editor.request !== request || !host.isConnected) return;
      host.textContent = 'Не вдалося завантажити проживання. Подію можна зберегти без зміни цих даних.';
      console.warn('Event accommodation editor:', error);
    });
  }

  function editorValues(state) {
    const value = key => String(state.host.querySelector('[data-accommodation="' + key + '"]')?.value || '').trim();
    return {hotel_name:value('hotel_name'), check_in:value('check_in') || null,
      check_out:value('check_out') || null, address:value('address'), guest_count:value('guest_count')};
  }

  function validateEditor() {
    const state = editor;
    if (!state || !state.ready || !state.touched) return '';
    const v = editorValues(state);
    if (v.check_in && v.check_out && v.check_out < v.check_in) return 'Дата завершення проживання раніше дати початку.';
    if (v.guest_count !== '' && (!/^\d+$/.test(v.guest_count) || Number(v.guest_count) > 9999)) return 'Вкажіть кількість осіб від 0 до 9999.';
    return '';
  }

  async function saveEditor(eventId) {
    const state = editor;
    if (!state || !state.ready || !state.touched) return;
    const message = validateEditor();
    if (message) throw Error(message);
    const v = editorValues(state);
    const result = await db.rpc('warehouse_set_event_accommodation', {
      p_event_id:eventId, p_hotel_name:v.hotel_name, p_check_in:v.check_in, p_check_out:v.check_out,
      p_address:v.address, p_guest_count:v.guest_count === '' ? null : Number(v.guest_count)
    });
    if (result.error) throw result.error;
    if (editor === state) state.touched = false;
  }

  document.addEventListener('input', event => {
    if (editor?.ready && editor.host.contains(event.target) && event.target.matches('[data-accommodation]')) editor.touched = true;
  });
  document.addEventListener('change', event => {
    if (editor?.ready && editor.host.contains(event.target) && event.target.matches('[data-accommodation]')) editor.touched = true;
  });
  window.harazdEventAccommodation = {
    mount, unmount:() => {detailGeneration++;}, mountEditor, validateEditor, saveEditor,
    unmountEditor:() => {editorGeneration++;editor=null;}
  };
})();
