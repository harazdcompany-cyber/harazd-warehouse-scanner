/* HARAZD WAREHOUSE — synchronize modal blur across embedded modules. */
(()=>{
 'use strict';
 const type='harazd:modal-state';
 const sameOrigin=location.origin;
 const embedded=window.parent!==window&&new URLSearchParams(location.search).get('embedded')==='1';
 if(embedded){
  let previous=null;
  const update=()=>{
   const open=Array.from(document.querySelectorAll('dialog[open]')).some(dialog=>dialog.matches(':modal'));
   if(open===previous)return;
   previous=open;
   window.parent.postMessage({type,open},sameOrigin);
  };
  const observer=new MutationObserver(changes=>{
   if(changes.some(change=>change.type==='childList'||change.attributeName==='open'))update();
  });
  observer.observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['open']});
  document.addEventListener('close',update,true);
  document.addEventListener('cancel',()=>queueMicrotask(update),true);
  update();
  return;
 }
 const frames=[
  {id:'packagingFrame',className:'harazd-packaging-card-open'},
  {id:'vehiclesFrame',className:'harazd-vehicles-card-open'}
 ];
 window.addEventListener('message',event=>{
  if(event.origin!==sameOrigin||event.data?.type!==type||typeof event.data.open!=='boolean')return;
  const matched=frames.find(({id})=>document.getElementById(id)?.contentWindow===event.source);
  if(matched)document.body.classList.toggle(matched.className,event.data.open);
 });
 frames.forEach(({id,className})=>{
  document.getElementById(id)?.addEventListener('load',event=>{
   let open=false;
   try{open=Array.from(event.currentTarget.contentDocument?.querySelectorAll('dialog[open]')||[]).some(dialog=>dialog.matches(':modal'))}catch(_){}
   document.body.classList.toggle(className,open);
  });
 });
})();
