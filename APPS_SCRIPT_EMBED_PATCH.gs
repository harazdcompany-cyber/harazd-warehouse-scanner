// ============================================================
// HARAZD WAREHOUSE
// EMBED MODE PATCH FOR doGet(e)
// ============================================================
//
// Додайте .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
// до HTML-відповіді сторінки ?page=add.
//
// ПРИКЛАД:
//
// function doGet(e) {
//
//   const page = String(e && e.parameter && e.parameter.page || '').trim();
//
//   if (page === 'add') {
//
//     const template = HtmlService.createTemplateFromFile('AddEquipment');
//
//     template.embedMode =
//       String(e.parameter.embed || '') === '1';
//
//     return template
//       .evaluate()
//       .setTitle('HARAZD WAREHOUSE — Додати обладнання')
//       .setXFrameOptionsMode(
//         HtmlService.XFrameOptionsMode.ALLOWALL
//       );
//   }
//
//   // ...ваші інші маршрути...
// }
//
// У AddEquipment.html можна використати embedMode, щоб приховати
// повторний заголовок HARAZD WAREHOUSE у вбудованому режимі.
