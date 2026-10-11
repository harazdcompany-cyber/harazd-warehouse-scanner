
// ============================================================
// HARAZD WAREHOUSE PREMIUM UI
// Scanner + manual lookup
// ============================================================

const API_URL = String(window.HARAZD_API_URL || '').trim();

let scanner = null;
let scannerRunning = false;
let torchEnabled = false;
let lastScanText = '';
let lastScanAt = 0;


// ============================================================
// NAVIGATION
// ============================================================

function showPage(id) {
  if (id !== 'scanner' && scannerRunning) stopScanner();
  document.querySelectorAll('.page').forEach(page => {
    page.classList.remove('active');
  });

  const page = document.getElementById(id);

  if (page) {
    page.classList.add('active');
  }

  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.toggle(
      'active',
      item.dataset.page === id
    );
  });

  window.scrollTo({
    top: 0,
    behavior: 'smooth'
  });
}


function notReady(moduleName) {
  showToast(
    'Модуль «' +
    moduleName +
    '» ще розробляється.'
  );
}


// ============================================================
// ADD EQUIPMENT
// ============================================================

function openAddEquipment() {
  showPage('add');
}

function openAddEquipmentExternal() {
  window.open(
    'https://script.google.com/macros/s/AKfycbytXZesXbry1qyynsnGGcBPj2vaomE5CPYG65h1A2fPZZNxUQ-G0u_fpxE3IwxHjHM8/exec?page=add',
    '_blank',
    'noopener,noreferrer'
  );
}


// ============================================================
// MANUAL SEARCH
// ============================================================

function findEquipmentManual() {

  const input =
    document.getElementById(
      'manualCode'
    );

  const code =
    String(
      input ? input.value : ''
    )
    .trim();

  if (!code) {
    showToast(
      'Введіть EQ-ID, Серійний ID, Barcode або QR.'
    );

    if (input) {
      input.focus();
    }

    return;
  }

  findEquipmentByCode(code);
}


// ============================================================
// API SEARCH VIA JSONP
// ============================================================

function findEquipmentByCode(code) {

  const cleanCode =
    String(code || '').trim();

  if (!cleanCode) {
    return;
  }

  hideResult();
  setLoading(true);

  const callbackName =
    '__harazdFind_' +
    Date.now() +
    '_' +
    Math.floor(
      Math.random() * 100000
    );

  let script = null;
  let finished = false;

  function cleanup() {

    if (
      script &&
      script.parentNode
    ) {
      script.parentNode
        .removeChild(script);
    }

    try {
      delete window[callbackName];
    }
    catch (error) {
      window[callbackName] =
        undefined;
    }
  }


  const timeout =
    setTimeout(
      function() {

        if (finished) {
          return;
        }

        finished = true;

        cleanup();
        setLoading(false);

        showNotFound(
          'Не вдалося підключитися до HARAZD API.'
        );

      },
      15000
    );


  window[callbackName] =
    function(result) {

      if (finished) {
        return;
      }

      finished = true;

      clearTimeout(timeout);
      cleanup();
      setLoading(false);

      if (
        !result ||
        !result.success
      ) {

        showNotFound(
          result &&
          result.message
            ? result.message
            : 'Обладнання не знайдено.'
        );

        return;
      }

      showEquipment(result);
    };


  const separator =
    API_URL.includes('?')
      ? '&'
      : '?';


  script =
    document.createElement(
      'script'
    );


  script.src =
    API_URL +
    separator +
    'action=find' +
    '&code=' +
    encodeURIComponent(cleanCode) +
    '&callback=' +
    encodeURIComponent(callbackName) +
    '&_=' +
    Date.now();


  script.onerror =
    function() {

      if (finished) {
        return;
      }

      finished = true;

      clearTimeout(timeout);
      cleanup();
      setLoading(false);

      showNotFound(
        'Помилка підключення до HARAZD API.'
      );
    };


  document.body
    .appendChild(script);
}


// ============================================================
// SCANNER
// ============================================================

async function toggleScanner() {

  if (scannerRunning) {
    await stopScanner();
  }
  else {
    await startScanner();
  }
}


