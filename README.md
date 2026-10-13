# HARAZD WAREHOUSE V41 — виправлення довідників

## GitHub Pages
Замініть файли `index.html`, `app.js`, `style.css`, `sw.js`, `manifest.json` у корені репозиторію. Завантажте зміни в гілку `main`.

## Google Apps Script
Замініть ВЕСЬ вміст наявного файлу `12_ScannerAPI.gs` однойменним файлом з архіву (не створюйте другий `doGet`). Збережіть. Deploy → Manage deployments → Edit → Version: New version → Deploy. Перевірте URL `/exec?action=formData` — має бути `success:true` та масив `categories`.

Після публікації відкрийте сайт із Ctrl+Shift+R.

## Виправлено
- Завантаження категорій, підкатегорій, виробників, типів обліку, одиниць, складів і пакування з ДОВІДНИК A:J.
- Перетворення `categorySubcategories` та `locations` на залежні списки форми.
- Після редагування товару викликається існуюча `loadStock(true)` замість неіснуючої `loadStockEquipment()`.
- Оновлено версію кешу Service Worker.

**Увага:** Запис через `action=updateEquipment` у поточній архітектурі здійснюється GET/JSONP. Для виробничого використання потрібні авторизація та захищений POST-інтерфейс. Не відкривайте доступ на редагування всім без додаткового захисту.
