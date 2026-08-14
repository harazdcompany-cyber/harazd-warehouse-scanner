# HARAZD WAREHOUSE — GitHub package v1.2

Готовий пакет для завантаження в корінь GitHub Pages репозиторію.

## Що виправлено
- сторінка **ДОДАТИ** нативна, без iframe і без «сторінки в сторінці»;
- форма розкладена у 4 колонки на широкому екрані;
- поля компактніші, щоб максимально помістити форму в правому робочому блоці;
- прибрана окрема кнопка/підказка Enter біля пошуку;
- нормалізовані імена `index.html`, `manifest.json`, `sw.js`;
- cache service worker піднято до v17.

## GitHub
Завантажте `index.html`, `app.js`, `style.css`, `manifest.json`, `sw.js` поверх однойменних файлів у корені репозиторію.

## Apps Script
Фронтенд очікує API actions `formData` та `addEquipment`. Файл `APPS_SCRIPT_NATIVE_ADD_PATCH.gs` описує точки підключення. Для повністю робочого збереження потрібна реалізація цих actions у вашому поточному Apps Script.
