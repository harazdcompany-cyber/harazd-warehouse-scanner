# HARAZD WAREHOUSE — Embedded Add Equipment

Ця версія відкриває **ДОДАТИ** у правому робочому блоці HARAZD WAREHOUSE,
так само як модуль сканера.

## GitHub

Завантажте поверх поточних файлів:

- index.html
- style.css
- app.js
- manifest.json
- sw.js
- README.md

`APPS_SCRIPT_EMBED_PATCH.gs` у GitHub завантажувати не обов'язково —
це підказка для Apps Script.

## Важливо для Apps Script

Google Apps Script за замовчуванням може блокувати iframe.
У `doGet(e)` для сторінки `?page=add` потрібно додати:

```javascript
.setXFrameOptionsMode(
  HtmlService.XFrameOptionsMode.ALLOWALL
)
```

Готовий приклад лежить у файлі `APPS_SCRIPT_EMBED_PATCH.gs`.

Після цієї зміни форма:
- не відкриватиме окрему сторінку;
- залишатиме sidebar HARAZD WAREHOUSE;
- відображатиметься в правому блоці;
- матиме окрему резервну кнопку «Відкрити окремо».

Apps Script Web App:
https://script.google.com/macros/s/AKfycbytXZesXbry1qyynsnGGcBPj2vaomE5CPYG65h1A2fPZZNxUQ-G0u_fpxE3IwxHjHM8/exec
