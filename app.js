'use strict';
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
// V48.2: capture staff submissions before the browser can navigate to ?email=...
// Capture phase also works when another UI initializer fails before attaching handlers.
document.addEventListener('submit',event=>{
 const form=event.target;
 if(form?.id!=='staffForm')return;
 event.preventDefault();
 event.stopImmediatePropagation();
 Promise.resolve().then(()=>staffSave(event)).catch(err=>{
  console.error('Personnel form:',err);
  toast('Помилка форми персоналу: '+(err?.message||String(err)),true);
 });
},true);

const cfg=window.HARAZD_CONFIG||{};
const configured=/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(cfg.SUPABASE_URL||'') && cfg.SUPABASE_ANON_KEY && !cfg.SUPABASE_ANON_KEY.startsWith('YOUR_');
const db=configured&&window.supabase?window.supabase.createClient(cfg.SUPABASE_URL,cfg.SUPABASE_ANON_KEY):null;
let locationNodes=[],locationReady=false;
let session=null,items=[],categories=[],subcategories=[],warehouses=[],editing=null,selected=null,scanner=null,scanBusy=false;
function toast(msg,error=false){const el=$('#toast');el.textContent=msg;el.className=error?'error':'';el.style.display='block';clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.style.display='none',5500)}
const LAST_PAGE_KEY='harazd-last-page-v47';
function savedPage(){const id=sessionStorage.getItem(LAST_PAGE_KEY);return $$('.page').some(p=>p.id===id)?id:'warehouse'}
function show(id){if(!$$('.page').some(p=>p.id===id))id='warehouse';sessionStorage.setItem(LAST_PAGE_KEY,id);$$('.page').forEach(x=>x.classList.toggle('hidden',x.id!==id));$$('#nav button').forEach(b=>b.classList.toggle('active',b.dataset.page===id));if(id!=='scanner')stopScan();if(id==='personnel'&&session)staffLoad();if(id==='repairs'&&session)repairLoad();}
function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function opts(el,data,placeholder,selectedValue=''){el.replaceChildren(new Option(placeholder,''),...data.map(x=>new Option(x.name,x.id)));el.value=selectedValue||''}
function current(){return !!session}
async function query(table,order='name'){let r=await db.from(table).select('*').order(order);if(r.error)throw r.error;return r.data||[]}
async function loadReference(){[categories,subcategories,warehouses]=await Promise.all([query('categories'),query('subcategories'),query('warehouses')]);renderReference();await loadLocationNodes();refreshEquipmentLocations()}
function renderReference(){
 opts($('#formCategory'),categories,'Оберіть категорію');opts($('#directoryCategory'),categories,'Оберіть категорію');opts($('#formWarehouse'),warehouses,'Оберіть склад');opts($('#categoryFilter'),categories,'Усі категорії',$('#categoryFilter').value);opts($('#warehouseFilter'),warehouses,'Усі склади',$('#warehouseFilter').value);updateSubcategories();
 const row=(table,x,label)=>`<div class="directory-entry"><span>${esc(label)}</span><button type="button" class="ref-edit" data-ref-table="${table}" data-ref-id="${esc(x.id)}" aria-label="Редагувати ${esc(label)}" title="Редагувати">✎</button></div>`;
 $('#categoryList').innerHTML=categories.map(x=>row('categories',x,x.name)).join('');
 $('#subcategoryList').innerHTML=subcategories.map(x=>row('subcategories',x,`${categories.find(c=>c.id===x.category_id)?.name||'—'} / ${x.name}`)).join('');
 $('#warehouseList').innerHTML=warehouses.map(x=>row('warehouses',x,x.name)).join('');
 renderLocations();
}
function renderLocations(){
 const list=$('#locationList');if(!list)return;
 const entries=new Map();
 for(const x of items){if(!x.warehouse_id)continue;
  for(const [field,scope] of [['zone',['warehouse_id']],['rack',['warehouse_id','zone']],['shelf',['warehouse_id','zone','rack']]]){
   if(!x[field])continue;const filter=Object.fromEntries(scope.map(k=>[k,x[k]||'']));const key=JSON.stringify([field,filter,x[field]]);entries.set(key,{field,filter,value:x[field]});
  }
 }
 const wh=id=>warehouses.find(w=>w.id===id)?.name||'Склад';
 list.innerHTML=[...entries.values()].sort((a,b)=>`${wh(a.filter.warehouse_id)} ${a.field} ${a.value}`.localeCompare(`${wh(b.filter.warehouse_id)} ${b.field} ${b.value}`,'uk')).map((x,i)=>`<div class="directory-entry location-entry"><span><small>${esc(wh(x.filter.warehouse_id))} ${x.filter.zone?' / '+esc(x.filter.zone):''} ${x.filter.rack?' / '+esc(x.filter.rack):''}</small><b>${{zone:'Зона',rack:'Стелаж',shelf:'Полиця'}[x.field]}: ${esc(x.value)}</b></span><button type="button" class="ref-edit" data-location-index="${i}" aria-label="Редагувати місце">✎</button></div>`).join('')||'<p class="muted">Місця зберігання з’являться після додавання обладнання.</p>';
 window.referenceLocationEntries=[...entries.values()].sort((a,b)=>`${wh(a.filter.warehouse_id)} ${a.field} ${a.value}`.localeCompare(`${wh(b.filter.warehouse_id)} ${b.field} ${b.value}`,'uk'));
}
let activeReferenceEdit=null;
function openReferenceEditor(target){
 const table=target.dataset.refTable;let x;
 if(table){x=({categories,subcategories,warehouses})[table]?.find(r=>String(r.id)===target.dataset.refId);if(!x)return;activeReferenceEdit={table,id:x.id,oldName:x.name};}
 else{const loc=window.referenceLocationEntries?.[Number(target.dataset.locationIndex)];if(!loc)return;activeReferenceEdit={...loc,table:'equipment_location'};}
 const a=activeReferenceEdit;$('#referenceDialogTitle').textContent='Редагувати '+({categories:'категорію',subcategories:'підкатегорію',warehouses:'склад',equipment_location:'місце зберігання'}[a.table]);$('#referenceDialogHint').textContent=a.table==='equipment_location'?'Буде оновлено назву у всіх одиниць обладнання, що відповідають цьому місцю.':'Зміна назви відобразиться в усіх пов’язаних одиницях обладнання.';$('#referenceNewName').value=a.oldName||a.value;$('#referenceDialog').showModal();$('#referenceNewName').focus();
}
async function saveReferenceEdit(e){e.preventDefault();const a=activeReferenceEdit;if(!a)return;const name=clean($('#referenceNewName').value);if(!name){toast('Вкажіть назву',true);return}if(name===(a.oldName||a.value)){$('#referenceDialog').close();return}
 const button=$('#referenceSave');button.disabled=true;
 try{
  if(a.table==='equipment_location'){
   let q=db.from('equipment').update({[a.field]:name}).eq(a.field,a.value);for(const [k,v] of Object.entries(a.filter))q=v?q.eq(k,v):q.is(k,null);
   const {data,error}=await q.select('id');if(error)throw error;
   if(!data?.length)throw Error('Жоден запис не оновлено. Перевірте права Supabase RLS.');
   toast(`Оновлено обладнання: ${data.length} записів`);
  }else{
   const {data,error}=await db.from(a.table).update({name}).eq('id',a.id).select('id,name');if(error)throw error;
   if(data?.length!==1||data[0].name!==name)throw Error('Зміни не підтверджено. Перевірте політики UPDATE у Supabase.');toast('Назву змінено');
  }
  $('#referenceDialog').close();await loadReference();await loadItems();renderLocations();
 }catch(err){toast('Помилка редагування: '+err.message,true)}finally{button.disabled=false}
}


