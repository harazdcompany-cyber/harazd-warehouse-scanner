/* HARAZD dropdowns: progressive enhancement; original <select> stays the data source. */
(()=>{
 const selector='select:not([multiple]):not([size])';
 const escapeHtml=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 let current=null;
 function close(){if(current){current.classList.remove('hd-open');current.querySelector('.hd-menu').hidden=true;current.querySelector('.hd-trigger').setAttribute('aria-expanded','false');current=null;}}
 function init(select){
  if(select.dataset.hdReady||select.closest('.hd-select'))return;
  select.dataset.hdReady='1';
  const wrap=document.createElement('div');wrap.className='hd-select';
  select.parentNode.insertBefore(wrap,select);wrap.appendChild(select);
  const trigger=document.createElement('button');trigger.type='button';trigger.className='hd-trigger';trigger.setAttribute('aria-haspopup','listbox');trigger.setAttribute('aria-expanded','false');
  const text=document.createElement('span');text.className='hd-value';trigger.appendChild(text);
  const arrow=document.createElement('span');arrow.className='hd-chevron';arrow.setAttribute('aria-hidden','true');arrow.textContent='';trigger.appendChild(arrow);
  const menu=document.createElement('div');menu.className='hd-menu';menu.setAttribute('role','listbox');menu.hidden=true;
  wrap.append(trigger,menu);
  function render(){
   const options=[...select.options];text.textContent=select.selectedOptions[0]?.textContent||options[0]?.textContent||'Оберіть';
   wrap.classList.toggle('hd-disabled',select.disabled);trigger.disabled=select.disabled;
   menu.replaceChildren();
   options.forEach((opt,i)=>{
    const b=document.createElement('button');b.type='button';b.className='hd-option';b.textContent=opt.textContent;b.setAttribute('role','option');b.setAttribute('aria-selected',String(i===select.selectedIndex));b.disabled=opt.disabled;
    if(i===select.selectedIndex)b.classList.add('hd-selected');
    b.addEventListener('click',()=>{if(opt.disabled)return;select.selectedIndex=i;select.dispatchEvent(new Event('input',{bubbles:true}));select.dispatchEvent(new Event('change',{bubbles:true}));render();close();trigger.focus();});
    menu.appendChild(b);
   });
  }
  trigger.addEventListener('click',()=>{if(current===wrap){close();return;}close();render();menu.hidden=false;wrap.classList.add('hd-open');trigger.setAttribute('aria-expanded','true');current=wrap;});
  trigger.addEventListener('keydown',e=>{
   if(e.key==='Escape'){close();return;}
   if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){
    e.preventDefault();if(current!==wrap){trigger.click();}
    const available=[...menu.querySelectorAll('.hd-option:not(:disabled)')];if(!available.length)return;
    const active=document.activeElement;let i=available.indexOf(active);
    if(e.key==='Home')i=0;else if(e.key==='End')i=available.length-1;else if(e.key==='ArrowDown')i=(i+1)%available.length;else i=(i<0?available.length:i)-1;
    available[i].focus();
   }
  });
  menu.addEventListener('keydown',e=>{
   if(e.key==='Escape'){e.preventDefault();close();trigger.focus();}
   const available=[...menu.querySelectorAll('.hd-option:not(:disabled)')];const i=available.indexOf(document.activeElement);
   if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){
    e.preventDefault();const next=e.key==='Home'?0:e.key==='End'?available.length-1:e.key==='ArrowDown'?(i+1)%available.length:(i-1+available.length)%available.length;available[next]?.focus();
   }
  });
  select.addEventListener('change',render);
  const observer=new MutationObserver(render);observer.observe(select,{childList:true,subtree:true,attributes:true,attributeFilter:['disabled','selected','label']});
  render();
 }
 function scan(){document.querySelectorAll(selector).forEach(init);}
 document.addEventListener('click',e=>{if(current&&!current.contains(e.target))close();});
 document.addEventListener('keydown',e=>{if(e.key==='Escape')close();});
 document.addEventListener('DOMContentLoaded',()=>{scan();new MutationObserver(scan).observe(document.body,{childList:true,subtree:true});});
})();