async function startScanner() {

  if (scannerRunning) {
    return;
  }

  if (
    typeof Html5Qrcode ===
    'undefined'
  ) {

    showToast(
      'Бібліотека QR-сканера не завантажилась.'
    );

    return;
  }

  try {

    scanner =
      scanner ||
      new Html5Qrcode('reader');

    await scanner.start(
      {
        facingMode:
          'environment'
      },

      {
        fps: 10,

      },

      onScanSuccess,

      function() {}
    );


    scannerRunning = true;

    updateCameraButton();

  }
  catch (error) {

    scannerRunning = false;

    updateCameraButton();

    showToast(
      'Не вдалося відкрити камеру. Перевірте доступ браузера до камери.'
    );
  }
}


async function stopScanner() {

  if (
    !scanner ||
    !scannerRunning
  ) {
    return;
  }

  try {
    await scanner.stop();
  }
  catch (error) {}

  scannerRunning = false;
  torchEnabled = false;

  updateCameraButton();
  updateTorchSwitch();
}


async function restartScanner() {

  await stopScanner();

  setTimeout(
    function() {
      startScanner();
    },
    250
  );
}


function updateCameraButton() {

  const button =
    document.getElementById(
      'cameraToggle'
    );

  if (!button) {
    return;
  }

  button.innerHTML =
    scannerRunning
      ? '▣ &nbsp; Вимкнути камеру'
      : '▣ &nbsp; Увімкнути камеру';
}


function onScanSuccess(
  decodedText
) {

  const text =
    String(
      decodedText || ''
    )
    .trim();

  if (!text) {
    return;
  }

  const now =
    Date.now();

  if (
    text === lastScanText &&
    now - lastScanAt < 3000
  ) {
    return;
  }

  lastScanText =
    text;

  lastScanAt =
    now;

  const input =
    document.getElementById(
      'manualCode'
    );

  if (input) {
    input.value = text;
  }

  if (navigator.vibrate) {
    navigator.vibrate(100);
  }

  stopScanner();

  findEquipmentByCode(text);
}


// ============================================================
// TORCH
// ============================================================

async function toggleTorch() {

  if (
    !scanner ||
    !scannerRunning
  ) {

    showToast(
      'Спочатку увімкніть камеру.'
    );

    return;
  }

  try {

    torchEnabled =
      !torchEnabled;

    await scanner.applyVideoConstraints({
      advanced: [
        {
          torch:
            torchEnabled
        }
      ]
    });

    updateTorchSwitch();

  }
  catch (error) {

    torchEnabled = false;

    updateTorchSwitch();

    showToast(
      'Ліхтарик не підтримується цією камерою або браузером.'
    );
  }
}


function updateTorchSwitch() {

  const button =
    document.getElementById(
      'torchSwitch'
    );

  if (!button) {
    return;
  }

  button.classList.toggle(
    'on',
    torchEnabled
  );
}


// ============================================================
// RESULT
// ============================================================