async function loadLocationNodes(){
 const {data,error}=await db.from('storage_locations').select('*').order('name');
 locationReady=!error;
 if(error){$('#locSetupNotice').textContent='Не вдалося завантажити місця з Supabase. Перевірте таблицю storage_locations та права доступу. '+error.message;locationNodes=[];}
 else{$('#locSetupNotice').textContent='Місця зберігаються в Supabase. Зміна назв у цьому дереві не змінює існуючі текстові поля обладнання.';locationNodes=data||[];}
 refreshLocationSelectors();renderLocationTree();
}
function refreshLocationSelectors(){
 const w=$('#locWarehouse');if(!w)return;
 const selected=w.value;opts(w,warehouses,'Оберіть склад',selected);
 const type=$('#locType').value,wh=w.value;
 $('#locZoneWrap').classList.toggle('hidden',type!=='rack'&&type!=='shelf');
 $('#locRackWrap').classList.toggle('hidden',type!=='shelf');
 $('#locParentWrap').classList.toggle('hidden',type!=='place');
 const z=$('#locZone'),oldZone=z.value;
 opts(z,locationNodes.filter(n=>n.kind==='zone'&&n.warehouse_id===wh),'Оберіть зону',oldZone);
 const r=$('#locRack'),oldRack=r.value;
 opts(r,locationNodes.filter(n=>n.kind==='rack'&&n.parent_id===z.value),'Оберіть стелаж',oldRack);
 const nodes=locationNodes.filter(n=>n.warehouse_id===wh&&['zone','rack','shelf'].includes(n.kind));
 const byId=new Map(locationNodes.map(n=>[n.id,n]));
 const path=n=>{let parts=[],current=n,seen=new Set();while(current&&!seen.has(current.id)){seen.add(current.id);parts.unshift(current.name);current=byId.get(current.parent_id)}return parts.join(' / ')};
 const parent=$('#locParent'),previous=parent.value;
 parent.innerHTML='<option value="">Оберіть зону, стелаж або полицю</option>'+nodes.sort((a,b)=>path(a).localeCompare(path(b),'uk')).map(n=>`<option value="${esc(n.id)}">${esc(({zone:'Зона',rack:'Стелаж',shelf:'Полиця'})[n.kind])} · ${esc(path(n))}</option>`).join('');
 if(nodes.some(n=>n.id===previous))parent.value=previous;
}
function renderLocationTree(){
 const root=$('#locationTree');if(!root)return;
 const labels={zone:'Зона',rack:'Стелаж',shelf:'Полиця',place:'Місце'};
 const children=(parent,warehouse)=>locationNodes.filter(n=>n.warehouse_id===warehouse&&(n.parent_id||null)===(parent||null));
 const line=(node,depth,visited=new Set())=>{
  if(visited.has(node.id))return '';const next=new Set(visited);next.add(node.id);
  const descendants=children(node.id,node.warehouse_id);
  const heading=`<span><small>${labels[node.kind]||'Місце'}</small><b>${esc(node.name)}</b></span>`;
  const edit=`<button type="button" data-node-edit="${esc(node.id)}" title="Перейменувати ${esc(node.name)}" aria-label="Перейменувати ${esc(node.name)}">✎</button>`;
  if(node.kind==='zone'){
   // Every zone is collapsed by default; native details supports mouse, keyboard and touch.
   return `<details class="storage-zone" style="--depth:${depth}"><summary><span class="storage-chevron" aria-hidden="true">▸</span>${heading}<span class="storage-zone-count">${descendants.length} підрозділів</span></summary><div class="storage-zone-actions">${edit}</div><div class="storage-zone-children">${descendants.map(n=>line(n,depth+1,next)).join('')||'<p class="muted">У зоні ще немає місць</p>'}</div></details>`;
  }
  return `<div class="storage-node" style="--depth:${depth}">${heading}${edit}</div>`+descendants.map(n=>line(n,depth+1,next)).join('');
 };
 root.innerHTML=warehouses.map(w=>{const zones=children(null,w.id);return `<div class="storage-group"><h4>▣ ${esc(w.name)}</h4>${zones.map(z=>line(z,0)).join('')||'<p class="muted">Зон поки немає</p>'}</div>`}).join('');
}
async function createLocation(e){
 e.preventDefault();if(!locationReady){toast('Спочатку виконайте SQL для таблиці storage_locations',true);return}
 const warehouse_id=$('#locWarehouse').value,kind=$('#locType').value,name=clean($('#locName').value);
 const parent_id=kind==='zone'?null:kind==='rack'?$('#locZone').value:kind==='shelf'?$('#locRack').value:$('#locParent').value;
 if(!warehouse_id||!name||(kind!=='zone'&&!parent_id)){toast('Оберіть склад і батьківське місце',true);return}
 const parent=locationNodes.find(n=>n.id===parent_id);
 if(kind!=='zone'&&(!parent||parent.warehouse_id!==warehouse_id||!({rack:['zone'],shelf:['rack'],place:['zone','rack','shelf']}[kind]||[]).includes(parent.kind))){toast('Неправильне розташування місця',true);return}
 const btn=$('#locCreateButton');btn.disabled=true;
 try{const {data,error}=await db.from('storage_locations').insert({warehouse_id,parent_id,kind,name}).select('id').single();if(error)throw error;if(!data)throw Error('Не підтверджено створення');$('#locName').value='';await loadLocationNodes();toast('Місце створено в Supabase')}
 catch(err){toast('Не вдалося створити місце: '+err.message,true)}finally{btn.disabled=false}
}
async function renameLocationNode(id){
 const node=locationNodes.find(n=>String(n.id)===id);if(!node)return;
 const name=clean(prompt('Нова назва місця:',node.name));if(!name||name===node.name)return;
 try{const {data,error}=await db.from('storage_locations').update({name}).eq('id',id).select('id,name').single();if(error)throw error;if(!data||data.name!==name)throw Error('Не вдалося підтвердити зміну');await loadLocationNodes();toast('Місце перейменовано')}
 catch(err){toast('Помилка: '+err.message,true)}
}

