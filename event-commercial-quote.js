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
  function notice(state, message, error=false) {
    if (current !== state) return;
    const el = state.host.querySelector('[data-quote-notice]');
    if (el) { el.textContent = message; el.classList.toggle('is-error', error); }
  }
  function render(state) {
    if (current !== state || !state.host.isConnected) return;
    const metadata = new Map(state.prices.map(x => [String(x.equipment_id),x]));
    let net=0,vat=0,total=0,missing=0;
    const rows = state.items.map((item,index) => {
      const eq=item.equipment || {}, p=metadata.get(String(item.equipment_id)) || {};
      const price=Number(p.unit_price ?? 0), days=Number(p.days ?? 1), discount=Number(p.discount_percent ?? 0), tax=Number(p.vat_percent ?? 20);
      if (p.unit_price == null) missing++;
      let sum;
      try {sum=calculate(Number(item.quantity)||0,price,days,discount,tax);}
      catch (_) {sum={net:0,vat:0,total:0};missing++;}
      net=round(net+sum.net);vat=round(vat+sum.vat);total=round(total+sum.total);
      return `<tr data-quote-row="${esc(item.equipment_id)}"><td>${index+1}</td><td><strong>${esc(eq.name || 'Обладнання')}</strong><small>${esc(eq.model || '')}</small><input data-quote-field="description" maxlength="500" value="${esc(p.description || '')}" placeholder="Додаткова інформація" aria-label="Додаткова інформація"></td><td>${esc(item.quantity)}</td><td><input data-quote-field="unit" maxlength="30" value="${esc(p.unit || 'шт.')}" aria-label="Одиниця виміру"></td><td><input data-quote-field="unit_price" type="number" min="0" max="999999999" step="0.01" value="${p.unit_price == null ? '' : price}" aria-label="Ціна за одиницю"></td><td><input data-quote-field="days" type="number" min="1" max="9999" step="1" value="${days}" aria-label="Кількість днів"></td><td><input data-quote-field="discount_percent" type="number" min="0" max="100" step="0.01" value="${discount}" aria-label="Знижка, відсотків"></td><td><input data-quote-field="vat_percent" type="number" min="0" max="100" step="0.01" value="${tax}" aria-label="ПДВ, відсотків"></td><td>${money(sum.total)}</td></tr>`;
    }).join('');
    state.host.innerHTML = `<div class="event-quote-head"><strong>Комерційна пропозиція</strong><div class="event-quote-actions"><button type="button" data-quote-refresh>Оновити список</button><button type="button" data-quote-print>Друк / PDF</button></div></div><p class="event-quote-hint">Обладнання спільне з листом погрузки. Вкажіть ціну, кількість днів, знижку та ПДВ для кожної позиції. Зміни зберігаються автоматично.</p><div class="event-quote-scroll"><table><thead><tr><th>№</th><th>Найменування та інформація</th><th>Кількість</th><th>Од.</th><th>Ціна, грн</th><th>Дні</th><th>Знижка, %</th><th>ПДВ, %</th><th>Сума з ПДВ</th></tr></thead><tbody>${rows || '<tr><td colspan="9">Додайте обладнання до події.</td></tr>'}</tbody></table></div><div class="event-quote-totals"><span>Без ПДВ: <strong>${money(net)}</strong></span><span>ПДВ: <strong>${money(vat)}</strong></span><span>Разом: <strong>${money(total)}</strong></span></div>${missing ? '<p class="event-quote-hint">Є позиції без збереженої ціни. Підсумок може бути неповним.</p>' : ''}<p data-quote-notice role="status" aria-live="polite"></p>`;
  }
  async function load(state) {
    const token=++request; notice(state,'Завантаження…');
    let items,prices;
    try {
      [items,prices]=await Promise.all([
        db.from('warehouse_event_equipment').select('equipment_id,quantity,equipment:equipment_id(name,model)').eq('event_id',state.id).order('created_at'),
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
    const get=key=>row.querySelector('[data-quote-field="'+key+'"]').value.trim();
    const rawPrice=get('unit_price');
    const values={event_id:state.id,equipment_id:row.dataset.quoteRow,description:get('description'),unit:get('unit')||'шт.',unit_price:rawPrice === '' ? null : Number(rawPrice),days:Number(get('days')),discount_percent:Number(get('discount_percent')),vat_percent:Number(get('vat_percent'))};
    if((values.unit_price!==null&&(!Number.isFinite(values.unit_price)||values.unit_price<0||values.unit_price>999999999))||!Number.isInteger(values.days)||values.days<1||values.days>9999||![values.discount_percent,values.vat_percent].every(x=>Number.isFinite(x)&&x>=0&&x<=100)){notice(state,'Перевірте ціну, кількість днів, знижку та ПДВ.',true);return;}
    const controls=[...state.host.querySelectorAll('[data-quote-field], [data-quote-refresh], [data-quote-print]')];controls.forEach(el=>el.disabled=true);
    notice(state,'Збереження…');
    let error;
    try { ({error}=await db.from('warehouse_event_quote_prices').upsert(values,{onConflict:'event_id,equipment_id'})); }
    catch (err) {error=err;}
    if(current!==state)return;
    if(error){controls.forEach(el=>el.disabled=false);notice(state,'Не вдалося зберегти: '+error.message,true);return;}
    await load(state);notice(state,'Збережено');
  }
  function printQuote(state) {
    if (!state.items.length) {notice(state,'Спочатку додайте обладнання.',true);return;}
    const metadata=new Map(state.prices.map(x=>[String(x.equipment_id),x]));
    if(state.items.some(item=>metadata.get(String(item.equipment_id))?.unit_price == null)) {
      notice(state,'Перед друком вкажіть і збережіть ціни для всіх позицій.',true);return;
    }
    let total=0;
    const rows=state.items.map((item,index)=>{
      const p=metadata.get(String(item.equipment_id)), eq=item.equipment||{};
      let sum;
      try {sum=calculate(Number(item.quantity),Number(p.unit_price),Number(p.days),Number(p.discount_percent),Number(p.vat_percent));}
      catch (_) {return null;}
      total=round(total+sum.total);
      return `<tr><td>${index+1}</td><td>${esc(eq.name||'Обладнання')}</td><td>${esc(p.description||'')}</td><td>${esc(item.quantity)}</td><td>${esc(p.unit)}</td><td>${money(Number(p.unit_price))}</td><td>${esc(p.days)}</td><td>${esc(p.discount_percent)}%</td><td>${money(sum.net)}</td><td>${money(sum.vat)}</td><td>${money(sum.total)}</td></tr>`;
    });
    if(rows.some(row=>row===null)){notice(state,'Сума однієї з позицій перевищує допустиме значення.',true);return;}
    const popup=window.open('','_blank');
    if(!popup){notice(state,'Дозвольте відкриття нового вікна для друку.',true);return;}
    popup.document.write(`<!doctype html><html lang="uk"><head><meta charset="utf-8"><title>Комерційна пропозиція</title><style>@page{size:A4 landscape;margin:12mm}body{font:11px Arial,sans-serif;color:#111}h1{font-size:21px}h2{font-size:16px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #777;padding:6px;text-align:left;vertical-align:top}th{background:#eee}.total{text-align:right;font-size:15px;font-weight:bold;margin-top:14px}</style></head><body><h1>Комерційна пропозиція</h1><h2>${esc(state.record?.name||'Подія')}</h2><p>Замовник: ${esc(state.record?.client||'—')}</p><table><thead><tr><th>№</th><th>Найменування</th><th>Додаткова інформація</th><th>Кількість</th><th>Од.</th><th>Ціна за одиницю</th><th>Дні</th><th>Знижка</th><th>Без ПДВ</th><th>ПДВ</th><th>Сума з ПДВ</th></tr></thead><tbody>${rows.join('')}</tbody></table><p class="total">Всього з ПДВ: ${money(total)}</p></body></html>`);
    popup.document.close();popup.focus();popup.print();
  }
  function mount(id,host,record) {
    current={id,host,record,items:[],prices:[]}; const state=current;
    host.innerHTML='<p data-quote-notice>Завантаження…</p>';
    host.addEventListener('click',e=>{if(e.target.closest('[data-quote-refresh]'))load(state);if(e.target.closest('[data-quote-print]'))printQuote(state);},{signal:(state.controller=new AbortController()).signal});
    host.addEventListener('change',e=>{const row=e.target.closest('[data-quote-row]');if(row&&e.target.matches('[data-quote-field]'))save(state,row);},{signal:state.controller.signal});
    load(state);
  }
  function unmount(){request++;if(current?.controller)current.controller.abort();current=null;}
  window.harazdEventQuote={mount,unmount,calculate,refresh:()=>{if(current)load(current);}};
})();
