/* HARAZD WAREHOUSE: edit shared attributes of every personal EQ-ID in a group.
   Individual fields (IDs, serial, barcode, QR, location, repair/status, documents) are untouched. */
(() => {
  const FIELDS = [
    ['name','Найменування','text'],['description','Опис','textarea'],
    ['manufacturer','Виробник','text'],['model','Модель','text'],
    ['category_id','Категорія','category'],['subcategory_id','Підкатегорія','subcategory'],
    ['unit','Одиниця виміру','text'],['weight','Вага / кг','number'],
    ['packaging','Пакування','text'],['price','Ціна / грн','number'],
    ['rental_price','Оренда / доба','number'],['photo_url','Фото (HTTPS URL)','text'],
    ['custom_fields','Додаткові характеристики (назва: значення, кожен рядок)','textarea']
  ];
  let groupIds = [];
  const safe = s => String(s ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const dialog = document.createElement('dialog');
  dialog.className = 'harazd-group-dialog';
  dialog.innerHTML = `<form id="harazdGroupForm"><div class="harazd-group-head"><h2>Редагування всієї групи</h2><button type="button" id="harazdGroupClose">✕</button></div><p id="harazdGroupCount" class="muted"></p><p class="muted">Позначте тільки ті поля, які потрібно змінити для всіх одиниць. Непозначені поля не змінюються.</p><div id="harazdGroupFields" class="harazd-group-fields"></div><div class="actions"><button type="button" id="harazdGroupCancel">Скасувати</button><button type="submit" class="primary" id="harazdGroupSave">Зберегти для всієї групи</button></div></form>`;
  document.body.append(dialog);
  const $ = sel => dialog.querySelector(sel);
  const close = () => dialog.close();
  $('#harazdGroupClose').onclick = close;
  $('#harazdGroupCancel').onclick = close;
  function fillOptions(kind, value, category) {
    const arr = kind === 'category' ? categories : subcategories.filter(s => !category || s.category_id === category);
    return `<option value="">— Не вибрано —</option>` + arr.map(x => `<option value="${safe(x.id)}" ${x.id === value ? 'selected' : ''}>${safe(x.name)}</option>`).join('');
  }
  function openGroup(key) {
    const members = items.filter(x => x.accounting_type === 'personal' && personalKey(x) === key);
    if (members.length < 2) return toast('Групу не знайдено',true);
    groupIds = members.map(x=>x.id);
    const first = members[0];
    $('#harazdGroupCount').textContent = `${first.name} · ${members.length} одиниць обладнання`;
    $('#harazdGroupFields').innerHTML = FIELDS.map(([field,label,type]) => {
      const v = field === 'custom_fields' ? (Array.isArray(first.custom_fields) ? first.custom_fields.map(x=>`${x.name}: ${x.value}`).join('\n') : '') : first[field] ?? '';
      let control;
      if(type === 'category' || type === 'subcategory') control = `<select data-field="${field}">${fillOptions(type,v,first.category_id)}</select>`;
      else if(type === 'textarea') control = `<textarea data-field="${field}" rows="${field==='custom_fields'?3:2}">${safe(v)}</textarea>`;
      else control = `<input data-field="${field}" type="${type}" ${type==='number'?'step="any" min="0"':''} value="${safe(v)}">`;
      return `<div class="harazd-group-field"><label class="harazd-group-check"><input type="checkbox" data-use="${field}"> <span>${safe(label)}</span></label>${control}</div>`;
    }).join('');
    $('[data-field="category_id"]').addEventListener('change',e=>{
      const sub = $('[data-field="subcategory_id"]');
      sub.innerHTML = fillOptions('subcategory','',e.target.value);
      $('[data-use="subcategory_id"]').checked = true;
    });
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
    if('category_id' in patch && !('subcategory_id' in patch)) {
      const first = items.find(x=>x.id===groupIds[0]);
      if(first?.category_id!==patch.category_id) return toast('При зміні категорії також виберіть підкатегорію',true);
    }
    if('photo_url' in patch && patch.photo_url && !/^https:\/\/[^\s<>"']+$/i.test(patch.photo_url)) return toast('Фото: вкажіть HTTPS-посилання',true);
    if(!confirm(`Застосувати вибрані зміни до всіх ${groupIds.length} одиниць групи?`)) return;
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
