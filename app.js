// ============================================================
// HARAZD WAREHOUSE FRONTEND
// SCANNER + MANUAL SEARCH
// ============================================================

const API_URL = String(window.HARAZD_API_URL || '').trim();

let scanner = null;
let scannerRunning = false;
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
  if (page) page.classList.add('active');

  window.scrollTo({ top: 0, behavior: 'smooth' });

  if (id === 'scanner') {
    setTimeout(() => {
      const input = document.getElementById('manualCode');
      if (input) input.focus();
    }, 150);
  }
}

function notReady(moduleName) {
  showMessage('Модуль «' + moduleName + '» ще розробляється.');
}

// ============================================================
// ADD EQUIPMENT
// ============================================================

function openAddEquipment() {
  if (!API_URL) {
    showMessage('Не задано URL Apps Script.');
    return;
  }

  const base = API_URL.split('?')[0];
  window.location.href = base + '?page=add';
}

// ============================================================
// MANUAL SEARCH
// ============================================================

function findEquipmentManual() {
  const input = document.getElementById('manualCode');
  const code = String(input ? input.value : '').trim();

  if (!code) {
    showMessage('Введіть EQ-ID, серійний ID, Barcode або QR.');
    if (input) input.focus();
    return;
  }

  findEquipmentByCode(code);
}

// ============================================================
// FIND EQUIPMENT THROUGH JSONP
// Avoids CORS problems between GitHub Pages and Apps Script.
// ============================================================

function findEquipmentByCode(code) {
  const cleanCode = String(code || '').trim();

  if (!cleanCode) return;

  hideEquipmentResult();
  setLoading(true);

  const callbackName =
    '__harazdFind_' +
    Date.now() +
    '_' +
    Math.floor(Math.random() * 100000);

  let script = null;
  let finished = false;

  const cleanup = () => {
    if (script && script.parentNode) {
      script.parentNode.removeChild(script);
    }
    try {
      delete window[callbackName];
    } catch (e) {
      window[callbackName] = undefined;
    }
  };

  const timeout = setTimeout(() => {
    if (finished) return;
    finished = true;
    cleanup();
    setLoading(false);
    showNotFound('Не вдалося підключитися до HARAZD API.');
  }, 15000);

  window[callbackName] = function(result) {
    if (finished) return;
    finished = true;
    clearTimeout(timeout);
    cleanup();
    setLoading(false);

    if (!result || !result.success) {
      showNotFound(
        result && result.message
          ? result.message
          : 'Обладнання не знайдено.'
      );
      return;
    }

    showEquipment(result);
  };

  const separator = API_URL.includes('?') ? '&' : '?';

  script = document.createElement('script');
  script.src =
    API_URL +
    separator +
    'action=find' +
    '&code=' + encodeURIComponent(cleanCode) +
    '&callback=' + encodeURIComponent(callbackName) +
    '&_=' + Date.now();

  script.onerror = function() {
    if (finished) return;
    finished = true;
    clearTimeout(timeout);
    cleanup();
    setLoading(false);
    showNotFound('Помилка підключення до HARAZD API.');
  };

  document.body.appendChild(script);
}

// ============================================================
// QR SCANNER
// ============================================================

async function startScanner() {
  if (scannerRunning) return;

  if (typeof Html5Qrcode === 'undefined') {
    showMessage('Бібліотека QR-сканера не завантажилась.');
    return;
  }

  try {
    scanner = scanner || new Html5Qrcode('reader');
    scannerRunning = true;

    await scanner.start(
      { facingMode: 'environment' },
      {
        fps: 10,
        qrbox: function(viewfinderWidth, viewfinderHeight) {
          const size = Math.floor(
            Math.min(viewfinderWidth, viewfinderHeight) * 0.68
          );
          return { width: size, height: size };
        }
      },
      onScanSuccess,
      function() {}
    );
  } catch (error) {
    scannerRunning = false;
    showMessage(
      'Не вдалося відкрити камеру. Перевірте дозвіл браузера на використання камери.'
    );
  }
}