function updateSubcategories(value=''){opts($('#formSubcategory'),subcategories.filter(x=>x.category_id===$('#formCategory').value),'Оберіть підкатегорію',value)}
// V47: equipment is linked to the UUID of a final storage place.
function locationChain(id){const chain=[],seen=new Set();let node=locationNodes.find(n=>n.id===id);while(node&&!seen.has(node.id)){seen.add(node.id);chain.unshift(node);node=locationNodes.find(n=>n.id===node.parent_id)}return chain}
function locationLabel(id){const chain=locationChain(id);return chain.length?chain.map(n=>({zone:'Зона',rack:'Стелаж',shelf:'Полиця',place:'Місце'}[n.kind]||n.kind)+' '+n.name).join(' / '):''}
function locationLegacy(id){const chain=locationChain(id);const get=k=>chain.find(n=>n.kind===k)?.name||null;return {zone:get('zone'),rack:get('rack'),shelf:get('shelf')}}
// V47.1: cascading storage location selectors; only final place UUID is persisted.
function cascadeOptions(el, nodes, placeholder, value=''){
 el.replaceChildren(new Option(placeholder,''),...nodes.map(n=>new Option(n.name,n.id)));
 if(value&&nodes.some(n=>n.id===value))el.value=value;
 el.disabled=!nodes.length;
}
function refreshEquipmentLocations(value=''){
 const wh=$('#formWarehouse').value,chain=value?locationChain(value):[];
 const z=$('#equipmentZone'),r=$('#equipmentRack'),s=$('#equipmentShelf'),p=$('#equipmentLocation');
 const zones=locationNodes.filter(n=>n.warehouse_id===wh&&n.kind==='zone');
 cascadeOptions(z,zones,wh?'Оберіть зону':'Спочатку оберіть склад',chain.find(n=>n.kind==='zone')?.id);
 refreshEquipmentRack(chain.find(n=>n.kind==='rack')?.id||'',chain.find(n=>n.kind==='shelf')?.id||'',value);
}
function refreshEquipmentRack(rackId='',shelfId='',placeId=''){
 const z=$('#equipmentZone').value;
 const racks=locationNodes.filter(n=>n.kind==='rack'&&n.parent_id===z);
 cascadeOptions($('#equipmentRack'),racks,'Без стелажа',rackId);
 refreshEquipmentShelf(shelfId,placeId);
}
function refreshEquipmentShelf(shelfId='',placeId=''){
 const rack=$('#equipmentRack').value;
 const shelves=locationNodes.filter(n=>n.kind==='shelf'&&n.parent_id===rack);
 cascadeOptions($('#equipmentShelf'),shelves,'Без полиці',shelfId);
 refreshEquipmentPlace(placeId);
}
function refreshEquipmentPlace(placeId=''){
 const zone=$('#equipmentZone').value,rack=$('#equipmentRack').value,shelf=$('#equipmentShelf').value;
 const parent=shelf||rack||zone;
 const places=locationNodes.filter(n=>n.kind==='place'&&n.parent_id===parent);
 cascadeOptions($('#equipmentLocation'),places,parent?'Оберіть місце':'Спочатку оберіть зону',placeId);
 const hint=$('#equipmentLocationHint');
 hint.textContent=!zone?'Оберіть зону для вибраного складу.':places.length?'Доступні лише місця всередині вибраного розташування.':'У вибраному розташуванні немає місць. Створіть місце в довіднику або змініть стелаж/полицю.';
 applyEquipmentLocation();
}
function applyEquipmentLocation(){
 const id=$('#equipmentLocation').value;
 const form=$('#equipmentForm');
 // Zone/rack/shelf are inherited from selected hierarchy, including while choosing a place.
 const zoneNode=locationNodes.find(n=>n.id===$('#equipmentZone').value);
 const rackNode=locationNodes.find(n=>n.id===$('#equipmentRack').value);
 const shelfNode=locationNodes.find(n=>n.id===$('#equipmentShelf').value);
 form.elements.namedItem('zone').value=zoneNode?.name||'';
 form.elements.namedItem('rack').value=rackNode?.name||'';
 form.elements.namedItem('shelf').value=shelfNode?.name||'';
 if(id){const loc=locationLegacy(id);for(const k of ['zone','rack','shelf'])form.elements.namedItem(k).value=loc[k]||'';}
}
async function loadItems(){if(!current())return;try{let all=[],from=0;while(true){const {data,error}=await db.from('equipment').select('*').order('created_at',{ascending:false}).range(from,from+999);if(error)throw error;all.push(...data);if(data.length<1000)break;from+=1000;}items=all;renderItems();renderLocations()}catch(e){toast('Не вдалося завантажити склад: '+e.message,true)}}
let warehouseView=localStorage.getItem('harazd-warehouse-view')==='table'?'table':'cards';
function itemPhoto(x){const url=String(x.photo_url||'');return /^https:\/\/[^\s"'<>]+$/i.test(url)?`<img src="${esc(url)}" alt="${esc(x.name)}" loading="lazy" referrerpolicy="no-referrer" onerror="this.replaceWith(document.createTextNode('◇'))">`:'<span aria-hidden="true">◇</span>'}
const expandedPersonalGroups=new Set();
function personalKey(x){
 // Identity is based on catalogue attributes, not individual EQ-ID or physical location.
 return JSON.stringify([x.name,x.manufacturer,x.model,x.category_id,x.subcategory_id,x.unit].map(v=>String(v??'').trim().toLocaleLowerCase('uk')));
}
function groupedInventory(visible){
 const groups=new Map(),result=[];
 for(const x of visible){
  if(x.accounting_type!=='personal'){result.push({items:[x],group:false});continue;}
  const key=personalKey(x);
  if(!groups.has(key)){const entry={items:[],group:true,key};groups.set(key,entry);result.push(entry)}
  groups.get(key).items.push(x);
 }
 return result;
}
function renderItems(){
 const q=$('#search').value.trim().toLowerCase(),cat=$('#categoryFilter').value,wh=$('#warehouseFilter').value,status=$('#statusFilter').value,sort=$('#sortFilter').value;
 let visible=items.filter(x=>(!cat||x.category_id===cat)&&(!wh||x.warehouse_id===wh)&&(!status||(status==='repair'?x.repair_quantity>0:x.quantity>x.repair_quantity))&&(!q||[x.name,x.eq_id,x.model,x.manufacturer,x.serial,x.barcode,x.qr].some(v=>String(v||'').toLowerCase().includes(q))));
 visible.sort((a,b)=>sort==='qty'?Number(b.quantity)-Number(a.quantity):sort==='newest'?String(b.created_at||'').localeCompare(String(a.created_at||'')):sort==='availability'?(Number(b.quantity||0)-Number(b.repair_quantity||0))-(Number(a.quantity||0)-Number(a.repair_quantity||0)):sort==='model'?String(a.model||'').localeCompare(String(b.model||''),'uk'):String(a.name||'').localeCompare(String(b.name||''),'uk'));
 const entries=groupedInventory(visible);
 $('#statItems').textContent=items.length;$('#statTotal').textContent=items.reduce((s,x)=>s+Number(x.quantity||0),0);$('#statAvailable').textContent=items.reduce((s,x)=>s+Math.max(0,Number(x.quantity||0)-Number(x.repair_quantity||0)),0);$('#statRepair').textContent=items.reduce((s,x)=>s+Number(x.repair_quantity||0),0);
 const catName=x=>categories.find(c=>c.id===x.category_id)?.name||'Без категорії';
 const whName=x=>warehouses.find(w=>w.id===x.warehouse_id)?.name||'Не вказано';
 const state=(qty,repair)=>repair>=qty?'repair':repair>0?'partial':'';
 const stateText=(qty,repair)=>repair>=qty?'На ремонті':repair>0?'Частково на ремонті':'Доступно';
 const sum=(xs,k)=>xs.reduce((n,x)=>n+Number(x[k]||0),0);
 const locationText=xs=>{const locs=[...new Set(xs.map(x=>`${whName(x)} / ${[x.zone,x.rack,x.shelf].filter(Boolean).join(' / ')}`))];return locs.length===1?locs[0]:`${locs.length} розташувань`};
 const card=x=>{
  const qty=Number(x.quantity||0),repair=Number(x.repair_quantity||0),available=Math.max(0,qty-repair),percent=qty?Math.round(available/qty*100):0;
  const locationNode=locationNodes.find(n=>n.id===x.location_id);
  const place=locationNode?.kind==='place'?locationNode.name:(x.place||'');
  const fields=[['Склад',whName(x)],['Зона',x.zone],['Стелаж',x.rack],['Полиця',x.shelf],['Місце',place]];
  const loc=fields.map(([label,value])=>`<div class="gallery-location-line"><span>${label}:</span> <b>${esc(value||'—')}</b></div>`).join('');
  return `<article class="equipment-card gallery-card" data-id="${esc(x.id)}" tabindex="0" role="button" aria-label="Відкрити ${esc(x.name)}"><div class="card-photo gallery-photo">${itemPhoto(x)}<span class="gallery-photo-label">${esc(catName(x))}</span></div><div class="card-main gallery-body"><div class="card-top"><span class="card-id">${esc(x.eq_id)}</span><span class="status ${state(qty,repair)}">${stateText(qty,repair)}</span></div><h3>${esc(x.name)}</h3><p class="card-model">${esc(x.description||'')}</p><div class="gallery-info"><div class="gallery-location">${loc}</div><div class="gallery-availability"><div class="gallery-stock"><div><small>Доступно</small><strong>${available} <em>/ ${qty}</em></strong></div><span>${percent}%</span></div><div class="gallery-progress"><span style="width:${percent}%"></span></div></div></div><div class="gallery-footer"><span>${x.weight!==null&&x.weight!==undefined&&x.weight!==''?'♧ '+esc(x.weight)+' кг':''}</span><span class="gallery-open">Деталі →</span></div></div></article>`;
 };
 const groupCard=e=>{const xs=e.items,x=xs[0],qty=sum(xs,'quantity'),repair=sum(xs,'repair_quantity'),available=Math.max(0,qty-repair),percent=qty?Math.round(available/qty*100):0,open=expandedPersonalGroups.has(e.key),key=encodeURIComponent(e.key);return `<div class="personal-group-card"><button type="button" class="personal-group-toggle" data-group="${esc(key)}" aria-expanded="${open}"><div class="personal-group-photo">${itemPhoto(x)}</div><div class="personal-group-main"><div class="personal-group-kicker">ПЕРСОНАЛЬНЕ ОБЛАДНАННЯ · ${xs.length} EQ-ID</div><h3>${esc(x.name)}</h3><p>${esc([x.manufacturer,x.model].filter(Boolean).join(' · ')||'Модель не вказана')}</p><small>${esc(catName(x))} · ${esc(locationText(xs))}</small></div><div class="personal-group-quantity"><b>${available} / ${qty}</b><small>Доступно / всього</small><span class="status ${state(qty,repair)}">${stateText(qty,repair)}</span></div><span class="personal-group-chevron">${open?'▾':'▸'}</span></button>${open?`<div class="personal-group-members">${xs.map(y=>`<button type="button" data-id="${esc(y.id)}" class="personal-member"><strong>${esc(y.eq_id)}</strong><span>${esc(locationText([y]))}</span><span class="status ${state(Number(y.quantity||0),Number(y.repair_quantity||0))}">${stateText(Number(y.quantity||0),Number(y.repair_quantity||0))}</span><span>Деталі ↗</span></button>`).join('')}</div>`:''}</div>`};
 $('#equipmentCards').innerHTML=entries.map(e=>e.group&&e.items.length>1?groupCard(e):card(e.items[0])).join('')||'<div class="empty-state">⌕<h3>Обладнання не знайдено</h3><p>Змініть пошуковий запит або фільтри</p></div>';
 const tableRow=x=>`<tr data-id="${esc(x.id)}"><td><b>${esc(x.name)}</b><div class="muted">${esc(x.manufacturer||'')} · ${esc(x.model||'')}</div></td><td>${esc(x.eq_id)}</td><td>${esc(catName(x))} / ${esc(subcategories.find(c=>c.id===x.subcategory_id)?.name||'')}</td><td>${esc(locationText([x]))}</td><td>${Number(x.quantity||0)}</td><td>${Math.max(0,Number(x.quantity||0)-Number(x.repair_quantity||0))}</td><td><span class="status ${state(Number(x.quantity||0),Number(x.repair_quantity||0))}">${stateText(Number(x.quantity||0),Number(x.repair_quantity||0))}</span></td></tr>`;
 $('#equipmentRows').innerHTML=entries.map(e=>{if(!e.group||e.items.length===1)return tableRow(e.items[0]);const xs=e.items,x=xs[0],qty=sum(xs,'quantity'),repair=sum(xs,'repair_quantity'),open=expandedPersonalGroups.has(e.key),key=encodeURIComponent(e.key);return `<tr class="personal-summary-row"><td><button type="button" class="personal-table-toggle" data-group="${esc(key)}" aria-expanded="${open}"><span>${open?'▾':'▸'}</span><b>${esc(x.name)}</b><small>${xs.length} персональних EQ-ID</small></button><div class="muted">${esc(x.manufacturer||'')} · ${esc(x.model||'')}</div></td><td>Група · ${xs.length}</td><td>${esc(catName(x))} / ${esc(subcategories.find(c=>c.id===x.subcategory_id)?.name||'')}</td><td>${esc(locationText(xs))}</td><td>${qty}</td><td>${Math.max(0,qty-repair)}</td><td><span class="status ${state(qty,repair)}">${stateText(qty,repair)}</span></td></tr>${open?xs.map(y=>tableRow(y).replace('<tr data-id=','<tr class="personal-child-row" data-id=')).join(''):''}`}).join('')||'<tr><td colspan="7">Нічого не знайдено</td></tr>';
 $('#equipmentCards').classList.toggle('hidden',warehouseView==='table');$('.inventory-table').classList.toggle('hidden',warehouseView!=='table');
 $('#viewCards').classList.toggle('selected',warehouseView==='cards');$('#viewTable').classList.toggle('selected',warehouseView==='table');$('#viewCards').setAttribute('aria-pressed',String(warehouseView==='cards'));$('#viewTable').setAttribute('aria-pressed',String(warehouseView==='table'));
}

function details(x){
 selected=x;
 const cat=categories.find(c=>c.id===x.category_id)?.name||'—';
 const sub=subcategories.find(c=>c.id===x.subcategory_id)?.name||'—';
 const wh=warehouses.find(w=>w.id===x.warehouse_id)?.name||'—';
 const available=x.quantity-x.repair_quantity;
 const safePhoto=/^https:\/\/[^\s]+$/i.test(x.photo_url||'')?x.photo_url:'';
 const row=(label,value)=>`<div class="detail-field"><span>${esc(label)}</span><strong>${esc(value??'—')}</strong></div>`;
 $('#itemDetail').innerHTML=`<div class="detail-heading"><div><div class="detail-eyebrow">КАРТКА ОБЛАДНАННЯ · ${esc(x.eq_id)}</div><h2>${esc(x.name)}</h2><p>${esc([x.manufacturer,x.model].filter(Boolean).join(' · ')||'Модель не вказана')}</p></div><span class="status ${x.repair_quantity?'repair':''}">${x.repair_quantity?'На ремонті':'Доступно'}</span></div>
 <div class="detail-hero"><div class="detail-photo">${safePhoto?`<img src="${esc(safePhoto)}" alt="Фото ${esc(x.name)}" referrerpolicy="no-referrer" onerror="this.style.display='none'">`:'<span class="detail-photo-empty">◇<small>Фото відсутнє</small></span>'}</div><div class="detail-metrics"><div><small>Всього</small><strong>${x.quantity}</strong></div><div><small>Доступно</small><strong>${available}</strong></div><div><small>На ремонті</small><strong>${x.repair_quantity}</strong></div></div></div>
 <div class="detail-section"><h3>Основна інформація</h3><div class="detail-grid">${row('Категорія',cat)}${row('Підкатегорія',sub)}${row('Тип обліку',x.accounting_type==='personal'?'Персональний':'Загальний')}${row('Одиниця виміру',x.unit)}${row('Вага / кг',x.weight)}${row('Опис',x.description)}</div></div>
 <div class="detail-section"><h3>Розміщення</h3><div class="detail-grid">${row('Склад',wh)}${row('Місце з довідника',x.location_id?locationLabel(x.location_id):'Не прив’язано')}${row('Зона',x.zone)}${row('Стелаж',x.rack)}${row('Полиця',x.shelf)}${row('Пакування',x.packaging)}</div></div>
 <div class="detail-section"><h3>Ідентифікація та вартість</h3><div class="detail-grid">${row('EQ-ID',x.eq_id)}${row('Серійний ID',x.serial)}${row('Barcode',x.barcode)}${row('QR',x.qr)}${row('Ціна / грн',Number(x.price||0).toLocaleString('uk-UA'))}${row('Оренда / доба',Number(x.rental_price||0).toLocaleString('uk-UA'))}</div></div>
 <div class="detail-foot">Оновлено: ${x.updated_at?esc(new Date(x.updated_at).toLocaleString('uk-UA')):'—'}</div>`;
 $('#itemDialog').showModal();
}
function askDeleteEquipment(){
 if(!selected)return;
 const x=selected;
 $('#deleteConfirmText').textContent=`Ви дійсно хочете видалити ${x.eq_id||'цю картку'} «${x.name||'Обладнання'}»?`;
 $('#deleteConfirmDialog').showModal();
}
async function deleteEquipmentConfirmed(){
 if(!selected||!current())return;
 const x=selected,button=$('#confirmDelete');
 button.disabled=true;
 try{
  const {data,error}=await db.from('equipment').delete().eq('id',x.id).select('id');
  if(error)throw error;
  if(!Array.isArray(data)||data.length!==1)throw Error('Видалення не підтверджено. Перевірте права доступу в Supabase.');
  $('#deleteConfirmDialog').close();$('#itemDialog').close();selected=null;
  await loadItems();toast(`Картку ${x.eq_id||''} видалено`);
 }catch(e){toast('Помилка видалення: '+(e.message||String(e)),true)}
 finally{button.disabled=false}
}
function resetForm(){editing=null;$('#equipmentForm').reset();$('#formTitle').textContent='Нове обладнання';$('#saveButton').textContent='Додати обладнання';updateSubcategories();$('#equipmentForm [name="quantity"]').disabled=false;$('#equipmentForm [name="accounting_type"]').disabled=false;refreshEquipmentLocations('');}
function edit(x){editing=x;show('add');$('#formTitle').textContent='Редагування '+x.eq_id;$('#saveButton').textContent='Зберегти зміни';const form=$('#equipmentForm');Object.keys(x).forEach(k=>{const el=form.elements.namedItem(k);if(el&&'value'in el)el.value=x[k]??''});form.elements.namedItem('category_id').value=x.category_id||'';updateSubcategories(x.subcategory_id);form.elements.namedItem('warehouse_id').value=x.warehouse_id||'';refreshEquipmentLocations(x.location_id||'');if(!x.location_id){for(const k of ['zone','rack','shelf'])form.elements.namedItem(k).value=x[k]||'';}form.elements.namedItem('quantity').disabled=x.accounting_type==='personal';form.elements.namedItem('accounting_type').disabled=true;$('#itemDialog').close()}
function clean(v){return String(v||'').trim()||null}
async function saveEquipment(e){e.preventDefault();const f=e.currentTarget, fd=new FormData(f), qty=editing?.accounting_type==='personal'?1:Number(fd.get('quantity'));if(!Number.isInteger(qty)||qty<1){toast('Перевірте кількість',true);return}const locationId=clean(fd.get('location_id'));if(editing?.location_id&&!locationId){toast('Оберіть місце зберігання для цього обладнання',true);return}if(locationId){const node=locationNodes.find(n=>n.id===locationId);if(!node||node.kind!=='place'||node.warehouse_id!==clean(fd.get('warehouse_id'))){toast('Оберіть коректне місце в обраному складі',true);return}}if(editing&&!locationId&&!editing.location_id){for(const k of ['zone','rack','shelf']){const el=f.elements.namedItem(k);if(el)el.value=editing[k]||'';}}const data={name:clean(fd.get('name')),description:clean(fd.get('description')),category_id:clean(fd.get('category_id')),subcategory_id:clean(fd.get('subcategory_id')),accounting_type:editing?.accounting_type||fd.get('accounting_type'),manufacturer:clean(fd.get('manufacturer')),model:clean(fd.get('model')),unit:clean(fd.get('unit'))||'шт.',quantity:qty,weight:Number(fd.get('weight')||0),warehouse_id:clean(fd.get('warehouse_id')),location_id:locationId,zone:clean(fd.get('zone')),rack:clean(fd.get('rack')),shelf:clean(fd.get('shelf')),packaging:clean(fd.get('packaging')),price:Number(fd.get('price')||0),rental_price:Number(fd.get('rental_price')||0),serial:clean(fd.get('serial')),photo_url:clean(fd.get('photo_url'))};if(!data.name||!data.category_id){toast('Заповніть назву та категорію',true);return}const btn=$('#saveButton');btn.disabled=true;try{let result;if(editing){result=await db.from('equipment').update(data).eq('id',editing.id).select('id');if(!result.error&&result.data.length!==1)throw Error('Запис не оновлено. Перевірте права доступу.');if(!result.error){const check=await db.from('equipment').select('id,name,updated_at').eq('id',editing.id).single();if(check.error||!check.data||check.data.name!==data.name)throw Error('Не вдалося підтвердити збереження у Supabase.')}}else{result=await db.rpc('create_equipment',{payload:data});}if(result.error)throw result.error;toast(editing?'Зміни збережено':'Обладнання додано');resetForm();await loadItems();show('warehouse')}catch(err){toast('Помилка збереження: '+err.message,true)}finally{btn.disabled=false}}
async function addReference(table,form){const fd=new FormData(form),record={name:clean(fd.get('name'))};if(table==='subcategories')record.category_id=clean(fd.get('category_id'));try{const {error}=await db.from(table).insert(record);if(error)throw error;form.reset();await loadReference();toast('Додано до довідника')}catch(e){toast(e.message,true)}}
function findCode(code){const val=String(code||'').trim().toUpperCase();const x=items.find(x=>[x.eq_id,x.serial,x.barcode,x.qr].some(v=>v&&String(v).trim().toUpperCase()===val));if(x)details(x);else toast('Обладнання не знайдено',true)}
async function startScan(){if(scanner)return;if(!window.Html5Qrcode){toast('Бібліотека сканування недоступна',true);return}try{scanner=new Html5Qrcode('reader',{verbose:false});await scanner.start({facingMode:'environment'},{fps:10,qrbox:{width:230,height:230}},async text=>{if(scanBusy)return;scanBusy=true;await stopScan();$('#scanSearch').value=text;findCode(text);scanBusy=false},()=>{});}catch(e){toast('Камера недоступна: '+e.message,true);await stopScan()}}
async function stopScan(){if(!scanner)return;const s=scanner;scanner=null;try{if(s.isScanning)await s.stop();s.clear()}catch(e){console.warn(e)}}
let appliedUserId=null;
async function init(){
 if(!db){$('#setup').classList.remove('hidden');$$('.page').forEach(x=>x.classList.add('hidden'));return}
 const {data,error}=await db.auth.getSession();
 if(error)toast(error.message,true);
 session=data?.session||null;
 await applySession();
 db.auth.onAuthStateChange((event,s)=>{
   const previousUser=appliedUserId;
   session=s;
   // Supabase refreshes tokens when a background tab becomes active.
   // Do not reload the application or reset its active page on token refresh.
   if(event==='TOKEN_REFRESHED' || (s?.user?.id && s.user.id===previousUser))return;
   setTimeout(()=>applySession(),0);
 });
}
async function applySession(){
 if(!session){
   appliedUserId=null;
   $('#auth').classList.remove('hidden');
   $$('.page').forEach(x=>x.classList.add('hidden'));
   $('#userPanel').textContent='Не авторизовано';
   return;
 }
 if(appliedUserId===session.user.id)return;
 appliedUserId=session.user.id;
 $('#auth').classList.add('hidden');
 $('#userPanel').replaceChildren(document.createTextNode(session.user.email+' '));
 const b=document.createElement('button');b.textContent='Вийти';
 b.onclick=()=>{sessionStorage.removeItem(LAST_PAGE_KEY);db.auth.signOut()};
 $('#userPanel').append(b);
 try{await loadReference();await loadItems();await staffLoadSelf();show(savedPage())}
 catch(e){toast('Помилка підключення: '+e.message,true)}
}
$$('#nav button').forEach(b=>b.addEventListener('click',()=>{if(current())show(b.dataset.page)}));$('#refresh').onclick=loadItems;$('#clearFilters').onclick=()=>{$('#search').value='';$('#categoryFilter').value='';$('#warehouseFilter').value='';$('#statusFilter').value='';$('#sortFilter').value='name';renderItems()};$('#search').oninput=renderItems;$('#categoryFilter').onchange=renderItems;$('#warehouseFilter').onchange=renderItems;$('#statusFilter').onchange=renderItems;$('#sortFilter').onchange=renderItems;$('#goAdd').onclick=()=>{resetForm();show('add')};$('#viewCards').onclick=()=>{warehouseView='cards';localStorage.setItem('harazd-warehouse-view',warehouseView);renderItems()};$('#viewTable').onclick=()=>{warehouseView='table';localStorage.setItem('harazd-warehouse-view',warehouseView);renderItems()};$('#equipmentCards').onclick=e=>{const toggle=e.target.closest('[data-group]');if(toggle){const key=decodeURIComponent(toggle.dataset.group);expandedPersonalGroups.has(key)?expandedPersonalGroups.delete(key):expandedPersonalGroups.add(key);renderItems();return;}const card=e.target.closest('[data-id]');if(card){const x=items.find(x=>x.id===card.dataset.id);if(x)details(x)}};$('#equipmentCards').onkeydown=e=>{if(e.key==='Enter'||e.key===' '){const card=e.target.closest('[data-id]');if(card){e.preventDefault();const x=items.find(x=>x.id===card.dataset.id);if(x)details(x)}}};$('#formCategory').onchange=()=>updateSubcategories();$('#formWarehouse').onchange=()=>refreshEquipmentLocations('');$('#equipmentZone').onchange=()=>refreshEquipmentRack();$('#equipmentRack').onchange=()=>refreshEquipmentShelf();$('#equipmentShelf').onchange=()=>refreshEquipmentPlace();$('#equipmentLocation').onchange=applyEquipmentLocation;$('#equipmentForm').onsubmit=saveEquipment;$('#cancelEdit').onclick=resetForm;$('#equipmentRows').onclick=e=>{const toggle=e.target.closest('[data-group]');if(toggle){const key=decodeURIComponent(toggle.dataset.group);expandedPersonalGroups.has(key)?expandedPersonalGroups.delete(key):expandedPersonalGroups.add(key);renderItems();return;}const row=e.target.closest('tr[data-id]');if(row){const x=items.find(x=>x.id===row.dataset.id);if(x)details(x)}};$('#closeDialog').onclick=()=>$('#itemDialog').close();$('#deleteItem').onclick=askDeleteEquipment;$('#cancelDelete').onclick=()=>$('#deleteConfirmDialog').close();$('#confirmDelete').onclick=deleteEquipmentConfirmed;$('#editItem').onclick=()=>selected&&edit(selected);$('#scanFind').onclick=()=>findCode($('#scanSearch').value);$('#scanSearch').onkeydown=e=>{if(e.key==='Enter')findCode(e.target.value)};$('#startCamera').onclick=startScan;$('#stopCamera').onclick=stopScan;$('#categoryForm').onsubmit=e=>{e.preventDefault();addReference('categories',e.target)};$('#subcategoryForm').onsubmit=e=>{e.preventDefault();addReference('subcategories',e.target)};$('#warehouseForm').onsubmit=e=>{e.preventDefault();addReference('warehouses',e.target)};$('#categories').addEventListener('click',e=>{const b=e.target.closest('button.ref-edit');if(b)openReferenceEditor(b)});$('#referenceEditForm').onsubmit=saveReferenceEdit;$('#referenceCancel').onclick=()=>$('#referenceDialog').close();$('#locationCreateForm').onsubmit=createLocation;$('#locWarehouse').onchange=refreshLocationSelectors;$('#locType').onchange=refreshLocationSelectors;$('#locZone').onchange=refreshLocationSelectors;$('#locationTree').onclick=e=>{const b=e.target.closest('[data-node-edit]');if(b)renameLocationNode(b.dataset.nodeEdit)};$('#loginForm').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target);const {error}=await db.auth.signInWithPassword({email:f.get('email'),password:f.get('password')});if(error)toast(error.message,true)};init();