function showEquipment(data) {

  const section =
    document.getElementById(
      'resultSection'
    );

  const notFound =
    document.getElementById(
      'notFound'
    );

  if (notFound) {
    notFound.classList.add(
      'hidden'
    );
  }

  if (section) {
    section.classList.remove(
      'hidden'
    );
  }


  setText(
    'equipmentName',
    data.name ||
    'Без назви'
  );


  const subtitle = [
    data.category,
    data.subcategory
  ]
  .filter(Boolean)
  .join('  •  ');


  setText(
    'equipmentSubtitle',
    subtitle || '—'
  );


  setText(
    'equipmentId',
    data.id || '—'
  );


  setText(
    'equipmentSerial',
    data.serial || '—'
  );


  setText(
    'equipmentBarcode',
    data.barcode || '—'
  );


  setText(
    'equipmentQr',
    data.qr || '—'
  );


  setText(
    'equipmentManufacturer',
    data.manufacturer || '—'
  );


  setText(
    'equipmentModel',
    data.model || '—'
  );


  setText(
    'equipmentAccounting',
    data.accountingType || '—'
  );


  const total =
    Number(
      data.total || 0
    );


  const available =
    Number(
      data.available || 0
    );


  const repair =
    Number(
      data.repair || 0
    );


  const unit =
    data.unit
      ? ' ' + data.unit
      : '';


  setText(
    'equipmentQty',
    total + unit
  );


  setText(
    'equipmentAvailable',
    available + unit
  );


  setText(
    'equipmentWarehouse',
    data.warehouse || '—'
  );


  const location = [
    data.zone,
    data.rack,
    data.shelf
  ]
  .filter(Boolean)
  .join(' / ');


  setText(
    'equipmentLocation',
    location || '—'
  );


  setText(
    'equipmentCategory',
    data.category || '—'
  );


  const status =
    document.getElementById(
      'equipmentStatus'
    );


  if (status) {

    if (
      repair > 0 &&
      available <= 0
    ) {

      status.textContent =
        '● В РЕМОНТІ';

      status.style.background =
        '#fff1f1';

      status.style.color =
        '#c62828';
    }

    else if (
      available > 0
    ) {

      status.textContent =
        '● ДОСТУПНО';

      status.style.background =
        '#e9f8ef';

      status.style.color =
        '#098347';
    }

    else {

      status.textContent =
        '● НЕ ДОСТУПНО';

      status.style.background =
        '#f1f2f4';

      status.style.color =
        '#5f6672';
    }
  }


  const description =
    document.getElementById(
      'equipmentDescription'
    );


  if (description) {

    if (data.description) {

      description.textContent =
        data.description;

      description.classList.remove(
        'hidden'
      );
    }

    else {

      description.textContent =
        '';

      description.classList.add(
        'hidden'
      );
    }
  }


  const photo =
    document.getElementById(
      'equipmentPhoto'
    );


  const placeholder =
    document.getElementById(
      'photoPlaceholder'
    );


  if (
    photo &&
    placeholder
  ) {

    if (
      data.photo &&
      /^https?:\/\//i.test(
        String(data.photo)
      )
    ) {

      photo.src =
        data.photo;

      photo.classList.remove(
        'hidden'
      );

      placeholder.classList.add(
        'hidden'
      );
    }

    else {

      photo.removeAttribute(
        'src'
      );

      photo.classList.add(
        'hidden'
      );

      placeholder.classList.remove(
        'hidden'
      );
    }
  }


  if (section) {

    section.scrollIntoView({
      behavior:
        'smooth',

      block:
        'start'
    });
  }
}


function hideResult() {

  const section =
    document.getElementById(
      'resultSection'
    );

  const notFound =
    document.getElementById(
      'notFound'
    );

  if (section) {
    section.classList.add(
      'hidden'
    );
  }

  if (notFound) {

    notFound.classList.add(
      'hidden'
    );

    notFound.textContent =
      '';
  }
}


function showNotFound(text) {

  const section =
    document.getElementById(
      'resultSection'
    );

  const notFound =
    document.getElementById(
      'notFound'
    );

  if (section) {
    section.classList.add(
      'hidden'
    );
  }

  if (notFound) {

    notFound.textContent =
      text ||
      'Обладнання не знайдено.';

    notFound.classList.remove(
      'hidden'
    );
  }
}


function setLoading(state) {

  const element =
    document.getElementById(
      'loading'
    );

  if (!element) {
    return;
  }

  element.classList.toggle(
    'hidden',
    !state
  );
}


function setText(
  id,
  value
) {

  const element =
    document.getElementById(id);

  if (element) {

    element.textContent =
      value === null ||
      value === undefined
        ? ''
        : String(value);
  }
}


// ============================================================
// TOAST
// ============================================================

function showToast(text) {

  const toast =
    document.getElementById(
      'toast'
    );

  if (!toast) {
    return;
  }

  toast.textContent =
    text;

  toast.style.display =
    'block';


  clearTimeout(
    window._harazdToastTimer
  );


  window._harazdToastTimer =
    setTimeout(
      function() {

        toast.style.display =
          'none';

      },
      4000
    );
}


// ============================================================
// SERVICE WORKER
// ============================================================

if (
  'serviceWorker' in navigator
) {

  window.addEventListener(
    'load',
    function() {

      navigator.serviceWorker
        .register('./sw.js')
        .catch(
          function() {}
        );
    }
  );
}


// ============================================================
// NATIVE ADD EQUIPMENT FORM
// ============================================================

let addDirectoryData = {
  categories: [],
  subcategories: {},
  manufacturers: [],
  accountingTypes: [],
  units: [],
  warehouses: [],
  locations: {},
  packaging: []
};

