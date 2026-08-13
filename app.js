// HARAZD WAREHOUSE FRONTEND
const URLS = {
  scanner: 'https://harazdcompany-cyber.github.io/harazd-warehouse-scanner/',
  addEquipmentBase: 'ВСТАВ_СЮДИ_РОБОЧИЙ_URL_APPS_SCRIPT_EXEC'
};

function openScanner() {
  window.location.href = URLS.scanner;
}

function openAddEquipment() {
  if (!URLS.addEquipmentBase || URLS.addEquipmentBase.includes('ВСТАВ_СЮДИ')) {
    showMessage('Не задано URL форми додавання.');
    return;
  }
  const base = URLS.addEquipmentBase.split('?')[0];
  window.location.href = base + '?page=add';
}

function notReady(moduleName) {
  showMessage('Модуль «' + moduleName + '» ще розробляється.');
}

function showMessage(text) {
  const element = document.getElementById('message');
  if (!element) return;
  element.textContent = text;
  setTimeout(function(){ element.textContent = ''; }, 3000);
}