// V48.1 — Personnel and permissions. Authorization is enforced in Supabase SQL.
const STAFF_PERMISSIONS=[['equipment_view','Перегляд обладнання','Склад'],['equipment_add','Додавання обладнання','Склад'],['equipment_edit','Редагування обладнання','Склад'],['directory_manage','Категорії, склади та місця','Склад'],['events_create','Створення подій','Івенти'],['events_edit','Редагування подій','Івенти'],['packing_create','Створення листа пакування','Івенти'],['packing_dispatch','Видача за листом пакування','Івенти'],['packing_return','Повернення за листом пакування','Івенти'],['repairs_manage','Оформлення ремонтів','Ремонти'],['personnel_manage','Керування працівниками та доступами','Адміністрування']];
const STAFF_PRESETS={viewer:['equipment_view'],warehouse:['equipment_view','equipment_add','equipment_edit','directory_manage','packing_dispatch','packing_return','repairs_manage'],manager:['equipment_view','events_create','events_edit','packing_create','packing_dispatch','packing_return'],admin:STAFF_PERMISSIONS.map(x=>x[0])};
let staffProfiles=[],staffCurrent=null,staffSelf=null,staffEditId=null;
function staffAllowed(k){return staffSelf?.status==='active'&&(staffSelf?.role==='admin'||staffSelf?.permissions?.[k]===true)}
async function staffLoadSelf(){const {data,error}=await db.from('warehouse_staff').select('*').eq('user_id',session.user.id).maybeSingle();staffSelf=error?null:data;staffApplyUI();}
function staffApplyUI(){const manage=staffAllowed('personnel_manage');$('#staffAdd').hidden=!manage;$('#staffNotice').textContent=!staffSelf?'Для доступу потрібен профіль працівника. Адміністратор має виконати початкове налаштування SQL.':staffSelf.status!=='active'?'Доступ до облікового запису заблоковано.':manage?'Ви можете керувати ролями та дозволами.':'Ваші права доступу призначає адміністратор.';const permByPage={add:'equipment_add',categories:'directory_manage',events:'events_create',repairs:'repairs_manage'};$$('#nav button').forEach(b=>{const key=permByPage[b.dataset.page];if(key)b.hidden=!(staffAllowed(key)||(b.dataset.page==='events'&&staffAllowed('events_edit')))});$('#goAdd').hidden=!staffAllowed('equipment_add');$('#editItem').hidden=!staffAllowed('equipment_edit');}
async function staffLoad(){if(!session)return;await staffLoadSelf();const {data,error}=await db.from('warehouse_staff').select('*').order('full_name');if(error){$('#staffNotice').textContent='Не вдалося завантажити персонал: '+error.message;return}staffProfiles=data||[];staffRender()}
function staffRender(){const q=$('#staffSearch').value.trim().toLowerCase();const visible=staffProfiles.filter(x=>[x.full_name,x.email,x.position,x.role].some(v=>String(v||'').toLowerCase().includes(q)));const roleName={admin:'Адміністратор',manager:'Менеджер',warehouse:'Комірник',viewer:'Перегляд'};$('#staffList').innerHTML=visible.map(x=>`<div class="staff-card"><span class="staff-avatar">${esc((x.full_name||'?').split(/\s+/).slice(0,2).map(w=>w[0]).join('').toUpperCase())}</span><div class="staff-person"><strong>${esc(x.full_name)}</strong><small>${esc(x.position||'Без посади')} · ${esc(x.email)}</small></div><div class="staff-meta"><strong>${esc(roleName[x.role]||x.role)}</strong><small>${x.status==='active'?'Активний':'Заблокований'}</small></div>${staffAllowed('personnel_manage')?`<button type="button" data-staff-edit="${esc(x.user_id)}">✎ Редагувати</button>`:''}</div>`).join('')||'<p class="muted">Працівників не знайдено.</p>'}
function staffSetPreset(role){const s=new Set(STAFF_PRESETS[role]||[]);$$('#staffPermissions input[type=checkbox]').forEach(c=>c.checked=s.has(c.value))}
function staffOpen(x=null){if(!staffAllowed('personnel_manage'))return;staffEditId=x?.user_id||null;staffCurrent=x;const f=$('#staffForm');f.reset();f.elements.email.value=x?.email||'';f.elements.email.readOnly=!!x;f.elements.full_name.value=x?.full_name||'';f.elements.position.value=x?.position||'';f.elements.role.value=x?.role||'viewer';f.elements.status.value=x?.status||'active';const selfAdmin=!!x&&x.user_id===session?.user?.id&&x.role==='admin';f.elements.role.disabled=selfAdmin;f.elements.status.disabled=selfAdmin;f.elements.role.title=selfAdmin?'Власну роль адміністратора змінювати заборонено':'';f.elements.status.title=selfAdmin?'Власний акаунт адміністратора не можна деактивувати':'';$('#staffDialogTitle').textContent=x?'Редагувати працівника':'Додати працівника';f.elements.password.required=!x;f.elements.password.value='';$('#staffPasswordNote').textContent=x?'Новий пароль (необов’язково): введіть, щоб змінити пароль працівника. Поточний пароль переглянути неможливо.':'Вкажіть початковий пароль від 8 символів. Пароль не зберігається у профілі персоналу.';$('#staffPermissions').innerHTML=STAFF_PERMISSIONS.map(([id,label,group])=>`<label class="staff-perm"><input type="checkbox" value="${id}"><span><small>${esc(group)}</small>${esc(label)}</span></label>`).join('');staffSetPreset(f.elements.role.value);if(x)$$('#staffPermissions input').forEach(c=>c.checked=x.permissions?.[c.value]===true);$('#staffDialog').showModal()}
async function staffSave(e){
 e.preventDefault();if(!staffAllowed('personnel_manage'))return;
 const f=e.currentTarget;
 const payload={email:f.elements.email.value.trim().toLowerCase(),full_name:f.elements.full_name.value.trim(),position:f.elements.position.value.trim(),role:f.elements.role.value,status:f.elements.status.value,permissions:Object.fromEntries($$('#staffPermissions input').map(c=>[c.value,c.checked]))};
 const password=f.elements.password.value;
 if(staffEditId===session?.user?.id&&staffCurrent?.role==='admin'){payload.role='admin';payload.status='active'}
 if(!staffEditId&&!password){toast('Введіть початковий пароль',true);return}
 if(password&&password.length<8){toast('Пароль має містити щонайменше 8 символів',true);return}
 const submit=f.querySelector('[type=submit]');submit.disabled=true;
 try{
  const {data,error}=await db.functions.invoke('warehouse-staff-admin',{body:{action:staffEditId?'update':'create',...payload,password:password||undefined}});
  if(error){let message=error.message||'Помилка Edge Function';try{const body=await error.context?.json();message=body?.error||body?.message||message}catch(_){}throw new Error(message)}
  if(data?.error)throw new Error(data.error);
  $('#staffDialog').close();await staffLoad();toast(staffEditId?'Працівника оновлено':'Працівника створено. Він може увійти за email і паролем.');
 }catch(err){toast('Помилка: '+err.message,true)}finally{submit.disabled=false}
}
// Optional UI controls must not prevent the personnel form from working.
function bindPersonnelControls(){
 const on=(selector,event,handler)=>{const el=$(selector);if(el)el.addEventListener(event,handler)};
 on('#staffAdd','click',()=>staffOpen());
 on('#staffRefresh','click',()=>staffLoad());
 on('#staffSearch','input',()=>staffRender());
 on('#staffRole','change',e=>staffSetPreset(e.target.value));
 on('#staffCancel','click',()=>$('#staffDialog')?.close());
 on('#staffList','click',e=>{const b=e.target.closest('[data-staff-edit]');if(b)staffOpen(staffProfiles.find(x=>x.user_id===b.dataset.staffEdit))});
 const form=$('#staffForm');if(form)form.setAttribute('method','post');
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bindPersonnelControls,{once:true});
else bindPersonnelControls();

