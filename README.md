# HARAZD WAREHOUSE — Native Add Page

Ця версія ПОВНІСТЮ прибирає iframe зі сторінки `ДОДАТИ`.

Форма тепер малюється прямо в правій частині HARAZD WAREHOUSE:
- без "сторінки в сторінці";
- без внутрішнього скролу iframe;
- усі поля є частиною GitHub UI;
- адаптивна сітка 4 колонки на широкому екрані;
- 2 колонки на середньому;
- 1 колонка на телефоні.

## Важливо

Фронтенд готовий, але для повністю робочого збереження та dropdown-ів
потрібні два API actions у Apps Script:

- `action=formData`
- `action=addEquipment`

Файл `APPS_SCRIPT_NATIVE_ADD_PATCH.gs` пояснює, що треба підключити.

Щоб я зробив бекенд 1:1 без ризику зламати існуючу логіку,
потрібен поточний код `13_AddEquipmentAPI.gs`.

API:
https://script.google.com/macros/s/AKfycbytXZesXbry1qyynsnGGcBPj2vaomE5CPYG65h1A2fPZZNxUQ-G0u_fpxE3IwxHjHM8/exec
