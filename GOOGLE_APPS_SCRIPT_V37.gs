/** HARAZD V37: додайте ці функції до наявного Apps Script.
 * У наявному doGet(e) перед обробкою інших action додайте:
 * if (e.parameter.action === 'listEquipment') return harazdV37ListEquipment_(e);
 * НЕ замінюйте свій doGet: він обслуговує scanner/formData/addEquipment.
 */
function harazdV37ListEquipment_(e) {
  var callback = String((e.parameter || {}).callback || '');
  if (!/^[$A-Z_a-z][$\w]{0,100}$/.test(callback)) {
    return ContentService.createTextOutput('Invalid callback').setMimeType(ContentService.MimeType.TEXT);
  }
  var result;
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) throw new Error('Скрипт потрібно прив’язати до таблиці Google Sheets.');
    var sheet = ss.getSheetByName('СПИСОК ОБЛАДНАННЯ');
    if (!sheet) throw new Error('Не знайдено аркуш СПИСОК ОБЛАДНАННЯ');
    var rows = sheet.getLastRow() >= 2 ? sheet.getRange(2,1,sheet.getLastRow()-1,25).getDisplayValues() : [];
    var items = rows.filter(function(r){ return /^EQ-\d+$/i.test(String(r[0]).trim()); }).map(function(r){
      return {id:r[0],serial:r[1],barcode:r[2],qr:r[3],name:r[4],description:r[5],category:r[6],subcategory:r[7],model:r[8],manufacturer:r[9],accountingType:r[10],weight:r[11],unit:r[12],total:harazdV37Num_(r[13]),repair:harazdV37Num_(r[14]),available:harazdV37Num_(r[15]),warehouse:r[16],zone:r[17],rack:r[18],shelf:r[19],packaging:r[20],price:r[21],rentalPrice:r[23],photo:r[24]};
    });
    result = {success:true,items:items};
  } catch(err) { result = {success:false,message:String(err.message||err)}; }
  return ContentService.createTextOutput(callback+'('+JSON.stringify(result)+');').setMimeType(ContentService.MimeType.JAVASCRIPT);
}
function harazdV37Num_(value) {
  var n = Number(String(value||'0').replace(/\s/g,'').replace(',','.'));
  return isFinite(n) ? n : 0;
}