// V50 — repair tickets (Supabase-backed)
let repairJobs=[],repairEditId=null;
const repairLabels={new:'Нова',progress:'В ремонті',waiting:'Очікує запчастини',done:'Завершено',cancelled:'Скасовано'};
const repairActiveStatuses=['new','progress','waiting'];
async function repairLoad(){if(!session)return;const el=$('#repairList');el.innerHTML='<p class="muted">Завантаження ремонтів...</p>';const {data,error}=await db.from('repair_jobs').select('*').order('created_at',{ascending:false});if(error){el.innerHTML='<p class="muted">Не вдалося завантажити ремонти. Спочатку виконайте SQL із ZIP. '+esc(error.message)+'</p>';return;}repairJobs=data||[];repairRender();}
function repairRender(){const q=$('#repairSearch').value.trim().toLowerCase(),status=$('#repairFilter').value;const equipment=id=>items.find(x=>x.id===id)||{};const filtered=repairJobs.filter(j=>(!status||j.status===status)&&(!q||[j.problem,j.assignee,j.notes,equipment(j.equipment_id).name,equipment(j.equipment_id).eq_id].some(v=>String(v||'').toLowerCase().includes(q))));$('#repairAll').textContent=repairJobs.length;$('#repairActive').textContent=repairJobs.filter(j=>repairActiveStatuses.includes(j.status)).length;$('#repairDone').textContent=repairJobs.filter(j=>j.status==='done').length;$('#repairCost').textContent=repairJobs.reduce((s,j)=>s+Number(j.cost||0),0).toLocaleString('uk-UA');$('#repairList').innerHTML=filtered.map(j=>{const x=equipment(j.equipment_id);return `<article class="repair-row"><div><div class="repair-kicker">${esc(x.eq_id||'EQ-ID')} · ${esc(new Date(j.created_at).toLocaleDateString('uk-UA'))}</div><h3>${esc(x.name||'Видалене обладнання')}</h3><p>${esc(j.problem)}</p><small>${esc(j.assignee||'Не призначено')} · ${Number(j.quantity)} шт. · ${Number(j.cost||0).toLocaleString('uk-UA')} грн ${j.due_on?' · До '+esc(j.due_on):''}</small></div><div class="repair-row-actions"><span class="repair-tag repair-${esc(j.status)}">${esc(repairLabels[j.status]||j.status)}</span>${staffAllowed('repairs_manage')?`<button type="button" data-repair-edit="${esc(j.id)}">Редагувати</button>`:''}</div></article>`}).join('')||'<p class="muted">Заявок не знайдено.</p>';$('#repairAdd').hidden=!staffAllowed('repairs_manage');}
function repairOpen(job=null){if(!staffAllowed('repairs_manage')){toast('Недостатньо прав для оформлення ремонту',true);return;}repairEditId=job?.id||null;const form=$('#repairForm');form.reset();$('#repairDialogTitle').textContent=job?'Редагувати ремонт':'Нова заявка на ремонт';repairSelectEquipment(null);$('#repairEquipmentSearch').value='';repairHideResults();repairStopCamera();for(const field of ['equipment_id','status','quantity','assignee','started_on','due_on','completed_on','cost','problem','notes'])if(job&&form.elements[field])form.elements[field].value=job[field]??'';if(job){repairSelectEquipment(items.find(x=>x.id===job.equipment_id)||null);}if(!job){form.elements.started_on.value=new Date().toISOString().slice(0,10);form.elements.quantity.value=1;form.elements.cost.value=0;}$('#repairDialog').showModal();}
async function repairSave(event){event.preventDefault();if(!staffAllowed('repairs_manage'))return;const f=event.currentTarget,fd=new FormData(f),record={equipment_id:fd.get('equipment_id'),status:fd.get('status'),quantity:Number(fd.get('quantity')),assignee:String(fd.get('assignee')||'').trim(),started_on:fd.get('started_on')||null,due_on:fd.get('due_on')||null,completed_on:fd.get('completed_on')||null,cost:Number(fd.get('cost')||0),problem:String(fd.get('problem')||'').trim(),notes:String(fd.get('notes')||'').trim()};if(!record.equipment_id||!record.problem||record.quantity<1){toast('Заповніть обладнання, несправність та кількість',true);return;}const btn=$('#repairSave');btn.disabled=true;try{const result=repairEditId?await db.from('repair_jobs').update(record).eq('id',repairEditId).select('id'):await db.from('repair_jobs').insert(record).select('id');if(result.error)throw result.error;if(result.data?.length!==1)throw Error('Запис не підтверджено. Перевірте дозволи RLS.');$('#repairDialog').close();await loadItems();await repairLoad();toast('Заявку на ремонт збережено');}catch(err){toast('Помилка ремонту: '+err.message,true);}finally{btn.disabled=false;}}
function bindRepairs(){const on=(s,ev,fn)=>$(s)?.addEventListener(ev,fn);on('#repairAdd','click',()=>repairOpen());on('#repairRefresh','click',repairLoad);on('#repairSearch','input',repairRender);on('#repairFilter','change',repairRender);on('#repairCancel','click',()=>{repairStopCamera();$('#repairDialog').close()});on('#repairDialog','close',repairStopCamera);on('#repairEquipmentSearch','input',repairShowResults);on('#repairEquipmentSearch','focus',repairShowResults);on('#repairEquipmentSearch','keydown',repairSearchKey);on('#repairEquipmentResults','click',e=>{const btn=e.target.closest('[data-equipment-choice]');if(btn)repairSelectEquipment(items.find(x=>x.id===btn.dataset.equipmentChoice));});on('#repairCameraButton','click',repairToggleCamera);on('#repairCameraClose','click',repairStopCamera);on('#repairForm','submit',repairSave);on('#repairList','click',e=>{const b=e.target.closest('[data-repair-edit]');if(b)repairOpen(repairJobs.find(x=>x.id===b.dataset.repairEdit));});}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bindRepairs,{once:true});else bindRepairs();

