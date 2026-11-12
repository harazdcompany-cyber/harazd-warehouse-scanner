/* Vehicles assigned to one event. Driver changes are specific to that event. */
(() => {
  'use strict';
  const safe = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let generation = 0;

  function mount(eventId, host, canEdit) {
    const request = ++generation;
    let vehicles = [], staff = [], assignments = [], staffAvailable = false, busy = false;
    const current = () => request === generation && host.isConnected;
    const vehicleName = vehicle => [vehicle.make, vehicle.model].filter(Boolean).join(' ') || 'Автомобіль';
    const say = text => { const notice = host.querySelector('.event-vehicles-notice'); if (notice) notice.textContent = text; };

    function render() {
      if (!current()) return;
      const assignedIds = new Set(assignments.map(row => String(row.vehicle_id)));
      const available = vehicles.filter(vehicle => !assignedIds.has(String(vehicle.id)));
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
        const driver = canEdit && staffAvailable ? `<label class="event-vehicle-driver-label">Водій<select data-event-vehicle-driver="${safe(v.id)}" aria-label="Водій автомобіля ${safe(vehicleName(v))}" ${busy ? 'disabled' : ''}>${options}</select></label>` : `<div class="event-vehicle-driver">${safe(driverName || 'Водія не призначено')}</div>`;
        return `<div class="event-vehicle-row">${avatar}<div class="event-vehicle-info"><strong>${safe(vehicleName(v))}</strong>${driver}</div>${canEdit ? `<button type="button" class="event-vehicle-remove" data-event-vehicle-remove="${safe(v.id)}" aria-label="Прибрати ${safe(vehicleName(v))} з івенту" ${busy ? 'disabled' : ''}>✕</button>` : ''}</div>`;
      }).join('');
      const picker = canEdit ? `<div class="event-vehicle-picker"><label for="eventVehiclePick">Вибрати автомобіль</label><div class="event-vehicle-picker-actions"><select id="eventVehiclePick" ${!available.length || busy ? 'disabled' : ''}><option value="">${available.length ? 'Оберіть автомобіль' : 'Немає доступних автомобілів'}</option>${available.map(v => `<option value="${safe(v.id)}">${safe(vehicleName(v))}${v.plate ? ` · ${safe(v.plate)}` : ''}</option>`).join('')}</select><button type="button" data-event-vehicle-add ${!available.length || busy ? 'disabled' : ''}>Додати</button></div></div>` : '';
      host.innerHTML = `<div class="event-vehicles-list">${rows || '<p class="event-vehicles-message">Автомобілі ще не додано.</p>'}</div>${picker}<p class="event-vehicles-notice" role="status"></p>`;
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

    host.addEventListener('click', event => {
      const add = event.target.closest('[data-event-vehicle-add]');
      const remove = event.target.closest('[data-event-vehicle-remove]');
      if (add) {
        const id = host.querySelector('#eventVehiclePick')?.value;
        const vehicle = vehicles.find(item => String(item.id) === String(id));
        if (!vehicle) { say('Оберіть автомобіль.'); return; }
        const driverName = String(vehicle.driver || '').trim();
        const person = staff.find(item => String(item.full_name || '').trim() === driverName);
        mutate(() => db.from('warehouse_event_vehicles').insert({event_id:eventId,vehicle_id:vehicle.id,driver_user_id:person?.user_id || null,driver_name:driverName || null}).select('vehicle_id'));
      } else if (remove) {
        const id = remove.dataset.eventVehicleRemove;
        mutate(() => db.from('warehouse_event_vehicles').delete().eq('event_id',eventId).eq('vehicle_id',id).select('vehicle_id'));
      }
    });
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

  window.harazdEventVehicles = {mount, unmount:() => {generation++;}};
})();