function onScanSuccess(decodedText) {
  const text = String(decodedText || '').trim();
  if (!text) return;

  const now = Date.now();

  // Захист від багаторазового зчитування одного коду.
  if (text === lastScanText && now - lastScanAt < 3000) {
    return;
  }

  lastScanText = text;
  lastScanAt = now;

  const input = document.getElementById('manualCode');
  if (input) input.value = text;

  if (navigator.vibrate) {
    navigator.vibrate(100);
  }

  stopScanner();
  findEquipmentByCode(text);
}

async function stopScanner() {
  if (!scanner || !scannerRunning) return;

  try {
    await scanner.stop();
  } catch (error) {}

  scannerRunning = false;
}

// ============================================================
// EQUIPMENT CARD
// ============================================================

function showEquipment(data) {
  const card = document.getElementById('equipmentCard');
  const notFound = document.getElementById('notFound');

  if (notFound) notFound.classList.add('hidden');
  if (card) card.classList.remove('hidden');

  setText('equipmentId', data.id || '—');
  setText('equipmentName', data.name || 'Без назви');

  const modelParts = [];
  if (data.model) modelParts.push(data.model);
  if (data.subcategory) modelParts.push(data.subcategory);
  setText('equipmentModel', modelParts.join(' • ') || '');

  setText('equipmentSerial', data.serial || '—');
  setText('equipmentBarcode', data.barcode || '—');
  setText('equipmentQr', data.qr || '—');
  setText('equipmentCategory', data.category || '—');
  setText('equipmentManufacturer', data.manufacturer || '—');
  setText('equipmentAccounting', data.accountingType || '—');

  const total = Number(data.total || 0);
  const available = Number(data.available || 0);
  const repair = Number(data.repair || 0);

  setText('equipmentQty', total + (data.unit ? ' ' + data.unit : ''));
  setText('equipmentAvailable', available + (data.unit ? ' ' + data.unit : ''));

  setText('equipmentWarehouse', data.warehouse || '—');

  const location = [
    data.zone,
    data.rack,
    data.shelf
  ].filter(Boolean).join(' / ');

  setText('equipmentLocation', location || '—');

  const status = document.getElementById('equipmentStatus');

  if (status) {
    if (repair > 0 && available <= 0) {
      status.textContent = '🔧 РЕМОНТ';
      status.style.background = '#fff1f1';
      status.style.color = '#c62828';
    } else if (available > 0) {
      status.textContent = '✓ ДОСТУПНО';
      status.style.background = '#e9f6ed';
      status.style.color = '#16803a';
    } else {
      status.textContent = 'НЕ ДОСТУПНО';
      status.style.background = '#f0f0f0';
      status.style.color = '#555';
    }
  }

  const description = document.getElementById('equipmentDescription');

  if (description) {
    if (data.description) {
      description.textContent = data.description;
      description.classList.remove('hidden');
    } else {
      description.textContent = '';
      description.classList.add('hidden');
    }
  }

  const photoWrap = document.getElementById('photoWrap');
  const photo = document.getElementById('equipmentPhoto');

  if (photoWrap && photo) {
    if (data.photo && /^https?:\/\//i.test(String(data.photo))) {
      photo.src = data.photo;
      photoWrap.classList.remove('hidden');
    } else {
      photo.removeAttribute('src');
      photoWrap.classList.add('hidden');
    }
  }

  card.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function hideEquipmentResult() {
  const card = document.getElementById('equipmentCard');
  const notFound = document.getElementById('notFound');

  if (card) card.classList.add('hidden');
  if (notFound) {
    notFound.classList.add('hidden');
    notFound.textContent = '';
  }
}

function showNotFound(text) {
  const card = document.getElementById('equipmentCard');
  const notFound = document.getElementById('notFound');

  if (card) card.classList.add('hidden');

  if (notFound) {
    notFound.textContent = text || 'Обладнання не знайдено.';
    notFound.classList.remove('hidden');
  }
}

function setLoading(state) {
  const el = document.getElementById('loading');
  if (!el) return;

  if (state) el.classList.remove('hidden');
  else el.classList.add('hidden');
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value == null ? '' : String(value);
}

// ============================================================
// MESSAGE
// ============================================================

function showMessage(text) {
  const el = document.getElementById('message');
  if (!el) return;

  el.textContent = text;
  el.style.display = 'block';

  clearTimeout(window._harazdMessageTimer);

  window._harazdMessageTimer = setTimeout(() => {
    el.style.display = 'none';
  }, 4000);
}