// Repair equipment lookup: searchable by text, EQ-ID, serial, barcode or QR; USB scanners act as keyboards.
let repairCamera=null;
function repairCodeValues(x){return [x.eq_id,x.name,x.model,x.manufacturer,x.serial,x.barcode,x.qr].filter(Boolean).map(v=>String(v).toLowerCase());}
function repairHideResults(){const r=$('#repairEquipmentResults');r.hidden=true;r.replaceChildren();$('#repairEquipmentSearch').setAttribute('aria-expanded','false');}
function repairSelectEquipment(x){const id=$('#repairEquipment');id.value=x?.id||'';const label=$('#repairEquipmentSelected');label.hidden=!x;label.textContent=x?`${x.eq_id||'EQ-ID'} · ${x.name||'Без назви'}`:'';if(x)$('#repairEquipmentSearch').value=`${x.eq_id||''} · ${x.name||''}`;repairHideResults();}
function repairShowResults(){const input=$('#repairEquipmentSearch'),q=input.value.trim().toLowerCase();if($('#repairEquipment').value){$('#repairEquipment').value='';$('#repairEquipmentSelected').hidden=true;}const r=$('#repairEquipmentResults');r.replaceChildren();if(!q){repairHideResults();return;}const hits=items.filter(x=>repairCodeValues(x).some(v=>v.includes(q))).slice(0,30);for(const x of hits){const b=document.createElement('button');b.type='button';b.dataset.equipmentChoice=x.id;b.setAttribute('role','option');b.textContent=`${x.eq_id||'EQ-ID'} · ${x.name||''}${x.model?' · '+x.model:''}`;r.appendChild(b);}if(!hits.length){const p=document.createElement('p');p.textContent='Обладнання не знайдено';r.appendChild(p);}r.hidden=false;input.setAttribute('aria-expanded','true');}
function repairSearchKey(e){if(e.key==='Escape'){repairHideResults();return;}if(e.key!=='Enter')return;e.preventDefault();const q=e.currentTarget.value.trim().toLowerCase();const exact=items.find(x=>repairCodeValues(x).some(v=>v===q));const first=$('#repairEquipmentResults [data-equipment-choice]');if(exact)repairSelectEquipment(exact);else if(first)repairSelectEquipment(items.find(x=>x.id===first.dataset.equipmentChoice));else toast('Обладнання не знайдено',true);}
async function repairStopCamera(){const camera=repairCamera;repairCamera=null;$('#repairCameraArea').hidden=true;$('#repairCameraButton').textContent='▣ Сканер';if(camera){try{if(camera.isScanning)await camera.stop();await camera.clear();}catch(e){console.warn('repair camera stop',e);}}}
async function repairToggleCamera(){if(repairCamera){await repairStopCamera();return;}if(!window.Html5Qrcode){toast('Бібліотека сканування не завантажена',true);return;}$('#repairCameraArea').hidden=false;$('#repairCameraButton').textContent='Вимкнути сканер';try{const camera=new Html5Qrcode('repairCameraReader',{verbose:false});repairCamera=camera;await camera.start({facingMode:'environment'},{fps:10,qrbox:{width:230,height:230}},async code=>{const q=String(code).trim().toLowerCase();const x=items.find(x=>[x.eq_id,x.serial,x.barcode,x.qr].some(v=>v&&String(v).trim().toLowerCase()===q));if(x){repairSelectEquipment(x);await repairStopCamera();}else{$('#repairEquipmentSearch').value=code;repairShowResults();toast('Код не знайдено в обладнанні',true);await repairStopCamera();}},()=>{});}catch(e){toast('Не вдалося запустити камеру: '+e.message,true);await repairStopCamera();}}
