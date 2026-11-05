"use strict";
(() => {
  const $ = id => document.getElementById(id);
  const dialog = $('eventEquipmentDialog');
  if (!dialog) return;
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const canEdit = () => typeof staffAllowed === 'function' && staffAllowed('events_edit');
  const authorized = () => typeof session !== 'undefined' && !!session?.user?.id;
  const notice = msg => { $('eventEquipmentNotice').textContent = msg || ''; };
  let eventId = null, inventory = [], plan = [], loading = false, requestKey = 0;

  function render() {
    const q = $('eventEquipmentSearch').value.trim().toLocaleLowerCase('uk-UA');
    const matches = inventory.filter(i => [i.name,i.eq_id,i.model].some(v => String(v ?? '').toLocaleLowerCase('uk-UA').includes(q))).slice(0,60);
    $('eventEquipmentCandidates').innerHTML = matches.length ? matches.map(i => {
      const existing = plan.find(x => x.equipment_id === i.id);
      return `<div class="event-equip-row"><div class="event-equip-name"><strong>${escapeHtml(i.name)}</strong><small>${escapeHtml(i.eq_id || 'Без EQ-ID')} · ${escapeHtml(i.model||'')} · На складі: ${Number(i.quantity)||0}</small></div><div class="event-equip-actions">${existing ? '<small>У списку</small>' : canEdit() ? `<button type="button" data-equip-add="${escapeHtml(i.id)}">Додати</button>` : ''}</div></div>`;
    }).join('') : '<div class="event-equip-empty">Обладнання не знайдено</div>';
    $('eventEquipmentList').innerHTML = plan.length ? plan.map(p => {
      const i = inventory.find(x => x.id === p.equipment_id);
      return `<div class="event-equip-row"><div class="event-equip-name"><strong>${escapeHtml(i?.name || p.equipment?.name || 'Обладнання')}</strong><small>${escapeHtml(i?.eq_id || p.equipment?.eq_id || '')}</small></div><div class="event-equip-actions"><label>Кількість <input type="number" min="1" step="1" max="999999" value="${Number(p.quantity)||1}" data-equip-qty="${escapeHtml(p.equipment_id)}" ${canEdit()?'':'disabled'}></label>${canEdit() ? `<button type="button" class="event-equip-delete" data-equip-remove="${escapeHtml(p.equipment_id)}">Видалити</button>` : ''}</div></div>`;
    }).join('') : '<div class="event-equip-empty">До планової комплектації ще нічого не додано</div>';
  }

  async function loadInventory() {
    let rows = [], from = 0;
    while (true) {
      const {data,error} = await db.from('equipment').select('id,eq_id,name,model,quantity').order('name').range(from, from + 999);
      if (error) throw error;
      rows.push(...(data || []));
      if (!data || data.length < 1000) break;
      from += 1000;
      if (from >= 10000) break;
    }
    inventory = rows;
  }
  async function loadPlan() {
    const {data,error} = await db.from('warehouse_event_equipment').select('id,event_id,equipment_id,quantity,equipment:equipment_id(name,eq_id)').eq('event_id',eventId).order('created_at');
    if (error) throw error;
    plan = data || [];
  }
  async function open(id) {
    if (!authorized() || !id) return;
    eventId = id; const key = ++requestKey;
    $('eventEquipmentSearch').value = ''; plan = []; inventory = [];
    $('eventEquipmentTitle').textContent = 'Обладнання івенту';
    dialog.showModal(); notice('Завантаження…');
    try { await Promise.all([loadInventory(), loadPlan()]); if (key !== requestKey) return; notice(''); render(); }
    catch (e) { if (key === requestKey) notice('Не вдалося завантажити: ' + (e?.message || e)); }
  }
  async function change(action) {
    if (loading || !canEdit() || !eventId || !authorized()) return;
    loading = true; notice('Збереження…');
    try { await action(); await loadPlan(); notice('Збережено'); render(); }
    catch (e) { notice('Помилка: ' + (e?.message || e)); }
    finally { loading = false; }
  }

  $('eventEquipmentCandidates').addEventListener('click', e => {
    const b = e.target.closest('[data-equip-add]'); if (!b) return;
    const equipmentId = b.dataset.equipAdd;
    if (!inventory.some(x => x.id === equipmentId) || plan.some(x => x.equipment_id === equipmentId)) return;
    change(async () => { const {error} = await db.from('warehouse_event_equipment').insert({event_id:eventId,equipment_id:equipmentId,quantity:1}); if (error) throw error; });
  });
  $('eventEquipmentList').addEventListener('click', e => {
    const b = e.target.closest('[data-equip-remove]'); if (!b) return;
    const equipmentId = b.dataset.equipRemove;
    if (!plan.some(x => x.equipment_id === equipmentId)) return;
    change(async () => { const {error} = await db.from('warehouse_event_equipment').delete().eq('event_id',eventId).eq('equipment_id',equipmentId); if (error) throw error; });
  });
  $('eventEquipmentList').addEventListener('change', e => {
    const input = e.target.closest('[data-equip-qty]'); if (!input) return;
    const id = input.dataset.equipQty, qty = Number(input.value);
    if (!Number.isSafeInteger(qty) || qty < 1 || qty > 999999) { notice('Вкажіть кількість від 1 до 999999'); render(); return; }
    change(async () => { const {error} = await db.from('warehouse_event_equipment').update({quantity:qty}).eq('event_id',eventId).eq('equipment_id',id); if (error) throw error; });
  });
  $('eventEquipmentSearch').addEventListener('input', render);
  $('eventEquipmentRefresh').addEventListener('click', async () => { notice('Оновлення складу…'); try { await loadInventory(); notice(''); render(); } catch (e) { notice('Помилка: ' + e.message); } });
  const close = () => dialog.close();
  $('eventEquipmentClose').addEventListener('click', close);
  $('eventEquipmentDone').addEventListener('click', close);
  dialog.addEventListener('close', async () => {
    requestKey++;
    const closedId = eventId;
    eventId = null;
    const state = inlineState;
    if (!state || state.id !== closedId || !state.host?.isConnected) return;
    try {
      const response = await db.from('warehouse_event_equipment')
        .select('id,event_id,equipment_id,quantity,equipment:equipment_id(name,eq_id,model)')
        .eq('event_id',state.id).order('created_at');
      if (response.error) throw response.error;
      if (state !== inlineState) return;
      state.plan = response.data || [];
      renderInline();
    } catch (error) {
      if (state === inlineState) inlineMessage('Не вдалося оновити лист: ' + (error?.message || error));
    }
  });

  let inlineState = null, inlineToken = 0;
  const inlineMessage = text => {
    if (inlineState?.host) {
      const n = inlineState.host.querySelector('[data-inline-notice]');
      if (n) n.textContent = text || '';
    }
  };

  // Compact loading manifest displayed inside the event details window.
  function renderInline() {
    const state = inlineState;
    if (!state || !state.host?.isConnected) return;
    const planned = state.plan;
    const total = planned.reduce((sum, row) => sum + (Number(row.quantity) || 0), 0);
    const rows = planned.map((entry, index) => {
      const eq = state.inventory.find(item => item.id === entry.equipment_id) || entry.equipment || {};
      return `<tr>
        <td class="event-manifest-seq">${index + 1}</td>
        <td class="event-manifest-id">${escapeHtml(eq.eq_id || '—')}</td>
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
          <thead><tr><th>№</th><th>EQ-ID</th><th>Найменування / модель</th><th>Кількість</th><th></th></tr></thead>
          <tbody>${rows || '<tr><td colspan="5" class="event-manifest-empty">Лист погрузки порожній. Додайте необхідне обладнання.</td></tr>'}</tbody>
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
        updateInline(current => db.from('warehouse_event_equipment').delete().eq('event_id',current.id).eq('equipment_id',id));
      }
    }, {signal});
    state.host.addEventListener('change', e => {
      const field = e.target.closest('[data-inline-qty]');
      if (!field) return;
      const id = field.dataset.inlineQty, qty = Number(field.value);
      if (!Number.isSafeInteger(qty) || qty < 1 || qty > 999999) {
        inlineMessage('Вкажіть кількість від 1 до 999999');
        field.value = String(state.plan.find(row => row.equipment_id === id)?.quantity || 1);
        return;
      }
      updateInline(current => db.from('warehouse_event_equipment').update({quantity:qty}).eq('event_id',current.id).eq('equipment_id',id));
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
        db.from('equipment').select('id,eq_id,name,model,quantity').order('name').limit(10000),
        db.from('warehouse_event_equipment').select('id,event_id,equipment_id,quantity,equipment:equipment_id(name,eq_id,model)').eq('event_id',id).order('created_at')
      ]);
      if (inv.error) throw inv.error;
      if (planned.error) throw planned.error;
      if (token !== inlineToken || !host.isConnected) return;
      inlineState.inventory = inv.data || [];
      inlineState.plan = planned.data || [];
      renderInline();
    } catch (e) {
      if (token === inlineToken && host.isConnected) host.textContent = 'Не вдалося завантажити лист погрузки: ' + (e?.message || e);
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
    state.busy = true; inlineMessage('Збереження…');
    try {
      const {error} = await action(state);
      if (error) throw error;
      const response = await db.from('warehouse_event_equipment').select('id,event_id,equipment_id,quantity,equipment:equipment_id(name,eq_id,model)').eq('event_id',state.id).order('created_at');
      if (response.error) throw response.error;
      if (inlineState !== state) return;
      state.plan = response.data || [];
      renderInline();
      inlineMessage('Збережено');
    } catch (e) {
      if (inlineState === state) inlineMessage('Помилка: ' + (e?.message || e));
    } finally {
      state.busy = false;
    }
  }

  window.harazdEventEquipment = {open, mountInline, unmountInline};
})();
