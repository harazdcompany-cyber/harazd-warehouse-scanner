HARAZD WAREHOUSE V37 — STOCK + GOOGLE SHEETS

1. Завантажте index.html, app.js, style.css, sw.js, manifest.json до GitHub репозиторію замість старих файлів.
2. У наявний Google Apps Script вставте код із GOOGLE_APPS_SCRIPT_V37.gs.
3. У вашому ІСНУЮЧОМУ doGet(e) додайте перед іншими перевірками action:
   if (e.parameter.action === 'listEquipment') return harazdV37ListEquipment_(e);
   Не створюйте другого doGet, не видаляйте наявні action=find/formData/addEquipment.
4. Deploy -> Manage deployments -> Edit -> New version -> Deploy.
5. Якщо URL вебзастосунку змінився, замініть window.HARAZD_API_URL у index.html.
6. Відкрийте GitHub Pages, оновіть сторінку; при старому кеші закрийте/відкрийте PWA.

Важливо: у Google Sheets мають бути колонки A:Y у структурі HARAZD, аркуш СПИСОК ОБЛАДНАННЯ.
Відображаються лише рядки EQ-000001 тощо; службові рядки категорій та груп не дублюються.
Додавання використовує наявний action=addEquipment, код якого не входив у надіслані файли.
У V37 нова функція читання готова, але фактичну інтеграцію потрібно виконати у вашому чинному Apps Script.
Без контролю доступу до Apps Script дані складу будуть доступні кожному, хто має URL API; для приватного складу потрібна авторизація.
