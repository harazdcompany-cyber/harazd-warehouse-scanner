// HARAZD WAREHOUSE
// ВСТАВТЕ СЮДИ URL вашого Google Apps Script Web App, який закінчується на /exec
const APPS_SCRIPT_URL = 'ВСТАВ_СЮДИ_URL_APPS_SCRIPT_EXEC';

let scanner = null;
let scannerRunning = false;

function showPage(id){
  document.querySelectorAll('.page').forEach(x=>x.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  window.scrollTo({top:0,behavior:'smooth'});
  if(id === 'scanner') setTimeout(startScanner, 200);
}

function openAddEquipment(){
  if(!APPS_SCRIPT_URL || APPS_SCRIPT_URL.includes('ВСТАВ_СЮДИ')){
    showMessage('Спочатку вставте URL Apps Script у файл app.js');
    return;
  }
  const base = APPS_SCRIPT_URL.split('?')[0];
  window.location.href = base + '?page=add';
}

async function startScanner(){
  if(scannerRunning) return;
  if(typeof Html5Qrcode === 'undefined'){
    showMessage('Бібліотека QR-сканера не завантажилась.');
    return;
  }
  try{
    scanner = scanner || new Html5Qrcode('reader');
    scannerRunning = true;
    await scanner.start(
      {facingMode:'environment'},
      {fps:10, qrbox:{width:250,height:250}},
      text => {
        document.getElementById('scanResult').textContent = 'QR: ' + text;
        if(navigator.vibrate) navigator.vibrate(100);
        stopScanner();
      },
      ()=>{}
    );
  }catch(e){
    scannerRunning = false;
    showMessage('Не вдалося відкрити камеру. Дозвольте доступ до камери в браузері.');
  }
}

async function stopScanner(){
  if(!scanner || !scannerRunning) return;
  try{ await scanner.stop(); }catch(e){}
  scannerRunning = false;
}

function showMessage(text){
  const el=document.getElementById('message');
  el.textContent=text; el.style.display='block';
  clearTimeout(window._msgTimer);
  window._msgTimer=setTimeout(()=>el.style.display='none',4000);
}