function loadAddFormLists() {
  // If already loaded, don't hit API again.
  if (addDirectoryData.categories.length) return;

  callHarazdJsonp(
    {
      action: 'formData'
    },
    function(result) {
      if (!result || !result.success) {
        setAddApiState(false, 'Не вдалося завантажити довідники');
        return;
      }

      addDirectoryData = Object.assign(addDirectoryData, result.data || result);

      fillSelect('addCategory', addDirectoryData.categories, 'Оберіть категорію');
      fillSelect('addManufacturer', addDirectoryData.manufacturers, 'Оберіть виробника');
      fillSelect('addAccountingType', addDirectoryData.accountingTypes, 'Оберіть тип обліку');
      fillSelect('addUnit', addDirectoryData.units, 'Оберіть одиницю');
      fillSelect('addWarehouse', addDirectoryData.warehouses, 'Оберіть склад');
      fillSelect('addPackaging', addDirectoryData.packaging, 'Оберіть пакування');

      setAddApiState(true, 'Підключено до Google Sheets');
    },
    function() {
      setAddApiState(false, 'Помилка підключення до Google Sheets');
    }
  );
}

function setAddApiState(ok, text) {
  const el = document.getElementById('addApiState');
  if (!el) return;

  el.lastChild.textContent = ' ' + text;
  const dot = el.querySelector('span');

  if (dot) {
    dot.style.background = ok ? '#12ae59' : '#d92d20';
    dot.style.boxShadow = ok
      ? '0 0 0 4px rgba(18,174,89,.10)'
      : '0 0 0 4px rgba(217,45,32,.10)';
  }
}

function fillSelect(id, values, placeholder) {
  const select = document.getElementById(id);
  if (!select) return;

  const current = select.value;

  select.innerHTML = '';

  const empty = document.createElement('option');
  empty.value = '';
  empty.textContent = placeholder || 'Оберіть значення';
  select.appendChild(empty);

  (values || []).forEach(function(value) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = value;
    select.appendChild(option);
  });

  if ([...select.options].some(o => o.value === current)) {
    select.value = current;
  }
}

function updateAddSubcategories() {
  const category = document.getElementById('addCategory').value;
  const values =
    (addDirectoryData.subcategories && addDirectoryData.subcategories[category]) || [];

  fillSelect(
    'addSubcategory',
    values,
    category ? 'Оберіть підкатегорію' : 'Спочатку оберіть категорію'
  );
}

function updateAddZones() {
  const warehouse = document.getElementById('addWarehouse').value;
  const location = getAddLocationNode(warehouse);

  fillSelect(
    'addZone',
    location ? Object.keys(location) : [],
    warehouse ? 'Оберіть зону' : 'Спочатку оберіть склад'
  );

  fillSelect('addRack', [], 'Оберіть стелаж');
  fillSelect('addShelf', [], 'Оберіть полицю');
}

function updateAddRacks() {
  const warehouse = document.getElementById('addWarehouse').value;
  const zone = document.getElementById('addZone').value;

  const location = getAddLocationNode(warehouse);
  const racks = location && location[zone]
    ? Object.keys(location[zone])
    : [];

  fillSelect('addRack', racks, zone ? 'Оберіть стелаж' : 'Спочатку оберіть зону');
  fillSelect('addShelf', [], 'Оберіть полицю');
}

function updateAddShelves() {
  const warehouse = document.getElementById('addWarehouse').value;
  const zone = document.getElementById('addZone').value;
  const rack = document.getElementById('addRack').value;

  const location = getAddLocationNode(warehouse);
  const shelves =
    location &&
    location[zone] &&
    location[zone][rack]
      ? location[zone][rack]
      : [];

  fillSelect('addShelf', shelves, rack ? 'Оберіть полицю' : 'Спочатку оберіть стелаж');
}

function getAddLocationNode(warehouse) {
  return addDirectoryData.locations && addDirectoryData.locations[warehouse]
    ? addDirectoryData.locations[warehouse]
    : null;
}

