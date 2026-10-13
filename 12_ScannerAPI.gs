/** HARAZD WAREHOUSE — Scanner and warehouse read API (v38).
 * Uses existing CONFIG, isEquipmentId_ and spreadsheet columns.
 * Replace the previous 12_ScannerAPI.gs with this entire file.
 * Deploy a NEW Web App version after saving.
 */
function doGet(e) {
  const p = (e && e.parameter) || {};
  const callback = String(p.callback || '').trim();
  try {
    const page = String(p.page || '').trim().toLowerCase();
    const action = String(p.action || '').trim().toLowerCase();
    if (page === 'add') {
      return HtmlService.createHtmlOutputFromFile('AddEquipment')
        .setTitle('HARAZD WAREHOUSE — Додати обладнання')
        .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
    }
    if (action === 'formdata') {
      return createWebApiResponse_(getWarehouseFormDataV41_(), callback);
    }
    if (action === 'updateequipment') {
      return createWebApiResponse_(updateEquipmentForWebApi_(p.id, p.payload), callback);
    }
    if (action === 'find') {
      return createWebApiResponse_(findEquipmentForWebApi_(p.code), callback);
    }
    // Support both legacy and V38 client action names.
    if (action === 'list' || action === 'listequipment') {
      return createWebApiResponse_(listEquipmentForWebApi_(), callback);
    }
    return createWebApiResponse_({success:true,app:CONFIG.APP_NAME,status:'online',message:'HARAZD WAREHOUSE API працює'},callback);
  } catch (error) {
    return createWebApiResponse_({success:false,message:'Помилка HARAZD API',error:String(error && error.message || error)},callback);
  }
}

function getWebEquipmentRows_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('Не вдалося відкрити Google Sheets.');
  const sheet = ss.getSheetByName(CONFIG.SHEETS.EQUIPMENT);
  if (!sheet) throw new Error('Лист обладнання не знайдено.');
  const first = CONFIG.FIRST_DATA_ROW;
  const last = sheet.getLastRow();
  if (last < first) return [];
  return sheet.getRange(first,1,last-first+1,CONFIG.COL.PHOTO).getDisplayValues()
    .map((row,i) => ({row, sheetRow:first+i}))
    .filter(item => isEquipmentId_(item.row[CONFIG.COL.ID-1]));
}

function listEquipmentForWebApi_() {
  const items = getWebEquipmentRows_().map(item => buildEquipmentWebResult_(item.row,item.sheetRow));
  return {success:true,count:items.length,items:items};
}

function findEquipmentForWebApi_(searchCode) {
  const code = normalizeWebSearchValue_(searchCode);
  if (!code) return {success:false,message:'Введіть EQ-ID, Серійний ID, Barcode або QR.'};
  const keys = [CONFIG.COL.ID,CONFIG.COL.SERIAL,CONFIG.COL.BARCODE,CONFIG.COL.QR];
  const found = getWebEquipmentRows_().find(item => keys.some(col => normalizeWebSearchValue_(item.row[col-1]) === code));
  return found ? buildEquipmentWebResult_(found.row,found.sheetRow) : {success:false,code:String(searchCode),message:'Обладнання не знайдено.'};
}

function buildEquipmentWebResult_(row,sheetRow) {
  const c = CONFIG.COL;
  const cell = col => webCell_(row,col);
  const num = col => webNumber_(row,col);
  return {
    success:true,row:sheetRow,
    id:cell(c.ID),serial:cell(c.SERIAL),barcode:cell(c.BARCODE),qr:cell(c.QR),
    name:cell(c.NAME),description:cell(c.DESCRIPTION),category:cell(c.CATEGORY),
    subcategory:cell(c.SUBCATEGORY),model:cell(c.MODEL),manufacturer:cell(c.MANUFACTURER),
    accountingType:cell(c.ACCOUNTING_TYPE),weight:cell(c.WEIGHT),unit:cell(c.UNIT),
    total:num(c.TOTAL_QTY),repair:num(c.REPAIR_QTY),available:num(c.AVAILABLE_QTY),
    warehouse:cell(c.WAREHOUSE),zone:cell(c.ZONE),rack:cell(c.RACK),shelf:cell(c.SHELF),
    packaging:cell(c.PACKAGING),price:num(c.PRICE),totalValue:num(c.TOTAL_VALUE),
    rentalPrice:num(c.RENTAL_PRICE),photo:normalizeEquipmentPhotoUrl_(cell(c.PHOTO))
  };
}

