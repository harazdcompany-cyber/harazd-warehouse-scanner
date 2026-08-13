
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

  if (!API_URL) {
    showToast('Не задано URL Apps Script.');
    return;
  }

  const base =
    API_URL.split('?')[0];

  window.location.href =
    base + '?page=add';
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

        qrbox:
          function(
            viewfinderWidth,
            viewfinderHeight
          ) {

            const size =
              Math.floor(
                Math.min(
                  viewfinderWidth,
                  viewfinderHeight
                ) * 0.62
              );

            return {
              width: size,
              height:
                Math.floor(
                  size * 0.70
                )
            };
          }
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