function submitNativeAddForm(event) {
  event.preventDefault();

  const form = document.getElementById('addEquipmentForm');
  if (!form || !form.reportValidity()) return;

  const button = document.getElementById('addSubmitButton');
  const resultBox = document.getElementById('addResult');

  const payload = {};
  new FormData(form).forEach((value, key) => {
    payload[key] = value;
  });

  button.disabled = true;
  button.textContent = 'ДОДАВАННЯ...';

  if (resultBox) {
    resultBox.classList.add('hidden');
    resultBox.classList.remove('error');
  }

  callHarazdJsonp(
    {
      action: 'addEquipment',
      payload: JSON.stringify(payload)
    },
    function(result) {
      button.disabled = false;
      button.innerHTML = '<span aria-hidden="true">＋</span><span>Додати обладнання</span>';

      if (!result || !result.success) {
        showAddResult(
          (result && result.message) || 'Не вдалося додати обладнання.',
          false
        );
        return;
      }

      showAddResult(
        result.message || 'Обладнання успішно додано.',
        true
      );

      stockNeedsRefresh = true;
      // Зберігаємо значення форми після додавання; очищення лише окремою кнопкою.
    },
    function() {
      button.disabled = false;
      button.innerHTML = '<span aria-hidden="true">＋</span><span>Додати обладнання</span>';

      showAddResult(
        'Помилка підключення до HARAZD API.',
        false
      );
    }
  );
}

function showAddResult(text, ok) {
  const box = document.getElementById('addResult');
  if (!box) return;

  box.textContent = text;
  box.classList.remove('hidden');
  box.classList.toggle('error', !ok);
}

function clearNativeAddForm() {
  const form = document.getElementById('addEquipmentForm');
  if (!form) return;

  form.reset();

  document.getElementById('addQuantity').value = '1';

  fillSelect('addSubcategory', [], 'Спочатку оберіть категорію');
  fillSelect('addZone', [], 'Оберіть зону');
  fillSelect('addRack', [], 'Оберіть стелаж');
  fillSelect('addShelf', [], 'Оберіть полицю');
}

function callHarazdJsonp(params, onSuccess, onError) {
  const callbackName =
    '__harazd_' +
    Date.now() +
    '_' +
    Math.floor(Math.random() * 100000);

  let finished = false;
  let script = document.createElement('script');

  function cleanup() {
    if (script && script.parentNode) {
      script.parentNode.removeChild(script);
    }

    try {
      delete window[callbackName];
    } catch (e) {
      window[callbackName] = undefined;
    }
  }

  const timer = setTimeout(function() {
    if (finished) return;
    finished = true;
    cleanup();
    if (onError) onError(new Error('timeout'));
  }, 15000);

  window[callbackName] = function(data) {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    cleanup();
    if (onSuccess) onSuccess(data);
  };

  const query = Object.assign({}, params, {
    callback: callbackName,
    _: Date.now()
  });

  const qs = Object.keys(query)
    .map(key => encodeURIComponent(key) + '=' + encodeURIComponent(query[key]))
    .join('&');

  script.src = API_URL + (API_URL.includes('?') ? '&' : '?') + qs;

  script.onerror = function() {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    cleanup();
    if (onError) onError(new Error('network'));
  };

  document.body.appendChild(script);
}


// ============================================================
// V37 — STOCK FROM GOOGLE SHEETS
// ============================================================
let stockData = [];
let stockNeedsRefresh = true;
let stockLoaded = false;
let stockLoading = false;