function webCell_(row,column) {
  const value = row && column ? row[column-1] : '';
  return value === null || value === undefined ? '' : String(value).trim();
}
function webNumber_(row,column) {
  const value = webCell_(row,column).replace(/[\s\u00a0]/g,'').replace(',','.');
  const n = Number(value);
  return value && Number.isFinite(n) ? n : 0;
}
function normalizeWebSearchValue_(value) {
  return String(value === null || value === undefined ? '' : value).replace(/\u00a0/g,' ').trim().toUpperCase();
}
function normalizeEquipmentPhotoUrl_(value) {
  const url = String(value || '').trim();
  if (!/^https?:\/\//i.test(url)) return '';
  const id = extractGoogleDriveFileId_(url);
  return id ? 'https://drive.google.com/thumbnail?id='+encodeURIComponent(id)+'&sz=w1200' : url;
}
function extractGoogleDriveFileId_(url) {
  if (!/^https?:\/\/(?:drive|docs)\.google\.com\//i.test(String(url))) return '';
  const text = String(url);
  const match = text.match(/\/d\/([a-zA-Z0-9_-]+)/) || text.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  return match ? match[1] : '';
}
function createWebApiResponse_(data,callback) {
  const json = JSON.stringify(data);
  if (callback) {
    const safe = sanitizeJsonpCallback_(callback);
    if (!safe) return ContentService.createTextOutput(JSON.stringify({success:false,message:'Некоректний callback'})).setMimeType(ContentService.MimeType.JSON);
    return ContentService.createTextOutput(safe+'('+json+');').setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}
function sanitizeJsonpCallback_(value) {
  const name = String(value || '').trim();
  return /^[a-zA-Z_$][a-zA-Z0-9_$]*(?:\.[a-zA-Z_$][a-zA-Z0-9_$]*)*$/.test(name) ? name : '';
}
function testScannerApi() {
  Logger.log(JSON.stringify(findEquipmentForWebApi_('EQ-000021'),null,2));
}
function testWarehouseListApi() {
  const data = listEquipmentForWebApi_();
  Logger.log(JSON.stringify({success:data.success,count:data.count,first:data.items[0] || null},null,2));
}


/** V40: Update a single equipment record by immutable EQ-ID. */
function updateEquipmentForWebApi_(id, payloadJson) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return {success:false,message:'Склад зайнятий. Спробуйте ще раз.'};
  try {
    const code = normalizeWebSearchValue_(id);
    if (!/^EQ-\d{6,}$/.test(code)) throw new Error('Некоректний EQ-ID');
    if (String(payloadJson || '').length > 12000) throw new Error('Завеликий запит');
    const data = JSON.parse(String(payloadJson || '{}'));
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Некоректні дані');
    const c = CONFIG.COL;
    const columns = {
      name:c.NAME, description:c.DESCRIPTION, category:c.CATEGORY,
      subcategory:c.SUBCATEGORY,manufacturer:c.MANUFACTURER,model:c.MODEL,
      accountingType:c.ACCOUNTING_TYPE,unit:c.UNIT,total:c.TOTAL_QTY,
      repair:c.REPAIR_QTY,weight:c.WEIGHT,warehouse:c.WAREHOUSE,
      zone:c.ZONE,rack:c.RACK,shelf:c.SHELF,packaging:c.PACKAGING,
      price:c.PRICE,rentalPrice:c.RENTAL_PRICE,serial:c.SERIAL,
      barcode:c.BARCODE,qr:c.QR,photo:c.PHOTO
    };
    const ss=SpreadsheetApp.getActiveSpreadsheet();
    const sheet=ss.getSheetByName(CONFIG.SHEETS.EQUIPMENT);
    if (!sheet) throw new Error('Лист обладнання не знайдено');
    const first=CONFIG.FIRST_DATA_ROW;
    const ids=sheet.getRange(first,c.ID,Math.max(1,sheet.getLastRow()-first+1),1).getDisplayValues();
    const index=ids.findIndex(r=>normalizeWebSearchValue_(r[0])===code);
    if(index<0)throw new Error('Обладнання не знайдено');
    const row=first+index;
    const current=sheet.getRange(row,1,1,c.PHOTO).getValues()[0];
    const changes={};
    Object.keys(columns).forEach(key=>{
      if(!Object.prototype.hasOwnProperty.call(data,key))return;
      let value=String(data[key]??'').trim();
      if(value.length>3000)throw new Error('Завелике значення: '+key);
      if(['total','repair','weight','price','rentalPrice'].includes(key)){
        const n=Number(value.replace(',','.'));
        if(!Number.isFinite(n)||n<0)throw new Error('Некоректне число: '+key);
        if(['total','repair'].includes(key)&&!Number.isInteger(n))throw new Error('Кількість має бути цілою');
        value=n;
      } else if (/^[=+@]/.test(value)) throw new Error('Недопустимий початок текстового поля: '+key);
      changes[key]=value;
    });
    ['name','category','accountingType','unit','warehouse'].forEach(key=>{
      if(key in changes&&!String(changes[key]).trim())throw new Error('Заповніть поле '+key);
    });
    const total='total'in changes?changes.total:Number(current[c.TOTAL_QTY-1])||0;
    const repair='repair'in changes?changes.repair:Number(current[c.REPAIR_QTY-1])||0;
    if(repair>total)throw new Error('На ремонті не може бути більше за загальну кількість');
    if(String(changes.accountingType||current[c.ACCOUNTING_TYPE-1])==='Персональний'&&total!==1)
      throw new Error('Персональна одиниця повинна мати кількість 1');
    Object.keys(changes).forEach(key=>{sheet.getRange(row,columns[key]).setValue(changes[key]);});
    sheet.getRange(row,c.AVAILABLE_QTY).setValue(total-repair);
    const price='price'in changes?changes.price:Number(current[c.PRICE-1])||0;
    sheet.getRange(row,c.TOTAL_VALUE).setValue(total*price);
    SpreadsheetApp.flush();
    return {success:true,id:code,message:'Зміни збережено'};
  }catch(error){return {success:false,message:String(error.message||error)};}
  finally{lock.releaseLock();}
}

/** V41: dropdown reference data from ДОВІДНИК A:J. */
function getWarehouseFormDataV41_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('Немає доступу до Google Sheets');
  const sheet = ss.getSheetByName('ДОВІДНИК');
  if (!sheet) throw new Error('Не знайдено аркуш ДОВІДНИК');
  const rows = sheet.getLastRow() > 1
    ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 10).getDisplayValues()
    : [];
  const unique = col => [...new Set(rows.map(r => String(r[col] || '').trim()).filter(Boolean))];
  const categorySubcategories = [];
  const locations = [];
  const seenCategories = new Set();
  const seenLocations = new Set();
  rows.forEach(r => {
    const category = String(r[0] || '').trim();
    const subcategory = String(r[1] || '').trim();
    if (category && subcategory) {
      const key = JSON.stringify([category, subcategory]);
      if (!seenCategories.has(key)) {
        seenCategories.add(key);
        categorySubcategories.push({category, subcategory});
      }
    }
    const warehouse = String(r[5] || '').trim();
    if (!warehouse) return;
    const entry = {warehouse, zone:String(r[6] || '').trim(), rack:String(r[7] || '').trim(), shelf:String(r[8] || '').trim()};
    const key = JSON.stringify(entry);
    if (!seenLocations.has(key)) {
      seenLocations.add(key);
      locations.push(entry);
    }
  });
  return {
    success:true, categories:unique(0), subcategories:unique(1),
    manufacturers:unique(2), accountingTypes:unique(3), units:unique(4),
    warehouses:unique(5), zones:unique(6), racks:unique(7), shelves:unique(8),
    packaging:unique(9), categorySubcategories, locations
  };
}
