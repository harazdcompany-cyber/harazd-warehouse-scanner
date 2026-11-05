// Shared PNG export for the existing equipment and packaging print-preview iframes.
// Capture the actual print-sized HTML rather than the QR bitmap alone.
window.harazdDownloadLabelPng=async function(frame,selector,filename){
 if(!frame)throw Error('Попередній перегляд наклейки ще не готовий');
 if(typeof window.html2canvas!=='function')throw Error('Не завантажена бібліотека експорту PNG. Перевірте інтернет-з’єднання');
 let target=frame.contentDocument?.querySelector(selector);
 if(frame.contentDocument?.readyState!=='complete'||!target){
  await new Promise((resolve,reject)=>{
   const timeout=setTimeout(()=>{frame.removeEventListener('load',loaded);reject(Error('Попередній перегляд не завантажився'))},8000);
   function loaded(){clearTimeout(timeout);resolve()}
   frame.addEventListener('load',loaded,{once:true});
  });
  target=frame.contentDocument?.querySelector(selector);
 }
 if(!target)throw Error('Не вдалося знайти макет наклейки');
 await Promise.all([...target.querySelectorAll('img')].map(img=>{
  if(img.complete&&img.naturalWidth>0)return Promise.resolve();
  return img.decode?img.decode():new Promise((resolve,reject)=>{img.addEventListener('load',resolve,{once:true});img.addEventListener('error',reject,{once:true})});
 }));
 if(frame.contentDocument.fonts)await frame.contentDocument.fonts.ready;
 const rect=target.getBoundingClientRect();
 if(rect.width<1||rect.height<1)throw Error('Розмір наклейки не визначено');
 // 600 dpi: preserves the selected physical label size and fine QR detail.
 const canvas=await window.html2canvas(target,{
  backgroundColor:'#050505',scale:600/96,useCORS:true,allowTaint:false,
  logging:false,imageTimeout:15000
 });
 if(!canvas.width||!canvas.height)throw Error('Наклейка не була збережена');
 const blob=await new Promise((resolve,reject)=>canvas.toBlob(data=>data?resolve(data):reject(Error('Не вдалося сформувати PNG')),'image/png'));
 const url=URL.createObjectURL(blob),link=document.createElement('a');
 link.download=filename;
 link.href=url;
 document.body.appendChild(link);
 link.click();
 link.remove();
 // Keep the blob alive long enough for mobile browsers to start saving it.
 setTimeout(()=>URL.revokeObjectURL(url),60000);
};