function openStock() {
  showPage('stock');
  if (!stockLoaded || stockNeedsRefresh) loadStock();
}
function loadStock(force) {
  if (stockLoading) return;
  stockLoading = true;
  document.getElementById('stockSync').textContent = '';
  document.getElementById('stockCount').textContent = 'Завантаження обладнання...';
  document.getElementById('stockError').classList.add('hidden');
  callHarazdJsonp({action:'listEquipment'}, function(result) {
    stockLoading = false;
    if (!result || !result.success || !Array.isArray(result.items)) {
      stockLoadError(result && result.message || 'Не вдалося завантажити склад.'); return;
    }
    stockData = result.items;
    stockLoaded = true;
    stockNeedsRefresh = false;
    stockFillFilters();
    renderStock();
    document.getElementById('stockSync').textContent = 'Оновлено: ' + new Date().toLocaleTimeString('uk-UA');
  }, function() {
    stockLoading = false;
    stockLoadError('Помилка з’єднання з Google Sheets. Перевірте Apps Script API.');
  });
}
function stockLoadError(message) {
  document.getElementById('stockCount').textContent = 'Помилка завантаження';
  stockNeedsRefresh = true;
  const el = document.getElementById('stockError');
  el.textContent = message;
  el.classList.remove('hidden');
  if (!stockLoaded) document.getElementById('stockRows').innerHTML = '<tr><td colspan="7" class="stock-empty">Дані недоступні</td></tr>';
}
function stockFillFilters() {
  [['stockCategory','category','Усі категорії'],['stockWarehouse','warehouse','Усі склади']].forEach(([id,key,placeholder]) => {
    const select = document.getElementById(id), old = select.value;
    const values = [...new Set(stockData.map(x=>String(x[key]||'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'uk'));
    select.replaceChildren(new Option(placeholder,''), ...values.map(x=>new Option(x,x)));
    select.value = values.includes(old) ? old : '';
  });
}
function stockText(tag, text, cls) {
  const el = document.createElement(tag);
  el.textContent = text == null || text === '' ? '—' : String(text);
  if (cls) el.className = cls;
  return el;
}
function renderStock() {
  const q = (document.getElementById('stockSearch').value||'').trim().toLocaleLowerCase('uk');
  const cat = document.getElementById('stockCategory').value;
  const wh = document.getElementById('stockWarehouse').value;
  const items = stockData.filter(x => (!cat || x.category===cat) && (!wh || x.warehouse===wh) && (!q || [x.name,x.id,x.serial,x.barcode,x.qr,x.model,x.manufacturer,x.subcategory].some(v=>String(v||'').toLocaleLowerCase('uk').includes(q))));
  const total = arr => arr.reduce((s,x)=>s+(Number(x)||0),0);
  document.getElementById('stockItems').textContent = stockData.length;
  document.getElementById('stockTotal').textContent = total(stockData.map(x=>x.total));
  document.getElementById('stockAvailable').textContent = total(stockData.map(x=>x.available));
  document.getElementById('stockRepair').textContent = total(stockData.map(x=>x.repair));
  document.getElementById('stockCount').textContent = 'Показано ' + items.length + ' із ' + stockData.length + ' позицій';
  const tbody = document.getElementById('stockRows'); tbody.replaceChildren();
  if (!items.length) { const tr=document.createElement('tr'), td=stockText('td','Обладнання не знайдено','stock-empty');td.colSpan=7;tr.appendChild(td);tbody.appendChild(tr);return; }
  const fragment = document.createDocumentFragment();
  items.forEach(x => {
    const tr=document.createElement('tr');
    const name=document.createElement('td');name.append(stockText('strong',x.name,'stock-name'),stockText('small',[x.manufacturer,x.model].filter(Boolean).join(' · '),'stock-secondary'));tr.appendChild(name);
    tr.appendChild(stockText('td',x.id));
    tr.appendChild(stockText('td',[x.category,x.subcategory].filter(Boolean).join(' / ')));
    tr.appendChild(stockText('td',[x.warehouse,x.zone,x.rack,x.shelf].filter(Boolean).join(' / ')));
    tr.appendChild(stockText('td',x.total));
    tr.appendChild(stockText('td',x.available));
    const td=document.createElement('td');const available=Number(x.available||0),repair=Number(x.repair||0);
    td.appendChild(stockText('span',available>0?'Доступно':repair>0?'На ремонті':'Недоступно','stock-status '+(available>0?'ok':repair>0?'repair':'off')));tr.appendChild(td);
    tr.tabIndex=0;tr.title='Відкрити картку обладнання';
    tr.addEventListener('click',()=>stockOpenItem(x));
    tr.addEventListener('keydown',e=>{if(e.key==='Enter')stockOpenItem(x)});
    fragment.appendChild(tr);
  });
  tbody.appendChild(fragment);
}
function stockOpenItem(item) {
  if (!item.id) {showToast('Для цієї позиції відсутній EQ-ID');return;}
  openEquipmentCard(item);
}

// V39: картка обладнання — лише читання даних з уже завантаженого складу.
let activeEquipmentCard = null;
let cardPreviousFocus = null;
function cardNode(tag, cls, value) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (value !== undefined && value !== null) n.textContent = String(value);
  return n;
}
function cardField(grid, label, value) {
  const cell=cardNode('div','eq-field');
  cell.append(cardNode('small','',label),cardNode('strong','',value === '' || value === null || value === undefined ? '—' : value));
  grid.append(cell);
}
function cardSection(parent,title,entries) {
  const section=cardNode('section','eq-section');
  section.append(cardNode('h3','',title));
  const grid=cardNode('div','eq-fields');
  entries.forEach(([label,value])=>cardField(grid,label,value));
  section.append(grid);parent.append(section);
}
function openEquipmentCard(item) {
  const overlay=document.getElementById('equipmentCard');
  if(!overlay) return;
  activeEquipmentCard=item;cardPreviousFocus=document.activeElement;
  document.getElementById('eqCardTitle').textContent=item.name||'Обладнання';
  document.getElementById('eqCardSubtitle').textContent=[item.manufacturer,item.model,item.id].filter(Boolean).join(' · ');
  const body=document.getElementById('eqCardBody');body.replaceChildren();
  const top=cardNode('div','eq-hero');
  const media=cardNode('div','eq-photo');
  if(item.photo && /^https:\/\//i.test(item.photo)) {
    const img=document.createElement('img');img.src=item.photo;img.alt='Фото обладнання';img.loading='lazy';
    img.onerror=()=>{media.replaceChildren(cardNode('span','','Фото недоступне'));};media.append(img);
  } else media.append(cardNode('span','','Фото не додано'));
  top.append(media);
  const stats=cardNode('div','eq-quickstats');
  [['Всього',item.total],['Доступно',item.available],['На ремонті',item.repair]].forEach(([k,v])=>{const c=cardNode('div','eq-quickstat');c.append(cardNode('small','',k),cardNode('strong','',v??0));stats.append(c)});
  top.append(stats);body.append(top);
  if(item.description){const desc=cardNode('div','eq-description');desc.append(cardNode('small','','Опис'),cardNode('p','',item.description));body.append(desc)}
  cardSection(body,'Основна інформація', [['EQ-ID',item.id],['Категорія',item.category],['Підкатегорія',item.subcategory],['Виробник',item.manufacturer],['Модель',item.model],['Тип обліку',item.accountingType],['Вага / кг',item.weight],['Одиниця виміру',item.unit]]);
  cardSection(body,'Розміщення', [['Склад',item.warehouse],['Зона',item.zone],['Стелаж',item.rack],['Полиця',item.shelf],['Пакування',item.packaging]]);
  cardSection(body,'Вартість та ідентифікація', [['Ціна за одиницю / грн',item.price],['Загальна вартість / грн',item.totalValue],['Оренда за добу / грн',item.rentalPrice],['Серійний ID',item.serial],['Barcode',item.barcode],['QR / Штрихкод',item.qr]]);
  overlay.hidden=false;document.body.classList.add('eq-modal-open');document.getElementById('eqCardClose').focus();
}
function closeEquipmentCard(){document.getElementById('equipmentCard').hidden=true;document.body.classList.remove('eq-modal-open');if(cardPreviousFocus&&cardPreviousFocus.isConnected)cardPreviousFocus.focus();activeEquipmentCard=null;}
document.getElementById('eqCardClose')?.addEventListener('click',closeEquipmentCard);
document.getElementById('eqCardDone')?.addEventListener('click',closeEquipmentCard);
document.getElementById('equipmentCard')?.addEventListener('click',e=>{if(e.target.id==='equipmentCard')closeEquipmentCard()});
document.addEventListener('keydown',e=>{const m=document.getElementById('equipmentCard');if(m&&!m.hidden){if(e.key==='Escape')closeEquipmentCard();if(e.key==='Tab'){const controls=[...m.querySelectorAll('button:not([disabled])')];const first=controls[0],last=controls[controls.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}}}});
document.getElementById('eqCopyId')?.addEventListener('click',async()=>{if(!activeEquipmentCard?.id)return;try{await navigator.clipboard.writeText(activeEquipmentCard.id);showToast('EQ-ID скопійовано')}catch(e){showToast('Не вдалося скопіювати EQ-ID')}});
