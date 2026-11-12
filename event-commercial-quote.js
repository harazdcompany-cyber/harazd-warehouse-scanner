/* Event estimate: prices are separate from the shared loading list. */
(() => {
  'use strict';
  const esc = v => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money = n => new Intl.NumberFormat('uk-UA',{minimumFractionDigits:2,maximumFractionDigits:2}).format(n)+' грн';
  const round = n => Math.round((n + Number.EPSILON) * 100) / 100;
  function calculate(qty, price, days, discount, tax) {
    const base = BigInt(qty) * BigInt(Math.round(price * 100)) * BigInt(days);
    const netKop = (base * BigInt(10000 - Math.round(discount * 100)) + 5000n) / 10000n;
    const vatKop = (netKop * BigInt(Math.round(tax * 100)) + 5000n) / 10000n;
    if (netKop + vatKop > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError('Сума перевищує допустиме значення');
    return {net:Number(netKop)/100, vat:Number(vatKop)/100, total:Number(netKop+vatKop)/100};
  }
  let current = null, request = 0;
  function subcategoryOf(item) {
    const sub=item.equipment?.subcategory;
    const name=String(sub?.name || '').trim();
    return {key:name ? String(sub.id || name) : '', name:name || 'Без підкатегорії'};
  }
  function groupedItems(items) {
    const groups = new Map();
    for (const item of items) {
      const category = item.equipment?.category;
      const name = String(category?.name || '').trim();
      const key = name ? String(category.id || name) : '';
      if (!groups.has(key)) groups.set(key,{name:name || 'Без категорії',items:[]});
      groups.get(key).items.push(item);
    }
    for (const group of groups.values()) group.items.sort((a,b)=>{
      const x=subcategoryOf(a),y=subcategoryOf(b);
      if (!x.key && y.key) return 1;
      if (x.key && !y.key) return -1;
      return x.name.localeCompare(y.name,'uk') ||
        x.key.localeCompare(y.key) ||
        String(a.equipment?.name || '').localeCompare(String(b.equipment?.name || ''),'uk');
    });
    return [...groups.entries()].sort((a,b) => {
      if (!a[0]) return 1;
      if (!b[0]) return -1;
      return a[1].name.localeCompare(b[1].name,'uk');
    }).map(([,group])=>group);
  }
  function eventDays(state) {
    const form = state.form || state.host.closest?.('form');
    const start = form?.elements?.event_date?.value ?? state.record?.event_date ?? '';
    const end = form?.elements?.event_end_date?.value ?? state.record?.event_end_date ?? '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || (end && !/^\d{4}-\d{2}-\d{2}$/.test(end))) return null;
    const first = Date.parse(start + 'T00:00:00Z');
    const last = Date.parse((end || start) + 'T00:00:00Z');
    const days = (last-first)/86400000+1;
    return Number.isInteger(days) && days >= 1 && days <= 9999 ? days : null;
  }
  function notice(state, message, error=false) {
    if (current !== state) return;
    const el = state.host.querySelector('[data-quote-notice]');
    if (el) { el.textContent = message; el.classList.toggle('is-error', error); }
  }
  function render(state) {
    if (current !== state || !state.host.isConnected) return;
    const metadata = new Map(state.prices.map(x => [String(x.equipment_id),x]));
    let net=0,vat=0,total=0,missing=0;
    const eventDuration=eventDays(state);
    let itemIndex=0;
    const groups = groupedItems(state.items).map(group => {
      let lastSubcategory=null;
      const rows = group.items.map(item => {
      const eq=item.equipment || {}, p=metadata.get(String(item.equipment_id)) || {};
      const sub=subcategoryOf(item);
      const heading=lastSubcategory !== sub.key ? `<tr class="event-quote-subcategory"><th colspan="12" scope="rowgroup">${esc(sub.name)}</th></tr>` : '';
      lastSubcategory=sub.key;
      const price=Number(p.unit_price ?? 0), days=eventDuration, discount=Number(p.discount_percent ?? 0), tax=Number(p.vat_percent ?? 20);
      if (p.unit_price == null) missing++;
      let sum;
      try {sum=calculate(Number(item.quantity)||0,price,days ?? 0,discount,tax);}
      catch (_) {sum={net:0,vat:0,total:0};missing++;}
      net=round(net+sum.net);vat=round(vat+sum.vat);total=round(total+sum.total);
      return heading+`<tr data-quote-row="${esc(item.equipment_id)}"><td>${++itemIndex}</td><td><strong>${esc(eq.name || 'Обладнання')}</strong><small>${esc(eq.model || '')}</small></td><td><input data-quote-field="description" maxlength="500" value="${esc(p.description || eq.description || '')}" placeholder="Додаткова інформація" aria-label="Додаткова інформація"></td><td>${esc(item.quantity)}</td><td><input data-quote-field="unit" maxlength="30" value="${esc(p.unit || 'шт.')}" aria-label="Одиниця виміру"></td><td><input data-quote-field="unit_price" type="number" min="0" max="999999999" step="0.01" value="${p.unit_price == null ? '' : price}" aria-label="Ціна за одиницю"></td><td><input type="text" value="${days ?? '—'}" aria-label="Кількість днів події" readonly></td><td><input data-quote-field="discount_percent" type="number" min="0" max="100" step="0.01" value="${discount}" aria-label="Знижка, відсотків"></td><td>${days === null ? '—' : money(sum.net)}</td><td><input data-quote-field="vat_percent" type="number" min="0" max="100" step="0.01" value="${tax}" aria-label="ПДВ, відсотків"></td><td>${days === null ? '—' : money(sum.vat)}</td><td>${days === null ? '—' : money(sum.total)}</td></tr>`;
      }).join('');
      return `<section class="event-quote-category"><h3>${esc(group.name)}</h3><div class="event-quote-scroll"><table><thead><tr><th>№</th><th>Найменування</th><th>Опис</th><th>Кількість</th><th>Од.</th><th>Ціна, грн</th><th>Дні</th><th>Знижка, %</th><th>Сума без ПДВ</th><th>ПДВ, %</th><th>Сума ПДВ, грн</th><th>Підсумкова сума з ПДВ</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
    }).join('');
    state.host.innerHTML = `<div class="event-quote-head"><strong>Комерційна пропозиція</strong><div class="event-quote-actions"><button type="button" data-quote-refresh>Оновити список</button><button type="button" data-quote-print>Друк / PDF</button></div></div><p class="event-quote-hint">Обладнання спільне з листом погрузки. Кількість днів розраховується за датами події включно. ${state.readOnly ? 'Режим перегляду.' : 'Вкажіть ціну, знижку та ПДВ для кожної позиції. Зміни зберігаються автоматично.'}</p>${groups || '<p class="event-quote-hint">Додайте обладнання до події.</p>'}<div class="event-quote-totals"><span>Без ПДВ: <strong>${eventDuration === null ? '—' : money(net)}</strong></span><span>ПДВ: <strong>${eventDuration === null ? '—' : money(vat)}</strong></span><span>Разом: <strong>${eventDuration === null ? '—' : money(total)}</strong></span></div>${eventDuration === null ? '<p class="event-quote-hint">Вкажіть коректні дати події для розрахунку.</p>' : ''}${missing ? '<p class="event-quote-hint">Є позиції без збереженої ціни. Підсумок може бути неповним.</p>' : ''}<p data-quote-notice role="status" aria-live="polite"></p>`;
    if (state.readOnly) state.host.querySelectorAll('[data-quote-field]').forEach(field=>field.readOnly=true);
  }
  async function load(state) {
    const token=++request; notice(state,'Завантаження…');
    let items,prices;
    try {
      [items,prices]=await Promise.all([
        db.from('warehouse_event_equipment').select('equipment_id,quantity,equipment:equipment_id(name,model,description,category:category_id(id,name),subcategory:subcategory_id(id,name))').eq('event_id',state.id).order('created_at'),
        db.from('warehouse_event_quote_prices').select('*').eq('event_id',state.id)
      ]);
    } catch (_) {
      if(current===state && token===request && state.host.isConnected) state.host.textContent='Не вдалося завантажити пропозицію. Перевірте з’єднання.';
      return;
    }
    if(current!==state || token!==request || !state.host.isConnected)return;
    if(items.error || prices.error) {
      state.host.textContent = prices.error?.code === '42P01' || prices.error?.code === 'PGRST205'
        ? 'Для комерційної пропозиції потрібно виконати SQL-оновлення в Supabase.'
        : 'Не вдалося завантажити комерційну пропозицію. ' + ((items.error || prices.error)?.message || '');
      return;
    }
    state.items=items.data||[]; state.prices=prices.data||[]; render(state);
  }
  async function save(state,row) {
    if (state.readOnly) return;
    const get=key=>row.querySelector('[data-quote-field="'+key+'"]').value.trim();
    const rawPrice=get('unit_price');
    const sourceDescription=String(state.items.find(item=>String(item.equipment_id)===String(row.dataset.quoteRow))?.equipment?.description || '').trim();
    const enteredDescription=get('description');
    const description=enteredDescription === sourceDescription ? '' : enteredDescription;
    const values={event_id:state.id,equipment_id:row.dataset.quoteRow,description,unit:get('unit')||'шт.',unit_price:rawPrice === '' ? null : Number(rawPrice),days:eventDays(state) ?? 1,discount_percent:Number(get('discount_percent')),vat_percent:Number(get('vat_percent'))};
    if((values.unit_price!==null&&(!Number.isFinite(values.unit_price)||values.unit_price<0||values.unit_price>999999999))||!Number.isInteger(values.days)||values.days<1||values.days>9999||![values.discount_percent,values.vat_percent].every(x=>Number.isFinite(x)&&x>=0&&x<=100)){notice(state,'Перевірте ціну, кількість днів, знижку та ПДВ.',true);return;}
    state.saving=true;
    const controls=[...state.host.querySelectorAll('[data-quote-field], [data-quote-refresh], [data-quote-print]')];controls.forEach(el=>el.disabled=true);
    notice(state,'Збереження…');
    let error;
    try { ({error}=await db.from('warehouse_event_quote_prices').upsert(values,{onConflict:'event_id,equipment_id'})); }
    catch (err) {error=err;}
    if(current!==state)return;
    if(error){state.saving=false;controls.forEach(el=>el.disabled=false);notice(state,'Не вдалося зберегти: '+error.message,true);return;}
    await load(state);state.saving=false;notice(state,'Збережено');
  }
  function printQuote(state) {
    if (!state.items.length) {notice(state,'Спочатку додайте обладнання.',true);return;}
    const eventDuration=eventDays(state);
    if(eventDuration === null){notice(state,'Вкажіть коректні дати події перед друком.',true);return;}
    const metadata=new Map(state.prices.map(x=>[String(x.equipment_id),x]));
    if(state.items.some(item=>metadata.get(String(item.equipment_id))?.unit_price == null)) {
      notice(state,'Перед друком вкажіть і збережіть ціни для всіх позицій.',true);return;
    }
    let total=0;
    let itemIndex=0, invalid=false;
    const tables=groupedItems(state.items).map(group=>{
      let lastSubcategory=null;
      const rows=group.items.map(item=>{
      const p=metadata.get(String(item.equipment_id)), eq=item.equipment||{};
      const sub=subcategoryOf(item);
      const heading=lastSubcategory !== sub.key ? `<tr class="subcategory"><th colspan="12" scope="rowgroup">${esc(sub.name)}</th></tr>` : '';
      lastSubcategory=sub.key;
      let sum;
      try {sum=calculate(Number(item.quantity),Number(p.unit_price),eventDuration,Number(p.discount_percent),Number(p.vat_percent));}
      catch (_) {invalid=true;return '';}
      total=round(total+sum.total);
      return heading+`<tr><td>${++itemIndex}</td><td>${esc(eq.name||'Обладнання')}</td><td>${esc(p.description || eq.description || '')}</td><td>${esc(item.quantity)}</td><td>${esc(p.unit)}</td><td>${money(Number(p.unit_price))}</td><td>${eventDuration}</td><td>${esc(p.discount_percent)}%</td><td>${money(sum.net)}</td><td>${esc(p.vat_percent)}%</td><td>${money(sum.vat)}</td><td>${money(sum.total)}</td></tr>`;
      }).join('');
      return `<h3>${esc(group.name)}</h3><table><thead><tr><th>№</th><th>Найменування</th><th>Додаткова інформація</th><th>Кількість</th><th>Од.</th><th>Ціна за одиницю</th><th>Дні</th><th>Знижка</th><th>Сума без ПДВ</th><th>ПДВ, %</th><th>Сума ПДВ, грн</th><th>Підсумкова сума з ПДВ</th></tr></thead><tbody>${rows}</tbody></table>`;
    }).join('');
    if(invalid){notice(state,'Сума однієї з позицій перевищує допустиме значення.',true);return;}
    const popup=window.open('','_blank');
    if(!popup){notice(state,'Дозвольте відкриття нового вікна для друку.',true);return;}
    popup.document.write(`<!doctype html><html lang="uk"><head><meta charset="utf-8"><title>Комерційна пропозиція</title><style>@page{size:A4 landscape;margin:12mm}body{font:11px Arial,sans-serif;color:#111}h1{font-size:21px}h2{font-size:16px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #777;padding:6px;text-align:left;vertical-align:top}th{background:#eee}.subcategory th{background:#f6f6f6;font-weight:bold;text-align:left}.total{text-align:right;font-size:15px;font-weight:bold;margin-top:14px}</style></head><body><h1>Комерційна пропозиція</h1><h2>${esc(state.record?.name||'Подія')}</h2><p>Замовник: ${esc(state.record?.client||'—')}</p>${tables}<p class="total">Всього з ПДВ: ${money(total)}</p></body></html>`);
    popup.document.close();popup.focus();popup.print();
  }
  function mount(id,host,record,form,options = {}) {
    current={id,host,record,form,readOnly:!!options.readOnly,items:[],prices:[]}; const state=current;
    host.innerHTML='<p data-quote-notice>Завантаження…</p>';
    host.addEventListener('click',e=>{if(e.target.closest('[data-quote-refresh]'))load(state);if(e.target.closest('[data-quote-print]'))printQuote(state);},{signal:(state.controller=new AbortController()).signal});
    host.addEventListener('change',e=>{const row=e.target.closest('[data-quote-row]');if(!state.readOnly&&row&&e.target.matches('[data-quote-field]'))save(state,row);},{signal:state.controller.signal});
    form = form || host.closest?.('form');
    form?.addEventListener('change',e=>{
      if (!['event_date','event_end_date'].includes(e.target.name) || current!==state) return;
      if (!state.saving) render(state);
    },{signal:state.controller.signal});
    load(state);
  }
  function unmount(){request++;if(current?.controller)current.controller.abort();current=null;}
  window.harazdEventQuote={mount,unmount,calculate,isSaving:()=>!!current?.saving,refresh:()=>{if(current)load(current);}};
})();





