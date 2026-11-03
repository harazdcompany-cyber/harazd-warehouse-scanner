/* HARAZD WAREHOUSE: edit shared attributes of every personal EQ-ID in a group.
   Individual fields (IDs, serial, barcode, QR, location, repair/status, documents) are untouched. */
(() => {
  const FIELDS = [
    ['photo_url','Фото (HTTPS URL)','text'],['name','Найменування','text'],['description','Опис','textarea'],
    ['manufacturer','Виробник','text'],['model','Модель','text'],
    ['category_id','Категорія','category'],['subcategory_id','Підкатегорія','subcategory'],['accounting_type','Тип обліку','accounting'],
    ['unit','Одиниця виміру','text'],['weight','Вага / кг','number'],
    ['warehouse_id','Склад','warehouse'],['location_id','Місце зберігання','location'],['packaging','Пакування','text'],['price','Ціна / грн','number'],
    ['rental_price','Оренда / доба','number'],
    ['custom_fields','Додаткові характеристики (назва: значення, кожен рядок)','textarea']
  ];
  let groupIds = [];
  const sectionFor = f => ['photo_url','name','description','manufacturer','model','category_id','subcategory_id','accounting_type','unit','weight'].includes(f)?'Основна інформація':f==='custom_fields'?'Додаткові характеристики':['warehouse_id','location_id','packaging'].includes(f)?'Розміщення та пакування':'Вартість';
  const safe = s => String(s ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const dialog = document.createElement('dialog');
  dialog.className = 'harazd-group-dialog';
  dialog.innerHTML = `<form id="harazdGroupForm"><div class="harazd-group-head"><h2>Редагування всієї групи</h2><button type="button" id="harazdGroupClose">✕</button></div><p id="harazdGroupCount" class="muted"></p><p class="muted">Позначте тільки ті поля, які потрібно змінити для всіх одиниць. Непозначені поля не змінюються.</p><div id="harazdGroupFields" class="harazd-group-fields"></div><section class="harazd-group-individual"><h3>Індивідуальні поля</h3><p class="muted">Серійний ID, EQ-ID, штрихкод, QR і кількість кожної одиниці не перезаписуються однаковим значенням. Для них використовуйте індивідуальне редагування.</p></section><div class="actions"><button type="button" id="harazdGroupCancel">Скасувати</button><button type="submit" class="primary" id="harazdGroupSave">Зберегти для всієї групи</button></div></form>`;
  document.body.append(dialog);
  const $ = sel => dialog.querySelector(sel);
  const close = () => dialog.close();
  $('#harazdGroupClose').onclick = close;
  $('#harazdGroupCancel').onclick = close;
  function fillOptions(kind, value, category) {
    const arr = kind === 'category' ? categories : kind==='warehouse'?warehouses : subcategories.filter(s => !category || s.category_id === category);
    return `<option value="">— Не вибрано —</option>` + arr.map(x => `<option value="${safe(x.id)}" ${x.id === value ? 'selected' : ''}>${safe(x.name)}</option>`).join('');
  }
  function openGroup(key) {
    const members = items.filter(x => x.accounting_type === 'personal' && personalKey(x) === key);
    if (members.length < 2) return toast('Групу не знайдено',true);
    groupIds = members.map(x=>x.id);
    const first = members[0];
    $('#harazdGroupCount').textContent = `${first.name} · ${members.length} одиниць обладнання`;
    let lastSection='';
    $('#harazdGroupFields').innerHTML = FIELDS.map(([field,label,type]) => {
      const section=sectionFor(field);const header=section!==lastSection?`<h3 class="harazd-group-section">${section}</h3>`:'';lastSection=section;
      const v = field === 'custom_fields' ? (Array.isArray(first.custom_fields) ? first.custom_fields.map(x=>`${x.name}: ${x.value}`).join('\n') : '') : first[field] ?? '';
      let control;
      if(type === 'category' || type === 'subcategory' || type==='warehouse') control = `<select data-field="${field}">${fillOptions(type,v,first.category_id)}</select>`;
      else if(type==='accounting') control=`<select data-field="${field}"><option value="personal" ${v==='personal'?'selected':''}>Персональний</option><option value="general" ${v==='general'?'selected':''}>Загальний</option></select>`;
      else if(type==='location') control=`<select data-field="${field}"><option value="">Без місця</option></select>`;
      else if(type === 'textarea') control = `<textarea data-field="${field}" rows="${field==='custom_fields'?3:2}">${safe(v)}</textarea>`;
      else control = `<input data-field="${field}" type="${type}" ${type==='number'?'step="any" min="0"':''} value="${safe(v)}">`;
      return `${header}<div class="harazd-group-field"><label class="harazd-group-check"><input type="checkbox" data-use="${field}"> <span>${safe(label)}</span></label>${control}</div>`;
    }).join('');
    $('[data-field="category_id"]').addEventListener('change',e=>{
      const sub = $('[data-field="subcategory_id"]');
      sub.innerHTML = fillOptions('subcategory','',e.target.value);
      // Changing the selection must not silently mark a second field for bulk update.
    });
    const locationSelect=$('[data-field="location_id"]');
    const populateLocations=()=>{
      const wh=$('[data-field="warehouse_id"]').value;
      const old=locationSelect.value||first.location_id||'';
      const nodes=(typeof locationNodes!=='undefined'&&Array.isArray(locationNodes))?locationNodes:[];
      const byId=new Map(nodes.map(n=>[n.id,n]));
      const label=n=>{const parts=[n.name];let parent=byId.get(n.parent_id);let limit=0;while(parent&&limit++<8){parts.unshift(parent.name);parent=byId.get(parent.parent_id)}return parts.join(' / ')};
      locationSelect.innerHTML='<option value="">Без місця</option>'+nodes.filter(n=>n.warehouse_id===wh).map(n=>`<option value="${safe(n.id)}">${safe(label(n))}</option>`).join('');
      if([...locationSelect.options].some(o=>o.value===old))locationSelect.value=old;
    };
    populateLocations();
    $('[data-field="warehouse_id"]').addEventListener('change',()=>{locationSelect.value='';populateLocations();locationSelect.value='';});
    dialog.showModal();
  }
  window.harazdGroupEdit = openGroup;
  $('#harazdGroupForm').onsubmit = async e => {
    e.preventDefault();
    const patch = {};
    for(const [field,,type] of FIELDS) {
      if(!$(`[data-use="${field}"]`).checked) continue;
      const raw = $(`[data-field="${field}"]`).value.trim();
      if(field === 'custom_fields') {
        const rows = raw.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
        if(rows.some(x=>!x.includes(':') || !x.split(':').slice(1).join(':').trim())) return toast('Додаткові характеристики: формат «Назва: значення»',true);
        patch[field] = rows.map(x=>({name:x.slice(0,x.indexOf(':')).trim(),value:x.slice(x.indexOf(':')+1).trim()}));
        if(patch[field].some(x=>!x.name)) return toast('Вкажіть назви характеристик',true);
      } else if(type === 'number') {
        if(raw && (!Number.isFinite(Number(raw)) || Number(raw)<0)) return toast('Некоректне число: '+field,true);
        patch[field] = raw ? Number(raw) : 0;
      } else patch[field] = raw || null;
    }
    if(!Object.keys(patch).length) return toast('Позначте хоча б одне поле',true);
    if('name' in patch && !patch.name) return toast('Назва не може бути порожньою',true);
    if('category_id' in patch && !patch.category_id) return toast('Оберіть категорію',true);
    if('accounting_type' in patch && patch.accounting_type!=='personal') return toast('Тип обліку групи не можна змінити масово: це вплине на групування. Змініть кожну одиницю окремо.',true);
    if('location_id' in patch && patch.location_id){
      const node=(typeof locationNodes!=='undefined'?locationNodes:[]).find(x=>x.id===patch.location_id);
      const warehouse=patch.warehouse_id||items.find(x=>x.id===groupIds[0])?.warehouse_id;
      if(!node||node.warehouse_id!==warehouse)return toast('Місце не належить вибраному складу',true);
    }
    if('warehouse_id' in patch && !('location_id' in patch) && groupIds.some(id=>items.find(x=>x.id===id)?.warehouse_id!==patch.warehouse_id))return toast('При зміні складу також позначте «Місце зберігання», щоб не залишити місце зі старого складу',true);
    if('category_id' in patch && !('subcategory_id' in patch)) {
      const first = items.find(x=>x.id===groupIds[0]);
      if(first?.category_id!==patch.category_id) return toast('Для зміни категорії окремо позначте поле «Підкатегорія» та виберіть відповідне значення',true);
    }
    if('subcategory_id' in patch && patch.subcategory_id && !subcategories.some(x=>x.id===patch.subcategory_id&&x.category_id===(patch.category_id||items.find(x=>x.id===groupIds[0])?.category_id)))return toast('Підкатегорія не відповідає категорії',true);
    if('photo_url' in patch && patch.photo_url && !/^https:\/\/[^\s<>"']+$/i.test(patch.photo_url)) return toast('Фото: вкажіть HTTPS-посилання',true);
    const changed = Object.entries(patch).filter(([field,value]) => groupIds.some(id => {
      const current=items.find(x=>x.id===id)?.[field] ?? null;
      return JSON.stringify(current)!==JSON.stringify(value);
    }));
    if(!changed.length)return toast('У вибраних полях змін немає');
    const labels=changed.map(([field])=>FIELDS.find(x=>x[0]===field)?.[1]||field);
    const differing=changed.filter(([field])=>new Set(groupIds.map(id=>JSON.stringify(items.find(x=>x.id===id)?.[field]??null))).size>1).map(([field])=>FIELDS.find(x=>x[0]===field)?.[1]||field);
    const message=`Застосувати зміни до всіх ${groupIds.length} одиниць групи?\n\nПоля: ${labels.join(', ')}${differing.length?'\n\nУвага: ці поля зараз відрізняються між одиницями: '+differing.join(', '):''}\n\nІндивідуальні поля не змінюються.`;
    if(!confirm(message))return;
    const save=$('#harazdGroupSave');save.disabled=true;
    try {
      // Update each UUID explicitly; only checked fields are included.
      const {data,error} = await db.from('equipment').update(patch).in('id',groupIds).select('id');
      if(error) throw error;
      if((data||[]).length!==groupIds.length) throw Error(`Оновлено ${data?.length||0} з ${groupIds.length}. Перевірте дозволи доступу.`);
      close();await loadItems();toast(`Зміни застосовано до ${groupIds.length} одиниць`);
    } catch(err) {toast('Редагування групи: '+err.message,true);} finally {save.disabled=false;}
  };
})();
