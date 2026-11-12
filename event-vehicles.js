/* Vehicles assigned to one event. Driver changes are specific to that event. */
(() => {
  'use strict';
  const safe = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let generation = 0;
  let editorGeneration = 0, editor = null;

  function mount(eventId, host, canEdit) {
    const request = ++generation;
    let vehicles = [], staff = [], assignments = [], staffAvailable = false, busy = false;
    const current = () => request === generation && host.isConnected;
    const vehicleName = vehicle => [vehicle.make, vehicle.model].filter(Boolean).join(' ') || 'Автомобіль';
    const say = text => { const notice = host.querySelector('.event-vehicles-notice'); if (notice) notice.textContent = text; };

    function render() {
      if (!current()) return;
      const rows = assignments.map(row => {
        const v = vehicles.find(item => String(item.id) === String(row.vehicle_id));
        if (!v) return '<p class="event-vehicles-message">Дані автомобіля недоступні.</p>';
        const photo = /^https?:\/\/[^\s"'<>]+$/i.test(String(v.photo_url || '')) ? v.photo_url : '';
        const avatar = photo ? `<span class="event-vehicle-photo"><img src="${safe(photo)}" alt="" loading="lazy" referrerpolicy="no-referrer"></span>` : '<span class="event-vehicle-photo event-vehicle-photo-empty" aria-hidden="true">▤</span>';
        const id = String(row.driver_user_id || '');
        const found = staff.some(person => String(person.user_id) === id);
        const driverName = String(row.driver_name || '').trim();
        const matching = !id && driverName ? staff.find(person => String(person.full_name || '').trim() === driverName) : null;
        const selected = found ? id : matching ? String(matching.user_id) : driverName ? '__existing__' : '';
        const options = `<option value="">Не призначено</option>` + (selected === '__existing__' ? `<option value="__existing__" selected>${safe(driverName)}</option>` : '') + staff.map(person => `<option value="${safe(person.user_id)}" ${selected === String(person.user_id) ? 'selected' : ''}>${safe(person.full_name)}</option>`).join('');
        const driver = canEdit && staffAvailable ? `<label class="event-vehicle-driver-label"><select data-event-vehicle-driver="${safe(v.id)}" aria-label="Водій автомобіля ${safe(vehicleName(v))}" ${busy ? 'disabled' : ''}>${options}</select></label>` : `<div class="event-vehicle-driver">${safe(driverName || 'Не призначено')}</div>`;
        return `<div class="event-vehicle-row">${avatar}<div class="event-vehicle-info"><strong>${safe(vehicleName(v))}</strong>${driver}</div></div>`;
      }).join('');
      host.innerHTML = `<div class="event-vehicles-list">${rows || '<p class="event-vehicles-message">Автомобілі ще не додано.</p>'}</div><p class="event-vehicles-notice" role="status"></p>`;
      host.querySelectorAll('.event-vehicle-photo img').forEach(img => img.addEventListener('error', () => { const box=img.parentElement; if (box) { box.classList.add('event-vehicle-photo-empty'); box.textContent='▤'; } }, {once:true}));
      if (canEdit && !staffAvailable) say('Не вдалося завантажити список водіїв.');
    }

    async function load() {
      host.textContent = 'Завантаження автомобілів…';
      try {
        const [fleet, eventVehicles, people] = await Promise.all([
          db.from('fleet_vehicles').select('id,make,model,plate,photo_url,driver').order('make'),
          db.from('warehouse_event_vehicles').select('vehicle_id,driver_user_id,driver_name').eq('event_id',eventId),
          canEdit ? Promise.resolve(db.rpc('warehouse_event_assignable_staff')).catch(error => ({error})) : Promise.resolve({data:[]})
        ]);
        if (fleet.error) throw fleet.error;
        if (eventVehicles.error) throw eventVehicles.error;
        if (!current()) return;
        vehicles = fleet.data || []; assignments = eventVehicles.data || [];
        staffAvailable = !people.error; staff = people.error ? [] : (people.data || []);
        render();
      } catch (error) {
        if (!current()) return;
        const missing = error?.code === '42P01' || error?.code === 'PGRST205';
        host.textContent = missing ? 'Потрібно завершити налаштування автомобілів для івентів.' : 'Не вдалося завантажити автомобілі.';
        console.warn('Event vehicles:', error);
      }
    }

    async function mutate(operation) {
      if (!current() || busy || !canEdit) return;
      busy = true;
      host.querySelectorAll('select,button').forEach(control => {control.disabled = true;});
      try {
        const result = await operation();
        if (result.error) throw result.error;
        if (!result.data || !result.data.length) throw Error('Зміни не підтверджено.');
        if (!current()) return;
        busy = false;
        await load();
      } catch (error) {
        if (!current()) return;
        busy = false; render(); say('Не вдалося зберегти зміни. Спробуйте ще раз.');
        console.warn('Event vehicles:', error);
      }
    }

    host.addEventListener('change', event => {
      const control = event.target.closest('[data-event-vehicle-driver]');
      if (!control || !canEdit) return;
      const value = control.value;
      if (value === '__existing__') return;
      const person = staff.find(item => String(item.user_id) === value);
      if (value && !person) { render(); say('Оберіть водія зі списку.'); return; }
      const id = control.dataset.eventVehicleDriver;
      mutate(() => db.from('warehouse_event_vehicles').update({driver_user_id:person?.user_id || null,driver_name:person?.full_name || null}).eq('event_id',eventId).eq('vehicle_id',id).select('vehicle_id'));
    });
    load();
  }

  function mountEditor(eventId, host) {
    const request = ++editorGeneration;
    editor = {request, eventId:eventId || null, host, ready:false, touched:false};
    host.textContent = 'Завантаження автомобілів…';
    Promise.all([
      db.from('fleet_vehicles').select('id,make,model,plate').order('make'),
      eventId ? db.from('warehouse_event_vehicles').select('vehicle_id').eq('event_id',eventId) : Promise.resolve({data:[]})
    ]).then(([fleet, assigned]) => {
      if (fleet.error) throw fleet.error;
      if (assigned.error) throw assigned.error;
      if (!editor || editor.request !== request || !host.isConnected) return;
      const selected = new Set((assigned.data || []).map(item => String(item.vehicle_id)));
      const vehicles = fleet.data || [];
      host.innerHTML = vehicles.length ? vehicles.map(vehicle => `<label class="event-edit-vehicle"><input type="checkbox" value="${safe(vehicle.id)}" ${selected.has(String(vehicle.id)) ? 'checked' : ''}><span>${safe([vehicle.make,vehicle.model].filter(Boolean).join(' '))}${vehicle.plate ? ` · ${safe(vehicle.plate)}` : ''}</span></label>`).join('') : '<p class="event-vehicles-message">Автомобілів не знайдено.</p>';
      editor.ready = true;
    }).catch(error => {
      if (!editor || editor.request !== request || !host.isConnected) return;
      host.textContent = 'Не вдалося завантажити автомобілі. Збереження події доступне без зміни автомобілів.';
      console.warn('Event vehicle editor:', error);
    });
  }

  async function saveEditor(eventId) {
    const state = editor;
    if (!state || !state.ready || !state.touched) return;
    const ids = [...state.host.querySelectorAll('input[type="checkbox"]:checked')].map(input => input.value);
    const result = await db.rpc('warehouse_set_event_vehicles', {p_event_id:eventId,p_vehicle_ids:ids});
    if (result.error) throw result.error;
    if (editor === state) {state.eventId = eventId; state.touched = false;}
  }

  document.addEventListener('change', event => {
    if (editor && editor.ready && editor.host.contains(event.target) && event.target.matches('input[type="checkbox"]')) editor.touched = true;
  });
  window.harazdEventVehicles = {mount, unmount:() => {generation++;}, mountEditor, saveEditor, unmountEditor:() => {editorGeneration++;editor=null;}};
})();
