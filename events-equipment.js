"use strict";
(() => {
  const $ = id => document.getElementById(id);
  const dialog = $('eventEquipmentDialog');
  if (!dialog) return;

  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const canEdit = () => typeof staffAllowed === 'function' && staffAllowed('events_edit');
  const authorized = () => typeof session !== 'undefined' && !!session?.user?.id;
  const methodDialog = $('eventAddMethodDialog');
  const scannerDialog = $('eventQrScanDialog');

  const notice = msg => { $('eventEquipmentNotice').textContent = msg || ''; };
  const methodNotice = text => { $('eventMethodNotice').textContent = text || ''; };

  let eventId = null;
  let inventory = [];
  let plan = [];
  let refs = {categories:[], subcategories:[], warehouses:[]};
  let loading = false;
  let requestKey = 0;
  let qrScanner = null;
  let qrStopping = false;
  let qrProcessing = false;
  let methodBusy = false;
  let pickerView = localStorage.getItem('harazd-event-picker-view') === 'table' ? 'table' : 'cards';
  let renderedGroups = [];

  function normalizeEqId(code) {
    const raw = String(code || '').trim();
    const normalized = raw.match(/EQ-\d+/i);
    return (normalized ? normalized[0] : raw).toUpperCase();
  }
  function findByEqId(code) {
    const eq = normalizeEqId(code);
    return inventory.find(item => String(item.eq_id || '').trim().toUpperCase() === eq);
  }
  function lookupName(list, id, fallback = '—') {
    return list.find(item => item.id === id)?.name || fallback;
  }
  function availableCount(item) {
    const qty = Number(item?.quantity || 0);
    const repair = Number(item?.repair_quantity || 0);
    return Math.max(0, qty - repair);
  }
  function planQuantity(equipmentId) {
    return plan.filter(row => row.equipment_id === equipmentId).reduce((sum, row) => sum + (Number(row.quantity) || 0), 0);
  }
  function statusInfo(item) {
    const qty = Number(item?.quantity || 0);
    const repair = Number(item?.repair_quantity || 0);
    if (qty <= 0 || repair >= qty) return {cls:'repair', label:'На ремонті'};
    if (repair > 0) return {cls:'partial', label:'Частково доступно'};
    return {cls:'available', label:'Доступно'};
  }
  function photoMarkup(item) {
    const url = String(item?.photo_url || '');
    return /^https:\/\/[^\s"'<>]+$/i.test(url)
      ? `<img src="${escapeHtml(url)}" alt="${escapeHtml(item?.name || 'Обладнання')}" loading="lazy" referrerpolicy="no-referrer">`
      : '<span class="event-picker-photo-empty" aria-hidden="true">◇</span>';
  }
  function locationMarkup(item) {
    const rows = [
      ['Склад', lookupName(refs.warehouses, item?.warehouse_id, 'Не вказано')],
      ['Зона', item?.zone || '—'],
      ['Стелаж', item?.rack || '—'],
      ['Полиця', item?.shelf || '—']
    ];
    return rows.map(([label, value]) => `<div><span>${escapeHtml(label)}:</span><b>${escapeHtml(value)}</b></div>`).join('');
  }
  function locationText(item) {
    return [lookupName(refs.warehouses, item?.warehouse_id, 'Не вказано'), item?.zone, item?.rack, item?.shelf].filter(Boolean).join(' / ') || 'Не вказано';
  }
  function searchFields(item) {
    return [
      item?.name,
      item?.eq_id,
      item?.model,
      item?.description,
      lookupName(refs.categories, item?.category_id, ''),
      lookupName(refs.subcategories, item?.subcategory_id, ''),
      lookupName(refs.warehouses, item?.warehouse_id, '')
    ].map(v => String(v || '').toLocaleLowerCase('uk-UA'));
  }

function groupedLabel(values, emptyLabel = '—', mixedLabel = 'Кілька') {
  const unique = [...new Set(values.map(value => String(value || '').trim()).filter(Boolean))];
  if (!unique.length) return emptyLabel;
  return unique.length === 1 ? unique[0] : mixedLabel;
}
function groupEqLabel(group) {
  if (!group) return 'Без EQ-ID';
  if (group.members?.length === 1) return group.members[0]?.eq_id || 'Без EQ-ID';
  return `Група · ${group.members?.length || 0} EQ-ID`;
}
function buildGroups(items) {
  const map = new Map();
  items.forEach(item => {
    const key = [
      item?.name || '',
      item?.model || '',
      item?.manufacturer || '',
      item?.description || '',
      item?.photo_url || '',
      item?.category_id || '',
      item?.subcategory_id || '',
      (item?.accounting_type || '').toLowerCase()
    ].join('||');
    let group = map.get(key);
    if (!group) {
      group = {
        id: key,
        name: item?.name || 'Обладнання',
        model: item?.model || '',
        manufacturer: item?.manufacturer || '',
        description: item?.description || '',
        photo_url: item?.photo_url || '',
        category_id: item?.category_id || '',
        subcategory_id: item?.subcategory_id || '',
        accounting_type: item?.accounting_type || '',
        members: [],
        warehouses: [],
        zones: [],
        racks: [],
        shelves: [],
        quantity: 0,
        repair_quantity: 0,
        inPlan: 0
      };
      map.set(key, group);
    }
    group.members.push(item);
    group.warehouses.push(lookupName(refs.warehouses, item?.warehouse_id, 'Не вказано'));
    group.zones.push(item?.zone || '');
    group.racks.push(item?.rack || '');
    group.shelves.push(item?.shelf || '');
    group.quantity += Number(item?.quantity || 0);
    group.repair_quantity += Number(item?.repair_quantity || 0);
    group.inPlan += planQuantity(item?.id);
  });
  return [...map.values()].map(group => ({
    ...group,
    warehouse_label: groupedLabel(group.warehouses, 'Не вказано', 'Різні склади'),
    zone_label: groupedLabel(group.zones, '—', 'Кілька'),
    rack_label: groupedLabel(group.racks, '—', 'Кілька'),
    shelf_label: groupedLabel(group.shelves, '—', 'Кілька')
  }));
}
function groupSearchFields(group) {
  return [
    group?.name,
    group?.model,
    group?.manufacturer,
    group?.description,
    lookupName(refs.categories, group?.category_id, ''),
    lookupName(refs.subcategories, group?.subcategory_id, ''),
    ...(group?.members || []).map(item => item?.eq_id),
    ...new Set(group?.warehouses || [])
  ].map(v => String(v || '').toLocaleLowerCase('uk-UA'));
}
function groupLocationMarkup(group) {
  const rows = [
    ['Склад', group?.warehouse_label || 'Не вказано'],
    ['Зона', group?.zone_label || '—'],
    ['Стелаж', group?.rack_label || '—'],
    ['Полиця', group?.shelf_label || '—']
  ];
  return rows.map(([label, value]) => `<div><span>${escapeHtml(label)}:</span><b>${escapeHtml(value)}</b></div>`).join('');
}
function groupLocationText(group) {
  return [group?.warehouse_label, group?.zone_label, group?.rack_label, group?.shelf_label].filter(Boolean).join(' / ') || 'Не вказано';
}
  function compareItems(a, b, sort) {
    const nameA = String(a?.name || '').localeCompare(String(b?.name || ''), 'uk');
    if (sort === 'qty') return Number(b?.quantity || 0) - Number(a?.quantity || 0) || nameA;
    if (sort === 'availability') return availableCount(b) - availableCount(a) || nameA;
    if (sort === 'model') return String(a?.model || '').localeCompare(String(b?.model || ''), 'uk') || nameA;
    if (sort === 'subcategory') {
      const sub = lookupName(refs.subcategories, a?.subcategory_id, '').localeCompare(lookupName(refs.subcategories, b?.subcategory_id, ''), 'uk');
      if (sub) return sub;
      const cat = lookupName(refs.categories, a?.category_id, '').localeCompare(lookupName(refs.categories, b?.category_id, ''), 'uk');
      if (cat) return cat;
      return nameA;
    }
    return nameA;
  }
  function fillSelect(select, rows, placeholder, value = '') {
    if (!select) return;
    const previous = value || select.value || '';
    select.replaceChildren(new Option(placeholder, ''), ...rows.map(row => new Option(row.name, row.id)));
    if (previous && rows.some(row => row.id === previous)) select.value = previous;
  }
  function updatePickerHeader() {
    const title = ($('eventDetailsTitle')?.textContent || '').trim();
    $('eventPickerContext').textContent = title
      ? `Вибір обладнання для листа погрузки івенту «${title}». Натисніть на позицію або кнопку «Додати».`
      : 'Вибір обладнання для листа погрузки цього івенту. Натисніть на позицію або кнопку «Додати».';
  }
  function updateViewState() {
    $('eventEquipmentCandidates').classList.toggle('hidden', pickerView === 'table');
    $('eventEquipmentTableWrap').classList.toggle('hidden', pickerView !== 'table');
    $('eventEquipmentViewCards').setAttribute('aria-pressed', String(pickerView === 'cards'));
    $('eventEquipmentViewTable').setAttribute('aria-pressed', String(pickerView === 'table'));
  }

function render() {
  const categoryValue = $('eventEquipmentCategory').value;
  fillSelect($('eventEquipmentCategory'), refs.categories, 'Усі категорії', categoryValue);
  const subcategoryRows = refs.subcategories.filter(row => !categoryValue || row.category_id === categoryValue);
  fillSelect($('eventEquipmentSubcategory'), subcategoryRows, 'Усі підкатегорії', $('eventEquipmentSubcategory').value);
  fillSelect($('eventEquipmentWarehouse'), refs.warehouses, 'Усі склади', $('eventEquipmentWarehouse').value);

  const q = $('eventEquipmentSearch').value.trim().toLocaleLowerCase('uk-UA');
  const category = $('eventEquipmentCategory').value;
  const subcategory = $('eventEquipmentSubcategory').value;
  const warehouse = $('eventEquipmentWarehouse').value;
  const sort = $('eventEquipmentSort').value || 'subcategory';

  const baseItems = inventory
    .filter(item => (!category || item.category_id === category) && (!subcategory || item.subcategory_id === subcategory) && (!warehouse || item.warehouse_id === warehouse));

  renderedGroups = buildGroups(baseItems)
    .filter(group => !q || groupSearchFields(group).some(value => value.includes(q)))
    .sort((a, b) => compareItems(a, b, sort));

  const totalPlanItems = plan.length;
  const totalPlanUnits = plan.reduce((sum, row) => sum + (Number(row.quantity) || 0), 0);
  $('eventEquipmentSummary').innerHTML = `<strong>${renderedGroups.length}</strong><span>${renderedGroups.length === 1 ? 'позиція' : 'позицій'}</span>`;
  $('eventEquipmentPlanSummary').textContent = `Лист погрузки: ${totalPlanItems} позицій · ${totalPlanUnits} од.`;

  const cards = renderedGroups.map(group => {
    const status = statusInfo(group);
    const available = availableCount(group);
    const total = Number(group.quantity || 0);
    const percent = total > 0 ? Math.max(0, Math.min(100, Math.round((available / total) * 100))) : 0;
    const categoryName = lookupName(refs.categories, group.category_id, 'Без категорії');
    const description = group.description || [group.manufacturer, group.model].filter(Boolean).join(' · ') || 'Опис не вказано';
    return `<article class="event-picker-card">
      <div class="event-picker-photo">${photoMarkup(group)}<span class="event-picker-photo-badge">${escapeHtml(categoryName)}</span></div>
      <div class="event-picker-body">
        <div class="event-picker-top"><span class="event-picker-id">${escapeHtml(groupEqLabel(group))}</span><span class="event-picker-status ${status.cls}">${escapeHtml(status.label)}</span></div>
        <h3>${escapeHtml(group.name || 'Обладнання')}</h3>
        <p class="event-picker-description">${escapeHtml(description)}</p>
        <div class="event-picker-info">
          <div class="event-picker-location">${groupLocationMarkup(group)}</div>
          <div class="event-picker-stock">
            <div class="event-picker-stock-head"><div><small>Доступно</small><strong>${available} <em>/ ${total}</em></strong></div><span>${percent}%</span></div>
            <div class="event-picker-progress"><i style="width:${percent}%"></i></div>
          </div>
        </div>
        <div class="event-picker-foot">
          <div>
            <small>${escapeHtml(lookupName(refs.subcategories, group.subcategory_id, 'Без підкатегорії'))}</small>
            ${group.members.length > 1 ? `<span class="event-picker-note">Згруповано: ${group.members.length} EQ-ID</span>` : ''}
            ${group.inPlan ? `<span class="event-picker-note">У листі погрузки: ${group.inPlan} од.</span>` : ''}
          </div>
          ${canEdit() ? `<button type="button" class="primary" data-equip-group="${escapeHtml(group.id)}">${group.inPlan ? 'Додати ще' : 'Додати'}</button>` : ''}
        </div>
      </div>
    </article>`;
  }).join('');

  $('eventEquipmentCandidates').innerHTML = cards || '<div class="event-picker-empty">Обладнання не знайдено. Змініть запит або фільтри.</div>';

  const rows = renderedGroups.map(group => {
    const available = availableCount(group);
    return `<tr>
      <td><strong>${escapeHtml(group.name || 'Обладнання')}</strong><small>${escapeHtml(group.model || group.description || '')}</small></td>
      <td class="event-picker-cell-id">${escapeHtml(groupEqLabel(group))}</td>
      <td>${escapeHtml(lookupName(refs.categories, group.category_id, '—'))}<small>${escapeHtml(lookupName(refs.subcategories, group.subcategory_id, '—'))}</small></td>
      <td>${escapeHtml(groupLocationText(group))}</td>
      <td class="event-picker-cell-qty">${available} / ${Number(group.quantity || 0)}${group.inPlan ? `<small>У листі: ${group.inPlan}</small>` : ''}</td>
      <td class="event-picker-cell-action">${canEdit() ? `<button type="button" class="primary" data-equip-group="${escapeHtml(group.id)}">${group.inPlan ? 'Додати ще' : 'Додати'}</button>` : '—'}</td>
    </tr>`;
  }).join('');
  $('eventEquipmentRows').innerHTML = rows || '<tr><td colspan="6" class="event-picker-empty-row">Обладнання не знайдено.</td></tr>';
  updateViewState();
}

async function loadInventory() {
    let rows = [];
    let from = 0;
    while (true) {
      const {data, error} = await db.from('equipment')
        .select('id,eq_id,name,model,description,quantity,repair_quantity,photo_url,category_id,subcategory_id,warehouse_id,zone,rack,shelf')
        .order('name')
        .range(from, from + 999);
      if (error) throw error;
      rows.push(...(data || []));
      if (!data || data.length < 1000) break;
      from += 1000;
      if (from >= 10000) break;
    }
    inventory = rows;
  }
  async function loadPlan() {
    const {data, error} = await db.from('warehouse_event_equipment')
      .select('id,event_id,equipment_id,quantity,equipment:equipment_id(name,eq_id,model,photo_url)')
      .eq('event_id', eventId)
      .order('created_at');
    if (error) throw error;
    plan = data || [];
  }
  async function loadReferences() {
    const [categoriesResp, subcategoriesResp, warehousesResp] = await Promise.all([
      db.from('categories').select('id,name').order('name'),
      db.from('subcategories').select('id,name,category_id').order('name'),
      db.from('warehouses').select('id,name').order('name')
    ]);
    if (categoriesResp.error) throw categoriesResp.error;
    if (subcategoriesResp.error) throw subcategoriesResp.error;
    if (warehousesResp.error) throw warehousesResp.error;
    refs = {
      categories: categoriesResp.data || [],
      subcategories: subcategoriesResp.data || [],
      warehouses: warehousesResp.data || []
    };
  }
  async function preload(force = false) {
    const tasks = [];
    if (force || !inventory.length) tasks.push(loadInventory());
    else tasks.push(Promise.resolve());
    tasks.push(loadPlan());
    if (force || !refs.categories.length) tasks.push(loadReferences());
    else tasks.push(Promise.resolve());
    await Promise.all(tasks);
  }

  async function stopScanner() {
    if (!qrScanner || qrStopping) return;
    qrStopping = true;
    const scanner = qrScanner;
    qrScanner = null;
    try { await scanner.stop(); } catch (_) {}
    try { scanner.clear(); } catch (_) {}
    qrStopping = false;
  }
  async function selectEquipment(item, source = 'warehouse') {
    if (!item || !authorized() || !canEdit() || !eventId || loading || methodBusy) return false;
    const existing = plan.find(row => row.equipment_id === item.id);
    const input = prompt(`${item.name} · ${item.eq_id || 'Без EQ-ID'}\n${existing ? 'У листі погрузки: ' + existing.quantity + ' шт.\n' : ''}Вкажіть кількість для додавання:`, '1');
    if (input === null) return false;
    const quantity = Number(input);
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 999999 || (existing && Number(existing.quantity) + quantity > 999999)) {
      const message = 'Вкажіть коректну кількість від 1 до 999999.';
      if (source === 'manual') methodNotice(message); else notice(message);
      return false;
    }
    methodBusy = true;
    const capturedEvent = eventId;
    const oldRow = existing;
    try {
      const query = oldRow
        ? db.from('warehouse_event_equipment').update({quantity:Number(oldRow.quantity) + quantity}).eq('event_id', capturedEvent).eq('equipment_id', item.id)
        : db.from('warehouse_event_equipment').insert({event_id:capturedEvent, equipment_id:item.id, quantity});
      const {error} = await query;
      if (error) throw error;
      if (capturedEvent !== eventId) return true;
      await loadPlan();
      render();
      if (inlineState && inlineState.id === capturedEvent && inlineState.host?.isConnected) {
        inlineState.plan = [...plan];
        renderInline();
      }
      notice('Обладнання додано до листа погрузки');
      if (methodDialog.open) methodDialog.close();
      return true;
    } catch (error) {
      const message = 'Не вдалося додати: ' + (error?.message || String(error));
      if (source === 'manual') methodNotice(message); else notice(message);
      return false;
    } finally {
      methodBusy = false;
    }
  }

  async function selectEquipmentGroup(group, source = 'warehouse') {
    if (!group?.members?.length || !authorized() || !canEdit() || !eventId || loading || methodBusy) return false;
    const current = group.members.reduce((sum, item) => sum + planQuantity(item.id), 0);
    const available = group.members.reduce((sum, item) => sum + availableCount(item), 0);
    const input = prompt(`${group.name || 'Обладнання'}\n${group.members.length > 1 ? 'Згруповано позицій: ' + group.members.length + '\n' : ''}${current ? 'У листі погрузки: ' + current + ' шт.\n' : ''}Доступно для вибору: ${available} шт.\nВкажіть кількість для додавання:`, '1');
    if (input === null) return false;
    const quantity = Number(input);
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 999999) {
      const message = 'Вкажіть коректну кількість від 1 до 999999.';
      if (source === 'manual') methodNotice(message); else notice(message);
      return false;
    }
    const members = [...group.members].sort((a, b) => availableCount(b) - availableCount(a) || String(a.eq_id || '').localeCompare(String(b.eq_id || ''), 'uk'));
    const assignments = [];
    let remaining = quantity;
    for (const item of members) {
      if (remaining <= 0) break;
      const free = Math.max(0, availableCount(item));
      if (!free) continue;
      const take = Math.min(free, remaining);
      assignments.push({item, quantity: take});
      remaining -= take;
    }
    if (!assignments.length || remaining > 0) {
      const message = `Недостатньо доступного обладнання. Можна додати максимум ${available} шт.`;
      if (source === 'manual') methodNotice(message); else notice(message);
      return false;
    }
    methodBusy = true;
    const capturedEvent = eventId;
    try {
      for (const entry of assignments) {
        const oldRow = plan.find(row => row.equipment_id === entry.item.id);
        const query = oldRow
          ? db.from('warehouse_event_equipment').update({quantity:Number(oldRow.quantity) + entry.quantity}).eq('event_id', capturedEvent).eq('equipment_id', entry.item.id)
          : db.from('warehouse_event_equipment').insert({event_id:capturedEvent, equipment_id:entry.item.id, quantity:entry.quantity});
        const {error} = await query;
        if (error) throw error;
      }
      if (capturedEvent !== eventId) return true;
      await loadPlan();
      render();
      if (inlineState && inlineState.id === capturedEvent && inlineState.host?.isConnected) {
        inlineState.plan = [...plan];
        renderInline();
      }
      notice('Обладнання додано до листа погрузки');
      if (methodDialog.open) methodDialog.close();
      return true;
    } catch (error) {
      const message = 'Не вдалося додати: ' + (error?.message || String(error));
      if (source === 'manual') methodNotice(message); else notice(message);
      return false;
    } finally {
      methodBusy = false;
    }
  }
  function showMethod() {
    if (!canEdit() || !eventId || !authorized()) return;
    methodNotice('');
    $('eventManualEq').value = '';
    $('eventManualPanel').hidden = true;
    if (!methodDialog.open) methodDialog.showModal();
  }
  async function startScanner() {
    methodDialog.close();
    $('eventQrNotice').textContent = 'Наведіть камеру на QR-код обладнання.';
    scannerDialog.showModal();
    if (typeof Html5Qrcode === 'undefined') {
      $('eventQrNotice').textContent = 'Бібліотека сканування не завантажена.';
      return;
    }
    try {
      qrScanner = new Html5Qrcode('eventQrReader');
      qrProcessing = false;
      await qrScanner.start({facingMode:'environment'}, {fps:10, qrbox:230}, async code => {
        if (qrProcessing) return;
        const item = findByEqId(code);
        if (!item) {
          $('eventQrNotice').textContent = 'EQ-ID не знайдено. Спробуйте інший QR-код.';
          return;
        }
        qrProcessing = true;
        await stopScanner();
        if (scannerDialog.open) scannerDialog.close();
        try { await selectEquipment(item, 'scan'); } finally { qrProcessing = false; }
      }, () => {});
    } catch (error) {
      $('eventQrNotice').textContent = 'Не вдалося запустити камеру: ' + (error?.message || error);
    }
  }

  $('eventMethodClose').addEventListener('click', () => methodDialog.close());
  $('eventMethodManual').addEventListener('click', () => { $('eventManualPanel').hidden = false; $('eventManualEq').focus(); });
  $('eventMethodWarehouse').addEventListener('click', () => {
    methodDialog.close();
    updatePickerHeader();
    notice('');
    dialog.showModal();
    $('eventEquipmentSearch').focus({preventScroll:true});
    render();
  });
  $('eventMethodScan').addEventListener('click', startScanner);
  $('eventManualConfirm').addEventListener('click', async () => {
    const item = findByEqId($('eventManualEq').value);
    if (!item) { methodNotice('EQ-ID не знайдено на складі.'); return; }
    await selectEquipment(item, 'manual');
  });
  $('eventManualEq').addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      $('eventManualConfirm').click();
    }
  });
  $('eventScanClose').addEventListener('click', () => scannerDialog.close());
  scannerDialog.addEventListener('close', stopScanner);

  async function open(id) {
    if (!authorized() || !canEdit() || !id) return;
    const switching = eventId !== id;
    eventId = id;
    const key = ++requestKey;
    updatePickerHeader();
    $('eventEquipmentSearch').value = '';
    $('eventEquipmentCategory').value = '';
    $('eventEquipmentSubcategory').value = '';
    $('eventEquipmentWarehouse').value = '';
    $('eventEquipmentSort').value = 'subcategory';
    if (switching) {
      plan = [];
      if (!inventory.length) refs = {categories:[], subcategories:[], warehouses:[]};
    }
    showMethod();
    methodNotice('Завантаження складу…');
    notice('');
    try {
      await preload(switching || !inventory.length || !refs.categories.length);
      if (key !== requestKey) return;
      methodNotice('');
      render();
    } catch (error) {
      if (key === requestKey) methodNotice('Не вдалося завантажити: ' + (error?.message || error));
    }
  }

  $('eventEquipmentSearch').addEventListener('input', render);
  $('eventEquipmentCategory').addEventListener('change', () => {
    $('eventEquipmentSubcategory').value = '';
    render();
  });
  $('eventEquipmentSubcategory').addEventListener('change', render);
  $('eventEquipmentWarehouse').addEventListener('change', render);
  $('eventEquipmentSort').addEventListener('change', render);
  $('eventEquipmentClear').addEventListener('click', () => {
    $('eventEquipmentSearch').value = '';
    $('eventEquipmentCategory').value = '';
    $('eventEquipmentSubcategory').value = '';
    $('eventEquipmentWarehouse').value = '';
    $('eventEquipmentSort').value = 'subcategory';
    render();
  });
  $('eventEquipmentViewCards').addEventListener('click', () => {
    pickerView = 'cards';
    localStorage.setItem('harazd-event-picker-view', pickerView);
    updateViewState();
  });
  $('eventEquipmentViewTable').addEventListener('click', () => {
    pickerView = 'table';
    localStorage.setItem('harazd-event-picker-view', pickerView);
    updateViewState();
  });
  $('eventEquipmentRefresh').addEventListener('click', async () => {
    if (!authorized() || !eventId) return;
    notice('Оновлення даних…');
    try {
      await preload(true);
      notice('');
      render();
    } catch (error) {
      notice('Не вдалося оновити дані: ' + (error?.message || error));
    }
  });
  $('eventEquipmentCandidates').addEventListener('click', e => {
    const button = e.target.closest('[data-equip-group], [data-equip-add]');
    if (!button) return;
    if (button.dataset.equipGroup) {
      const group = renderedGroups.find(entry => entry.id === button.dataset.equipGroup);
      if (group) selectEquipmentGroup(group, 'warehouse');
      return;
    }
    const item = inventory.find(entry => entry.id === button.dataset.equipAdd);
    if (item) selectEquipment(item, 'warehouse');
  });
  $('eventEquipmentRows').addEventListener('click', e => {
    const button = e.target.closest('[data-equip-group], [data-equip-add]');
    if (!button) return;
    if (button.dataset.equipGroup) {
      const group = renderedGroups.find(entry => entry.id === button.dataset.equipGroup);
      if (group) selectEquipmentGroup(group, 'warehouse');
      return;
    }
    const item = inventory.find(entry => entry.id === button.dataset.equipAdd);
    if (item) selectEquipment(item, 'warehouse');
  });

  const close = () => dialog.close();
  $('eventEquipmentClose').addEventListener('click', close);
  $('eventEquipmentDone').addEventListener('click', close);
  dialog.addEventListener('close', async () => {
    requestKey++;
    const closedId = eventId;
    const state = inlineState;
    if (!state || state.id !== closedId || !state.host?.isConnected) return;
    try {
      const response = await db.from('warehouse_event_equipment')
        .select('id,event_id,equipment_id,quantity,equipment:equipment_id(name,eq_id,model,photo_url)')
        .eq('event_id', state.id)
        .order('created_at');
      if (response.error) throw response.error;
      if (state !== inlineState) return;
      state.plan = response.data || [];
      renderInline();
    } catch (error) {
      if (state === inlineState) inlineMessage('Не вдалося оновити лист: ' + (error?.message || error));
    }
  });

  let inlineState = null;
  let inlineToken = 0;
  const inlineMessage = text => {
    if (inlineState?.host) {
      const node = inlineState.host.querySelector('[data-inline-notice]');
      if (node) node.textContent = text || '';
    }
  };

  function renderInline() {
    const state = inlineState;
    if (!state || !state.host?.isConnected) return;
    const planned = state.plan;
    const total = planned.reduce((sum, row) => sum + (Number(row.quantity) || 0), 0);
    const rows = planned.map((entry, index) => {
      const eq = state.inventory.find(item => item.id === entry.equipment_id) || entry.equipment || {};
      const photoUrl = String(eq.photo_url || '');
      const photo = /^https:\/\/[^\s"'<>]+$/i.test(photoUrl)
        ? `<img src="${escapeHtml(photoUrl)}" alt="Фото: ${escapeHtml(eq.name || 'Обладнання')}" loading="lazy" referrerpolicy="no-referrer" onerror="this.hidden=true;this.nextElementSibling.hidden=false"><span class="event-manifest-photo-empty" hidden aria-hidden="true">◇</span>`
        : '<span class="event-manifest-photo-empty" aria-hidden="true">◇</span>';
      return `<tr>
        <td class="event-manifest-seq">${index + 1}</td>
        <td class="event-manifest-id">${escapeHtml(eq.eq_id || '—')}</td>
        <td class="event-manifest-photo-cell"><div class="event-manifest-photo">${photo}</div></td>
        <td><strong>${escapeHtml(eq.name || 'Обладнання')}</strong>${eq.model ? `<small>${escapeHtml(eq.model)}</small>` : ''}</td>
        <td class="event-manifest-qty"><input type="number" aria-label="Кількість: ${escapeHtml(eq.name || 'Обладнання')}" min="1" max="999999" step="1" value="${Number(entry.quantity) || 1}" data-inline-qty="${escapeHtml(entry.equipment_id)}" ${canEdit() ? '' : 'disabled'}></td>
        <td class="event-manifest-action">${canEdit() ? `<button type="button" class="event-equip-delete" data-inline-remove="${escapeHtml(entry.equipment_id)}">Видалити</button>` : '—'}</td>
      </tr>`;
    }).join('');
    state.host.innerHTML = `
      <div class="event-manifest-toolbar">
        <div class="event-loading-summary"><strong>${planned.length} позицій</strong><span>${total} од.</span></div>
        ${canEdit() ? '<button type="button" class="primary" data-inline-open-picker>＋ Додати обладнання</button>' : ''}
      </div>
      <div class="event-manifest-scroll">
        <table class="event-manifest-table">
          <thead><tr><th>№</th><th>EQ-ID</th><th>Фото</th><th>Найменування / модель</th><th>Кількість</th><th></th></tr></thead>
          <tbody>${rows || '<tr><td colspan="6" class="event-manifest-empty">Лист погрузки порожній. Додайте необхідне обладнання.</td></tr>'}</tbody>
        </table>
      </div>
      <p class="muted event-load-notice" data-inline-notice role="status" aria-live="polite"></p>`;
  }
  function bindInlineHost(state) {
    if (state.controller) state.controller.abort();
    state.controller = new AbortController();
    const signal = state.controller.signal;
    state.host.addEventListener('click', e => {
      if (e.target.closest('[data-inline-open-picker]')) {
        open(state.id);
        return;
      }
      const remove = e.target.closest('[data-inline-remove]');
      if (remove && !state.busy) {
        const id = remove.dataset.inlineRemove;
        updateInline(current => db.from('warehouse_event_equipment').delete().eq('event_id', current.id).eq('equipment_id', id));
      }
    }, {signal});
    state.host.addEventListener('change', e => {
      const field = e.target.closest('[data-inline-qty]');
      if (!field) return;
      const id = field.dataset.inlineQty;
      const qty = Number(field.value);
      if (!Number.isSafeInteger(qty) || qty < 1 || qty > 999999) {
        inlineMessage('Вкажіть кількість від 1 до 999999');
        field.value = String(state.plan.find(row => row.equipment_id === id)?.quantity || 1);
        return;
      }
      updateInline(current => db.from('warehouse_event_equipment').update({quantity:qty}).eq('event_id', current.id).eq('equipment_id', id));
    }, {signal});
  }
  async function mountInline(id, host) {
    if (!authorized() || !id || !host) return;
    unmountInline();
    const token = ++inlineToken;
    inlineState = {id, host, inventory:[], plan:[], busy:false, controller:null};
    bindInlineHost(inlineState);
    host.textContent = 'Завантаження листа погрузки…';
    try {
      const [inv, planned] = await Promise.all([
        db.from('equipment').select('id,eq_id,name,model,photo_url,quantity').order('name').limit(10000),
        db.from('warehouse_event_equipment').select('id,event_id,equipment_id,quantity,equipment:equipment_id(name,eq_id,model,photo_url)').eq('event_id', id).order('created_at')
      ]);
      if (inv.error) throw inv.error;
      if (planned.error) throw planned.error;
      if (token !== inlineToken || !host.isConnected) return;
      inlineState.inventory = inv.data || [];
      inlineState.plan = planned.data || [];
      renderInline();
    } catch (error) {
      if (token === inlineToken && host.isConnected) host.textContent = 'Не вдалося завантажити лист погрузки: ' + (error?.message || error);
    }
  }
  const unmountInline = () => {
    inlineToken++;
    if (inlineState?.controller) inlineState.controller.abort();
    inlineState = null;
  };
  async function updateInline(action) {
    const state = inlineState;
    if (!state || state.busy || !canEdit() || !authorized()) return;
    state.busy = true;
    inlineMessage('Збереження…');
    try {
      const {error} = await action(state);
      if (error) throw error;
      const response = await db.from('warehouse_event_equipment')
        .select('id,event_id,equipment_id,quantity,equipment:equipment_id(name,eq_id,model,photo_url)')
        .eq('event_id', state.id)
        .order('created_at');
      if (response.error) throw response.error;
      if (inlineState !== state) return;
      state.plan = response.data || [];
      renderInline();
      inlineMessage('Збережено');
    } catch (error) {
      if (inlineState === state) inlineMessage('Помилка: ' + (error?.message || error));
    } finally {
      state.busy = false;
    }
  }

  window.harazdEventEquipment = {open, mountInline, unmountInline};
})();
