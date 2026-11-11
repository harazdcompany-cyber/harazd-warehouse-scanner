/* HARAZD WAREHOUSE · local, dependency-free Code 128-B renderer.
   Encodes the existing EQ-ID / PK-ID (does not create a new database identifier).
   Code 128-B is an ASCII barcode format supported by standard USB/Bluetooth scanners. */
(()=>{'use strict';
const PATTERNS=[
'212222','222122','222221','121223','121322','131222','122213','122312','132212','221213','221312','231212',
'112232','122132','122231','113222','123122','123221','223211','221132','221231','213212','223112','312131',
'311222','321122','321221','312212','322112','322211','212123','212321','232121','111323','131123','131321',
'112313','132113','132311','211313','231113','231311','112133','112331','132131','113123','113321','133121',
'313121','211331','231131','213113','213311','213131','311123','311321','331121','312113','312311','332111',
'314111','221411','431111','111224','111422','121124','121421','141122','141221','112214','112412','122114',
'122411','142112','142211','241211','221114','413111','241112','134111','111242','121142','121241','114212',
'124112','124211','411212','421112','421211','212141','214121','412121','111143','111341','131141','114113',
'114311','411113','411311','113141','114131','311141','411131','211412','211214','211232','2331112'];
const START_B=104,STOP=106;
function toValues(code){
 const value=String(code||'').trim();
 if(!value||value.length>80)throw Error('Недопустима довжина штрихкоду');
 let checksum=START_B;
 const codes=[START_B];
 for(let index=0;index<value.length;index++){
  const char=value.charCodeAt(index);
  if(char<32||char>126)throw Error('Штрихкод Code 128 підтримує лише латинські літери, цифри та знаки ASCII');
  const n=char-32;codes.push(n);checksum+=(index+1)*n;
 }
 codes.push(checksum%103,STOP);return codes;
}
function modules(value){
 const codes=toValues(value),bars=[];let position=12;
 for(const code of codes){
  const widths=PATTERNS[code];
  for(let i=0;i<widths.length;i++){
   const width=Number(widths[i]);if(i%2===0)bars.push([position,width]);position+=width;
  }
 }
 return {bars,modules:position+12};
}
function dataUrl(code,{moduleWidth=4,height=180}={}){
 const {bars,modules:widthModules}=modules(code);
 const unit=Math.max(2,Math.floor(moduleWidth)),h=Math.max(70,Math.floor(height));
 const canvas=document.createElement('canvas');canvas.width=widthModules*unit;canvas.height=h;
 const ctx=canvas.getContext('2d');if(!ctx)throw Error('Canvas недоступний');
 ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);
 ctx.fillStyle='#000';for(const [start,width] of bars)ctx.fillRect(start*unit,0,width*unit,h);
 return canvas.toDataURL('image/png');
}
window.harazdCode128={dataUrl,modules};
})();
