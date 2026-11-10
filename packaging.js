(()=>{'use strict';
const $=id=>document.getElementById(id),cfg=window.HARAZD_CONFIG||{},db=window.supabase&&cfg.SUPABASE_URL&&cfg.SUPABASE_ANON_KEY?window.supabase.createClient(cfg.SUPABASE_URL,cfg.SUPABASE_ANON_KEY):null;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const kind={rack:'Рек',case:'Кейс',box:'Ящик',pallet:'Палета',other:'Інше'};
let items=[],contents=[],equipment=[],selected=null,session=null,pkgPickerRefs={categories:[],subcategories:[],warehouses:[]},pkgPickerView=localStorage.getItem('harazd-packaging-picker-view')==='table'?'table':'cards',pkgRenderedGroups=[],rackPendingStart=null,rackMovingId=null,rackSwapBusy=false,rackDropHandled=false;
let pkgBulkMode=false,pkgBulkBusy=false;const pkgBulkSelected=new Map();
const PKG_PHOTO_BUCKET='packaging-photos';let pkgPhotoFile=null,pkgPhotoObjectUrl=null,pkgPhotoRemoved=false;
function pkgPhotoReset(){if(pkgPhotoObjectUrl)URL.revokeObjectURL(pkgPhotoObjectUrl);pkgPhotoObjectUrl=null;pkgPhotoFile=null;pkgPhotoRemoved=false;$('pkgPhotoFile').value='';$('pkgPhotoCapture').value='';$('pkgPhotoUrl').value='';pkgPhotoPreview();}
function pkgPhotoPreview(){const wrap=$('pkgPhotoPreview');wrap.replaceChildren();const url=pkgPhotoObjectUrl||(!pkgPhotoRemoved?$('pkgPhotoUrl').value.trim():'');$('pkgPhotoRemove').hidden=!url;if(!url)return;const img=document.createElement('img');img.alt='Фото пакування';img.src=url;img.onerror=()=>{img.remove();};wrap.append(img);}
function pkgPhotoChoose(file){if(!file)return;if(!['image/jpeg','image/png','image/webp'].includes(file.type))return msg('Доступні лише JPG, PNG, WEBP',true);if(file.size>10*1024*1024)return msg('Фото має бути до 10 МБ',true);if(pkgPhotoObjectUrl)URL.revokeObjectURL(pkgPhotoObjectUrl);pkgPhotoFile=file;pkgPhotoObjectUrl=URL.createObjectURL(file);pkgPhotoRemoved=false;$('pkgPhotoUrl').value='';pkgPhotoPreview();}
async function pkgPhotoUpload(file){const ext=file.type==='image/png'?'png':file.type==='image/webp'?'webp':'jpg';const path=crypto.randomUUID()+'.'+ext;const {error}=await db.storage.from(PKG_PHOTO_BUCKET).upload(path,file,{contentType:file.type,upsert:false});if(error)throw Error('Не вдалося завантажити фото: '+error.message);return db.storage.from(PKG_PHOTO_BUCKET).getPublicUrl(path).data.publicUrl;}

function msg(t,bad=false){$('toast').textContent=t;$('toast').style.cssText=`display:block;padding:15px;background:${bad?'#69303a':'#253d39'};border-radius:12px;color:white`;clearTimeout(msg.timer);msg.timer=setTimeout(()=>$('toast').style.display='none',5500)}
function check(r){if(r.error)throw r.error;return r.data}
function editable(){return !!session}
function fmt(n){return Number(n||0).toLocaleString('uk-UA',{maximumFractionDigits:2})}
function descendants(id){const found=[];const walk=p=>{for(const c of items.filter(x=>x.parent_id===p)){found.push(c.id);walk(c.id)}};walk(id);return found}
function allWeight(id,seen=new Set()){if(seen.has(id))return 0;seen.add(id);const p=items.find(x=>x.id===id);if(!p)return 0;const own=Number(p.empty_weight_kg||0);const eq=contents.filter(x=>x.packaging_id===id).reduce((sum,x)=>sum+Number(equipment.find(e=>e.id===x.equipment_id)?.weight||0)*Number(x.quantity),0);return own+eq+items.filter(x=>x.parent_id===id).reduce((sum,x)=>sum+allWeight(x.id,seen),0)}
// A nested package remains the owner of its equipment; the parent's totals are a view of the tree.
function pkgTreeIds(rootId){
 const ids=new Set(),queue=[rootId];
 while(queue.length){
  const id=queue.pop();
  if(ids.has(id))continue;
  ids.add(id);
  for(const child of items)if(child.parent_id===id&&!ids.has(child.id))queue.push(child.id);
 }
 return ids;
}
function pkgTreeContents(rootId){const ids=pkgTreeIds(rootId);return contents.filter(x=>ids.has(x.packaging_id))}
function pkgTreeQty(rootId){return pkgTreeContents(rootId).reduce((sum,x)=>sum+Number(x.quantity||0),0)}
function pkgCardPhoto(p){const url=String(p.photo_url||'');return /^https:\/\/[^\s"'<>]+$/i.test(url)?`<div class="pkg-card-photo"><img src="${esc(url)}" alt="Фото ${esc(p.name)}" loading="lazy" referrerpolicy="no-referrer" onerror="this.parentElement.style.display='none'"></div>`:'';}

// Package thumbnail in the "Nested packages" rows. Use the same photo_url as package cards.
function pkgNestedThumb(p){
 const url=String(p?.photo_url||'');
 if(/^https:\/\/[^\s"'<>]+$/i.test(url)){
  return `<img class="pkg-equipment-photo" src="${esc(url)}" alt="Фото ${esc(p?.name||'пакування')}" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.display='none';this.nextElementSibling.hidden=false"><span class="pkg-equipment-placeholder" hidden aria-hidden="true">◇</span>`;
 }
 return '<span class="pkg-equipment-placeholder" aria-hidden="true">◇</span>';
}

function render(){const q=$('search').value.toLowerCase(),kindFilter=$('kind').value,modeFilter=$('mode').value;const filtered=items.filter(p=>(!kindFilter||p.kind===kindFilter)&&(!modeFilter||p.mode===modeFilter)&&[p.name,p.pk_id,p.model,p.location].join(' ').toLowerCase().includes(q));$('stats').innerHTML=`<div class="pkg-stat"><strong>${items.length}</strong>Всього</div><div class="pkg-stat"><strong>${items.filter(p=>!contents.some(c=>c.packaging_id===p.id)&&!items.some(c=>c.parent_id===p.id)).length}</strong>Порожні</div><div class="pkg-stat"><strong>${items.filter(p=>p.mode==='fixed').length}</strong>Постійні</div>`;$('list').innerHTML=filtered.length?filtered.map(p=>`<button class="pkg-card" data-id="${esc(p.id)}">${pkgCardPhoto(p)}<span class="pkg-id">${esc(p.pk_id)}</span><h3>${esc(p.name)}</h3><div class="pkg-muted">${esc(kind[p.kind])} · ${p.mode==='fixed'?'Постійна':'Змінна'} комплектація</div><div class="pkg-muted">${esc(p.location||'Розміщення не задано')}</div><div class="pkg-muted">Обладнання: ${pkgTreeContents(p.id).length} · Вкладень: ${items.filter(x=>x.parent_id===p.id).length}</div></button>`).join(''):'<p class="pkg-muted">Пакувань не знайдено.</p>'}
async function load(){if(!db){$('notice').classList.remove('hidden');$('notice').textContent='Не налаштовано Supabase';return}try{const auth=check(await db.auth.getUser());session=auth.user;if(!session){$('notice').classList.remove('hidden');$('notice').textContent='Спочатку увійдіть до HARAZD WAREHOUSE на головній сторінці.';return}const results=await Promise.all([db.from('packaging').select('*').order('pk_id'),db.from('packaging_contents').select('*'),db.from('equipment').select('id,eq_id,name,model,description,weight,rack_units,quantity,repair_quantity,accounting_type,photo_url,category_id,subcategory_id,warehouse_id,zone,rack,shelf').limit(10000)]);items=check(results[0]);contents=check(results[1]);equipment=check(results[2]);render();const deepPk=new URLSearchParams(location.search).get('pk');if(deepPk){const deep=items.find(x=>x.pk_id===deepPk);if(deep)details(deep)}const picked=sessionStorage.getItem('harazd-packaging-picked');if(picked){sessionStorage.removeItem('harazd-packaging-picked');try{const data=JSON.parse(picked);const p=items.find(x=>x.id===data.packagingId);const eq=equipment.find(x=>x.id===data.equipmentId);if(p&&eq){details(p);await chooseEquipment(eq)}}catch(e){msg(e.message,true)}}}catch(e){$('notice').classList.remove('hidden');$('notice').textContent='Не вдалося завантажити пакування: '+e.message+' Перевірте, чи виконано SETUP_PACKAGING.sql.'}}
async function edit(p){
 selected=p||null;const f=$('form');f.reset();$('formTitle').textContent=p?`Редагувати ${p.pk_id}`:'Нове пакування';
 if(p)for(const [k,v] of Object.entries(p)){const input=f.elements.namedItem(k);if(input&&v!=null)input.value=v}
 pkgPhotoReset();$('pkgPhotoUrl').value=p?.photo_url||'';pkgPhotoPreview();
 try{
  await pkgLoadLocations();
  const chain=pkgLocChain(p?.location_id),wh=p?.warehouse_id||chain[0]?.warehouse_id||'';
  pkgOptions('pkgEditWarehouse',pkgWarehouses,'Оберіть склад',wh);
  pkgEditRefresh('warehouse',chain.find(n=>n.kind==='zone')?.id||'');
  const rack=chain.find(n=>n.kind==='rack');if(rack){$('pkgEditRack').value=rack.id;pkgEditRefresh('rack')}
  const shelf=chain.find(n=>n.kind==='shelf');if(shelf){$('pkgEditShelf').value=shelf.id;pkgEditRefresh('shelf')}
  const place=chain.find(n=>n.kind==='place');if(place)$('pkgEditPlace').value=place.id;
  $('editor').showModal();
 }catch(e){msg('Не вдалося завантажити місця зберігання: '+e.message,true)}
}
function pkgEditRefresh(level,initial=''){
 const wh=$('pkgEditWarehouse').value;
 if(level==='warehouse')pkgOptions('pkgEditZone',pkgLocationNodes.filter(n=>n.kind==='zone'&&n.warehouse_id===wh),wh?'Оберіть зону':'Спочатку оберіть склад',initial);
 if(['warehouse','zone'].includes(level))pkgOptions('pkgEditRack',pkgLocationNodes.filter(n=>n.kind==='rack'&&n.parent_id===$('pkgEditZone').value),'Без стелажа');
 if(['warehouse','zone','rack'].includes(level))pkgOptions('pkgEditShelf',pkgLocationNodes.filter(n=>n.kind==='shelf'&&n.parent_id===$('pkgEditRack').value),'Без полиці');
 const parent=$('pkgEditShelf').value||$('pkgEditRack').value||$('pkgEditZone').value;
 pkgOptions('pkgEditPlace',pkgLocationNodes.filter(n=>n.kind==='place'&&n.parent_id===parent),parent?'Оберіть місце':'Спочатку оберіть зону');
 $('pkgEditHint').textContent=parent?'Оберіть кінцеве місце зберігання.':'Спочатку оберіть зону.';
}
for(const [id,level] of [['pkgEditWarehouse','warehouse'],['pkgEditZone','zone'],['pkgEditRack','rack'],['pkgEditShelf','shelf']])$(id).onchange=()=>pkgEditRefresh(level);

function num(f,key){const s=f.elements.namedItem(key).value;return s===''?null:Number(s)}
async function save(e){
 e.preventDefault();const f=e.target;
 const warehouse_id=$('pkgEditWarehouse').value,location_id=$('pkgEditPlace').value;
 const place=pkgLocationNodes.find(n=>n.id===location_id);
 if(!place||place.kind!=='place'||place.warehouse_id!==warehouse_id)return msg('Оберіть місце зберігання у вибраному складі',true);
 const chain=pkgLocChain(location_id);
 const location=chain.map(n=>n.name).join(' / ');
 const row={name:f.elements.name.value.trim(),kind:f.elements.kind.value,mode:f.elements.mode.value,manufacturer:f.elements.manufacturer.value.trim()||null,model:f.elements.model.value.trim()||null,description:f.elements.description.value.trim()||null};
 if(selected?.kind==='rack'&&selected?.id&&contents.some(c=>c.packaging_id===selected.id&&c.rack_start_u!=null)){const nextHeight=Number(f.elements.rack_u.value||0);if(row.kind!=='rack'||contents.some(c=>c.packaging_id===selected.id&&c.rack_start_u!=null&&Number(c.rack_start_u)+Number(c.rack_height_u)-1>nextHeight))return msg('Спочатку звільніть юніти за межами нової висоти река',true)}
 for(const k of ['length_mm','width_mm','height_mm','empty_weight_kg','max_payload_kg','rack_u','rack_depth_mm'])row[k]=num(f,k);
 const saveBtn=f.querySelector('button[type="submit"]');saveBtn.disabled=true;
 try{
  const photoUrl=$('pkgPhotoUrl').value.trim();if(photoUrl&&!/^https:\/\/[^\s"'<>]+$/i.test(photoUrl))throw Error('Вкажіть коректне HTTPS-посилання на фото');
  if(pkgPhotoFile)row.photo_url=await pkgPhotoUpload(pkgPhotoFile);else if(pkgPhotoRemoved)row.photo_url=null;else if(photoUrl)row.photo_url=photoUrl;else if(!selected)row.photo_url=null;
  if(selected){
   if(selected.warehouse_id!==warehouse_id||selected.location_id!==location_id){
    // The RPC moves nested packaging and contents atomically, and logs the move.
    check(await db.rpc('packaging_move_with_contents',{p_packaging_id:selected.id,p_location_id:location_id}));
   }
   check(await db.from('packaging').update(row).eq('id',selected.id).select());
  }else{
   row.warehouse_id=warehouse_id;row.location_id=location_id;row.location=location;
   check(await db.from('packaging').insert(row).select());
  }
  $('editor').close();pkgPhotoReset();msg('Пакування збережено');await load();
 }catch(err){msg('Не вдалося зберегти пакування: '+err.message,true)}
 finally{saveBtn.disabled=false}
}

function eqLabel(id){const e=equipment.find(x=>x.id===id);return e?`${esc(e.name)} · ${esc(e.eq_id||'')}`:esc(id)}
function equipmentThumb(id){
 const e=equipment.find(x=>x.id===id);
 const url=String(e?.photo_url||'');
 if(/^https:\/\/[^\s"'<>]+$/i.test(url)){
  return `<img class="pkg-equipment-photo" src="${esc(url)}" alt="${esc(e.name||'Фото обладнання')}" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.display='none';this.nextElementSibling.hidden=false"><span class="pkg-equipment-placeholder" hidden aria-hidden="true">◇</span>`;
 }
 return '<span class="pkg-equipment-placeholder" aria-hidden="true">◇</span>';
}
function rackUnits(p){return p?.kind==='rack'?Math.max(0,Math.min(100,Math.trunc(Number(p.rack_u)||0))):0}
function rackOccupied(start,height,excludeId=null){
 const n=rackUnits(selected);
 const s=Number(start),h=Number(height);
 if(!Number.isSafeInteger(s)||!Number.isSafeInteger(h)||s<1||h<1||s+h-1>n)return true;
 return contents.some(row=>row.packaging_id===selected.id&&row.id!==excludeId&&row.rack_start_u!=null&&row.rack_height_u!=null&&s<=Number(row.rack_start_u)+Number(row.rack_height_u)-1&&s+h-1>=Number(row.rack_start_u));
}
function rackSwapAllowed(source,target){
 if(!selected||selected.kind!=='rack'||!source||!target||source.id===target.id
  ||source.packaging_id!==selected.id||target.packaging_id!==selected.id
  ||Number(source.quantity)!==1||Number(target.quantity)!==1)return false;
 const aStart=Number(source.rack_start_u), bStart=Number(target.rack_start_u);
 const aHeight=Number(source.rack_height_u), bHeight=Number(target.rack_height_u);
 const count=rackUnits(selected);
 if(!Number.isSafeInteger(aStart)||!Number.isSafeInteger(bStart)
  ||!Number.isSafeInteger(aHeight)||!Number.isSafeInteger(bHeight)
  ||aStart<1||bStart<1||aHeight<1||bHeight<1)return false;
 const aEnd=bStart+aHeight-1, bEnd=aStart+bHeight-1;
 if(aEnd>count||bEnd>count)return false;
 if(bStart<=bEnd && aStart<=aEnd)return false;
 return !contents.some(row=>row.packaging_id===selected.id
  &&row.id!==source.id&&row.id!==target.id
  &&row.rack_start_u!=null&&row.rack_height_u!=null
  &&((bStart<=Number(row.rack_start_u)+Number(row.rack_height_u)-1&&aEnd>=Number(row.rack_start_u))
  ||(aStart<=Number(row.rack_start_u)+Number(row.rack_height_u)-1&&bEnd>=Number(row.rack_start_u))));
}
async function rackSwap(sourceId,targetId){
 if(rackSwapBusy||!selected||selected.kind!=='rack')return;
 const source=contents.find(x=>x.id===sourceId&&x.packaging_id===selected.id);
 const target=contents.find(x=>x.id===targetId&&x.packaging_id===selected.id);
 if(!rackSwapAllowed(source,target)){
  msg('Не можна поміняти прилади місцями: недостатньо суміжних вільних юнітів',true);return;
 }
 rackSwapBusy=true;
 try{
  check(await db.rpc('packaging_rack_swap',{
   p_packaging_id:selected.id,p_source_id:source.id,p_target_id:target.id
  }));
  rackMovingId=null;
  await reloadDetail();
  msg('Обладнання успішно помінялося місцями');
 }catch(err){msg('Не вдалося поміняти місцями: '+(err?.message||err),true)}
 finally{rackSwapBusy=false}
}
function rackView(p,own){
 const units=rackUnits(p);
 if(!units)return '<div class="rack-empty-config">Щоб відображати юніти, вкажіть висоту река (U) у параметрах картки.</div>';
 const rows=[];
 let used=0;
 // Each installed item is represented by ONE continuous block of its actual height.
 for(let u=units;u>=1;){
  const record=own.find(x=>x.rack_start_u!=null&&x.rack_height_u!=null&&u>=Number(x.rack_start_u)&&u<Number(x.rack_start_u)+Number(x.rack_height_u));
  if(record){
   const start=Number(record.rack_start_u),height=Number(record.rack_height_u),top=start+height-1;
   // Skip any inconsistent partial/overlapping record without breaking the rack view.
   if(u!==top){u--;continue;}
   used+=height;
   const slotNumbers=Array.from({length:height},(_,i)=>top-i);
   const moving=own.find(x=>x.id===rackMovingId);
   const canSwap=!!moving&&rackSwapAllowed(moving,record);
   rows.push(`<div class="rack-unit occupied rack-unit-span${rackMovingId===record.id?' rack-is-moving':''}${canSwap?' rack-swap-target':''}" style="--rack-span:${height}" draggable="true" data-rack-drag="${esc(record.id)}" ${canSwap?`data-rack-swap-target="${esc(record.id)}"`:''} aria-label="${esc(eqLabel(record.equipment_id))}: ${height}U, юніти ${start}–${top}"><div class="rack-span-numbers">${slotNumbers.map(n=>`<span class="rack-number">${n}U</span>`).join('')}</div><div class="rack-equipment"><strong>${eqLabel(record.equipment_id)}</strong><small>${height}U · юніти ${start}–${top}</small>${canSwap?`<button type="button" class="rack-swap-button" data-rack-swap="${esc(record.id)}">⇄ Поміняти місцями</button>`:`<button type="button" class="rack-move-button" data-rack-move="${esc(record.id)}">↕ Перемістити</button>`}</div></div>`);
   u=start-1;
  }else{
   const moving=own.find(x=>x.id===rackMovingId),canMove=!!moving&&!rackOccupied(u,Number(moving.rack_height_u),moving.id);
   rows.push(`<button class="rack-unit free${moving?(canMove?' rack-move-target':' rack-move-invalid'):''}" type="button" data-rack-free="${u}" aria-label="${moving?(canMove?'Перемістити обладнання на юніт ':'Немає місця для переміщення на юніт '):'Вільний юніт '}${u}" ${moving&&!canMove?'disabled':''}><span class="rack-number">${u}U</span><span class="rack-empty-text">${moving?(canMove?'↓ Перемістити сюди':'Недостатньо вільних U'):'＋ Вільно — додати обладнання'}</span></button>`);
   u--;
  }
 }
 const notPlaced=own.filter(x=>x.rack_start_u==null||x.rack_height_u==null);
 return `<div class="rack-overview"><span>${units}U загалом</span><span>${used}U зайнято</span><span>${units-used}U вільно</span>${rackMovingId?'<button type="button" class="rack-cancel-move" data-rack-cancel>Скасувати переміщення</button>':''}</div>${rackMovingId?'<p class="rack-move-hint">Виберіть вільний юніт або натисніть «Поміняти місцями» на зайнятому слоті. Можна також перетягнути блок.</p>':''}<div class="rack-chassis"><div class="rack-panel-top">REК · ${units}U</div><div class="rack-unit-list">${rows.join('')}</div><div class="rack-panel-bottom"></div></div>${notPlaced.length?`<div class="rack-unplaced"><h4>Не розміщено в юнітах (${notPlaced.length})</h4><p class="pkg-note">Раніше додане обладнання залишилося у пакуванні. Вкажіть позицію в реку. Висота U береться з картки обладнання, якщо задана.</p>${notPlaced.map(x=>`<div class="rack-unplaced-row"><span>${eqLabel(x.equipment_id)} · ${fmt(x.quantity)} шт.</span>${Number(x.quantity)===1?`<button type="button" data-rack-place="${esc(x.id)}">Розмістити в реку</button>`:'<small>Для позиціонування потрібно по 1 шт. на рядок</small>'}</div>`).join('')}</div>`:''}`;
}
function rackPlacement(equipmentId=null,excludeId=null){
 const n=rackUnits(selected);
 if(!n){msg('Спочатку вкажіть висоту река (U) у параметрах пакування',true);return null}
 const equipmentRecord=equipment.find(e=>e.id===equipmentId);
 const savedHeight=equipmentRecord?.rack_units==null?null:Number(equipmentRecord.rack_units);
 const heightRaw=savedHeight!==null?savedHeight:prompt(`Для цього обладнання не задано висоту U. Скільки юнітів займає обладнання? Рек ${n}U:`, '1');
 if(heightRaw===null)return null;
 const height=Number(heightRaw);
 if(!Number.isSafeInteger(height)||height<1||height>n){msg('Обладнання має недопустиму висоту U або не поміщається в рек',true);return null}
 const suggested=rackPendingStart!=null?Math.max(1,Math.min(n-height+1,rackPendingStart)):
  Array.from({length:n-height+1},(_,i)=>i+1).find(start=>!rackOccupied(start,height,excludeId));
 if(!suggested){msg('У реку немає вільної послідовності юнітів такої висоти',true);return null}
 const startRaw=prompt(`Позиція нижнього юніта (1–${n-height+1}).\nОбладнання займатиме ${height}U.`,String(suggested));
 if(startRaw===null)return null;
 const start=Number(startRaw);
 if(rackOccupied(start,height,excludeId)){msg('Юніти зайняті або позиція виходить за межі река',true);return null}
 return {rack_start_u:start,rack_height_u:height};
}
async function rackMoveTo(rowId,newStart){
 if(!selected||selected.kind!=='rack')return;
 const row=contents.find(x=>x.id===rowId&&x.packaging_id===selected.id);
 if(!row||row.rack_start_u==null||row.rack_height_u==null||Number(row.quantity)!==1){msg('Це обладнання неможливо перемістити між юнітами',true);return}
 const start=Number(newStart),height=Number(row.rack_height_u);
 if(!Number.isSafeInteger(start)||rackOccupied(start,height,row.id)){msg('Недостатньо суміжних вільних юнітів для переміщення',true);return}
 if(start===Number(row.rack_start_u)){rackMovingId=null;details(selected);return}
 try{
  check(await db.from('packaging_contents').update({rack_start_u:start}).eq('id',row.id).eq('packaging_id',selected.id).select());
  rackMovingId=null;await reloadDetail();msg(`Обладнання переміщено на юніти ${start}–${start+height-1}`);
 }catch(err){msg('Не вдалося перемістити: '+(err?.message||err),true)}
}
function details(p){
 const detailDialog=$('details');
 const resetToTop=!detailDialog.open||selected?.id!==p.id;
 const pkgHero=pkgCardPhoto(p);
 if(selected?.id!==p.id){rackPendingStart=null;rackMovingId=null;}
 selected=p;
 $('detailTitle').textContent=`${p.pk_id} · ${p.name}`;
 const own=contents.filter(x=>x.packaging_id===p.id);
 const children=items.filter(x=>x.parent_id===p.id),parent=items.find(x=>x.id===p.parent_id);
 const inherited=pkgTreeContents(p.id).filter(x=>x.packaging_id!==p.id);
 const treeRows=[...own,...inherited];
 const total=allWeight(p.id);
 const nestedEquipment=inherited.length?`<h4 class="pkg-nested-content-title">З вкладених пакувань (${inherited.length})</h4>${inherited.map(x=>{
  const container=items.find(item=>item.id===x.packaging_id);
  return `<div class="pkg-row"><div class="pkg-equipment-info"><div class="pkg-equipment-thumb">${equipmentThumb(x.equipment_id)}</div><span>${eqLabel(x.equipment_id)} · ${fmt(x.quantity)} шт.<small class="pkg-note pkg-nested-source">${esc(container?.pk_id||'')} · ${esc(container?.name||'')}</small></span></div></div>`;
 }).join('')}`:'';
 $('detailBody').innerHTML=`${pkgHero}<p class="pkg-muted">${esc(kind[p.kind])} · ${p.mode==='fixed'?'Постійна':'Змінна'} комплектація · ${esc(p.location||'Без розміщення')}</p><div class="pkg-tools"><button id="editItem">Редагувати картку</button><button id="moveItem">Перемістити пакування</button><button id="printPkgQr">▦ Друк QR</button><button id="disbandItem" type="button" ${own.length||children.length?'':'disabled'}>Розформувати</button><button id="deleteItem" class="pkg-danger" type="button">Видалити</button></div><div class="pkg-section"><h3>Фактичний вміст (${treeRows.length})</h3>${inherited.length?`<p class="pkg-note">Безпосередньо: ${own.length} позицій · У вкладених: ${inherited.length} · Всього: ${fmt(treeRows.reduce((sum,x)=>sum+Number(x.quantity||0),0))} шт.</p>`:''}${p.kind==='rack'?rackView(p,own):''}${own.map(x=>`<div class="pkg-row"><div class="pkg-equipment-info"><div class="pkg-equipment-thumb">${equipmentThumb(x.equipment_id)}</div><span>${eqLabel(x.equipment_id)} · ${fmt(x.quantity)} шт.</span></div><button data-remove="${x.id}">Вилучити</button></div>`).join('')||(!inherited.length?'<p class="pkg-note">Обладнання немає</p>':'')}${nestedEquipment}<div class="pkg-tools"><button class="primary" id="addEquipment">${p.kind==='rack'?'＋ Додати в рек':'＋ Додати зі складу'}</button></div></div><div class="pkg-section"><h3>Вкладені пакування (${children.length})</h3>${children.map(x=>`<div class="pkg-row"><div class="pkg-equipment-info"><div class="pkg-equipment-thumb">${pkgNestedThumb(x)}</div><span>${esc(x.pk_id)} · ${esc(x.name)}<small class="pkg-note pkg-nested-source">${pkgTreeContents(x.id).length} позицій · ${fmt(pkgTreeQty(x.id))} шт. · ${fmt(allWeight(x.id))} кг</small></span></div><span class="pkg-nested-actions"><button data-child="${x.id}">Відкрити</button><button data-childdetach="${x.id}" type="button">Вийняти</button></span></div>`).join('')||'<p class="pkg-note">Вкладень немає</p>'}<button id="addChild">＋ Вкласти пакування</button>${parent?`<p class="pkg-note">У пакуванні: ${esc(parent.pk_id)} · ${esc(parent.name)}</p>`:''}</div><div class="pkg-section"><h3>Вага</h3><p>Порожнє: ${fmt(p.empty_weight_kg)} кг · Разом із вмістом: ${fmt(total)} кг</p>${children.length?`<p class="pkg-note">У тому числі вкладені пакування з їхнім обладнанням: ${fmt(children.reduce((sum,x)=>sum+allWeight(x.id),0))} кг</p>`:''}${p.max_payload_kg!=null?`<p class="pkg-note">Допустиме навантаження: ${fmt(p.max_payload_kg)} кг${total-Number(p.empty_weight_kg||0)>Number(p.max_payload_kg)?' · ⚠ Перевищено':''}</p>`:''}</div><div class="pkg-section"><h3>Історія</h3><div id="history" class="pkg-note">Завантаження...</div></div>`;
 if(!detailDialog.open)detailDialog.showModal();
 if(resetToTop){
  // Mobile browsers may restore scroll position or focus an off-screen dialog control.
  detailDialog.tabIndex=-1;
  detailDialog.style.overflowAnchor='none';
  const scrollArea=$('detailBody');
  scrollArea.style.overflowAnchor='none';
  detailDialog.focus({preventScroll:true});
  const pkgId=p.id;
  const resetCardTop=()=>{
   if(!detailDialog.open||selected?.id!==pkgId)return;
   detailDialog.scrollTop=0;
   scrollArea.scrollTop=0;
  };
  resetCardTop();
  requestAnimationFrame(()=>requestAnimationFrame(resetCardTop));
  setTimeout(resetCardTop,100);
  setTimeout(resetCardTop,300);
 }
 loadHistory(p.id);
}
async function loadHistory(id){try{const h=check(await db.from('packaging_history').select('action,created_at,details').eq('packaging_id',id).order('created_at',{ascending:false}).limit(30));if(selected?.id===id)$('history').innerHTML=h.map(x=>`<div class="pkg-row">${esc(new Date(x.created_at).toLocaleString('uk-UA'))} · ${esc(x.action)} · ${esc(x.details?.table||'переміщення')}</div>`).join('')||'Історія порожня'}catch(e){if($('history'))$('history').textContent=e.message}}
function addDialog(){
 $('addMethod').showModal();
}
function findEq(code){const raw=String(code||'').trim();const normalized=raw.match(/EQ-\d+/i)?.[0]||raw;return equipment.find(x=>String(x.eq_id||'').toLowerCase()===normalized.toLowerCase())}
function pickerLookup(list,id,fallback='—'){return list.find(x=>x.id===id)?.name||fallback}
function pickerAvailable(e,rows=contents){
 if(!e)return 0;
 const allocated=rows.filter(x=>x.equipment_id===e.id).reduce((sum,x)=>sum+Number(x.quantity||0),0);
 const available=Math.max(0,Number(e.quantity||0)-Number(e.repair_quantity||0)-allocated);
 const personal=String(e.accounting_type||'').toLowerCase();
 return (personal.includes('personal')||personal.includes('персон'))?(allocated>0?0:Math.min(1,available)):available;
}
function pickerCurrentQty(equipmentId){return contents.filter(x=>x.packaging_id===selected?.id&&x.equipment_id===equipmentId).reduce((sum,x)=>sum+Number(x.quantity||0),0)}
// Bulk allocation is for cases/boxes/pallets, not U-positioned rack devices.
// Quantity-accounted EQ-IDs may be distributed across multiple packages.
// Individually accounted EQ-IDs remain exclusive to one package.
function pkgBulkFree(item,rows=contents){return Math.floor(pickerAvailable(item,rows))} 
function packagingAllocationError(err){
 const message=String(err?.message||err||'Невідома помилка');
 if(err?.code==='23505'&&message.includes('packaging_contents_equipment_id_key')){
  return 'База даних ще не дозволяє розподіляти одну позицію між пакуваннями. Спочатку виконайте SETUP_PACKAGING_SHARED_QUANTITY.sql у Supabase.';
 }
 return message;
}
function pkgBulkGroupFree(group){return (group.members||[]).reduce((n,item)=>n+pkgBulkFree(item),0)}
function pkgPickerAddControl(group,available){
 const button=`<button type="button" class="primary" data-pkg-warehouse-group="${esc(group.id)}" ${available<=0?'disabled':''}>${group.current?'Додати ще':'Додати'}</button>`;
 if(selected?.kind==='rack'||available<2)return button;
 return `<div class="pkg-bulk-control"><label class="pkg-bulk-qty-label">Кількість <input type="number" inputmode="numeric" min="1" max="${available}" step="1" value="1" aria-label="Кількість ${esc(group.name)}" data-pkg-picker-qty="${esc(group.id)}"></label>${button}</div>`;
}
function pkgBulkControls(group){
 const free=pkgBulkGroupFree(group),entry=pkgBulkSelected.get(group.id),checked=!!entry;
 return `<div class="pkg-bulk-control"><label class="pkg-bulk-check"><input type="checkbox" data-pkg-bulk-check="${esc(group.id)}" ${checked?'checked':''} ${free<1&&!checked?'disabled':''}><span>Вибрати</span></label><label class="pkg-bulk-qty-label">Кількість <input aria-label="Кількість для ${esc(group.name)}" type="number" inputmode="numeric" min="1" max="${Math.max(free,1)}" step="1" value="${checked?esc(entry.quantity):1}" data-pkg-bulk-qty="${esc(group.id)}" ${!checked?'disabled':''}></label></div>`;
}
function pkgBulkState(){
 $('pkgWarehouseBulkToggle').hidden=!selected||selected.kind==='rack';
 $('pkgWarehouseBulkToggle').setAttribute('aria-pressed',String(pkgBulkMode));
 $('pkgWarehouseBulkToggle').textContent=pkgBulkMode?'✓ Масовий вибір':'☷ Масове додавання';
 $('pkgWarehouseBulkBar').classList.toggle('hidden',!pkgBulkMode);
 const qty=[...pkgBulkSelected.values()].reduce((n,e)=>n+Number(e.quantity||0),0);
 $('pkgWarehouseBulkCount').textContent=`Вибрано: ${pkgBulkSelected.size} позицій · ${qty} од.`;
 $('pkgWarehouseBulkAdd').disabled=pkgBulkBusy||pkgBulkSelected.size===0;
 $('pkgWarehouseBulkCancel').disabled=pkgBulkBusy;
 $('pkgWarehouseBulkToggle').disabled=pkgBulkBusy;
}
function pkgBulkReset(){pkgBulkMode=false;pkgBulkBusy=false;pkgBulkSelected.clear();pkgBulkState()}

function pickerStatus(item){const qty=Number(item?.quantity||0),repair=Number(item?.repair_quantity||0);if(qty<=0||repair>=qty)return{cls:'repair',label:'На ремонті'};if(repair>0)return{cls:'partial',label:'Частково доступно'};return{cls:'available',label:'Доступно'}}
function pickerPhoto(item){const url=String(item?.photo_url||'');return /^https:\/\/[^\s"'<>]+$/i.test(url)?`<img src="${esc(url)}" alt="${esc(item?.name||'Обладнання')}" loading="lazy" referrerpolicy="no-referrer">`:'<span class="pkg-picker-photo-empty" aria-hidden="true">◇</span>'}
function pickerLocationMarkup(item){const rows=[["Склад",pickerLookup(pkgPickerRefs.warehouses,item?.warehouse_id,'Не вказано')],["Зона",item?.zone||'—'],["Стелаж",item?.rack||'—'],["Полиця",item?.shelf||'—']];return rows.map(([label,value])=>`<div><span>${esc(label)}:</span><b>${esc(value)}</b></div>`).join('')}
function pickerLocationText(item){return [pickerLookup(pkgPickerRefs.warehouses,item?.warehouse_id,'Не вказано'),item?.zone,item?.rack,item?.shelf].filter(Boolean).join(' / ')||'Не вказано'}

function pickerFields(item){return [item?.name,item?.eq_id,item?.model,item?.description,pickerLookup(pkgPickerRefs.categories,item?.category_id,''),pickerLookup(pkgPickerRefs.subcategories,item?.subcategory_id,''),pickerLookup(pkgPickerRefs.warehouses,item?.warehouse_id,'')].map(v=>String(v||'').toLocaleLowerCase('uk-UA'))}
function pickerGroupedLabel(values,empty='—',mixed='Кілька'){const unique=[...new Set(values.map(v=>String(v||'').trim()).filter(Boolean))];if(!unique.length)return empty;return unique.length===1?unique[0]:mixed}
function pickerGroupEqLabel(group){if(!group)return'Без EQ-ID';if((group.members||[]).length===1)return group.members[0]?.eq_id||'Без EQ-ID';return `Група · ${(group.members||[]).length} EQ-ID`}
function pickerGroupRows(items){const map=new Map();const norm=v=>String(v??'').trim().toLocaleLowerCase('uk-UA');items.forEach(item=>{
 // Групуємо однакову номенклатуру, а не посилання на фото/індивідуальні описи.
 // EQ-ID залишаються окремими в базі й розподіляються при додаванні.
 const personal=['personal','персон'].some(v=>norm(item?.accounting_type).includes(v));
 const hasModel=!!(norm(item?.manufacturer)||norm(item?.model));
 const key=JSON.stringify([item?.name,item?.manufacturer,item?.model,item?.category_id,item?.subcategory_id,item?.accounting_type,(!personal&&!hasModel)?item?.description:''].map(norm));let group=map.get(key);if(!group){group={id:key,name:item?.name||'Обладнання',model:item?.model||'',manufacturer:item?.manufacturer||'',description:item?.description||'',photo_url:item?.photo_url||'',category_id:item?.category_id||'',subcategory_id:item?.subcategory_id||'',accounting_type:item?.accounting_type||'',members:[],warehouses:[],zones:[],racks:[],shelves:[],quantity:0,repair_quantity:0,current:0};map.set(key,group)}group.members.push(item);group.warehouses.push(pickerLookup(pkgPickerRefs.warehouses,item?.warehouse_id,'Не вказано'));group.zones.push(item?.zone||'');group.racks.push(item?.rack||'');group.shelves.push(item?.shelf||'');group.quantity+=Number(item?.quantity||0);group.repair_quantity+=Number(item?.repair_quantity||0);group.current+=pickerCurrentQty(item?.id)});return [...map.values()].map(group=>({...group,warehouse_label:pickerGroupedLabel(group.warehouses,'Не вказано','Різні склади'),zone_label:pickerGroupedLabel(group.zones,'—','Кілька'),rack_label:pickerGroupedLabel(group.racks,'—','Кілька'),shelf_label:pickerGroupedLabel(group.shelves,'—','Кілька')}))}
function pickerGroupFields(group){return [group?.name,group?.model,group?.manufacturer,group?.description,pickerLookup(pkgPickerRefs.categories,group?.category_id,''),pickerLookup(pkgPickerRefs.subcategories,group?.subcategory_id,''),...(group?.members||[]).map(item=>item?.eq_id),...new Set(group?.warehouses||[])].map(v=>String(v||'').toLocaleLowerCase('uk-UA'))}
function pickerGroupLocationMarkup(group){const rows=[["Склад",group?.warehouse_label||'Не вказано'],["Зона",group?.zone_label||'—'],["Стелаж",group?.rack_label||'—'],["Полиця",group?.shelf_label||'—']];return rows.map(([label,value])=>`<div><span>${esc(label)}:</span><b>${esc(value)}</b></div>`).join('')}
function pickerGroupLocationText(group){return [group?.warehouse_label,group?.zone_label,group?.rack_label,group?.shelf_label].filter(Boolean).join(' / ')||'Не вказано'}
function pickerCompare(a,b,sort){const byName=String(a?.name||'').localeCompare(String(b?.name||''),'uk');if(sort==='qty')return Number(b?.quantity||0)-Number(a?.quantity||0)||byName;if(sort==='availability')return pickerAvailable(b)-pickerAvailable(a)||byName;if(sort==='model')return String(a?.model||'').localeCompare(String(b?.model||''),'uk')||byName;if(sort==='subcategory'){const sub=pickerLookup(pkgPickerRefs.subcategories,a?.subcategory_id,'').localeCompare(pickerLookup(pkgPickerRefs.subcategories,b?.subcategory_id,''),'uk');if(sub)return sub;const cat=pickerLookup(pkgPickerRefs.categories,a?.category_id,'').localeCompare(pickerLookup(pkgPickerRefs.categories,b?.category_id,''),'uk');if(cat)return cat;return byName}return byName}
function pickerFillSelect(id,rows,placeholder,value=''){const el=$(id);if(!el)return;const prev=value||el.value||'';el.replaceChildren(new Option(placeholder,''),...rows.map(row=>new Option(row.name,row.id)));if(prev&&rows.some(row=>row.id===prev))el.value=prev}
async function loadPickerRefs(){if(pkgPickerRefs.categories.length&&pkgPickerRefs.subcategories.length&&pkgPickerRefs.warehouses.length)return;const [cats,subs,whs]=await Promise.all([db.from('categories').select('id,name').order('name'),db.from('subcategories').select('id,name,category_id').order('name'),db.from('warehouses').select('id,name').order('name')]);pkgPickerRefs={categories:check(cats),subcategories:check(subs),warehouses:check(whs)}}
function updatePickerViewState(){$('pkgWarehouseChoices').classList.toggle('hidden',pkgPickerView==='table');$('pkgWarehouseTableWrap').classList.toggle('hidden',pkgPickerView!=='table');$('pkgWarehouseViewCards').setAttribute('aria-pressed',String(pkgPickerView==='cards'));$('pkgWarehouseViewTable').setAttribute('aria-pressed',String(pkgPickerView==='table'))}
function updatePickerTarget(){if(!selected){$('pkgWarehouseTarget').textContent='Виберіть обладнання для поточного пакування';return;}$('pkgWarehouseTarget').textContent=`Вибір обладнання для ${selected.pk_id} · ${selected.name}. Натисніть на позицію або кнопку «Додати».`}
function pickerNotice(text=''){$('pkgWarehouseNotice').textContent=text}

async function chooseEquipment(e){
 if(!e||!selected)return;
 if(selected.kind==='rack'){
  const available=pickerAvailable(e);
  if(available<1)return msg('Це обладнання недоступне для додавання в рек',true);
  if(contents.some(x=>x.packaging_id===selected.id&&x.equipment_id===e.id))return msg('Цей EQ-ID уже є у реку',true);
  const placement=rackPlacement(e.id);
  if(!placement)return;
  const pk=selected.id;
  try{
   check(await db.from('packaging_contents').insert({packaging_id:pk,equipment_id:e.id,quantity:1,...placement}).select());
   rackPendingStart=null;
   $('addMethod').close();await reloadDetail();if($('pkgWarehousePicker').open)renderWarehousePicker();msg('Обладнання встановлено в рек');
  }catch(err){msg('Не вдалося додати: '+err.message,true)}
  return;
 }

 const personal=String(e.accounting_type||'').toLowerCase().includes('personal')||String(e.accounting_type||'').toLowerCase().includes('персон');
 const already=contents.filter(x=>x.equipment_id===e.id).reduce((sum,x)=>sum+Number(x.quantity||0),0);
 const max=Math.max(0,Number(e.quantity||1)-Number(e.repair_quantity||0)-already);
 if(max<=0)return msg('Усі доступні одиниці цієї позиції вже розміщені в пакуваннях',true);
 if(personal&&already)return msg('Цей EQ-ID вже знаходиться в пакуванні',true);
 const current=pickerCurrentQty(e.id);
 const answer=prompt(`${e.name} · ${e.eq_id}
Доступно для пакування: ${max} шт.
${current?`У цьому пакуванні: ${current} шт.
`:''}Вкажіть кількість:`, '1');
 if(answer===null)return;
 const count=Number(answer);
 if(!Number.isInteger(count)||count<1||count>max||(personal&&count!==1))return msg('Некоректна кількість',true);
 try{
  const existing=contents.find(x=>x.packaging_id===selected.id&&x.equipment_id===e.id);
  if(existing)check(await db.from('packaging_contents').update({quantity:Number(existing.quantity)+count}).eq('id',existing.id).select());
  else check(await db.from('packaging_contents').insert({packaging_id:selected.id,equipment_id:e.id,quantity:count}).select());
  $('addMethod').close();await reloadDetail();if($('pkgWarehousePicker').open){renderWarehousePicker();$('pkgWarehouseSearch').focus({preventScroll:true});}msg('Обладнання додано до пакування');
 }catch(ex){msg('Не вдалося додати: '+packagingAllocationError(ex),true)}
}
async function chooseEquipmentGroup(group,requestedQuantity=null){
 if(!group||!selected)return;
 if(selected.kind==='rack'){
  const availableMembers=(group.members||[]).filter(e=>pickerAvailable(e)>0&&!contents.some(c=>c.packaging_id===selected.id&&c.equipment_id===e.id));
  if(!availableMembers.length)return msg('У цій групі немає доступних EQ-ID для река',true);
  await chooseEquipment(availableMembers[0]);
  return;
 }
 const available=(group.members||[]).reduce((sum,item)=>sum+pickerAvailable(item),0);
 if(available<=0)return msg('Усі доступні одиниці цієї групи вже розміщені в пакуваннях',true);
 const current=group.current||0;
 let answer=requestedQuantity;
 if(answer===null){
  answer=prompt(`${group.name||'Обладнання'}
${group.members.length>1?`Згруповано позицій: ${group.members.length}
`:''}Доступно для пакування: ${available} шт.
${current?`У цьому пакуванні: ${current} шт.
`:''}Вкажіть кількість:`, '1');
 }
 if(answer===null)return;
 const count=Number(answer);
 if(!Number.isInteger(count)||count<1||count>available)return msg(`Некоректна кількість. Доступно максимум ${available} шт.`,true);
 const members=[...(group.members||[])].sort((a,b)=>pickerAvailable(b)-pickerAvailable(a)||String(a.eq_id||'').localeCompare(String(b.eq_id||''),'uk'));
 const assignments=[];let remaining=count;
 for(const item of members){if(remaining<=0)break;const free=pickerAvailable(item);if(!free)continue;const personal=String(item.accounting_type||'').toLowerCase().includes('personal')||String(item.accounting_type||'').toLowerCase().includes('персон');const take=Math.min(personal?1:free,remaining);if(take>0){assignments.push({item,quantity:take});remaining-=take}}
 if(!assignments.length||remaining>0)return msg(`Не вдалося розподілити вибрану кількість. Доступно максимум ${available} шт.`,true);
 try{
  for(const entry of assignments){
   const existing=contents.find(x=>x.packaging_id===selected.id&&x.equipment_id===entry.item.id);
   if(existing)check(await db.from('packaging_contents').update({quantity:Number(existing.quantity)+entry.quantity}).eq('id',existing.id).select());
   else check(await db.from('packaging_contents').insert({packaging_id:selected.id,equipment_id:entry.item.id,quantity:entry.quantity}).select());
  }
  $('addMethod').close();await reloadDetail();if($('pkgWarehousePicker').open){renderWarehousePicker();$('pkgWarehouseSearch').focus({preventScroll:true});}msg('Обладнання додано до пакування');
 }catch(ex){msg('Не вдалося додати: '+packagingAllocationError(ex),true)}
}
async function addById(){const code=$('pkgEqId').value.trim();const e=findEq(code);if(!e)return msg('EQ-ID не знайдено на складі',true);await chooseEquipment(e)}

function renderWarehousePicker(){
 const categoryValue=$('pkgWarehouseCategory').value;pickerFillSelect('pkgWarehouseCategory',pkgPickerRefs.categories,'Усі категорії',categoryValue);const subRows=pkgPickerRefs.subcategories.filter(row=>!categoryValue||row.category_id===categoryValue);pickerFillSelect('pkgWarehouseSubcategory',subRows,'Усі підкатегорії',$('pkgWarehouseSubcategory').value);pickerFillSelect('pkgWarehouseWarehouse',pkgPickerRefs.warehouses,'Усі склади',$('pkgWarehouseWarehouse').value);
 const q=$('pkgWarehouseSearch').value.trim().toLocaleLowerCase('uk-UA'),category=$('pkgWarehouseCategory').value,subcategory=$('pkgWarehouseSubcategory').value,warehouse=$('pkgWarehouseWarehouse').value,sort=$('pkgWarehouseSort').value||'subcategory';
 const base=equipment.filter(item=>(!category||item.category_id===category)&&(!subcategory||item.subcategory_id===subcategory)&&(!warehouse||item.warehouse_id===warehouse));
 pkgRenderedGroups=pickerGroupRows(base).filter(group=>!q||pickerGroupFields(group).some(v=>v.includes(q))).sort((a,b)=>pickerCompare(a,b,sort));
 const packedPositions=contents.filter(x=>x.packaging_id===selected?.id).length,packedUnits=contents.filter(x=>x.packaging_id===selected?.id).reduce((sum,x)=>sum+Number(x.quantity||0),0);$('pkgWarehouseSummary').innerHTML=`<strong>${pkgRenderedGroups.length}</strong><span>${pkgRenderedGroups.length===1?'позиція':'позицій'}</span>`;$('pkgWarehouseSelectionSummary').textContent=`У пакуванні: ${packedPositions} позицій · ${packedUnits} од.`;
 $('pkgWarehouseChoices').innerHTML=pkgRenderedGroups.length?pkgRenderedGroups.map(group=>{const available=pkgBulkMode?pkgBulkGroupFree(group):(group.members||[]).reduce((sum,item)=>sum+pickerAvailable(item),0),status=pickerStatus(group),total=Number(group.quantity||0),percent=total>0?Math.max(0,Math.min(100,Math.round((Math.max(0,total-Number(group.repair_quantity||0))/total)*100))):0,categoryName=pickerLookup(pkgPickerRefs.categories,group.category_id,'Без категорії'),description=group.description||[group.manufacturer,group.model].filter(Boolean).join(' · ')||'Опис не вказано';return `<article class="pkg-picker-card"><div class="pkg-picker-photo">${pickerPhoto(group)}<span class="pkg-picker-photo-badge">${esc(categoryName)}</span></div><div class="pkg-picker-body"><div class="pkg-picker-top"><span class="pkg-picker-id">${esc(pickerGroupEqLabel(group))}</span><span class="pkg-picker-status ${status.cls}">${esc(status.label)}</span></div><h3>${esc(group.name||'Обладнання')}</h3><p class="pkg-picker-description">${esc(description)}</p><div class="pkg-picker-info"><div class="pkg-picker-location">${pickerGroupLocationMarkup(group)}</div><div class="pkg-picker-stock"><div class="pkg-picker-stock-head"><div><small>Доступно</small><strong>${available} <em>/ ${total}</em></strong></div><span>${percent}%</span></div><div class="pkg-picker-progress"><i style="width:${percent}%"></i></div></div></div><div class="pkg-picker-foot"><div><small>${esc(pickerLookup(pkgPickerRefs.subcategories,group.subcategory_id,'Без підкатегорії'))}</small>${group.members.length>1?`<span class="pkg-picker-note">Згруповано: ${group.members.length} EQ-ID</span>`:''}${group.current?`<span class="pkg-picker-note">У цьому пакуванні: ${group.current} од.</span>`:''}</div>${pkgBulkMode?pkgBulkControls(group):pkgPickerAddControl(group,available)}</div></div></article>`}).join(''):'<div class="pkg-picker-empty">Обладнання не знайдено. Змініть запит або фільтри.</div>';
 $('pkgWarehouseRows').innerHTML=pkgRenderedGroups.length?pkgRenderedGroups.map(group=>{const available=pkgBulkMode?pkgBulkGroupFree(group):(group.members||[]).reduce((sum,item)=>sum+pickerAvailable(item),0);return `<tr><td><strong>${esc(group.name||'Обладнання')}</strong><small>${esc(group.model||group.description||'')}</small></td><td class="pkg-picker-cell-id">${esc(pickerGroupEqLabel(group))}</td><td>${esc(pickerLookup(pkgPickerRefs.categories,group.category_id,'—'))}<small>${esc(pickerLookup(pkgPickerRefs.subcategories,group.subcategory_id,'—'))}</small></td><td>${esc(pickerGroupLocationText(group))}</td><td class="pkg-picker-cell-qty">${available} / ${Number(group.quantity||0)}${group.current?`<small>У пакуванні: ${group.current}</small>`:''}</td><td class="pkg-picker-cell-action">${pkgBulkMode?pkgBulkControls(group):pkgPickerAddControl(group,available)}</td></tr>`}).join(''):'<tr><td colspan="6" class="pkg-picker-empty-row">Обладнання не знайдено.</td></tr>';
 updatePickerViewState();pkgBulkState();
}
async function chooseFromWarehouse(){
 if(!selected)return;
 sessionStorage.removeItem('harazd-packaging-picker');
 sessionStorage.removeItem('harazd-packaging-picked');
 $('addMethod').close();
 pkgBulkReset();updatePickerTarget();
 pickerNotice('');
 $('pkgWarehouseSearch').value='';$('pkgWarehouseCategory').value='';$('pkgWarehouseSubcategory').value='';$('pkgWarehouseWarehouse').value='';$('pkgWarehouseSort').value='subcategory';
 try{await loadPickerRefs();renderWarehousePicker();$('pkgWarehousePicker').showModal();$('pkgWarehouseSearch').focus({preventScroll:true});}catch(e){msg('Не вдалося завантажити довідники: '+e.message,true)}
}
function pkgBulkSelectionChange(ev){
 if(!pkgBulkMode||pkgBulkBusy)return;
 const checkInput=ev.target.closest('[data-pkg-bulk-check]'),qtyInput=ev.target.closest('[data-pkg-bulk-qty]');
 if(!checkInput&&!qtyInput)return;
 const group=pkgRenderedGroups.find(g=>g.id===(checkInput||qtyInput).dataset[checkInput?'pkgBulkCheck':'pkgBulkQty']);
 if(!group)return;
 if(checkInput){
  if(checkInput.checked){
   const free=pkgBulkGroupFree(group);if(!free){renderWarehousePicker();return;}
   pkgBulkSelected.set(group.id,{name:group.name,quantity:1,memberIds:group.members.map(e=>e.id)});
  }else pkgBulkSelected.delete(group.id);
 }else{
  const entry=pkgBulkSelected.get(group.id);if(!entry)return;
  const max=entry.memberIds.reduce((n,id)=>n+pkgBulkFree(equipment.find(e=>e.id===id)||{id,quantity:0}),0);
  const qty=Number(qtyInput.value);
  if(!Number.isSafeInteger(qty)||qty<1||qty>max){
   pickerNotice(`Вкажіть кількість від 1 до ${max} для «${entry.name}».`);
   qtyInput.value=String(entry.quantity);return;
  }
  entry.quantity=qty;pickerNotice('');
 }
 renderWarehousePicker();
}
function pkgBulkChangeMode(){
 if(pkgBulkBusy)return;
 if(selected?.kind==='rack')return pickerNotice('Для река використовуйте додавання з розміщенням по U.');
 pkgBulkMode=!pkgBulkMode;pkgBulkSelected.clear();pickerNotice('');renderWarehousePicker();
}
async function pkgBulkSave(){
 if(pkgBulkBusy||!pkgBulkMode||!selected||selected.kind==='rack'||!pkgBulkSelected.size)return;
 const packageId=selected.id,entries=[...pkgBulkSelected.values()];
 pkgBulkBusy=true;pkgBulkState();pickerNotice('Перевіряємо залишки обладнання...');
 let savedRows=0;
 try{
  // Re-read stock and allocations before writing: do not rely on an old picker snapshot.
  const ids=[...new Set(entries.flatMap(e=>e.memberIds))];
  const [stockResult,contentsResult]=await Promise.all([
   db.from('equipment').select('id,eq_id,quantity,repair_quantity,accounting_type').in('id',ids),
   db.from('packaging_contents').select('id,packaging_id,equipment_id,quantity')
  ]);
  const freshStock=new Map(check(stockResult).map(x=>[x.id,x]));
  const freshContents=check(contentsResult);
  const reserved=new Map(),operations=[];
  for(const entry of entries){
   let remaining=entry.quantity;
   if(!Number.isSafeInteger(remaining)||remaining<1)throw Error('Некоректна кількість у вибраних позиціях');
   const members=entry.memberIds.map(id=>freshStock.get(id)).filter(Boolean).sort((a,b)=>pkgBulkFree(b,freshContents)-pkgBulkFree(a,freshContents)||String(a.eq_id||'').localeCompare(String(b.eq_id||''),'uk'));
   for(const item of members){
    if(!remaining)break;
    const free=Math.max(0,pkgBulkFree(item,freshContents)-(reserved.get(item.id)||0));
    const take=Math.min(remaining,free);
    if(!take)continue;
    reserved.set(item.id,(reserved.get(item.id)||0)+take);
    const existing=freshContents.find(row=>row.packaging_id===packageId&&row.equipment_id===item.id);
    const operation=operations.find(row=>row.equipmentId===item.id);
    if(operation)operation.add+=take;
    else operations.push({equipmentId:item.id,existing,add:take});
    remaining-=take;
   }
   if(remaining)throw Error(`Недостатньо доступного обладнання «${entry.name}» (бракує ${remaining} шт.). Оновіть вибір.`);
  }
  pickerNotice(`Додавання обладнання: 0 / ${operations.length}...`);
  for(const op of operations){
   if(op.existing){
    const updated=check(await db.from('packaging_contents').update({quantity:Number(op.existing.quantity)+op.add}).eq('id',op.existing.id).eq('packaging_id',packageId).select('id'));
    if(!updated?.length)throw Error('Не вдалося оновити наявну позицію');
   }else{
    const inserted=check(await db.from('packaging_contents').insert({packaging_id:packageId,equipment_id:op.equipmentId,quantity:op.add}).select('id'));
    if(!inserted?.length)throw Error('Не вдалося додати позицію');
   }
   savedRows++;pickerNotice(`Додавання обладнання: ${savedRows} / ${operations.length}...`);
  }
  pkgBulkSelected.clear();
  await reloadDetail();
  pickerNotice(`Додано ${entries.length} позицій (${entries.reduce((sum,e)=>sum+e.quantity,0)} од.) до пакування.`);
  msg('Обладнання масово додано до пакування');
 }catch(err){
  // If a later write fails, show partial completion explicitly; don't offer blind retry.
  pkgBulkSelected.clear();
  if(savedRows){
   await reloadDetail();
   pickerNotice(`Збережено ${savedRows} позицій, але наступна операція не вдалася: ${packagingAllocationError(err)}. Перевірте вміст пакування.`);
  }else pickerNotice('Не додано: '+packagingAllocationError(err));
  msg('Масове додавання: '+packagingAllocationError(err),true);
 }finally{pkgBulkBusy=false;renderWarehousePicker()}
}
$('pkgWarehouseBulkToggle').addEventListener('click',pkgBulkChangeMode);
$('pkgWarehouseBulkCancel').addEventListener('click',()=>{if(pkgBulkBusy)return;pkgBulkSelected.clear();pickerNotice('');renderWarehousePicker()});
$('pkgWarehouseBulkAdd').addEventListener('click',pkgBulkSave);
$('pkgWarehousePicker').addEventListener('cancel',e=>{if(pkgBulkBusy)e.preventDefault()});
$('pkgWarehousePicker').addEventListener('close',pkgBulkReset);
for(const id of ['pkgWarehouseChoices','pkgWarehouseRows'])$(id).addEventListener('change',pkgBulkSelectionChange);
$('pkgWarehouseSearch').addEventListener('input',renderWarehousePicker);
$('pkgWarehouseCategory').addEventListener('change',()=>{$('pkgWarehouseSubcategory').value='';renderWarehousePicker()});
$('pkgWarehouseSubcategory').addEventListener('change',renderWarehousePicker);
$('pkgWarehouseWarehouse').addEventListener('change',renderWarehousePicker);
$('pkgWarehouseSort').addEventListener('change',renderWarehousePicker);
$('pkgWarehouseClear').addEventListener('click',()=>{$('pkgWarehouseSearch').value='';$('pkgWarehouseCategory').value='';$('pkgWarehouseSubcategory').value='';$('pkgWarehouseWarehouse').value='';$('pkgWarehouseSort').value='subcategory';renderWarehousePicker()});
$('pkgWarehouseViewCards').addEventListener('click',()=>{pkgPickerView='cards';localStorage.setItem('harazd-packaging-picker-view',pkgPickerView);updatePickerViewState()});
$('pkgWarehouseViewTable').addEventListener('click',()=>{pkgPickerView='table';localStorage.setItem('harazd-packaging-picker-view',pkgPickerView);updatePickerViewState()});
$('pkgWarehousePickerClose').addEventListener('click',()=>{if(!pkgBulkBusy)$('pkgWarehousePicker').close()});
for(const id of ['pkgWarehouseChoices','pkgWarehouseRows'])$(id).addEventListener('click',async ev=>{const btn=ev.target.closest('[data-pkg-warehouse-group],[data-pkg-warehouse-id]');if(!btn||btn.disabled)return;if(btn.dataset.pkgWarehouseGroup){const group=pkgRenderedGroups.find(g=>g.id===btn.dataset.pkgWarehouseGroup);if(!group)return;const qtyInput=btn.closest('.pkg-picker-card,tr')?.querySelector('[data-pkg-picker-qty]');await chooseEquipmentGroup(group,qtyInput?qtyInput.value:null);return;}const item=equipment.find(e=>e.id===btn.dataset.pkgWarehouseId);if(!item)return;await chooseEquipment(item)});
let qrScanner=null;
async function stopQr(){if(qrScanner){try{await qrScanner.stop()}catch(e){}try{qrScanner.clear()}catch(e){}qrScanner=null}}
async function startQr(){
 $('addMethod').close();$('pkgScan').showModal();
 if(typeof Html5Qrcode==='undefined')return msg('Бібліотека сканування не завантажена',true);
 try{qrScanner=new Html5Qrcode('pkgReader');await qrScanner.start({facingMode:'environment'},{fps:10,qrbox:230},async code=>{
  const e=findEq(code);if(!e){msg('Код не знайдено на складі',true);return}
  await stopQr();$('pkgScan').close();await chooseEquipment(e);
 },()=>{});}catch(e){msg('Не вдалося запустити камеру: '+e.message,true)}
}

let pkgNestedTargetId=null,pkgNestedBusy=false;
function pkgNestedDisableReason(candidate){
 if(!pkgNestedTargetId)return 'Оберіть основне пакування';
 if(candidate.id===pkgNestedTargetId)return 'Поточне пакування';
 if(candidate.parent_id)return 'Уже вкладено в інше пакування';
 // An ancestor cannot be put inside its own descendant.
 if(descendants(candidate.id).includes(pkgNestedTargetId))return 'Неможливо створити циклічне вкладення';
 return '';
}
function renderNestedPicker(){
 const search=$('pkgNestedSearch').value.trim().toLocaleLowerCase('uk-UA');
 const kindFilter=$('pkgNestedKind').value;
 const availableOnly=$('pkgNestedAvailability').value==='available';
 const shown=items.filter(p=>(!kindFilter||p.kind===kindFilter)&&(!availableOnly||!pkgNestedDisableReason(p))&&[p.pk_id,p.name,p.model,p.location].join(' ').toLocaleLowerCase('uk-UA').includes(search));
 $('pkgNestedCount').textContent=`Знайдено: ${shown.length} · Доступно: ${shown.filter(p=>!pkgNestedDisableReason(p)).length}`;
 $('pkgNestedGrid').innerHTML=shown.length?shown.map(p=>{
  const reason=pkgNestedDisableReason(p),rows=pkgTreeContents(p.id),weight=allWeight(p.id);
  const preview=rows.slice(0,3).map(x=>`<div class="pkg-nested-preview-row">${eqLabel(x.equipment_id)} · ${fmt(x.quantity)} шт.</div>`).join('');
  return `<button type="button" class="pkg-card pkg-nested-card" data-nestedpick="${esc(p.id)}" ${reason||pkgNestedBusy?'disabled':''}>${pkgCardPhoto(p)}<span class="pkg-id">${esc(p.pk_id)}</span><h3>${esc(p.name)}</h3><div class="pkg-muted">${esc(kind[p.kind]||'Пакування')} · ${esc(p.location||'Без розміщення')}</div><div class="pkg-nested-totals">${rows.length} позицій · ${fmt(pkgTreeQty(p.id))} шт. · ${fmt(weight)} кг</div><div class="pkg-nested-preview">${preview||'<span class="pkg-note">Обладнання немає</span>'}${rows.length>3?`<small class="pkg-note">та ще ${rows.length-3} позицій</small>`:''}</div><span class="pkg-nested-pick-label">${reason?esc(reason):'＋ Вкласти пакування'}</span></button>`;
 }).join(''):'<p class="pkg-note">Пакувань за заданими фільтрами немає.</p>';
}
function addChild(){
 if(!selected)return;
 pkgNestedTargetId=selected.id;
 $('pkgNestedTarget').textContent=`Основне пакування: ${selected.pk_id} · ${selected.name}`;
 $('pkgNestedSearch').value='';
 $('pkgNestedKind').value='';
 $('pkgNestedAvailability').value='available';
 renderNestedPicker();
 $('pkgNestedPicker').showModal();
 $('pkgNestedSearch').focus({preventScroll:true});
}
async function attachNestedPackaging(childId){
 if(pkgNestedBusy)return;
 const parent=items.find(p=>p.id===pkgNestedTargetId),child=items.find(p=>p.id===childId);
 if(!parent||!child)return msg('Пакування не знайдено. Оновіть сторінку.',true);
 const reason=pkgNestedDisableReason(child);
 if(reason)return msg(reason,true);
 pkgNestedBusy=true;
 renderNestedPicker();
 try{
  const result=check(await db.from('packaging').update({parent_id:parent.id}).eq('id',child.id).is('parent_id',null).select('id,parent_id'));
  if(!result?.length)throw Error('Пакування вже було переміщено. Оновіть список і повторіть спробу.');
  $('pkgNestedPicker').close();
  await reloadDetail();
  msg(`Пакування ${child.pk_id} вкладено в ${parent.pk_id}. Вага та обладнання враховані в підсумках.`);
 }catch(e){msg('Не вдалося вкласти пакування: '+e.message,true)}
 finally{pkgNestedBusy=false;if($('pkgNestedPicker').open)renderNestedPicker()}
}
async function detachNestedPackaging(childId){
 if(!selected)return;
 const parent=selected,child=items.find(x=>x.id===childId&&x.parent_id===parent.id);
 if(!child)return msg('Це пакування вже не вкладено до поточного',true);
 if(!confirm(`Вийняти пакування ${child.pk_id} · ${child.name} з ${parent.pk_id}?\nОбладнання залишиться в ${child.pk_id}.`))return;
 try{
  const result=check(await db.from('packaging').update({parent_id:null}).eq('id',child.id).eq('parent_id',parent.id).select('id'));
  if(!result?.length)throw Error('Вкладення вже змінене. Оновіть дані.');
  await reloadDetail();
  msg(`Пакування ${child.pk_id} вийнято з ${parent.pk_id}`);
 }catch(e){msg('Не вдалося вийняти пакування: '+e.message,true)}
}
$('pkgNestedClose').onclick=()=>{if(!pkgNestedBusy)$('pkgNestedPicker').close()};
$('pkgNestedPicker').addEventListener('cancel',e=>{if(pkgNestedBusy)e.preventDefault()});
$('pkgNestedPicker').addEventListener('close',()=>{pkgNestedTargetId=null});
$('pkgNestedGrid').addEventListener('click',e=>{const button=e.target.closest('[data-nestedpick]');if(button&&!button.disabled)attachNestedPackaging(button.dataset.nestedpick)});
$('pkgNestedSearch').addEventListener('input',renderNestedPicker);
$('pkgNestedKind').addEventListener('change',renderNestedPicker);
$('pkgNestedAvailability').addEventListener('change',renderNestedPicker);
let pkgLocationNodes=[],pkgWarehouses=[];
async function pkgLoadLocations(){
 const r=await Promise.all([db.from('warehouses').select('id,name').order('name'),db.from('storage_locations').select('id,warehouse_id,parent_id,kind,name').order('name')]);
 pkgWarehouses=check(r[0]);pkgLocationNodes=check(r[1]);
 if(!pkgWarehouses.length)throw Error('У довіднику немає складів');
}

function pkgOptions(id,nodes,placeholder,value=''){
 const el=$(id);el.replaceChildren(new Option(placeholder,''),...nodes.map(n=>new Option(n.name,n.id)));
 if(value&&nodes.some(n=>n.id===value))el.value=value;
 el.disabled=!nodes.length;
}
function pkgLocChain(id){const result=[],seen=new Set();let n=pkgLocationNodes.find(x=>x.id===id);while(n&&!seen.has(n.id)){seen.add(n.id);result.unshift(n);n=pkgLocationNodes.find(x=>x.id===n.parent_id)}return result}
function pkgMoveRefresh(level,initial=''){
 if(level==='warehouse')pkgOptions('pkgMoveZone',pkgLocationNodes.filter(n=>n.kind==='zone'&&n.warehouse_id===$('pkgMoveWarehouse').value),'Оберіть зону',initial);
 if(['warehouse','zone'].includes(level))pkgOptions('pkgMoveRack',pkgLocationNodes.filter(n=>n.kind==='rack'&&n.parent_id===$('pkgMoveZone').value),'Без стелажа');
 if(['warehouse','zone','rack'].includes(level))pkgOptions('pkgMoveShelf',pkgLocationNodes.filter(n=>n.kind==='shelf'&&n.parent_id===$('pkgMoveRack').value),'Без полиці');
 const parent=$('pkgMoveShelf').value||$('pkgMoveRack').value||$('pkgMoveZone').value;
 pkgOptions('pkgMovePlace',pkgLocationNodes.filter(n=>n.kind==='place'&&n.parent_id===parent),parent?'Оберіть місце':'Спочатку оберіть зону');
 $('pkgMoveHint').textContent=parent?'Виберіть кінцеве місце зберігання.':'Спочатку оберіть зону.';
}
async function moveItem(){
 try{
  const r=await Promise.all([db.from('warehouses').select('id,name').order('name'),db.from('storage_locations').select('id,warehouse_id,parent_id,kind,name').order('name')]);
  pkgWarehouses=check(r[0]);pkgLocationNodes=check(r[1]);
  if(!pkgWarehouses.length)throw Error('У довіднику немає складів');
  $('pkgMoveDescription').textContent=selected.pk_id+' · '+selected.name;
  const chain=pkgLocChain(selected.location_id),wh=selected.warehouse_id||chain[0]?.warehouse_id||'';
  pkgOptions('pkgMoveWarehouse',pkgWarehouses,'Оберіть склад',wh);
  pkgMoveRefresh('warehouse',chain.find(n=>n.kind==='zone')?.id||'');
  const rack=chain.find(n=>n.kind==='rack');if(rack){$('pkgMoveRack').value=rack.id;pkgMoveRefresh('rack')}
  const shelf=chain.find(n=>n.kind==='shelf');if(shelf){$('pkgMoveShelf').value=shelf.id;pkgMoveRefresh('shelf')}
  const place=chain.find(n=>n.kind==='place');if(place)$('pkgMovePlace').value=place.id;
  $('pkgMoveDialog').showModal();
 }catch(e){msg('Не вдалося відкрити переміщення: '+e.message,true)}
}
$('pkgMoveWarehouse').onchange=()=>pkgMoveRefresh('warehouse');
$('pkgMoveZone').onchange=()=>pkgMoveRefresh('zone');
$('pkgMoveRack').onchange=()=>pkgMoveRefresh('rack');
$('pkgMoveShelf').onchange=()=>pkgMoveRefresh('shelf');
$('pkgMoveClose').onclick=$('pkgMoveCancel').onclick=()=>$('pkgMoveDialog').close();
$('pkgMoveForm').onsubmit=async event=>{
 event.preventDefault();const warehouse_id=$('pkgMoveWarehouse').value,location_id=$('pkgMovePlace').value;
 const node=pkgLocationNodes.find(n=>n.id===location_id);
 if(!node||node.kind!=='place'||node.warehouse_id!==warehouse_id)return msg('Оберіть місце у вибраному складі',true);
 if(!confirm('Перемістити пакування разом із усім фактичним вмістом та вкладеними пакуваннями?'))return;
 const button=$('pkgMoveSave');button.disabled=true;
 try{check(await db.rpc('packaging_move_with_contents',{p_packaging_id:selected.id,p_location_id:location_id}));$('pkgMoveDialog').close();await reloadDetail();msg('Розташування пакування та його вмісту оновлено')}
 catch(e){msg('Переміщення скасовано: '+e.message,true)}finally{button.disabled=false}
};

async function reloadDetail(){const id=selected.id;await load();const p=items.find(x=>x.id===id);if(p)details(p)}
$('pkgManual').onclick=()=>{$('pkgManualPanel').hidden=false;$('pkgEqId').focus()};
$('pkgEqConfirm').onclick=addById;
$('pkgEqId').onkeydown=e=>{if(e.key==='Enter')addById()};
$('pkgWarehouse').onclick=chooseFromWarehouse;
$('pkgCamera').onclick=startQr;
$('pkgScanClose').onclick=async()=>{await stopQr();$('pkgScan').close()};
$('pkgScan').addEventListener('close',stopQr);
$('addMethod').addEventListener('close',()=>{$('pkgManualPanel').hidden=true;$('pkgEqId').value='' });
$('pkgLabelDownload').onclick=downloadPkgLabel;$('pkgLabelPrint').onclick=printPkgLabel;$('pkgLabelClose').onclick=()=>$('pkgLabelDialog').close();$('pkgPhotoPick').onclick=()=>$('pkgPhotoFile').click();$('pkgPhotoCamera').onclick=()=>$('pkgPhotoCapture').click();for(const id of ['pkgPhotoFile','pkgPhotoCapture'])$(id).onchange=e=>pkgPhotoChoose(e.target.files?.[0]);$('pkgPhotoUrl').addEventListener('input',()=>{if(pkgPhotoObjectUrl)URL.revokeObjectURL(pkgPhotoObjectUrl);pkgPhotoObjectUrl=null;pkgPhotoFile=null;pkgPhotoRemoved=false;pkgPhotoPreview();});$('pkgPhotoRemove').onclick=()=>{if(pkgPhotoObjectUrl)URL.revokeObjectURL(pkgPhotoObjectUrl);pkgPhotoObjectUrl=null;pkgPhotoFile=null;pkgPhotoRemoved=true;$('pkgPhotoUrl').value='';pkgPhotoPreview();};$('add').onclick=()=>edit(null);$('form').onsubmit=save;for(const el of document.querySelectorAll('[data-close]'))el.onclick=()=>el.closest('dialog').close();for(const id of ['search','kind','mode'])$(id).addEventListener(id==='search'?'input':'change',render);$('list').onclick=e=>{const b=e.target.closest('[data-id]');if(b){const p=items.find(x=>x.id===b.dataset.id);if(p)details(p)}};

// QR labels: independent print workflow, no changes to stored package records.
let labelPackage=null;
function labelWeight(p){
 const visited=new Set();let valid=true;
 const walk=id=>{if(visited.has(id)){valid=false;return 0}visited.add(id);
  const pack=items.find(x=>x.id===id);if(!pack){valid=false;return 0}
  if(pack.empty_weight_kg===null||pack.empty_weight_kg===undefined||pack.empty_weight_kg==='')valid=false;
  let total=Number(pack.empty_weight_kg||0);
  for(const c of contents.filter(x=>x.packaging_id===id)){
   const eq=equipment.find(x=>x.id===c.equipment_id);
   if(!eq||eq.weight===null||eq.weight===undefined||eq.weight===''||!Number.isFinite(Number(eq.weight))){valid=false;continue}
   total+=Number(eq.weight)*Number(c.quantity||0);
  }
  for(const child of items.filter(x=>x.parent_id===id))total+=walk(child.id);
  return total;
 };
 const total=walk(p.id);return valid?fmt(total)+' кг':'Не визначено';
}
function labelHtml(p){
 const own=p.empty_weight_kg==null||p.empty_weight_kg===''?'Не визначено':fmt(p.empty_weight_kg)+' кг';
 return `<div class="pkg-label"><div class="pkg-label-qr" id="pkgLabelQr"></div><div class="pkg-label-right"><div class="pkg-label-brand"><img src="harazd-warehouse-label-logo.png" alt="HARAZD WAREHOUSE"></div><div class="pkg-label-identity"><div class="pkg-label-name">${esc(p.name)}</div><div class="pkg-label-id">${esc(p.pk_id)}</div></div><div class="pkg-label-weights"><div class="pkg-label-weight"><span class="pkg-weight-icon" aria-hidden="true"><svg viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round"><circle cx="20" cy="8" r="4"/><path d="M14 14h12l8 20H6z"/></svg></span><span><small>КЕЙС</small><strong>${esc(own)}</strong></span></div>${p.mode==='fixed'?`<div class="pkg-label-total pkg-label-weight"><span class="pkg-weight-icon" aria-hidden="true"><svg viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round"><circle cx="20" cy="8" r="4"/><path d="M14 14h12l8 20H6z"/></svg></span><span><small>ЗАГАЛЬНА</small><strong>${esc(labelWeight(p))}</strong></span></div>`:''}</div></div></div>`;
}
function labelUrl(p){const url=new URL('packaging.html',location.href);url.searchParams.set('pk',p.pk_id);return url.href}
function openPkgLabel(p){if(!p)return;labelPackage=p;const dialog=$('pkgLabelDialog');$('pkgLabelName').textContent=p.pk_id+' · '+p.name;$('pkgLabelPreview').innerHTML=labelHtml(p);$('pkgLabelQr').replaceChildren();if(typeof QRCode==='undefined'){msg('Не завантажено бібліотеку QR. Перевірте підключення до інтернету.',true);return}new QRCode($('pkgLabelQr'),{text:labelUrl(p),width:256,height:256,correctLevel:QRCode.CorrectLevel.M});dialog.showModal();requestAnimationFrame(syncLabelPreviewSize)}
// Preview and print use the SAME markup and the SAME packaging-label.css stylesheet.
function labelSize(){
 const [w,h]=$('pkgLabelSize').value.split('x').map(Number);
 return [w,h];
}
// Render the preview in an isolated print-sized document. The site's screen
// styles can no longer shift icons, labels, or alignment relative to printing.
function syncLabelPreviewSize(){
 const preview=$('pkgLabelPreview'), label=preview.querySelector('.pkg-label');
 if(!label)return;
 const [w,h]=labelSize();
 label.classList.toggle('pkg-label-vertical',h>w);
 const qr=label.querySelector('.pkg-label-qr canvas');
 if(!qr)return;
 const copy=label.cloneNode(true), slot=copy.querySelector('.pkg-label-qr');
 const qrImg=document.createElement('img');qrImg.src=qr.toDataURL('image/png');qrImg.alt='QR';slot.replaceChildren(qrImg);
 const logo=copy.querySelector('.pkg-label-brand img');
 if(logo)logo.src=new URL(logo.getAttribute('src'),location.href).href;
 copy.removeAttribute('style');
 const frame=document.createElement('iframe');frame.className='pkg-label-preview-frame';frame.title='Точний попередній перегляд наклейки';
 const pxW=w*96/25.4,pxH=h*96/25.4;
 frame.style.width=pxW+'px';frame.style.height=pxH+'px';
 const cssUrl=new URL('packaging-label.css',location.href).href;
 frame.srcdoc=`<!doctype html><html lang="uk"><head><meta charset="utf-8"><link rel="stylesheet" href="${cssUrl}"><style>html,body{margin:0;padding:0;overflow:hidden;background:#050505}.pkg-print-page{width:${w}mm;height:${h}mm}.pkg-print-page .pkg-label{width:100%;height:100%;aspect-ratio:auto!important}</style></head><body><div class="pkg-print-page">${copy.outerHTML}</div></body></html>`;
 let holder=preview.querySelector('.pkg-label-preview-holder');
 if(!holder){holder=document.createElement('div');holder.className='pkg-label-preview-holder';preview.appendChild(holder)}
 holder.replaceChildren(frame);
 const fit=()=>{const width=preview.clientWidth-32;const height=Math.max(0,preview.clientHeight-32);const scale=Math.min(1,width/pxW,height/pxH);holder.style.width=(pxW*scale)+'px';holder.style.height=(pxH*scale)+'px';frame.style.transform=`scale(${scale})`;};
 fit();
 if(window.ResizeObserver){if(window.pkgLabelPreviewObserver)window.pkgLabelPreviewObserver.disconnect();window.pkgLabelPreviewObserver=new ResizeObserver(fit);window.pkgLabelPreviewObserver.observe(preview)}
}
$('pkgLabelSize').addEventListener('change',syncLabelPreviewSize);
function printPkgLabel(){
 const p=labelPackage;if(!p)return;
 const [w,h]=labelSize(),copies=Math.min(100,Math.max(1,Math.floor(Number($('pkgLabelCopies').value)||1)));
 const preview=$('pkgLabelPreview').querySelector('.pkg-label');
 const qr=preview?.querySelector('.pkg-label-qr canvas');
 if(!preview||!qr){msg('QR-код ще не готовий',true);return}
 const qrData=qr.toDataURL('image/png');
 const label=preview.cloneNode(true);
 label.classList.toggle('pkg-label-vertical',h>w);
 const qrSlot=label.querySelector('.pkg-label-qr');
 qrSlot.replaceChildren();
 const img=document.createElement('img');img.src=qrData;img.alt='QR';qrSlot.appendChild(img);
 label.removeAttribute('style');
 const logo=label.querySelector('.pkg-label-brand img');
 if(logo)logo.src=new URL(logo.getAttribute('src'),location.href).href;
 const win=window.open('','_blank');if(!win){msg('Дозвольте спливні вікна для друку',true);return}
 const cssUrl=new URL('packaging-label.css',location.href).href;
 const pages=Array.from({length:copies},()=>`<div class="pkg-print-page">${label.outerHTML}</div>`).join('');
 win.document.open();win.document.write(`<!doctype html><html lang="uk"><head><meta charset="utf-8"><title>QR ${esc(p.pk_id)}</title><link rel="stylesheet" href="${cssUrl}"><style>@page{size:${w}mm ${h}mm;margin:0}html,body{margin:0;padding:0} .pkg-print-page{width:${w}mm;height:${h}mm;break-after:page;page-break-after:always}.pkg-print-page:last-child{break-after:auto;page-break-after:auto}</style></head><body>${pages}<script>window.addEventListener('load',async()=>{await Promise.all([...document.images].map(i=>i.decode().catch(()=>{})));await document.fonts.ready;setTimeout(()=>window.print(),120)});<\/script></body></html>`);win.document.close();
}

// Export the entire packaging label shown in the print preview.
async function downloadPkgLabel(){
 const p=labelPackage;
 if(!p)return;
 if(!$('pkgLabelPreview').querySelector('.pkg-label-qr canvas')){msg('QR-код ще не готовий',true);return}
 const button=$('pkgLabelDownload');
 button.disabled=true;
 try{
  await window.harazdDownloadLabelPng(
   $('pkgLabelPreview .pkg-label-preview-frame'),'.pkg-print-page',
   'HARAZD_LABEL_'+String(p.pk_id).trim().replace(/[^a-zA-Z0-9_-]/g,'_')+'.png');
 }catch(e){console.error('Packaging label export:',e);msg('Не вдалося завантажити наклейку: '+(e?.message||e),true)}
 finally{button.disabled=false}
}

let pkgDisbandBusy=false;
async function disbandPackaging(){
 const p=selected;
 if(!p||pkgDisbandBusy)return;
 const qty=contents.filter(x=>x.packaging_id===p.id).reduce((sum,x)=>sum+Number(x.quantity||0),0);
 const children=items.filter(x=>x.parent_id===p.id).length;
 if(!qty&&!children)return msg('Пакування вже порожнє');
 if(!confirm(`Розформувати ${p.pk_id} · ${p.name}?\n\n${fmt(qty)} шт. обладнання повернуться у місця, де перебували до пакування.${children?`\n${children} вкладених пакувань буде вийнято та повернуто на їхні попередні місця (разом із вмістом).`:''}\n\nПакування залишиться у списку порожнім.`))return;
 const button=$('disbandItem');
 pkgDisbandBusy=true;
 if(button)button.disabled=true;
 try{
  const result=check(await db.rpc('packaging_disband',{p_packaging_id:p.id}));
  await reloadDetail();
  msg(`Пакування розформовано: ${fmt(result?.equipment_quantity||0)} шт. повернуто, вкладень від'єднано: ${fmt(result?.detached_packages||0)}.`);
 }catch(e){
  const detail=String(e?.message||e);
  msg(detail.includes('packaging_disband')&&detail.includes('schema cache')?'Спочатку виконайте SETUP_PACKAGING_DISBAND.sql у Supabase SQL Editor.':'Не вдалося розформувати: '+detail,true);
 }finally{
  pkgDisbandBusy=false;
  if(button?.isConnected)button.disabled=false;
 }
}

async function deletePackaging(){
 const p=selected;
 if(!p)return;
 const nested=items.filter(x=>x.parent_id===p.id).length;
 const ownCount=contents.filter(x=>x.packaging_id===p.id).length;
 if(nested||ownCount){
  alert('Спочатку звільніть пакування: вилучіть обладнання ('+ownCount+') та перемістіть вкладені пакування ('+nested+').');
  return;
 }
 if(!confirm(`Видалити пакування ${p.pk_id} · ${p.name}?\n\nЦю дію неможливо скасувати.`))return;
 const button=$('deleteItem');
 if(button)button.disabled=true;
 try{
  const deleted=check(await db.from('packaging').delete().eq('id',p.id).select('id'));
  if(!deleted?.length)throw Error('Пакування не видалено. Перевірте права доступу.');
  $('details').close();
  selected=null;
  await load();
  msg(`Пакування ${p.pk_id} видалено`);
 }catch(e){msg('Не вдалося видалити пакування: '+e.message,true)}
 finally{if(button?.isConnected)button.disabled=false}
}

let rackDragId=null;
$('detailBody').addEventListener('dragstart',e=>{
 const block=e.target.closest('[data-rack-drag]');if(!block||!selected||selected.kind!=='rack')return;
 rackDragId=block.dataset.rackDrag;rackMovingId=rackDragId;
 e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',rackDragId);
});
$('detailBody').addEventListener('dragover',e=>{
 if(!rackDragId||!selected||selected.kind!=='rack'||rackSwapBusy)return;
 const source=contents.find(x=>x.id===rackDragId&&x.packaging_id===selected.id);
 const occupied=e.target.closest('[data-rack-drag]');
 if(occupied&&occupied.dataset.rackDrag!==rackDragId){
  const target=contents.find(x=>x.id===occupied.dataset.rackDrag&&x.packaging_id===selected.id);
  if(rackSwapAllowed(source,target)){
   e.preventDefault();e.dataTransfer.dropEffect='move';occupied.classList.add('rack-drag-hover');
  }
  return;
 }
 const target=e.target.closest('[data-rack-free]');
 if(!target||!source||rackOccupied(Number(target.dataset.rackFree),Number(source.rack_height_u),source.id))return;
 e.preventDefault();e.dataTransfer.dropEffect='move';target.classList.add('rack-drag-hover');
});
$('detailBody').addEventListener('dragleave',e=>{
 const target=e.target.closest('[data-rack-free], [data-rack-drag]');
 if(target)target.classList.remove('rack-drag-hover');
});
$('detailBody').addEventListener('drop',async e=>{
 if(!rackDragId||rackSwapBusy)return;
 const occupied=e.target.closest('[data-rack-drag]');
 const free=e.target.closest('[data-rack-free]');
 const id=rackDragId;
 if(occupied&&occupied.dataset.rackDrag!==id){
  const source=contents.find(x=>x.id===id&&x.packaging_id===selected.id);
  const target=contents.find(x=>x.id===occupied.dataset.rackDrag&&x.packaging_id===selected.id);
  if(!rackSwapAllowed(source,target))return;
  e.preventDefault();rackDragId=null;rackDropHandled=true;
  await rackSwap(id,target.id);
 }else if(free){
  e.preventDefault();rackDragId=null;rackDropHandled=true;
  await rackMoveTo(id,Number(free.dataset.rackFree));
 }
});
$('detailBody').addEventListener('dragend',()=>{
 rackDragId=null;
 if(rackDropHandled){rackDropHandled=false;return}
 if(rackMovingId){rackMovingId=null;if(selected?.kind==='rack')details(selected)}
});
$('detailBody').onclick=async e=>{const b=e.target.closest('button');if(!b||!selected)return;if(b.id==='editItem'){$('details').close();edit(selected)}else if(b.dataset.rackCancel!==undefined){rackMovingId=null;details(selected)}
else if(b.dataset.rackSwap){if(rackMovingId)await rackSwap(rackMovingId,b.dataset.rackSwap)}
else if(b.dataset.rackMove){rackMovingId=rackMovingId===b.dataset.rackMove?null:b.dataset.rackMove;details(selected)}
else if(b.dataset.rackFree){if(rackMovingId)await rackMoveTo(rackMovingId,Number(b.dataset.rackFree));else{rackPendingStart=Number(b.dataset.rackFree);addDialog()}}
else if(b.dataset.rackPlace){const row=contents.find(x=>x.id===b.dataset.rackPlace&&x.packaging_id===selected.id);if(!row||row.quantity!==1)return;const placement=rackPlacement(row.equipment_id,row.id);if(!placement)return;try{check(await db.from('packaging_contents').update(placement).eq('id',row.id).select());rackPendingStart=null;await reloadDetail()}catch(err){msg('Не вдалося розмістити: '+err.message,true)}}
else if(b.id==='addEquipment'){rackPendingStart=null;addDialog()}else if(b.id==='addChild')addChild();else if(b.dataset.childdetach)await detachNestedPackaging(b.dataset.childdetach);else if(b.id==='moveItem')await moveItem();else if(b.id==='printPkgQr')openPkgLabel(selected);else if(b.id==='disbandItem')await disbandPackaging();else if(b.id==='deleteItem')await deletePackaging();else if(b.dataset.child){const p=items.find(x=>x.id===b.dataset.child);if(p)details(p)}else if(b.dataset.remove){if(!confirm('Підтвердити вилучення запису?'))return;const id=b.dataset.remove;try{check(await db.from('packaging_contents').delete().eq('id',id).select());await reloadDetail()}catch(ex){msg(ex.message,true)}}};
load();
})();
