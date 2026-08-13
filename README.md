# HARAZD WAREHOUSE — UPDATE

Оновлення додає:

- ручний пошук обладнання;
- пошук за EQ-ID;
- пошук за Серійним ID;
- пошук за Barcode;
- пошук за QR/Штрихкодом;
- QR-сканування камерою;
- автоматичний пошук після сканування;
- картку знайденого обладнання.

## API

У цьому комплекті вже прописаний поточний HARAZD Apps Script URL:

`https://script.google.com/macros/s/AKfycybtXZesXbry1qynsnGGcBPj2vaomE5CPYG65h1A2fPZZNxUQ-G0u_fpxE3lwxHjHM8/exec`

Пошук виконується через JSONP:

`?action=find&code=EQ-000001&callback=...`

## Встановлення

Завантажте файли з ZIP у корінь GitHub-репозиторію
`harazd-warehouse-scanner` та підтвердьте заміну файлів.

Файл `sw.js`, який уже є в GitHub, видаляти не потрібно.
