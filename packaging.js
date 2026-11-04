(()=>{'use strict';
const $=id=>document.getElementById(id),cfg=window.HARAZD_CONFIG||{},db=window.supabase&&cfg.SUPABASE_URL&&cfg.SUPABASE_ANON_KEY?window.supabase.createClient(cfg.SUPABASE_URL,cfg.SUPABASE_ANON_KEY):null;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const kind={rack:'Рек',case:'Кейс',box:'Ящик',pallet:'Палета',other:'Інше'};
let items=[],contents=[],plans=[],equipment=[],selected=null,session=null;
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
function pkgCardPhoto(p){const url=String(p.photo_url||'');return /^https:\/\/[^\s"'<>]+$/i.test(url)?`<div class="pkg-card-photo"><img src="${esc(url)}" alt="Фото ${esc(p.name)}" loading="lazy" referrerpolicy="no-referrer" onerror="this.parentElement.style.display='none'"></div>`:'';}
function render(){const q=$('search').value.toLowerCase(),kindFilter=$('kind').value,modeFilter=$('mode').value;const filtered=items.filter(p=>(!kindFilter||p.kind===kindFilter)&&(!modeFilter||p.mode===modeFilter)&&[p.name,p.pk_id,p.model,p.location].join(' ').toLowerCase().includes(q));$('stats').innerHTML=`<div class="pkg-stat"><strong>${items.length}</strong>Всього</div><div class="pkg-stat"><strong>${items.filter(p=>!contents.some(c=>c.packaging_id===p.id)&&!items.some(c=>c.parent_id===p.id)).length}</strong>Порожні</div><div class="pkg-stat"><strong>${items.filter(p=>p.mode==='fixed').length}</strong>Постійні</div>`;$('list').innerHTML=filtered.length?filtered.map(p=>`<button class="pkg-card" data-id="${esc(p.id)}">${pkgCardPhoto(p)}<span class="pkg-id">${esc(p.pk_id)}</span><h3>${esc(p.name)}</h3><div class="pkg-muted">${esc(kind[p.kind])} · ${p.mode==='fixed'?'Постійна':'Змінна'} комплектація</div><div class="pkg-muted">${esc(p.location||'Розміщення не задано')}</div><div class="pkg-muted">Обладнання: ${contents.filter(x=>x.packaging_id===p.id).length} · Вкладень: ${items.filter(x=>x.parent_id===p.id).length}</div></button>`).join(''):'<p class="pkg-muted">Пакувань не знайдено.</p>'}
async function load(){if(!db){$('notice').classList.remove('hidden');$('notice').textContent='Не налаштовано Supabase';return}try{const auth=check(await db.auth.getUser());session=auth.user;if(!session){$('notice').classList.remove('hidden');$('notice').textContent='Спочатку увійдіть до HARAZD WAREHOUSE на головній сторінці.';return}const results=await Promise.all([db.from('packaging').select('*').order('pk_id'),db.from('packaging_contents').select('*'),db.from('packaging_plan').select('*'),db.from('equipment').select('id,eq_id,name,weight,quantity,accounting_type,photo_url').limit(10000)]);items=check(results[0]);contents=check(results[1]);plans=check(results[2]);equipment=check(results[3]);render();const picked=sessionStorage.getItem('harazd-packaging-picked');if(picked){sessionStorage.removeItem('harazd-packaging-picked');try{const data=JSON.parse(picked);const p=items.find(x=>x.id===data.packagingId);const eq=equipment.find(x=>x.id===data.equipmentId);if(p&&eq){details(p);await chooseEquipment(eq)}}catch(e){msg(e.message,true)}}}catch(e){$('notice').classList.remove('hidden');$('notice').textContent='Не вдалося завантажити пакування: '+e.message+' Перевірте, чи виконано SETUP_PACKAGING.sql.'}}
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
function details(p){
 const pkgHero=pkgCardPhoto(p);selected=p;$('detailTitle').textContent=`${p.pk_id} · ${p.name}`;const own=contents.filter(x=>x.packaging_id===p.id),plan=plans.filter(x=>x.packaging_id===p.id),children=items.filter(x=>x.parent_id===p.id),parent=items.find(x=>x.id===p.parent_id);const total=allWeight(p.id);$('detailBody').innerHTML=`${pkgHero}<p class="pkg-muted">${esc(kind[p.kind])} · ${p.mode==='fixed'?'Постійна':'Змінна'} комплектація · ${esc(p.location||'Без розміщення')}</p><div class="pkg-tools"><button id="editItem">Редагувати картку</button><button id="moveItem">Перемістити пакування</button></div><div class="pkg-section"><h3>Фактичний вміст (${own.length})</h3>${own.map(x=>`<div class="pkg-row"><div class="pkg-equipment-info"><div class="pkg-equipment-thumb">${equipmentThumb(x.equipment_id)}</div><span>${eqLabel(x.equipment_id)} · ${fmt(x.quantity)} шт.</span></div><button data-remove="${x.id}">Вилучити</button></div>`).join('')||'<p class="pkg-note">Обладнання немає</p>'}<div class="pkg-tools"><button class="primary" id="addEquipment">＋ Додати зі складу</button></div></div><div class="pkg-section"><h3>Планова комплектація (${plan.length})</h3>${plan.map(x=>`<div class="pkg-row"><span>${esc(x.item_name)} · ${fmt(x.quantity)} шт.</span><button data-planremove="${x.id}">Видалити</button></div>`).join('')||'<p class="pkg-note">План не заданий</p>'}<button id="addPlan">＋ Додати до плану</button></div><div class="pkg-section"><h3>Вкладені пакування (${children.length})</h3>${children.map(x=>`<div class="pkg-row"><span>${esc(x.pk_id)} · ${esc(x.name)}</span><button data-child="${x.id}">Відкрити</button></div>`).join('')||'<p class="pkg-note">Вкладень немає</p>'}<button id="addChild">＋ Вкласти пакування</button>${parent?`<p class="pkg-note">У пакуванні: ${esc(parent.pk_id)} · ${esc(parent.name)}</p>`:''}</div><div class="pkg-section"><h3>Вага</h3><p>Порожнє: ${fmt(p.empty_weight_kg)} кг · Разом із вмістом: ${fmt(total)} кг</p>${p.max_payload_kg!=null?`<p class="pkg-note">Допустиме навантаження: ${fmt(p.max_payload_kg)} кг${total-Number(p.empty_weight_kg||0)>Number(p.max_payload_kg)?' · ⚠ Перевищено':''}</p>`:''}</div><div class="pkg-section"><h3>Історія</h3><div id="history" class="pkg-note">Завантаження...</div></div>`;$('details').showModal();loadHistory(p.id)}
async function loadHistory(id){try{const h=check(await db.from('packaging_history').select('action,created_at,details').eq('packaging_id',id).order('created_at',{ascending:false}).limit(30));if(selected?.id===id)$('history').innerHTML=h.map(x=>`<div class="pkg-row">${esc(new Date(x.created_at).toLocaleString('uk-UA'))} · ${esc(x.action)} · ${esc(x.details?.table||'переміщення')}</div>`).join('')||'Історія порожня'}catch(e){if($('history'))$('history').textContent=e.message}}
function addDialog(){
 $('addMethod').showModal();
}
function findEq(code){const raw=String(code||'').trim();const normalized=raw.match(/EQ-\d+/i)?.[0]||raw;return equipment.find(x=>String(x.eq_id||'').toLowerCase()===normalized.toLowerCase())}
async function chooseEquipment(e){
 if(!e||!selected)return;
 const personal=String(e.accounting_type||'').toLowerCase().includes('personal')||String(e.accounting_type||'').toLowerCase().includes('персон');
 const already=contents.filter(x=>x.equipment_id===e.id).reduce((sum,x)=>sum+Number(x.quantity||0),0);
 const max=Math.max(0,Number(e.quantity||1)-already);
 if(max<=0)return msg('Усі одиниці цієї позиції вже розміщені в пакуваннях',true);
 if(personal&&already)return msg('Цей EQ-ID вже знаходиться в пакуванні',true);
 const answer=prompt(`${e.name} · ${e.eq_id}\nДоступно для пакування: ${max} шт.\nВкажіть кількість:`, '1');
 if(answer===null)return;
 const count=Number(answer);
 if(!Number.isInteger(count)||count<1||count>max||(personal&&count!==1))return msg('Некоректна кількість',true);
 try{
  const existing=contents.find(x=>x.packaging_id===selected.id&&x.equipment_id===e.id);
  if(existing)check(await db.from('packaging_contents').update({quantity:Number(existing.quantity)+count}).eq('id',existing.id).select());
  else check(await db.from('packaging_contents').insert({packaging_id:selected.id,equipment_id:e.id,quantity:count}).select());
  $('addMethod').close();await reloadDetail();msg('Обладнання додано до пакування');
 }catch(ex){msg(ex.message,true)}
}
async function addById(){const code=$('pkgEqId').value.trim();const e=findEq(code);if(!e)return msg('EQ-ID не знайдено на складі',true);await chooseEquipment(e)}
function chooseFromWarehouse(){if(!selected)return;sessionStorage.setItem('harazd-packaging-picker',JSON.stringify({id:selected.id,pk:selected.pk_id,name:selected.name}));location.href='index.html#warehouse'}
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

async function addPlan(){const name=prompt('Назва обладнання за планом:');if(!name?.trim())return;const q=prompt('Кількість:','1');if(q===null)return;const count=Number(q);if(!Number.isFinite(count)||count<=0)return msg('Некоректна кількість',true);try{check(await db.from('packaging_plan').insert({packaging_id:selected.id,item_name:name.trim(),quantity:count}));await reloadDetail()}catch(e){msg(e.message,true)}}
async function addChild(){const id=prompt('Введіть PK-ID пакування, яке потрібно вкласти:');if(!id)return;const child=items.find(x=>x.pk_id?.toLowerCase()===id.trim().toLowerCase());if(!child)return msg('PK-ID не знайдено',true);if(child.id===selected.id||descendants(child.id).includes(selected.id))return msg('Циклічне вкладення заборонено',true);if(child.parent_id)return msg('Пакування вже вкладено в інше. Спочатку вилучіть його.',true);try{check(await db.from('packaging').update({parent_id:selected.id}).eq('id',child.id).select());await reloadDetail()}catch(e){msg(e.message,true)}}
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
$('pkgPhotoPick').onclick=()=>$('pkgPhotoFile').click();$('pkgPhotoCamera').onclick=()=>$('pkgPhotoCapture').click();for(const id of ['pkgPhotoFile','pkgPhotoCapture'])$(id).onchange=e=>pkgPhotoChoose(e.target.files?.[0]);$('pkgPhotoUrl').addEventListener('input',()=>{if(pkgPhotoObjectUrl)URL.revokeObjectURL(pkgPhotoObjectUrl);pkgPhotoObjectUrl=null;pkgPhotoFile=null;pkgPhotoRemoved=false;pkgPhotoPreview();});$('pkgPhotoRemove').onclick=()=>{if(pkgPhotoObjectUrl)URL.revokeObjectURL(pkgPhotoObjectUrl);pkgPhotoObjectUrl=null;pkgPhotoFile=null;pkgPhotoRemoved=true;$('pkgPhotoUrl').value='';pkgPhotoPreview();};$('add').onclick=()=>edit(null);$('form').onsubmit=save;for(const el of document.querySelectorAll('[data-close]'))el.onclick=()=>el.closest('dialog').close();for(const id of ['search','kind','mode'])$(id).addEventListener(id==='search'?'input':'change',render);$('list').onclick=e=>{const b=e.target.closest('[data-id]');if(b){const p=items.find(x=>x.id===b.dataset.id);if(p)details(p)}};
$('detailBody').onclick=async e=>{const b=e.target.closest('button');if(!b||!selected)return;if(b.id==='editItem'){$('details').close();edit(selected)}else if(b.id==='addEquipment')addDialog();else if(b.id==='addPlan')await addPlan();else if(b.id==='addChild')await addChild();else if(b.id==='moveItem')await moveItem();else if(b.dataset.child){const p=items.find(x=>x.id===b.dataset.child);if(p)details(p)}else if(b.dataset.remove||b.dataset.planremove){if(!confirm('Підтвердити вилучення запису?'))return;const table=b.dataset.remove?'packaging_contents':'packaging_plan',id=b.dataset.remove||b.dataset.planremove;try{check(await db.from(table).delete().eq('id',id).select());await reloadDetail()}catch(ex){msg(ex.message,true)}}};
load();
})();
