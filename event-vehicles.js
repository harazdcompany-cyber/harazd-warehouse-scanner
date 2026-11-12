/* Event vehicles and their event-specific drivers. */
(() => {
  'use strict';
  const safe = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let generation = 0, editorGeneration = 0, editor = null;
  const vehicleName = vehicle => [vehicle.make, vehicle.model].filter(Boolean).join(' ') || 'Автомобіль';

  function mount(eventId, host) {
    const request = ++generation;
    const current = () => request === generation && host.isConnected;
    host.textContent = 'Завантаження автомобілів…';
    Promise.all([
      db.from('fleet_vehicles').select('id,make,model,photo_url').order('make'),
      db.from('warehouse_event_vehicles').select('vehicle_id,driver_user_id,driver_name').eq('event_id', eventId)
    ]).then(([fleet, assigned]) => {
      if (fleet.error) throw fleet.error;
      if (assigned.error) throw assigned.error;
      if (!current()) return;
      const vehicles = fleet.data || [];
      const rows = (assigned.data || []).map(row => {
        const v = vehicles.find(item => String(item.id) === String(row.vehicle_id));
        if (!v) return '<p class="event-vehicles-message">Дані автомобіля недоступні.</p>';
        const photo = /^https?:\/\/[^\s"'<>]+$/i.test(String(v.photo_url || '')) ? v.photo_url : '';
        const avatar = photo ? `<span class="event-vehicle-photo"><img src="${safe(photo)}" alt="" loading="lazy" referrerpolicy="no-referrer"></span>` : '<span class="event-vehicle-photo event-vehicle-photo-empty" aria-hidden="true">▤</span>';
        return `<div class="event-vehicle-row">${avatar}<div class="event-vehicle-info"><strong>${safe(vehicleName(v))}</strong><small>${safe(row.driver_name || 'Не призначено')}</small></div></div>`;
      }).join('');
      host.innerHTML = `<div class="event-vehicles-list">${rows || '<p class="event-vehicles-message">Автомобілі ще не додано.</p>'}</div>`;
      host.querySelectorAll('.event-vehicle-photo img').forEach(img => img.addEventListener('error', () => {
        const box = img.parentElement;
        if (box) { box.classList.add('event-vehicle-photo-empty'); box.textContent = '▤'; }
      }, {once:true}));
    }).catch(error => {
      if (!current()) return;
      const missing = error?.code === '42P01' || error?.code === 'PGRST205';
      host.textContent = missing ? 'Потрібно завершити налаштування автомобілів для івентів.' : 'Не вдалося завантажити автомобілі.';
      console.warn('Event vehicles:', error);
    });
  }

  function mountEditor(eventId, host) {
    const request = ++editorGeneration;
    editor = {request, eventId:eventId || null, host, ready:false, touched:false, vehicles:[], assigned:[], staff:[], staffAvailable:false};
    host.textContent = 'Завантаження автомобілів…';
    Promise.all([
      db.from('fleet_vehicles').select('id,make,model,plate,driver').order('make'),
      eventId ? db.from('warehouse_event_vehicles').select('vehicle_id,driver_user_id,driver_name').eq('event_id', eventId) : Promise.resolve({data:[]}),
      Promise.resolve(db.rpc('warehouse_event_assignable_staff')).catch(error => ({error}))
    ]).then(([fleet, assigned, people]) => {
      if (fleet.error) throw fleet.error;
      if (assigned.error) throw assigned.error;
      if (!editor || editor.request !== request || !host.isConnected) return;
      editor.vehicles = fleet.data || [];
      editor.assigned = assigned.data || [];
      editor.staff = people.error ? [] : (people.data || []);
      editor.staffAvailable = !people.error;
      const byVehicle = new Map(editor.assigned.map(row => [String(row.vehicle_id), row]));
      host.innerHTML = editor.vehicles.length ? editor.vehicles.map(vehicle => {
        const existing = byVehicle.get(String(vehicle.id));
        const driverName = String(existing ? (existing.driver_name || '') : (vehicle.driver || '')).trim();
        const driverId = existing?.driver_user_id ? String(existing.driver_user_id) : '';
        const match = editor.staff.find(person => driverId ? String(person.user_id) === driverId : String(person.full_name || '').trim() === driverName && driverName);
        const selected = match ? String(match.user_id) : (driverName || driverId ? '__existing__' : '');
        const options = '<option value="">Не призначено</option>' +
          (selected === '__existing__' ? `<option value="__existing__" selected>${safe(driverName || 'Недоступний працівник')}</option>` : '') +
          editor.staff.map(person => `<option value="${safe(person.user_id)}" ${selected === String(person.user_id) ? 'selected' : ''}>${safe(person.full_name)}</option>`).join('');
        return `<div class="event-edit-vehicle"><label class="event-edit-vehicle-choice"><input type="checkbox" value="${safe(vehicle.id)}" ${existing ? 'checked' : ''}><span>${safe(vehicleName(vehicle))}${vehicle.plate ? ` · ${safe(vehicle.plate)}` : ''}</span></label><label class="event-edit-vehicle-driver">Водій<select data-event-edit-driver aria-label="Водій автомобіля ${safe(vehicleName(vehicle))}" ${!existing || !editor.staffAvailable ? 'disabled' : ''}>${options}</select></label></div>`;
      }).join('') : '<p class="event-vehicles-message">Автомобілів не знайдено.</p>';
      if (!editor.staffAvailable) host.insertAdjacentHTML('beforeend', '<p class="event-vehicles-message">Список водіїв недоступний; наявні призначення збережуться.</p>');
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
    const existing = new Map(state.assigned.map(row => [String(row.vehicle_id), row]));
    const assignments = [...state.host.querySelectorAll('.event-edit-vehicle')].flatMap(row => {
      const checkbox = row.querySelector('input[type="checkbox"]');
      if (!checkbox?.checked) return [];
      const vehicle = state.vehicles.find(item => String(item.id) === checkbox.value);
      const previous = existing.get(checkbox.value);
      const select = row.querySelector('[data-event-edit-driver]');
      const chosen = select?.value || '';
      const person = state.staff.find(item => String(item.user_id) === chosen);
      const keepExisting = !state.staffAvailable || chosen === '__existing__';
      return [{
        vehicle_id:checkbox.value,
        driver_user_id:keepExisting ? (previous?.driver_user_id || null) : (person?.user_id || null),
        driver_name:keepExisting ? (previous ? previous.driver_name : vehicle?.driver || null) : (person?.full_name || null)
      }];
    });
    const result = await db.rpc('warehouse_set_event_vehicles_with_drivers', {p_event_id:eventId, p_vehicles:assignments});
    if (result.error) throw result.error;
    if (editor === state) {state.eventId = eventId; state.assigned = assignments; state.touched = false;}
  }

  document.addEventListener('change', event => {
    if (!editor || !editor.ready || !editor.host.contains(event.target)) return;
    const row = event.target.closest('.event-edit-vehicle');
    if (!row) return;
    if (event.target.matches('input[type="checkbox"]')) {
      const select = row.querySelector('[data-event-edit-driver]');
      if (select) select.disabled = !event.target.checked || !editor.staffAvailable;
      editor.touched = true;
    } else if (event.target.matches('[data-event-edit-driver]')) {
      editor.touched = true;
    }
  });
  window.harazdEventVehicles = {mount, unmount:() => {generation++;}, mountEditor, saveEditor, unmountEditor:() => {editorGeneration++;editor=null;}};
})();
