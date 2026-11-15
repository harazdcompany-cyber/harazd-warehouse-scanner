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
  function commercialTerms(item, metadata) {
    const eq=item.equipment || {}, p=metadata.get(String(item.equipment_id)) || {};
    const raw=p.unit_price ?? eq.rental_price;
    const price=raw == null || raw === '' ? null : Number(raw);
    return {
      description:String(p.description || eq.description || ''),
      unit:String(p.unit || eq.unit || 'шт.'),
      price:Number.isFinite(price) ? price : null,
      discount:Number(p.discount_percent ?? 0),
      vat:Number(p.vat_percent ?? 20)
    };
  }
  function combineEquipment(items, metadata) {
    const map=new Map();
    for (const item of items) {
      const eq=item.equipment || {}, terms=commercialTerms(item,metadata);
      // Use the warehouse picker's identity, and keep differing commercial terms separate.
      const identity=eq.name ? [
        eq.name,eq.model || '',eq.manufacturer || '',eq.description || '',eq.photo_url || '',
        eq.category?.id || '',eq.subcategory?.id || '',String(eq.accounting_type || '').toLowerCase()
      ] : ['unavailable',item.equipment_id];
      const key=JSON.stringify([identity,terms.description,terms.unit,terms.price,terms.discount,terms.vat]);
      let group=map.get(key);
      if (!group) {
        group={...item,quantity:0,members:[],terms};
        map.set(key,group);
      }
      group.quantity+=Number(item.quantity) || 0;
      group.members.push(item);
    }
    return [...map.values()];
  }
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

  // This record is written only once. Read-only viewing must never claim authorship.
  async function fetchQuoteAuthor(state, hasOldPrices=false) {
    try {
      const result=await db.from('warehouse_event_quote_authors')
        .select('created_by,author_name,author_phone,author_email,created_at')
        .eq('event_id',state.id).maybeSingle();
      if(result.error) throw result.error;
      let author=result.data;
      if(!author && hasOldPrices) return {author:null,error:'',legacy:true};
      if(!author && !state.readOnly && current===state && state.host.isConnected) {
        const claimed=await db.rpc('warehouse_quote_claim_author',{p_event_id:state.id});
        if(claimed.error) throw claimed.error;
        author=Array.isArray(claimed.data) ? claimed.data[0] : claimed.data;
        if(!author) throw new Error('Не вдалося зафіксувати автора пропозиції.');
      }
      return {author:author||null,error:'',legacy:false};
    } catch (error) {
      return {author:null,error:String(error?.message||error||'Невідома помилка'),legacy:false};
    }
  }
  function render(state) {
    if (current !== state || !state.host.isConnected) return;
    const metadata = new Map(state.prices.map(x => [String(x.equipment_id),x]));
    let net=0,vat=0,total=0,missing=0;
    const eventDuration=eventDays(state);
    let itemIndex=0;
    const combined=combineEquipment(state.items,metadata);
    state.groupMembers=new Map(combined.map(item=>[String(item.equipment_id),item.members]));
    const groups = groupedItems(combined).map(group => {
      let lastSubcategory=null;
      const rows = group.items.map(item => {
      const eq=item.equipment || {}, p=metadata.get(String(item.equipment_id)) || {};
      const sub=subcategoryOf(item);
      const heading=lastSubcategory !== sub.key ? `<tr class="event-quote-subcategory"><th colspan="12" scope="rowgroup">${esc(sub.name)}</th></tr>` : '';
      lastSubcategory=sub.key;
      const price=item.terms.price ?? 0, days=eventDuration, discount=item.terms.discount, tax=item.terms.vat;
      if (item.terms.price == null) missing++;
      let sum;
      try {sum=calculate(Number(item.quantity)||0,price,days ?? 0,discount,tax);}
      catch (_) {sum={net:0,vat:0,total:0};missing++;}
      net=round(net+sum.net);vat=round(vat+sum.vat);total=round(total+sum.total);
      return heading+`<tr data-quote-row="${esc(item.equipment_id)}"><td>${++itemIndex}</td><td><strong>${esc(eq.name || 'Обладнання')}</strong></td><td><input data-quote-field="description" maxlength="500" value="${esc(item.terms.description)}" placeholder="Додаткова інформація" aria-label="Додаткова інформація"></td><td>${esc(item.quantity)}</td><td><input data-quote-field="unit" maxlength="30" value="${esc(item.terms.unit)}" aria-label="Одиниця виміру"></td><td><input data-quote-field="unit_price" type="number" min="0" max="999999999" step="0.01" value="${item.terms.price == null ? '' : price}" aria-label="Ціна за одиницю"></td><td><input type="text" value="${days ?? '—'}" aria-label="Кількість днів події" readonly></td><td><input data-quote-field="discount_percent" type="number" min="0" max="100" step="0.01" value="${discount}" aria-label="Знижка, відсотків"></td><td>${days === null ? '—' : money(sum.net)}</td><td><input data-quote-field="vat_percent" type="number" min="0" max="100" step="0.01" value="${tax}" aria-label="ПДВ, відсотків"></td><td>${days === null ? '—' : money(sum.vat)}</td><td>${days === null ? '—' : money(sum.total)}</td></tr>`;
      }).join('');
      return `<section class="event-quote-category"><h3>${esc(group.name)}</h3><div class="event-quote-scroll"><table><thead><tr><th>№</th><th>Найменування</th><th>Опис</th><th>Кількість</th><th>Од.</th><th>Ціна, грн</th><th>Дні</th><th>Знижка, %</th><th>Сума без ПДВ</th><th>ПДВ, %</th><th>Сума ПДВ, грн</th><th>Підсумкова сума з ПДВ</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
    }).join('');
    const authorMessage=state.authorLegacy
      ? '<p class="event-quote-hint">Ця КП створена раніше, а її автора не було збережено. Неможливо достовірно визначити початкового автора автоматично.</p>'
      : state.authorError
      ? `<p class="event-quote-hint">Не вдалося завантажити автора КП. Перевірте SQL-оновлення SETUP_EVENT_QUOTE_AUTHOR.sql. ${esc(state.authorError)}</p>`
      : !state.author
        ? '<p class="event-quote-hint">Автор цієї КП ще не зафіксований. Відкрийте її для редагування, щоб зберегти дані автора.</p>'
        : '';
    state.host.innerHTML = `<div class="event-quote-head"><strong>Комерційна пропозиція</strong><div class="event-quote-actions"><button type="button" data-quote-refresh>Оновити список</button><button type="button" data-quote-print>Друк / PDF</button></div></div><p class="event-quote-hint">Обладнання спільне з листом погрузки. Кількість днів розраховується за датами події включно. ${state.readOnly ? 'Режим перегляду.' : 'Вкажіть ціну, знижку та ПДВ для кожної позиції. Зміни зберігаються автоматично.'}</p>${groups || '<p class="event-quote-hint">Додайте обладнання до події.</p>'}<div class="event-quote-totals"><span>Без ПДВ: <strong>${eventDuration === null ? '—' : money(net)}</strong></span><span>ПДВ: <strong>${eventDuration === null ? '—' : money(vat)}</strong></span><span>Разом: <strong>${eventDuration === null ? '—' : money(total)}</strong></span></div>${eventDuration === null ? '<p class="event-quote-hint">Вкажіть коректні дати події для розрахунку.</p>' : ''}${missing ? '<p class="event-quote-hint">Є позиції без збереженої ціни. Підсумок може бути неповним.</p>' : ''}${authorMessage}<p data-quote-notice role="status" aria-live="polite"></p>`;
    if (state.readOnly) state.host.querySelectorAll('[data-quote-field]').forEach(field=>field.readOnly=true);
  }
  async function load(state) {
    const token=++request; notice(state,'Завантаження…');
    let items,prices,authorResult;
    try {
      [items,prices]=await Promise.all([
        db.from('warehouse_event_equipment').select('equipment_id,quantity,equipment:equipment_id(name,model,manufacturer,description,photo_url,accounting_type,unit,rental_price,category:category_id(id,name),subcategory:subcategory_id(id,name))').eq('event_id',state.id).order('created_at'),
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
    authorResult=await fetchQuoteAuthor(state,(prices.data||[]).length>0);
    if(current!==state || token!==request || !state.host.isConnected)return;
    state.items=items.data||[]; state.prices=prices.data||[];
    state.author=authorResult?.author||null; state.authorError=authorResult?.error||'';
    state.authorLegacy=!!authorResult?.legacy;
    render(state);
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
    const members=state.groupMembers?.get(String(row.dataset.quoteRow));
    if (!members?.length) {state.saving=false;notice(state,'Список змінився. Оновіть пропозицію.',true);return;}
    const updates=members.map(item=>({...values,equipment_id:item.equipment_id}));
    const controls=[...state.host.querySelectorAll('[data-quote-field], [data-quote-refresh], [data-quote-print]')];controls.forEach(el=>el.disabled=true);
    notice(state,'Збереження…');
    let error;
    try { ({error}=await db.from('warehouse_event_quote_prices').upsert(updates,{onConflict:'event_id,equipment_id'})); }
    catch (err) {error=err;}
    if(current!==state)return;
    if(error){state.saving=false;controls.forEach(el=>el.disabled=false);notice(state,'Не вдалося зберегти: '+error.message,true);return;}
    await load(state);state.saving=false;notice(state,'Збережено');
  }

  function printQuote(state) {
    // Legacy quotations remain printable, but never impersonate an unknown author.
    if (!state.items.length) {notice(state,'Спочатку додайте обладнання.',true);return;}
    const eventDuration=eventDays(state);
    if (eventDuration === null){notice(state,'Вкажіть коректні дати події перед друком.',true);return;}
    const metadata=new Map(state.prices.map(x=>[String(x.equipment_id),x]));
    const combined=combineEquipment(state.items,metadata);
    if(combined.some(item=>item.terms.price == null)) {
      notice(state,'Перед друком вкажіть і збережіть ціни для всіх позицій.',true);return;
    }

    // One printed estimate section per warehouse category; never modify the loading list.
    let total=0, invalid=false;
    // Keep the same major-section sequence as the HARAZD estimate example.
    const printOrder=['КОНСТРУКТИВИ','СПЕЦЕЛЕМЕНТИ','ЗВУК','LED SCREEN','СВІТЛО',
      'ДОСТАВКА ОБЛАДНАННЯ','ВИТРАТИ НА ПЕРСОНАЛ','ДОДАТКОВІ ВИТРАТИ'];
    const rank=name=>{const i=printOrder.indexOf(String(name||'').trim().toLocaleUpperCase('uk'));
      return i===-1 ? printOrder.length : i;};
    const orderedGroups=groupedItems(combined).sort((a,b)=>rank(a.name)-rank(b.name)||a.name.localeCompare(b.name,'uk'));
    const tables=orderedGroups.map(group=>{
      let categoryTotal=0, lastSubcategory=null, itemIndex=0;
      const rows=group.items.map(item=>{
        const eq=item.equipment||{}, terms=item.terms, sub=subcategoryOf(item);
        let heading='';
        if(lastSubcategory !== sub.key) {
          lastSubcategory=sub.key;
          itemIndex=0;
          if(sub.key) heading=`<tr class="subcategory"><th colspan="12" scope="rowgroup">${esc(sub.name)}</th></tr>`;
        }
        let sum;
        try {sum=calculate(Number(item.quantity),terms.price,eventDuration,terms.discount,terms.vat);}
        catch (_) {invalid=true;return '';}
        categoryTotal=round(categoryTotal+sum.total);
        const pct=value=>esc(String(value).replace('.',',')+'%');
        return heading+`<tr class="item-row">
          <td class="number">${++itemIndex}</td>
          <td class="item-name">${esc(eq.name||'Обладнання')}</td>
          <td class="item-description">${esc(terms.description)}</td>
          <td>${esc(item.quantity)}</td>
          <td>${esc(terms.unit)}</td>
          <td class="currency">${money(terms.price)}</td>
          <td>${eventDuration}</td>
          <td>${pct(terms.discount)}</td>
          <td class="currency">${money(sum.net)}</td>
          <td>${pct(terms.vat)}</td>
          <td class="currency">${money(sum.vat)}</td>
          <td class="currency">${money(sum.total)}</td>
        </tr>`;
      }).join('');
      total=round(total+categoryTotal);
      return `<section class="quote-section">
        <h2>${esc(group.name)}</h2>
        <table>
          <colgroup>
            <col style="width:4%"><col style="width:18%"><col style="width:15%">
            <col style="width:5%"><col style="width:6%"><col style="width:8%">
            <col style="width:5%"><col style="width:6%"><col style="width:10%">
            <col style="width:5%"><col style="width:9%"><col style="width:9%">
          </colgroup>
          <thead><tr>
            <th>№ п/п</th><th>Найменування</th><th>Додаткова інформація</th>
            <th>Кількість</th><th>Одиниця виміру</th><th>Ціна за одиницю</th>
            <th>Кількість днів</th><th>Партнерська знижка</th><th>Загальна вартість без ПДВ</th>
            <th>ПДВ, %</th><th>ПДВ, грн</th><th>Сума з ПДВ</th>
          </tr></thead><tbody>${rows}</tbody>
        </table>
        <p class="section-total"><strong>ВСЬОГО:</strong> <span>${money(categoryTotal)}</span></p>
      </section>`;
    }).join('');
    if(invalid){notice(state,'Сума однієї з позицій перевищує допустиме значення.',true);return;}

    const record=state.record||{};
    const author=state.author||{};
    const formatDate=value=>/^\d{4}-\d{2}-\d{2}$/.test(String(value||''))
      ? String(value).slice(8,10)+'.'+String(value).slice(5,7)+'.'+String(value).slice(0,4) : '—';
    const eventStart=state.form?.elements?.event_date?.value || record.event_date || '';
    const eventEnd=state.form?.elements?.event_end_date?.value || record.event_end_date || eventStart;
    const eventPeriod=eventStart && eventEnd && eventStart!==eventEnd
      ? formatDate(eventStart)+' – '+formatDate(eventEnd) : formatDate(eventStart);
    const quoteNumber=String(record.quote_number||'').trim() || String(state.id||'').slice(0,8).toUpperCase() || '—';
    const dateIssued=new Date().toLocaleDateString('uk-UA');
    const logoUrl=new URL('harazd-logo-white.png',document.baseURI).href;
    const styles=`
      @page {size:A4 portrait;margin:12mm 9mm}
      * {box-sizing:border-box}
      html,body {margin:0;padding:0}
      body {font-family:Arial,Helvetica,sans-serif;font-size:8px;line-height:1.35;color:#111;background:white}
      .quote-cover {margin-bottom:18px}
      .quote-top {display:grid;grid-template-columns:minmax(0,1fr) 34%;gap:22px;align-items:start}
      .quote-logo {display:flex;align-items:center;justify-content:center;width:66px;height:55px;background:#091016;
        -webkit-print-color-adjust:exact;print-color-adjust:exact}
      .quote-logo img {display:block;width:50px;max-height:48px;object-fit:contain}
      .quote-title {font-size:11px;font-weight:700;margin:0 0 8px}
      .quote-number {margin:0 0 2px}
      .quote-meta {display:grid;grid-template-columns:minmax(0,1fr) 34%;gap:22px;margin-top:17px;align-items:start}
      .quote-meta p {margin:0 0 5px}
      .quote-meta-label {font-weight:700;margin:0 0 4px}
      .quote-contact {margin-top:12px}
      .quote-date {margin:0 0 14px}
      .quote-top-total-label {max-width:150px;font-weight:700;margin:0 0 7px}
      .quote-top-total-value {display:inline-block;padding:5px 9px;background:#101010;color:#fff;font-weight:700;font-size:10px;
        -webkit-print-color-adjust:exact;print-color-adjust:exact}
      .event-name {font-size:12px;font-weight:700;margin:20px 0 3px;text-transform:uppercase;overflow-wrap:anywhere}
      .event-client {margin:0 0 12px;color:#333}
      .quote-section {margin:18px 0 0;break-inside:auto}
      .quote-section h2 {font-size:10px;font-weight:700;margin:0 0 14px;text-transform:uppercase;break-after:avoid}
      table {width:100%;border-collapse:collapse;table-layout:fixed}
      thead {display:table-header-group}
      thead th {padding:4px 2px 6px;text-align:center;vertical-align:bottom;border-bottom:1px solid #222;
        font-size:6.65px;line-height:1.18;overflow-wrap:anywhere;font-weight:700}
      tbody td {padding:5px 2px;text-align:center;vertical-align:middle;border-bottom:1px dotted #6f6f6f;
        font-size:6.8px;overflow-wrap:anywhere}
      tbody tr {break-inside:avoid;page-break-inside:avoid}
      td.number {text-align:center}
      td.item-name,td.item-description {text-align:left}
      td.currency {font-size:6.25px;white-space:nowrap;letter-spacing:-0.15px}
      tr.subcategory th {padding:8px 3px 5px;text-align:left;border-bottom:1px dotted #666;
        font-weight:400;font-style:italic;font-size:8px;break-after:avoid}
      .section-total {display:flex;justify-content:flex-end;gap:6px;align-items:center;
        margin:7px 0 0;font-size:8px;break-inside:avoid;page-break-inside:avoid}
      .section-total span {display:inline-block;padding:4px 7px;background:#4a86e8;color:white;font-weight:700;
        -webkit-print-color-adjust:exact;print-color-adjust:exact}
      .quote-grand-total {display:flex;justify-content:flex-end;gap:10px;align-items:center;
        margin:25px 0 10px;font-size:12px;font-weight:700;break-inside:avoid}
      .quote-grand-total strong {font-size:14px}
      @media screen {
        body {max-width:1100px;margin:auto;padding:15px}
      }
    `;
    const popup=window.open('','_blank');
    if(!popup){notice(state,'Дозвольте відкриття нового вікна для друку.',true);return;}
    popup.document.write(`<!doctype html><html lang="uk"><head><meta charset="utf-8">
      <title>Комерційна пропозиція – ${esc(record.name||'Подія')}</title>
      <style>${styles}</style></head><body>
      <header class="quote-cover">
        <div class="quote-top">
          <div class="quote-logo"><img src="${esc(logoUrl)}" alt="HARAZD"></div>
          <div>
            <p class="quote-title">Комерційна пропозиція</p>
            <p class="quote-number">Номер: ${esc(quoteNumber)}</p>
            <p>Дата: ${esc(dateIssued)}</p>
          </div>
        </div>
        <div class="quote-meta">
          <div>
            <p class="quote-meta-label">Пропозицію склав:</p>
            <p>${esc(author.author_name||'—')}</p>
            <div class="quote-contact">
              <p class="quote-meta-label">Контактні дані:</p>
              <p>моб. ${esc(author.author_phone||'—')}</p>
              <p>${esc(author.author_email||'—')}</p>
            </div>
          </div>
          <div>
            <div class="quote-date">
              <p class="quote-meta-label">Дата виконання робіт:</p>
              <p>${esc(eventPeriod)}</p>
            </div>
            <p class="quote-top-total-label">Вартість виконання робіт з ПДВ:</p>
            <span class="quote-top-total-value">${money(total)}</span>
          </div>
        </div>
        <h1 class="event-name">${esc(record.name||'Подія')}</h1>
        ${record.client ? `<p class="event-client">Замовник: ${esc(record.client)}</p>` : ''}
      </header>
      ${tables}
      <div class="quote-grand-total"><span>Загальна сума з ПДВ:</span><strong>${money(total)}</strong></div>
      </body></html>`);
    popup.document.close();
    let didPrint=false;
    const showPrint=()=>{if(didPrint)return;didPrint=true;popup.focus();popup.print();};
    const logo=popup.document.querySelector('.quote-logo img');
    if(logo && !logo.complete){
      logo.addEventListener('load',showPrint,{once:true});
      logo.addEventListener('error',showPrint,{once:true});
      setTimeout(showPrint,1500);
    } else showPrint();
  }
  function mount(id,host,record,form,options = {}) {
    current={id,host,record,form,readOnly:!!options.readOnly,items:[],prices:[],author:null,authorError:'',authorLegacy:false}; const state=current;
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






