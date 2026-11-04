(()=>{'use strict';
const raw=sessionStorage.getItem('harazd-packaging-picker');if(!raw)return;
let context;try{context=JSON.parse(raw)}catch(e){sessionStorage.removeItem('harazd-packaging-picker');return}
const style=document.createElement('style');style.textContent=`#pkgPickerBanner{position:sticky;top:0;z-index:1000;background:#17283a;border:1px solid #dfff00;color:#fff;padding:12px 18px;border-radius:12px;display:flex;align-items:center;justify-content:space-between;gap:12px;margin:12px 0}#pkgPickerBanner button{background:#dfff00;border:0;color:#101800;border-radius:8px;padding:9px 14px;cursor:pointer}#pkgPickerChoice{border:0;border-radius:14px;padding:25px;background:#111d2b;color:#fff;max-width:430px;width:94vw}#pkgPickerChoice::backdrop{background:#000a}`;document.head.append(style);
function exit(){sessionStorage.removeItem('harazd-packaging-picker');location.href='packaging.html'}
function init(){const root=document.getElementById('equipmentCards');const rows=document.getElementById('equipmentRows');if(!root||!rows)return;
const banner=document.createElement('div');banner.id='pkgPickerBanner';banner.innerHTML='<span>Вибір обладнання для <strong></strong> · натисніть на позицію</span><button type="button">Повернутися до пакування</button>';banner.querySelector('strong').textContent=context.pk+' · '+context.name;banner.querySelector('button').onclick=exit;const host=root.parentElement;host.insertBefore(banner,root);
function pick(e){const target=e.target.closest('[data-id]');if(!target)return;const id=target.dataset.id;if(!id)return;e.preventDefault();e.stopImmediatePropagation();sessionStorage.setItem('harazd-packaging-picked',JSON.stringify({packagingId:context.id,equipmentId:id}));sessionStorage.removeItem('harazd-packaging-picker');location.href='packaging.html'}
root.addEventListener('click',pick,true);rows.addEventListener('click',pick,true);
root.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){const t=e.target.closest('[data-id]');if(t)pick(e)}},true);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();