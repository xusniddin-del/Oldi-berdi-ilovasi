/**
 * Oldi-Berdi — Google Sheets server (Apps Script)
 * ------------------------------------------------
 * 1) Google Sheets'da yangi jadval oching: Kengaytmalar (Extensions) → Apps Script
 * 2) Shu faylning hammasini Code.gs ichiga qo'ying va saqlang
 * 3) Yuqoridan "setup" funksiyasini tanlab, ▶ Run bosing (ruxsat bering)
 * 4) Deploy → New deployment → Web app:
 *      Execute as: Me    |    Who has access: Anyone
 * 5) Chiqqan Web app havolasini (…/exec) ilovadagi config.js fayliga qo'ying
 *
 * PREMIUM: Accounts varag'idagi "premium" ustuniga yozing:
 *   2026-12-31  → shu sanagacha Premium
 *   ha          → muddatsiz Premium
 *   (bo'sh)     → bepul tarif
 *
 * ONLAYN TO'LOV (TezCheck): Project Settings → Script Properties ga qo'shing:
 *   TC_KEY   = maxfiy API kalit (aps_…)
 *   TC_DESK  = kassa kodi (cdk_…)
 * Narxlar Meta varag'ida: price_month, price_year (so'mda). 0 yozilsa — o'sha tarif yopiladi.
 * To'langan to'lovlar Payments varag'iga yoziladi va Premium o'zi yoqiladi/uzaytiriladi.
 *
 * TELEGRAM BOT: Script Properties ga TG_TOKEN (BotFather tokeni) va ADMIN_PHONE (raqamingiz) qo'shing,
 * yangi versiyani Deploy qiling, keyin yuqoridan "botSetup" funksiyasini tanlab ▶ Run bosing.
 *
 * ADMIN PANEL: botda /admin deb yozing (faqat admin Telegram'ida ochiladi).
 *   ADMIN_TG = Telegram ID raqamingiz (ixtiyoriy). Yozilmasa — ADMIN_PHONE akkauntiga ulangan Telegram admin hisoblanadi.
 */

const TABLES = {
  Accounts: ['id', 'name', 'phone', 'salt', 'hash', 'photo', 'currency', 'pinSalt', 'pinHash', 'createdAt', 'premium', 'tg', 'trialEnd', 'biz', 'badge'],
  Sessions: ['token', 'acc', 'createdAt'],
  People:   ['id', 'acc', 'name', 'phone', 'note', 'photo', 'log', 'createdAt', 'updatedAt'],
  Tx:       ['id', 'acc', 'pid', 'type', 'amount', 'date', 'due', 'note', 'photo', 'edits', 'createdAt', 'updatedAt', 'cur', 'plan'],
  Confirms: ['token', 'acc', 'txId', 'status', 'answeredAt', 'createdAt'],
  Meta:     ['key', 'value'],
  Reminders: ['key', 'acc', 'pid', 'txId', 'idx', 'due', 'amount', 'status', 'markDay', 'chat', 'msg', 'text', 'updatedAt'],
  Payments: ['bill', 'acc', 'phone', 'tarif', 'days', 'amount', 'status', 'createdAt', 'paidAt', 'until'],
  Lists:    ['id', 'acc', 'name', 'items', 'createdAt', 'updatedAt'],
  Docs:     ['id', 'acc', 'kind', 'name', 'data', 'createdAt', 'updatedAt'],
  Kids:     ['id', 'acc', 'name', 'photo', 'pinSalt', 'pinHash', 'data', 'createdAt', 'updatedAt']
};
const JSON_FIELDS = { log: true, edits: true, plan: true, items: true, data: true };
/* Docs turlari va ular uchun kerakli tarif: '' — bepul, 'prem' — Premium, 'biz' — Biznes */
const DOC_KINDS = { toy: 'prem', toyg: 'prem', loan: 'prem', gap: 'prem', yigin: '', biz: 'biz' };
/* ---------- imkoniyatlar: admin paneldan boshqariladi ----------
 * off — ilovada ko'rinmaydi (ma'lumotlar o'chmaydi), free — hammaga bepul, prem — faqat Premium */
const FEAT_DEF = { shop: 'prem', toy: 'off', loan: 'off', gap: 'off', yigin: 'free', kids: 'prem', report: 'prem', excel: 'prem', remind: 'prem', trust: 'prem', usd: 'prem', plan: 'prem', confirm: 'prem', ru: 'prem', biz: 'prem' };
const FEAT_MODES = { shop: ['off', 'free', 'prem'], toy: ['off', 'free', 'prem'], loan: ['off', 'free', 'prem'], gap: ['off', 'free', 'prem'], yigin: ['off', 'free', 'prem'], kids: ['off', 'free', 'prem'], biz: ['off', 'prem'] };
const DOC_FEAT_ = { toy: 'toy', toyg: 'toy', loan: 'loan', gap: 'gap', yigin: 'yigin', biz: 'biz' };
let FEAT_MEMO_ = null;
function feat_() {
  if (FEAT_MEMO_) return FEAT_MEMO_;
  let o = {}; try { o = JSON.parse(meta_('features') || '{}') || {}; } catch (e) {}
  const r = {};
  Object.keys(FEAT_DEF).forEach(function (k) { r[k] = (FEAT_MODES[k] || ['free', 'prem']).indexOf(o[k]) >= 0 ? o[k] : FEAT_DEF[k]; });
  return (FEAT_MEMO_ = r);
}
/* "off" bo'lgan bo'lim ham Premium kabi tekshiriladi: telefonda navbatda turgan eski yozuvlar yo'qolmasin */
function featOk_(a, f) { return feat_()[f] === 'free' || premium_(a).on; }
const PREM_BADGES_ = ['green', 'gold', 'gem', 'crown'];
const TX_TYPES = { lend: true, borrow: true, got: true, paid: true };
const BLOCKABLE = { savePerson: 1, deletePerson: 1, saveTx: 1, deleteTx: 1, shareTx: 1, mirrorConfirm: 1, setCurrency: 1, instMark: 1 };
const WRITE = { startTrial: 1, instMark: 1, payCreate: 1, payCheck: 1, shareTx: 1, answerConfirm: 1, mirrorConfirm: 1, register: 1, login: 1, logout: 1, saveProfile: 1, setBadge: 1, changePass: 1, setPin: 1, setCurrency: 1, savePerson: 1, deletePerson: 1, saveTx: 1, deleteTx: 1, saveList: 1, deleteList: 1, saveDoc: 1, deleteDoc: 1, kidSave: 1, kidDelete: 1, kidTx: 1, kidLogin: 1, kidAddTx: 1, kidGoals: 1, kidProfile: 1, kidLogout: 1, admSetPlan: 1, admTrial: 1, admPass: 1, admLogout: 1, admFeat: 1, admPrices: 1 };

/* ---------- one-time setup ---------- */
function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(TABLES).forEach(function (name) {
    let s = ss.getSheetByName(name);
    if (!s) s = ss.insertSheet(name);
    const h = TABLES[name];
    s.getRange(1, 1, 1, h.length).setValues([h]).setFontWeight('bold').setBackground('#13894a').setFontColor('#ffffff');
    s.setFrozenRows(1);
  });
  ss.getSheets().forEach(function (s) {
    if (!TABLES[s.getName()] && s.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(s);
  });
  folder_();
  return 'Tayyor! Endi Deploy → New deployment → Web app qiling.';
}

/* ---------- HTTP ---------- */
function doGet() {
  return out_({ ok: true, app: 'Oldi-Berdi', message: 'Server ishlayapti' });
}

function doPost(e) {
  let req;
  try { req = JSON.parse(e.postData.contents); } catch (x) { return out_({ ok: false, error: "Noto'g'ri so'rov" }); }
  if (req.update_id !== undefined) {   // Telegram bot update
    try { const l = LockService.getScriptLock(); l.waitLock(25000); try { botUpdate_(req); } finally { l.releaseLock(); } } catch (x) { console.error(x); }
    return HtmlService.createHtmlOutput('ok');
  }
  if (!req.action && req.data && req.data.bill_id) {   // TezCheck webhook: verified by asking TezCheck directly
    try { const l = LockService.getScriptLock(); l.waitLock(20000); try { payVerify_(String(req.data.bill_id)); } finally { l.releaseLock(); } } catch (x) {}
    return HtmlService.createHtmlOutput('ok');
  }
  const fn = API[req.action];
  if (!fn) return out_({ ok: false, error: "Noma'lum amal" });
  try { migrate_(); migrate2_(); } catch (x) {}
  const lock = LockService.getScriptLock();
  let locked = false;
  try {
    if (WRITE[req.action]) { lock.waitLock(20000); locked = true; }
    const r = fn(req) || {};
    r.ok = true;
    return out_(r);
  } catch (err) {
    return out_({ ok: false, error: String((err && err.message) || err) });
  } finally {
    if (locked) lock.releaseLock();
  }
}

function out_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

/* ---------- sheet helpers ---------- */
function sheet_(n) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let s = ss.getSheetByName(n);
  if (!s && TABLES[n] && ss.getSheetByName('Accounts')) {
    s = ss.insertSheet(n);
    s.getRange(1, 1, 1, TABLES[n].length).setValues([TABLES[n]]).setFontWeight('bold').setBackground('#13894a').setFontColor('#ffffff');
    s.setFrozenRows(1);
  }
  if (!s) throw new Error('Jadval topilmadi: ' + n + '. Apps Script ichida setup funksiyasini bir marta ishga tushiring.');
  if (TABLES[n] && !HDR_[n]) {   // add header cells for columns added in newer versions
    HDR_[n] = 1;
    const h = TABLES[n];
    if (s.getLastColumn() < h.length) s.getRange(1, 1, 1, h.length).setValues([h]).setFontWeight('bold').setBackground('#13894a').setFontColor('#ffffff');
  }
  return s;
}
const HDR_ = {};
function all_(n) {
  const s = sheet_(n), last = s.getLastRow(), h = TABLES[n];
  if (last < 2) return [];
  return s.getRange(2, 1, last - 1, h.length).getValues().map(function (r, i) {
    const o = { _row: i + 2 };
    h.forEach(function (k, j) {
      let x = r[j];
      if (x instanceof Date) x = Utilities.formatDate(x, Session.getScriptTimeZone(), 'yyyy-MM-dd');
      if (JSON_FIELDS[k]) { try { x = x ? JSON.parse(x) : []; } catch (er) { x = []; } }
      else if (k !== 'amount' && k !== 'createdAt' && k !== 'updatedAt') x = (x === null || x === undefined) ? '' : String(x);
      o[k] = x;
    });
    return o;
  });
}
function put_(n, obj, row) {
  const h = TABLES[n];
  const vals = h.map(function (k) {
    let x = obj[k];
    if (x === undefined || x === null) x = '';
    if (JSON_FIELDS[k]) x = JSON.stringify(x || []);
    if (typeof x === 'string' && x !== '') x = "'" + x;   // keep as plain text (dates, phones)
    return x;
  });
  const s = sheet_(n);
  if (row) s.getRange(row, 1, 1, h.length).setValues([vals]);
  else s.appendRow(vals);
}
function delRows_(n, rows) {
  const s = sheet_(n);
  rows.sort(function (a, b) { return b - a; }).forEach(function (r) { s.deleteRow(r); });
}
function clean_(o) { const c = {}; Object.keys(o).forEach(function (k) { if (k !== '_row' && k !== 'acc') c[k] = o[k]; }); return c; }
function uid_() { return Utilities.getUuid().replace(/-/g, '').slice(0, 20); }
function hash_(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8)
    .map(function (b) { return ('0' + (b & 255).toString(16)).slice(-2); }).join('');
}
function pwHash_(salt, pass) { return hash_(salt + '|' + pass + '|oldi-berdi'); }   // eski (v1) usul — faqat tekshirish uchun
/* v2: parol xeshi ko'p marta takrorlanadi — jadval begona qo'lga tushsa ham parolni topish ancha qiyin */
const PW_ROUNDS = 500;
function pwHashV2_(salt, pass) {
  let h = pwHash_(salt, pass);
  for (let i = 0; i < PW_ROUNDS; i++) h = hash_(h + '|' + salt);
  return 'v2$' + h;
}
/* parolni tekshiradi; eski (v1) xesh to'g'ri kelsa, akkauntni jimgina v2 ga o'tkazadi */
function checkPw_(a, pass) {
  const stored = String(a.hash || '');
  if (stored.indexOf('v2$') === 0) return pwHashV2_(a.salt, pass) === stored;
  if (pwHash_(a.salt, pass) !== stored) return false;
  try { a.hash = pwHashV2_(a.salt, pass); put_('Accounts', a, a._row); } catch (e) { console.error(e); }
  return true;
}
/* kirishda ketma-ket xato parol: 5 marta xato → 15 daqiqa kutish */
const LOGIN_MAX_FAILS = 5, LOGIN_BLOCK_SEC = 900;
function loginGuard_(phone) {
  const n = Number(CacheService.getScriptCache().get('lf_' + phone) || 0);
  if (n >= LOGIN_MAX_FAILS) throw new Error("Juda ko'p xato urinish. 15 daqiqadan keyin qayta urinib ko'ring.");
}
function loginFail_(phone) {
  const c = CacheService.getScriptCache(), k = 'lf_' + phone;
  c.put(k, String(Number(c.get(k) || 0) + 1), LOGIN_BLOCK_SEC);
}
function normPhone_(p) { let d = String(p || '').replace(/\D/g, ''); if (d.length === 9) d = '998' + d; return d; }
function str_(v, max) { return String(v === undefined || v === null ? '' : v).slice(0, max || 500); }
function pub_(a) {
  return { id: a.id, name: a.name, phone: a.phone, photo: a.photo, currency: a.currency || "so'm", pinSalt: a.pinSalt, pinHash: a.pinHash, createdAt: a.createdAt, premium: premium_(a), tg: !!a.tg, badge: a.badge || '' };
}
/* Biznes tarif muddati: '' — yo'q, 'ha' — muddatsiz, aks holda sana */
function bizUntil_(a) {
  if (a.phone && a.phone === adminPhone_()) return 'ha';
  const v = String(a.biz || '').trim().toLowerCase();
  if (!v || v === '0' || v === "yo'q" || v === 'no') return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v >= today_() ? v : '';
  return 'ha';
}
/* Biznes faol bo'lsa, Premium ham faol hisoblanadi */
function premium_(a) {
  const p = premiumBase_(a), b = bizUntil_(a);
  if (!b) return p;
  const unlimited = p.on && p.until === '' && !p.trial;
  p.on = true; p.biz = true; p.bizUntil = b === 'ha' ? '' : b;
  delete p.trial; delete p.canTrial;
  if (b === 'ha' || unlimited) p.until = ''; else if (!p.until || p.until < b) p.until = b;
  return p;
}
function premiumBase_(a) {
  if (a.phone && a.phone === adminPhone_()) return { on: true, until: '' };
  const td = today_(), v = String(a.premium || '').trim().toLowerCase();
  let paidUntil = '';
  if (v && v !== '0' && v !== "yo'q" && v !== 'yoq' && v !== 'no') {
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) { if (v >= td) return { on: true, until: v }; paidUntil = v; }
    else return { on: true, until: '' };
  }
  const te = String(a.trialEnd || '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(te)) {
    if (te >= td) return { on: true, until: te, trial: true };
    return { on: false, trialUsed: true, trialEnd: te, until: paidUntil };   // sinov tugadi: bepul qism ishlayveradi
  }
  return { on: false, canTrial: !paidUntil, trialDays: TRIAL_DAYS, until: paidUntil };   // bepul foydalanuvchi
}
function meta_(key) { const r = all_('Meta').filter(function (m) { return m.key === key; })[0]; return r ? r.value : ''; }

/* ---------- photos (Google Drive) ---------- */
function folder_() {
  const p = PropertiesService.getScriptProperties();
  const id = p.getProperty('FOLDER');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) {} }
  const f = DriveApp.createFolder('Oldi-Berdi rasmlar');
  p.setProperty('FOLDER', f.getId());
  return f;
}
function photo_(acc, v) {
  v = String(v || '');
  if (!v) return '';
  if (v.indexOf('d:') === 0) return v;
  const m = v.match(/^data:(image\/[a-z+]+);base64,(.+)$/);
  if (!m) return '';
  if (m[2].length > 900000) throw new Error('Rasm juda katta');
  const blob = Utilities.newBlob(Utilities.base64Decode(m[2]), m[1], acc + '_' + uid_() + '.jpg');
  return 'd:' + folder_().createFile(blob).getId();
}

/* ---------- auth ---------- */
function auth_(req) {
  const t = String(req.token || '');
  if (!t) throw new Error('AUTH');
  const s = all_('Sessions').filter(function (x) { return x.token === t; })[0];
  if (!s) throw new Error('AUTH');
  const a = all_('Accounts').filter(function (x) { return x.id === s.acc; })[0];
  if (!a) throw new Error('AUTH');
  return a;
}
function newSession_(accId) {
  const token = uid_() + uid_();
  put_('Sessions', { token: token, acc: accId, createdAt: Date.now() });
  return token;
}
function marks_(accId) {
  const o = {};
  all_('Reminders').forEach(function (r) { if (r.acc === accId && r.status && r.status !== 'open') o[r.key] = { s: r.status, d: r.markDay }; });
  return o;
}
function data_(accId) {
  const confirms = {};
  all_('Confirms').forEach(function (c) { if (c.acc === accId) confirms[c.txId] = { status: c.status, token: c.token }; });
  return {
    people: all_('People').filter(function (p) { return p.acc === accId; }).map(clean_),
    tx: all_('Tx').filter(function (t) { return t.acc === accId; }).map(clean_),
    lists: all_('Lists').filter(function (l) { return l.acc === accId; }).map(clean_),
    docs: all_('Docs').filter(function (x) { return x.acc === accId; }).map(clean_),
    kids: all_('Kids').filter(function (k) { return k.acc === accId; }).map(kidPub_),
    confirms: confirms,
    rate: rate_(),
    api: 11,
    feat: feat_(),
    marks: marks_(accId),
    prices: prices_(),
    version: meta_('version')
  };
}

/* Central Bank of Uzbekistan USD rate, cached for 6 hours */
function rate_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('usd');
  if (hit) return JSON.parse(hit);
  try {
    const r = JSON.parse(UrlFetchApp.fetch('https://cbu.uz/uz/arkhiv-kursov-valyut/json/USD/', { muteHttpExceptions: true }).getContentText());
    const o = { usd: Number(r[0].Rate), date: String(r[0].Date) };
    if (o.usd > 0) { cache.put('usd', JSON.stringify(o), 21600); return o; }
  } catch (e) {}
  return null;
}
function plan_(v) {
  if (!Array.isArray(v)) return [];
  return v.slice(0, 120).map(function (x) { return { d: str_(x && x.d, 10), a: Number(x && x.a) || 0 }; }).filter(function (x) { return x.d && x.a > 0; });
}
const FLIP = { lend: 'borrow', borrow: 'lend', got: 'paid', paid: 'got' };

/* ---------- online payment (TezCheck) ---------- */
const PLANS = { month: { days: 30, key: 'price_month', def: 59000, title: 'Oldi-Berdi Premium — 1 oy' }, year: { days: 365, key: 'price_year', def: 588000, title: 'Oldi-Berdi Premium — 1 yil' }, biz: { days: 30, key: 'price_biz', def: 99000, title: 'Oldi-Berdi Biznes — 1 oy', biz: true } };
function prices_() {
  const p = PropertiesService.getScriptProperties();
  const on = !!(p.getProperty('TC_KEY') && p.getProperty('TC_DESK'));
  const o = { online: on, bot: p.getProperty('TG_BOT') || '' };
  Object.keys(PLANS).forEach(function (k) { const v = meta_(PLANS[k].key); o[k] = v === '' ? PLANS[k].def : Number(String(v).replace(/\s/g, '')) || 0; });
  if (feat_().biz === 'off') o.biz = 0;
  return o;
}
function tc_(path, body, idem) {
  const p = PropertiesService.getScriptProperties();
  const key = p.getProperty('TC_KEY'), desk = p.getProperty('TC_DESK');
  if (!key || !desk) throw new Error("Onlayn to'lov hali ulanmagan");
  const headers = { Authorization: 'Bearer ' + key, 'X-Cash-Desk-Code': desk, Accept: 'application/json' };
  if (idem) headers['Idempotency-Key'] = idem;
  const res = UrlFetchApp.fetch('https://api.tezcheck.uz/api/merchant/v1' + path, { method: 'post', contentType: 'application/json', headers: headers, payload: JSON.stringify(body || {}), muteHttpExceptions: true });
  let j = {}; try { j = JSON.parse(res.getContentText()); } catch (e) {}
  const code = res.getResponseCode();
  if (code < 200 || code >= 300) {
    const er = (j.error && (j.error.message || j.error.code)) || j.message || ('HTTP ' + code);
    const x = new Error("To'lov tizimi: " + er); x.tc = j; x.code = code; throw x;
  }
  return j;
}
function createBill_(a, planKey, ret) {
  const plan = PLANS[planKey];
  if (!plan) throw new Error("Tarif noto'g'ri");
  const price = prices_()[planKey];
  if (!price) throw new Error('Bu tarif hozircha yopiq');
  const idem = uid_();
  const body = { amount_minor: Math.round(price * 100), title: plan.title, description: 'Akkaunt: +' + a.phone, external_reference: a.id + ':' + planKey + ':' + idem.slice(0, 8) };
  let j;
  try { j = tc_('/bills', ret ? Object.assign({ return_url: ret }, body) : body, idem); }
  catch (e) { if (ret && /return|url|allow/i.test(e.message + JSON.stringify(e.tc || {}))) j = tc_('/bills', body, idem + 'n'); else throw e; }
  const bill = j.data && j.data.bill, url = j.data && j.data.payment_url;
  if (!bill || !url) throw new Error("To'lov havolasini olib bo'lmadi");
  put_('Payments', { bill: String(bill.id), acc: a.id, phone: a.phone, tarif: planKey, days: plan.days, amount: price, status: 'active', createdAt: Date.now(), paidAt: '', until: '' });
  return { bill: String(bill.id), url: String(url), amount: price };
}
function addDays_(ds, n) { const d = new Date(ds + 'T12:00:00'); d.setDate(d.getDate() + n); return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd'); }
function grant_(accId, days) {
  const a = all_('Accounts').filter(function (x) { return x.id === accId; })[0];
  if (!a) return '';
  const v = String(a.premium || '').trim().toLowerCase();
  const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v) && premium_(a).on) return 'ha';   // already unlimited
  const from = /^\d{4}-\d{2}-\d{2}$/.test(v) && v >= today ? v : today;
  a.premium = addDays_(from, days);
  put_('Accounts', a, a._row);
  return a.premium;
}
function grantBiz_(accId, days) {
  const a = all_('Accounts').filter(function (x) { return x.id === accId; })[0];
  if (!a) return '';
  const v = String(a.biz || '').trim().toLowerCase();
  if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v) && bizUntil_(a)) return 'ha';
  const from = /^\d{4}-\d{2}-\d{2}$/.test(v) && v >= today_() ? v : today_();
  a.biz = addDays_(from, days);
  put_('Accounts', a, a._row);
  return a.biz;
}
/* asks TezCheck whether the bill is paid; if so, gives Premium once */
function payVerify_(billId) {
  const row = all_('Payments').filter(function (x) { return x.bill === billId; })[0];
  if (!row) return { paid: false };
  if (row.status === 'paid') return { paid: true, until: row.until };
  const j = tc_('/bills/' + encodeURIComponent(billId), {});
  const b = (j.data && j.data.bill) || {};
  if (!b.paid) { if (row.status !== b.state && b.state) { row.status = String(b.state); put_('Payments', row, row._row); } return { paid: false, state: b.state }; }
  row.status = 'paid'; row.paidAt = Date.now(); row.until = PLANS[row.tarif] && PLANS[row.tarif].biz ? grantBiz_(row.acc, Number(row.days) || 30) : grant_(row.acc, Number(row.days) || 30);
  put_('Payments', row, row._row);
  try {
    const u = row.until === 'ha' ? 'muddatsiz' : fdate_(row.until) + ' gacha';
    notify_(row.acc, '🎉 To\'lov qabul qilindi! <b>' + (row.tarif === 'biz' ? 'Biznes' : 'Premium') + ' yoqildi</b> — ' + u + '.\nIlovani oching, hamma funksiyalar ochiq. Rahmat! 💚');
    notifyAdmin_('💰 <b>Yangi to\'lov</b>: ' + sum_(Number(row.amount) || 0) + '\n+' + row.phone + ' · ' + (row.tarif === 'year' ? '1 yil' : row.tarif === 'biz' ? 'Biznes 1 oy' : '1 oy') + ' · ' + u);
  } catch (e) {}
  return { paid: true, until: row.until };
}

/* ---------- farzandlar (bola akkauntlari) ---------- */
const KID_MAX = 6, KID_TX_MAX = 300, KID_GOALS_MAX = 10;
function kidData_(k) { const d = k.data && typeof k.data === 'object' && !Array.isArray(k.data) ? k.data : {}; return { tx: Array.isArray(d.tx) ? d.tx : [], goals: Array.isArray(d.goals) ? d.goals : [] }; }
function kidBal_(d) { return d.tx.reduce(function (z, t) { return z + (t.t === 'out' ? -1 : 1) * (Number(t.a) || 0); }, 0); }
function kidPub_(k) { const d = kidData_(k); return { id: k.id, name: k.name, photo: k.photo, data: d, balance: kidBal_(d), createdAt: k.createdAt, updatedAt: k.updatedAt }; }
function kidAuth_(r) {
  const t = String(r.token || '');
  const s = t && all_('Sessions').filter(function (x) { return x.token === t; })[0];
  if (!s || String(s.acc).indexOf('kid:') !== 0) throw new Error('AUTH');
  const k = all_('Kids').filter(function (x) { return 'kid:' + x.id === s.acc; })[0];
  if (!k) throw new Error('AUTH');
  return k;
}
function kidOfParent_(a, id) {
  const k = all_('Kids').filter(function (x) { return x.id === String(id || '') && x.acc === a.id; })[0];
  if (!k) throw new Error('Farzand topilmadi');
  return k;
}
function kidPinOk_(pin) { return /^\d{4}$/.test(String(pin || '')); }
function kidPushTx_(k, t, a, note, by) {
  const amt = Math.round((Number(a) || 0) * 100) / 100;
  if (!(amt > 0) || amt > 100000000) throw new Error('Summani to\'g\'ri kiriting');
  const d = kidData_(k);
  if (t === 'out' && amt > kidBal_(d) + 0.001) throw new Error("Xazinada buncha pul yo'q");
  d.tx.push({ id: uid_(), t: t === 'out' ? 'out' : 'in', a: amt, n: str_(note, 60).trim(), by: by, at: Date.now() });
  if (d.tx.length > KID_TX_MAX) {   // eski yozuvlarni bitta qoldiq yozuviga yig'amiz
    const old = d.tx.splice(0, d.tx.length - KID_TX_MAX + 1);
    const b = kidBal_({ tx: old });
    if (b !== 0) d.tx.unshift({ id: uid_(), t: b > 0 ? 'in' : 'out', a: Math.abs(b), n: 'Oldingi qoldiq', by: 'sys', at: old[old.length - 1].at });
  }
  k.data = d; k.updatedAt = Date.now();
  put_('Kids', k, k._row);
}

/* ---------- API ---------- */
const API = {
  register: function (r) {
    const name = str_(r.name, 80).trim(), phone = normPhone_(r.phone), pass = String(r.pass || '');
    if (name.length < 2) throw new Error('Ismingizni yozing');
    if (phone.length < 9 || phone.length > 15) throw new Error("Telefon raqam noto'g'ri");
    if (pass.length < 6) throw new Error("Parol kamida 6 belgidan iborat bo'lsin");
    if (all_('Accounts').some(function (a) { return a.phone === phone; })) throw new Error("Bu raqam allaqachon ro'yxatdan o'tgan. «Kirish»ni tanlang.");
    const salt = uid_();
    const a = { id: uid_(), name: name, phone: phone, salt: salt, hash: pwHashV2_(salt, pass), photo: '', currency: "so'm", pinSalt: '', pinHash: '', createdAt: Date.now(), trialEnd: '' };
    put_('Accounts', a);
    try { notifyAdmin_('🆕 Yangi foydalanuvchi: <b>' + h_(name) + '</b> (+' + phone + ')'); } catch (e) {}
    const d = data_(a.id);
    return { acc: pub_(a), token: newSession_(a.id), people: d.people, tx: d.tx, lists: d.lists, docs: d.docs, kids: d.kids, confirms: d.confirms, rate: d.rate, api: d.api, version: d.version, prices: d.prices, marks: d.marks, feat: d.feat };
  },
  login: function (r) {
    const phone = normPhone_(r.phone);
    const a = all_('Accounts').filter(function (x) { return x.phone === phone; })[0];
    if (!a) throw new Error("Bu raqam ro'yxatdan o'tmagan");
    loginGuard_(phone);
    if (!checkPw_(a, String(r.pass || ''))) { loginFail_(phone); throw new Error("Parol noto'g'ri"); }
    CacheService.getScriptCache().remove('lf_' + phone);
    const d = data_(a.id);
    return { acc: pub_(a), token: newSession_(a.id), people: d.people, tx: d.tx, lists: d.lists, docs: d.docs, kids: d.kids, confirms: d.confirms, rate: d.rate, api: d.api, version: d.version, prices: d.prices, marks: d.marks, feat: d.feat };
  },
  logout: function (r) {
    const rows = all_('Sessions').filter(function (x) { return x.token === String(r.token || ''); }).map(function (x) { return x._row; });
    delRows_('Sessions', rows);
    return {};
  },
  sync: function (r) {
    const a = auth_(r), d = data_(a.id);
    return { acc: pub_(a), people: d.people, tx: d.tx, lists: d.lists, docs: d.docs, kids: d.kids, confirms: d.confirms, rate: d.rate, api: d.api, version: d.version, prices: d.prices, marks: d.marks, feat: d.feat };
  },
  saveProfile: function (r) {
    const a = auth_(r);
    const name = str_(r.name, 80).trim(), phone = normPhone_(r.phone);
    if (name.length < 2) throw new Error('Ismni yozing');
    if (phone.length < 9 || phone.length > 15) throw new Error("Telefon raqam noto'g'ri");
    if (all_('Accounts').some(function (x) { return x.phone === phone && x.id !== a.id; })) throw new Error('Bu raqam boshqa akkauntga tegishli');
    a.name = name; a.phone = phone; a.photo = photo_(a.id, r.photo);
    put_('Accounts', a, a._row);
    return { acc: pub_(a) };
  },
  changePass: function (r) {
    const a = auth_(r);
    if (!checkPw_(a, String(r.old || ''))) throw new Error("Hozirgi parol noto'g'ri");
    if (String(r['new'] || '').length < 6) throw new Error("Yangi parol kamida 6 belgi bo'lsin");
    a.salt = uid_(); a.hash = pwHashV2_(a.salt, String(r['new']));
    put_('Accounts', a, a._row);
    return { acc: pub_(a) };
  },
  setPin: function (r) {
    const a = auth_(r);
    a.pinSalt = str_(r.pinSalt, 64); a.pinHash = str_(r.pinHash, 128);
    put_('Accounts', a, a._row);
    return { acc: pub_(a) };
  },
  startTrial: function (r) { const a = auth_(r); startTrial_(a); return { acc: pub_(a) }; },
  /* tasdiqlash belgisi: akkauntda saqlanadi — telefon, sayt va Telegram Mini App'da bir xil ko'rinadi */
  setBadge: function (r) {
    const a = auth_(r), b = str_(r.badge, 10);
    if (!premium_(a).on) throw new Error('Belgini tanlash Premium uchun');
    if (PREM_BADGES_.indexOf(b) < 0) throw new Error("Noto'g'ri belgi");
    a.badge = b;
    put_('Accounts', a, a._row);
    return { acc: pub_(a) };
  },
  setCurrency: function (r) {
    const a = auth_(r);
    a.currency = str_(r.currency, 8) || "so'm";
    put_('Accounts', a, a._row);
    return { acc: pub_(a) };
  },
  savePerson: function (r) {
    const a = auth_(r), it = r.item || {};
    const id = str_(it.id, 40) || uid_();
    const name = str_(it.name, 80).trim();
    if (name.length < 1) throw new Error('Ismni yozing');
    const old = all_('People').filter(function (p) { return p.id === id; })[0];
    if (old && old.acc !== a.id) throw new Error('Ruxsat yo\'q');
    const now = Date.now();
    const p = {
      id: id, acc: a.id, name: name, phone: normPhone_(it.phone), note: str_(it.note, 1000),
      photo: photo_(a.id, it.photo), log: (Array.isArray(it.log) ? it.log : []).slice(-30),
      createdAt: Number(it.createdAt) || (old && old.createdAt) || now, updatedAt: now
    };
    put_('People', p, old ? old._row : 0);
    return { item: clean_(p) };
  },
  deletePerson: function (r) {
    const a = auth_(r), id = String(r.id || '');
    const p = all_('People').filter(function (x) { return x.id === id && x.acc === a.id; })[0];
    if (!p) return {};
    delRows_('Tx', all_('Tx').filter(function (t) { return t.pid === id && t.acc === a.id; }).map(function (t) { return t._row; }));
    delRows_('People', [all_('People').filter(function (x) { return x.id === id; })[0]._row]);
    return {};
  },
  saveTx: function (r) {
    const a = auth_(r), it = r.item || {};
    const id = str_(it.id, 40) || uid_();
    if (!TX_TYPES[it.type]) throw new Error("Noto'g'ri tur");
    const amount = Number(it.amount);
    if (!(amount > 0)) throw new Error('Summani kiriting');
    if (!all_('People').some(function (p) { return p.id === it.pid && p.acc === a.id; })) throw new Error('Odam topilmadi');
    const old = all_('Tx').filter(function (t) { return t.id === id; })[0];
    if (old && old.acc !== a.id) throw new Error("Ruxsat yo'q");
    const now = Date.now();
    const t = {
      id: id, acc: a.id, pid: it.pid, type: it.type, amount: amount,
      date: str_(it.date, 10), due: str_(it.due, 10), note: str_(it.note, 1000),
      photo: photo_(a.id, it.photo), edits: (Array.isArray(it.edits) ? it.edits : []).slice(-20),
      createdAt: Number(it.createdAt) || (old && old.createdAt) || now, updatedAt: now,
      cur: it.cur === 'USD' ? 'USD' : '', plan: plan_(it.plan)
    };
    put_('Tx', t, old ? old._row : 0);
    return { item: clean_(t) };
  },
  deleteTx: function (r) {
    const a = auth_(r), id = String(r.id || '');
    delRows_('Tx', all_('Tx').filter(function (t) { return t.id === id && t.acc === a.id; }).map(function (t) { return t._row; }));
    return {};
  },
  /* Bozorlik ro'yxati (Premium): butun ro'yxat bitta qatorda, mahsulotlar JSON ko'rinishida */
  saveList: function (r) {
    const a = auth_(r), it = r.item || {};
    if (!featOk_(a, 'shop')) throw new Error("Bozorlik ro'yxati — Premium funksiya");
    const id = str_(it.id, 40) || uid_();
    const old = all_('Lists').filter(function (x) { return x.id === id; })[0];
    if (old && old.acc !== a.id) throw new Error("Ruxsat yo'q");
    if (!old && all_('Lists').filter(function (x) { return x.acc === a.id; }).length >= 30) throw new Error("Ko'pi bilan 30 ta ro'yxat bo'ladi");
    const items = (Array.isArray(it.items) ? it.items : []).slice(0, 150).map(function (x) {
      x = x || {};
      return { id: str_(x.id, 40) || uid_(), n: str_(x.n, 80).trim(), q: str_(x.q, 24).trim(), p: Math.max(0, Math.round((Number(x.p) || 0) * 100) / 100), d: x.d ? 1 : 0 };
    }).filter(function (x) { return x.n; });
    if (JSON.stringify(items).length > 45000) throw new Error("Ro'yxat juda katta");
    const now = Date.now();
    const l = { id: id, acc: a.id, name: str_(it.name, 60).trim() || 'Bozorlik', items: items,
      createdAt: Number(it.createdAt) || (old && old.createdAt) || now, updatedAt: Number(it.updatedAt) || now };
    put_('Lists', l, old ? old._row : 0);
    return { item: clean_(l) };
  },
  deleteList: function (r) {
    const a = auth_(r), id = String(r.id || '');
    delRows_('Lists', all_('Lists').filter(function (x) { return x.id === id && x.acc === a.id; }).map(function (x) { return x._row; }));
    return {};
  },
  /* Docs: to'yona, kreditlar, gap, pul yig'ish, biznes sozlamalari — bitta qatorda JSON */
  saveDoc: function (r) {
    const a = auth_(r), it = r.item || {}, kind = String(it.kind || '');
    if (!DOC_KINDS.hasOwnProperty(kind)) throw new Error("Noto'g'ri tur");
    const p = premium_(a);
    if (kind === 'biz') { if (!p.biz) throw new Error('Bu Biznes tarif funksiyasi'); }
    else if (!featOk_(a, DOC_FEAT_[kind])) throw new Error('Bu Premium funksiya');
    const id = str_(it.id, 40) || uid_();
    const rows = all_('Docs');
    const old = rows.filter(function (x) { return x.id === id; })[0];
    if (old && old.acc !== a.id) throw new Error("Ruxsat yo'q");
    if (!old && rows.filter(function (x) { return x.acc === a.id && x.kind === kind; }).length >= 50) throw new Error("Ko'pi bilan 50 ta bo'ladi");
    const data = it.data && typeof it.data === 'object' ? it.data : {};
    if (JSON.stringify(data).length > 45000) throw new Error('Ma\'lumot juda katta');
    const now = Date.now();
    const d = { id: id, acc: a.id, kind: kind, name: str_(it.name, 80).trim(), data: data,
      createdAt: Number(it.createdAt) || (old && old.createdAt) || now, updatedAt: Number(it.updatedAt) || now };
    put_('Docs', d, old ? old._row : 0);
    return { item: clean_(d) };
  },
  deleteDoc: function (r) {
    const a = auth_(r), id = String(r.id || '');
    delRows_('Docs', all_('Docs').filter(function (x) { return x.id === id && x.acc === a.id; }).map(function (x) { return x._row; }));
    return {};
  },
  /* ota-ona: farzand qo'shish yoki o'zgartirish (ism, 4 xonali PIN) */
  kidSave: function (r) {
    const a = auth_(r), id = String(r.id || ''), name = str_(r.name, 40).trim(), pin = String(r.pin || '');
    if (name.length < 1) throw new Error('Farzandingiz ismini yozing');
    const mine = all_('Kids').filter(function (x) { return x.acc === a.id; });
    let k = id ? mine.filter(function (x) { return x.id === id; })[0] : null;
    if (id && !k) throw new Error('Farzand topilmadi');
    if (!k) {
      if (!featOk_(a, 'kids')) throw new Error('Bu Premium funksiya');
      if (mine.length >= KID_MAX) throw new Error("Ko'pi bilan " + KID_MAX + " ta farzand qo'shish mumkin");
      if (!kidPinOk_(pin)) throw new Error('PIN kod 4 ta raqamdan iborat bo\'lsin');
    }
    if (pin) {
      if (!kidPinOk_(pin)) throw new Error('PIN kod 4 ta raqamdan iborat bo\'lsin');
      if (mine.some(function (x) { return (!k || x.id !== k.id) && pwHashV2_(x.pinSalt, pin) === x.pinHash; })) throw new Error('Bu PIN boshqa farzandingizda bor. Boshqasini tanlang');
    }
    const now = Date.now();
    if (!k) k = { id: uid_(), acc: a.id, name: name, photo: '', pinSalt: '', pinHash: '', data: { tx: [], goals: [] }, createdAt: now, updatedAt: now };
    k.name = name;
    if (pin) { k.pinSalt = uid_(); k.pinHash = pwHashV2_(k.pinSalt, pin); }
    if (r.photo !== undefined) k.photo = photo_(a.id, r.photo);
    k.updatedAt = now;
    put_('Kids', k, k._row || 0);
    if (pin && k._row) delRows_('Sessions', all_('Sessions').filter(function (x) { return x.acc === 'kid:' + k.id; }).map(function (x) { return x._row; }));
    return { kid: kidPub_(k) };
  },
  kidDelete: function (r) {
    const a = auth_(r), k = kidOfParent_(a, r.id);
    delRows_('Sessions', all_('Sessions').filter(function (x) { return x.acc === 'kid:' + k.id; }).map(function (x) { return x._row; }));
    delRows_('Kids', [k._row]);
    return {};
  },
  /* ota-ona farzandiga pul berdi yoki oldi */
  kidTx: function (r) {
    const a = auth_(r), k = kidOfParent_(a, r.id);
    kidPushTx_(k, r.t, r.a, r.n, 'parent');
    return { kid: kidPub_(k) };
  },
  /* bola: ota-onasining telefon raqami va o'z PIN kodi bilan kiradi */
  kidLogin: function (r) {
    const phone = normPhone_(r.phone), pin = String(r.pin || '');
    if (!kidPinOk_(pin)) throw new Error('PIN kod 4 ta raqamdan iborat');
    const a = all_('Accounts').filter(function (x) { return x.phone === phone; })[0];
    if (!a) throw new Error("Bu raqam ro'yxatdan o'tmagan");
    const g = 'kf_' + phone, c = CacheService.getScriptCache();
    if (Number(c.get(g) || 0) >= LOGIN_MAX_FAILS) throw new Error("Juda ko'p xato urinish. 15 daqiqadan keyin qayta urinib ko'ring.");
    const k = all_('Kids').filter(function (x) { return x.acc === a.id && pwHashV2_(x.pinSalt, pin) === x.pinHash; })[0];
    if (!k) { c.put(g, String(Number(c.get(g) || 0) + 1), LOGIN_BLOCK_SEC); throw new Error("PIN kod noto'g'ri"); }
    c.remove(g);
    return { kid: kidPub_(k), token: newSession_('kid:' + k.id) };
  },
  kidSync: function (r) { return { kid: kidPub_(kidAuth_(r)) }; },
  kidAddTx: function (r) { const k = kidAuth_(r); kidPushTx_(k, r.t, r.a, r.n, 'kid'); return { kid: kidPub_(k) }; },
  kidGoals: function (r) {
    const k = kidAuth_(r), d = kidData_(k);
    d.goals = (Array.isArray(r.goals) ? r.goals : []).slice(0, KID_GOALS_MAX).map(function (x) {
      x = x || {}; return { id: str_(x.id, 40) || uid_(), n: str_(x.n, 40).trim(), target: Math.max(0, Math.round(Number(x.target) || 0)) };
    }).filter(function (x) { return x.n && x.target > 0; });
    k.data = d; k.updatedAt = Date.now(); put_('Kids', k, k._row);
    return { kid: kidPub_(k) };
  },
  kidProfile: function (r) {
    const k = kidAuth_(r);
    if (r.name !== undefined) { const n = str_(r.name, 40).trim(); if (!n) throw new Error('Ismingizni yozing'); k.name = n; }
    if (r.photo !== undefined) k.photo = photo_(k.acc, r.photo);
    k.updatedAt = Date.now(); put_('Kids', k, k._row);
    return { kid: kidPub_(k) };
  },
  kidPhoto: function (r) {
    const k = kidAuth_(r), id = String(r.id || '');
    if (k.photo !== 'd:' + id) throw new Error("Ruxsat yo'q");
    const b = DriveApp.getFileById(id).getBlob();
    return { data: 'data:' + b.getContentType() + ';base64,' + Utilities.base64Encode(b.getBytes()) };
  },
  kidLogout: function (r) {
    delRows_('Sessions', all_('Sessions').filter(function (x) { return x.token === String(r.token || '') && String(x.acc).indexOf('kid:') === 0; }).map(function (x) { return x._row; }));
    return {};
  },
  /* two-sided confirmation: the other person opens a link and confirms the record */
  shareTx: function (r) {
    const a = auth_(r), id = String(r.id || '');
    if (!featOk_(a, 'confirm')) throw new Error("Ikki tomonlama tasdiq — Premium funksiya");
    if (!all_('Tx').some(function (t) { return t.id === id && t.acc === a.id; })) throw new Error("Yozuv hali saqlanmagan. Birozdan keyin urinib ko'ring.");
    const ex = all_('Confirms').filter(function (c) { return c.txId === id && c.acc === a.id; })[0];
    if (ex) return { token: ex.token, status: ex.status };
    const token = uid_() + uid_();
    put_('Confirms', { token: token, acc: a.id, txId: id, status: 'pending', answeredAt: '', createdAt: Date.now() });
    return { token: token, status: 'pending' };
  },
  getConfirm: function (r) {
    const c = all_('Confirms').filter(function (x) { return x.token === String(r.c || ''); })[0];
    if (!c) throw new Error("Havola eskirgan yoki noto'g'ri");
    const t = all_('Tx').filter(function (x) { return x.id === c.txId && x.acc === c.acc; })[0];
    if (!t) throw new Error("Bu yozuv o'chirilgan");
    const a = all_('Accounts').filter(function (x) { return x.id === c.acc; })[0] || {};
    const p = all_('People').filter(function (x) { return x.id === t.pid; })[0] || {};
    return { from: a.name || '', fromPhone: a.phone || '', person: p.name || '', currency: a.currency || "so'm",
      type: t.type, amount: t.amount, cur: t.cur, date: t.date, due: t.due, note: t.note, plan: t.plan, status: c.status };
  },
  answerConfirm: function (r) {
    const c = all_('Confirms').filter(function (x) { return x.token === String(r.c || ''); })[0];
    if (!c) throw new Error("Havola eskirgan yoki noto'g'ri");
    c.status = r.answer === 'yes' ? 'confirmed' : 'rejected'; c.answeredAt = Date.now();
    put_('Confirms', c, c._row);
    try {
      const t = all_('Tx').filter(function (x) { return x.id === c.txId && x.acc === c.acc; })[0] || {};
      const p = all_('People').filter(function (x) { return x.id === t.pid && x.acc === c.acc; })[0] || {};
      notify_(c.acc, (c.status === 'confirmed' ? '✅ <b>' + h_(p.name || 'Mijoz') + '</b> yozuvni tasdiqladi' : '❌ <b>' + h_(p.name || 'Mijoz') + '</b> yozuvni rad etdi') + ': ' + (t.cur === 'USD' ? '$' + t.amount : sum_(Number(t.amount) || 0)) + ' (' + fdate_(t.date) + ')');
    } catch (e) {}
    return { status: c.status };
  },
  mirrorConfirm: function (r) {
    const me = auth_(r);
    const c = all_('Confirms').filter(function (x) { return x.token === String(r.c || ''); })[0];
    if (!c) throw new Error("Havola eskirgan yoki noto'g'ri");
    if (c.acc === me.id) throw new Error("Bu o'zingizning yozuvingiz");
    const t = all_('Tx').filter(function (x) { return x.id === c.txId && x.acc === c.acc; })[0];
    const owner = all_('Accounts').filter(function (x) { return x.id === c.acc; })[0];
    if (!t || !owner) throw new Error("Bu yozuv o'chirilgan");
    const mirrorId = 'cf_' + c.txId;
    if (all_('Tx').some(function (x) { return x.id === mirrorId && x.acc === me.id; })) return { already: true };
    const now = Date.now();
    let p = all_('People').filter(function (x) { return x.acc === me.id && x.phone === owner.phone; })[0];
    if (!p) { p = { id: uid_(), acc: me.id, name: owner.name, phone: owner.phone, note: '', photo: '', log: [{ at: now, t: "Tasdiqlash havolasidan qo'shildi" }], createdAt: now, updatedAt: now }; put_('People', p); }
    const m = { id: mirrorId, acc: me.id, pid: p.id, type: FLIP[t.type] || 'borrow', amount: t.amount, date: t.date, due: t.due, note: t.note, photo: '',
      edits: [], createdAt: now, updatedAt: now, cur: t.cur, plan: t.plan };
    put_('Tx', m);
    if (c.status === 'pending') { c.status = 'confirmed'; c.answeredAt = now; put_('Confirms', c, c._row); }
    return { person: clean_(p), item: clean_(m) };
  },
  /* voice input: audio (WAV, base64) -> Uzbek text via Gemini. Key: Project Settings -> Script properties -> GEMINI_KEY */
  payCreate: function (r) {
    const b = createBill_(auth_(r), r.plan, str_(r.returnUrl, 250));
    return { bill: b.bill, url: b.url };
  },
  instMark: function (r) {
    const a = auth_(r), key = str_(r.key, 80), st = r.status === 'paid' ? 'paid' : 'missed';
    if (!/^[^:]+:\d+$/.test(key)) throw new Error("Noto'g'ri so'rov");
    instMark_(a, key, st, 'app');
    return { marks: marks_(a.id) };
  },
  payCheck: function (r) {
    const a = auth_(r), id = String(r.bill || '');
    const row = all_('Payments').filter(function (x) { return x.bill === id && x.acc === a.id; })[0];
    if (!row) throw new Error("To'lov topilmadi");
    const v = payVerify_(id);
    const fresh = all_('Accounts').filter(function (x) { return x.id === a.id; })[0];
    return { paid: v.paid, state: v.state || '', acc: pub_(fresh) };
  },
  voice: function (r) {
    auth_(r);
    const props = PropertiesService.getScriptProperties();
    const key = props.getProperty('GEMINI_KEY');
    if (!key) throw new Error('VOICE_OFF');
    const audio = String(r.audio || '');
    if (!audio || audio.length > 8000000) throw new Error('Ovoz yozuvi juda uzun');
    const prompt = "Bu ovozli xabar o'zbek tilida (ba'zan ruscha so'zlar aralashgan). Aytilgan gapni o'zbek lotin yozuvida aynan yozib ber. " +
      "Pul summalarini raqam bilan yoz (masalan: 500 ming, 1 million 200 ming, 300 dollar). Ismlarni bosh harf bilan yoz. Faqat matnni qaytar, boshqa hech narsa qo'shma.";
    const body = JSON.stringify({ contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: String(r.mime || 'audio/wav'), data: audio } }] }],
      generationConfig: { temperature: 0 } });
    const saved = props.getProperty('GEMINI_MODEL');
    const models = (saved ? [saved] : []).concat(['gemini-flash-latest', 'gemini-3.5-flash', 'gemini-2.5-flash']);
    let lastErr = '';
    for (let i = 0; i < models.length; i++) {
      const res = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + models[i] + ':generateContent?key=' + encodeURIComponent(key),
        { method: 'post', contentType: 'application/json', payload: body, muteHttpExceptions: true });
      const code = res.getResponseCode();
      if (code === 200) {
        const j = JSON.parse(res.getContentText());
        const text = (((j.candidates || [])[0] || {}).content || { parts: [] }).parts.map(function (x) { return x.text || ''; }).join(' ').trim();
        if (saved !== models[i]) props.setProperty('GEMINI_MODEL', models[i]);
        return { text: text };
      }
      lastErr = code + ' ' + res.getContentText().slice(0, 160);
      if (code === 400 || code === 401 || code === 403 || code === 429) break;
    }
    throw new Error(lastErr.indexOf('429') === 0 ? "Ovozli yozish limiti tugadi, birozdan keyin urinib ko'ring" : "Ovozni tanib bo'lmadi");
  },
  photo: function (r) {
    const a = auth_(r);
    const f = DriveApp.getFileById(String(r.id || ''));
    if (f.getName().indexOf(a.id + '_') !== 0) throw new Error("Ruxsat yo'q");
    const b = f.getBlob();
    return { data: 'data:' + b.getContentType() + ';base64,' + Utilities.base64Encode(b.getBytes()) };
  }
};

/* =====================================================================
 * TELEGRAM BOT
 * Script Properties:  TG_TOKEN = BotFather bergan token
 *                     ADMIN_PHONE = sizning raqamingiz (998901234567) — admin buyruqlari uchun
 * Keyin Apps Script'da yuqoridan "botSetup" ni tanlab ▶ Run bosing (bir marta).
 * ===================================================================== */
const APP_URL_DEF = 'https://xusniddin-del.github.io/Oldi-berdi-ilovasi/';
function prop_(k) { return PropertiesService.getScriptProperties().getProperty(k) || ''; }
function appUrl_() { return prop_('APP_URL') || APP_URL_DEF; }
function adminPhone_() { return normPhone_(prop_('ADMIN_PHONE') || '998908324436'); }
function h_(s) { return String(s === null || s === undefined ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function sum_(n) { return String(Math.round(Math.abs(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + " so'm"; }
function today_() { return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'); }
function fdate_(s) { const M = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr']; const p = String(s || '').split('-'); return p.length === 3 ? (+p[2]) + '-' + M[+p[1] - 1] + ' ' + p[0] : s; }

function tg_(method, payload) {
  const t = prop_('TG_TOKEN');
  if (!t) return null;
  try {
    const r = UrlFetchApp.fetch('https://api.telegram.org/bot' + t + '/' + method, { method: 'post', contentType: 'application/json', payload: JSON.stringify(payload || {}), muteHttpExceptions: true });
    return JSON.parse(r.getContentText());
  } catch (e) { return null; }
}
function send_(chat, text, extra) { return tg_('sendMessage', Object.assign({ chat_id: chat, text: text, parse_mode: 'HTML', disable_web_page_preview: true }, extra || {})); }
function accByChat_(chat) { return all_('Accounts').filter(function (x) { return x.tg && x.tg === String(chat); })[0]; }
function adminChat_() { const a = all_('Accounts').filter(function (x) { return x.phone === adminPhone_() && x.tg; })[0]; return a ? a.tg : ''; }
/* admin Telegram ID: ADMIN_TG yoki ADMIN_PHONE akkauntiga ulangan Telegram */
function adminTg_() { return String(prop_('ADMIN_TG') || adminChat_() || '').replace(/\D/g, ''); }
function isAdminChat_(chat) { const t = adminTg_(); return !!t && String(chat) === t; }
function notify_(accId, text, extra) { if (!prop_('TG_TOKEN')) return; const a = all_('Accounts').filter(function (x) { return x.id === accId; })[0]; if (a && a.tg) send_(a.tg, text, extra); }
function notifyAdmin_(text) { if (!prop_('TG_TOKEN')) return; const c = adminTg_(); if (c) send_(c, text); }

function kbMain_() { return { keyboard: [[{ text: '💎 Premium' }, { text: '📊 Hisobim' }], [{ text: '📱 Ilovani ochish' }, { text: 'ℹ️ Ilova haqida' }], [{ text: '❓ Yordam' }]], resize_keyboard: true, is_persistent: true }; }
function kbLink_() { return { keyboard: [[{ text: '📲 Raqamni yuborish', request_contact: true }], [{ text: 'ℹ️ Ilova haqida' }, { text: '❓ Yordam' }]], resize_keyboard: true, is_persistent: true }; }
function btnApp_() { return { text: '📱 Ilovani ochish', web_app: { url: appUrl_() } }; }

function botUpdate_(u) {
  const cache = CacheService.getScriptCache(), key = 'tgu' + u.update_id;
  if (cache.get(key)) return;
  cache.put(key, '1', 21600);
  if (u.callback_query) return botCallback_(u.callback_query);
  const m = u.message;
  if (!m || !m.chat || m.chat.type !== 'private') return;
  const chat = String(m.chat.id), a = accByChat_(chat), text = String(m.text || m.caption || '').trim();
  if (m.contact) return botContact_(m, chat);
  const admin = isAdminChat_(chat);
  if (admin && (/^\/admin\b/.test(text) || text === '🛠 Admin panel')) return botAdminPanel_(chat);
  if (admin && m.reply_to_message) {
    const mm = String(m.reply_to_message.text || '').match(/#u(\d+)/);
    if (mm) { send_(mm[1], '💬 <b>Dasturchi javobi:</b>\n' + h_(text)); send_(chat, '✅ Javob yuborildi'); return; }
  }
  if (admin && /^\/xabar\b/.test(text)) {
    const rt = m.reply_to_message;
    if (rt && !/#u\d+/.test(String(rt.text || ''))) return botBroadcast_(chat, rt.message_id, null);   // reply "/xabar" to any post
    if (!m.text) return botBroadcast_(chat, m.message_id, text.replace(/^\/xabar\s*/, ''));        // photo/video with caption "/xabar …"
  }
  if (admin && /^\/(stat|premium|biznes|xabar)\b/.test(text)) return botAdmin_(chat, text);
  const cmd = text.split(/\s+/)[0].replace(/@.*$/, '').toLowerCase();
  if (cmd === '/start') {
    const pl = (text.split(/\s+/)[1] || '').toLowerCase();
    if (pl === 'premium') { if (a) return botPremium_(chat, a); CacheService.getScriptCache().put('tgp' + chat, '1', 3600); }
    return botStart_(chat, a);
  }
  if (text === 'ℹ️ Ilova haqida' || cmd === '/ilova') return botAbout_(chat, a);
  if (text === '📱 Ilovani ochish' || cmd === '/ochish') return send_(chat, '👇 Ilovani shu yerdan oching:', { reply_markup: { inline_keyboard: [[btnApp_()], [{ text: '🌐 Brauzerda ochish', url: appUrl_() }]] } });
  if (text === '❓ Yordam' || cmd === '/yordam') return botHelp_(chat, a);
  if (!a) return send_(chat, 'Avval akkauntingizni ulang: pastdagi <b>📲 Raqamni yuborish</b> tugmasini bosing.', { reply_markup: kbLink_() });
  if (text === '💎 Premium' || cmd === '/tarif' || cmd === '/premium') return botPremium_(chat, a);
  if (text === '📊 Hisobim' || cmd === '/holat' || cmd === '/hisob') return botStatus_(chat, a);
  const ad = adminTg_();
  if (ad && ad !== chat) {
    if (!m.text) tg_('forwardMessage', { chat_id: ad, from_chat_id: chat, message_id: m.message_id });
    send_(ad, '✉️ <b>' + h_(a.name) + '</b> (+' + a.phone + ')\n' + h_(text || '[rasm yoki fayl — yuqorida]') + '\n\n#u' + chat + '\n<i>Javob berish uchun shu xabarga «Reply» qiling</i>');
    send_(chat, '✅ Xabaringiz dasturchiga yuborildi. Javob shu yerga keladi.', { reply_markup: kbMain_() });
  } else send_(chat, 'Quyidagi tugmalardan birini tanlang 👇', { reply_markup: kbMain_() });
}

function botStart_(chat, a) {
  if (isAdminChat_(chat)) botAdminPanel_(chat);
  if (a) return send_(chat, 'Xush kelibsiz, <b>' + h_(a.name) + '</b>! 👋\n\nBu yerda Premium olishingiz, hisobingizni ko\'rishingiz va eslatmalar olishingiz mumkin. Savol bo\'lsa — shunchaki yozing.', { reply_markup: kbMain_() });
  send_(chat, 'Assalomu alaykum! 👋\n<b>Oldi-Berdi</b> — qarz daftaringiz doim cho\'ntagingizda.\n\nBot orqali:\n💎 Premium sotib olasiz\n📊 Hisobingizni ko\'rasiz\n⏰ Muddati o\'tgan qarzlar haqida eslatma olasiz\n💬 Dasturchiga yozasiz\n\nBoshlash uchun ilovada ro\'yxatdan o\'tgan raqamingizni yuboring 👇', { reply_markup: kbLink_() });
}

function botContact_(m, chat) {
  const c = m.contact;
  if (!m.from || String(c.user_id) !== String(m.from.id)) return send_(chat, 'Iltimos, <b>o\'zingizning</b> raqamingizni pastdagi tugma orqali yuboring.', { reply_markup: kbLink_() });
  const ph = normPhone_(c.phone_number);
  const a = all_('Accounts').filter(function (x) { return x.phone === ph; })[0];
  if (!a) return send_(chat, '+' + ph + ' raqami bilan hali ro\'yxatdan o\'tilmagan.\n\nAvval ilovani ochib, shu raqam bilan ro\'yxatdan o\'ting, keyin raqamni qayta yuboring.', { reply_markup: { inline_keyboard: [[btnApp_()]] } });
  all_('Accounts').forEach(function (x) { if (x.tg === chat && x.id !== a.id) { x.tg = ''; put_('Accounts', x, x._row); } });
  a.tg = chat; put_('Accounts', a, a._row);
  send_(chat, '✅ Akkaunt ulandi: <b>' + h_(a.name) + '</b>\n\nEndi:\n💎 <b>Premium</b> — tarif va to\'lov\n📊 <b>Hisobim</b> — kim qancha qarzdor\n⏰ Muddati o\'tgan qarzlar haqida har kuni ertalab xabar (Premium)\n💬 Istalgan savolni shu yerga yozing — dasturchiga boradi', { reply_markup: kbMain_() });
  if (CacheService.getScriptCache().get('tgp' + chat)) { CacheService.getScriptCache().remove('tgp' + chat); botPremium_(chat, a); }
}

function botPremium_(chat, a) {
  const p = premium_(a), pr = prices_();
  let t = '💎 <b>Oldi-Berdi Premium</b>\n\n';
  t += p.trial ? '🎁 Holat: <b>sinov muddati — ' + fdate_(p.until) + ' gacha</b>\nSinov tugagach ilova bepul rejimda ishlayveradi.\n\n' : p.on ? '✅ Holat: <b>faol' + (p.until ? ' — ' + fdate_(p.until) + ' gacha' : ' (muddatsiz)') + '</b>\n\n' : '🆓 Holat: <b>bepul rejim</b>\nAsosiy imkoniyatlar bepul. Premium qo\'shimcha imkoniyatlarni ochadi.\n\n';
  t += 'Premium\'da:\n' + premList_().join('\n') + '\n⏰ Har kuni botda eslatma';
  const rows = [];
  if (p.canTrial) { rows.push([{ text: '🎁 ' + TRIAL_DAYS + ' kun bepul sinab ko\'rish', callback_data: 'trial' }]); t += '\n\nPremium\'ni <b>' + TRIAL_DAYS + ' kun bepul</b> sinab ko\'rishingiz mumkin — majburiy emas.'; }
  if (pr.online && !(p.on && !p.until)) {
    const full = pr.month * 12, save = pr.month > 0 && pr.year > 0 ? full - pr.year : 0, pct = save > 0 ? Math.round(save / full * 100) : 0;
    if (pr.year > 0) rows.push([{ text: '🔥 1 yil — ' + sum_(pr.year) + (pct ? ' (−' + pct + '%)' : ''), callback_data: 'buy:year' }]);
    if (save > 0) t += '\n\n🔥 <b>Yillik tarif foydali:</b> oyiga ' + sum_(Math.round(pr.year / 12)) + ' — <s>' + sum_(full) + '</s> o\'rniga <b>' + sum_(pr.year) + '</b>, ' + sum_(save) + ' tejaysiz.';
    if (pr.month > 0) rows.push([{ text: '1 oy — ' + sum_(pr.month), callback_data: 'buy:month' }]);
    if (pr.biz > 0) { rows.push([{ text: '🏪 Biznes — ' + sum_(pr.biz) + ' / oy', callback_data: 'buy:biz' }]); t += '\n\n🏪 <b>Biznes tarif</b> (do\'konlar uchun): Premium\'dagi hammasi + do\'kon nomi eslatmalarda, qarzdorlar ro\'yxatini yuborish — oyiga ' + sum_(pr.biz) + '.'; }
    t += '\n\n' + (p.on && !p.trial ? 'Uzaytirish' : 'Sotib olish') + ' uchun tarifni tanlang 👇\n<i>Click, Payme, Uzum yoki karta orqali</i>';
  }
  send_(chat, t, rows.length ? { reply_markup: { inline_keyboard: rows } } : {});
}

/* Premium sinovni faqat foydalanuvchi rozi bo'lsa boshlaymiz (bir marta) */
function startTrial_(a) {
  if (!premium_(a).canTrial) return false;
  a.trialEnd = addDays_(today_(), TRIAL_DAYS - 1);
  put_('Accounts', a, a._row);
  if (a.tg) send_(a.tg, '🎁 <b>Premium sinov boshlandi!</b>\n' + TRIAL_DAYS + ' kun (' + fdate_(a.trialEnd) + ' gacha) barcha Premium imkoniyatlar bepul.\nSinov tugagach ilova bepul rejimda ishlashda davom etadi — hech narsa bloklanmaydi.', { reply_markup: kbMain_() });
  return true;
}
function botTrialOver_(chat, a) {
  send_(chat, '🎁 Premium sinov muddati tugadi.\n\nIlova <b>bepul rejimda ishlashda davom etadi</b> — qarzlaringiz va ma\'lumotlaringiz joyida. Premium imkoniyatlar (hisobot, Excel, SMS eslatma, bo\'lib to\'lash…) kerak bo\'lsa, «💎 Premium» tugmasini bosing.', { reply_markup: kbMain_() });
}
function botCallback_(q) {
  const chat = String(q.message && q.message.chat && q.message.chat.id || q.from.id), a = accByChat_(chat), d = String(q.data || '');
  if (!a) { tg_('answerCallbackQuery', { callback_query_id: q.id, text: 'Avval akkauntni ulang (/start)', show_alert: true }); return; }
  if (d.indexOf('ip:') === 0 || d.indexOf('im:') === 0) {
    if (!premium_(a).on) { tg_('answerCallbackQuery', { callback_query_id: q.id, text: 'Bu Premium imkoniyat. «💎 Premium» tugmasini bosing.', show_alert: true }); return; }
    let r;
    try { r = instMark_(a, d.slice(3), d.indexOf('ip:') === 0 ? 'paid' : 'missed', 'bot'); } catch (e) { tg_('answerCallbackQuery', { callback_query_id: q.id, text: e.message, show_alert: true }); return; }
    tg_('answerCallbackQuery', { callback_query_id: q.id, text: r.already ? 'Bu to\'lov allaqachon belgilangan' : (d.indexOf('ip:') === 0 ? '✅ To\'ladi — yozib qo\'yildi' : '❌ To\'lamadi — ertaga yana eslatamiz') });
    return;
  }
  if (d === 'trial') {
    const l = LockService.getScriptLock(); l.waitLock(20000);
    let ok = false;
    try { ok = startTrial_(a); } finally { l.releaseLock(); }
    tg_('answerCallbackQuery', { callback_query_id: q.id, text: ok ? '🎁 Sinov boshlandi!' : 'Sinov allaqachon ishlatilgan' });
    return;
  }
  if (d.indexOf('buy:') === 0) {
    tg_('answerCallbackQuery', { callback_query_id: q.id, text: 'To\'lov havolasi tayyorlanmoqda…' });
    let r;
    try { r = createBill_(a, d.slice(4), ''); } catch (e) { send_(chat, '⚠️ ' + h_(e.message)); return; }
    send_(chat, '💳 <b>' + h_(PLANS[d.slice(4)].title) + '</b>\nSumma: <b>' + sum_(r.amount) + '</b>\n\n1) «To\'lash» tugmasini bosing va to\'lovni qiling\n2) Qaytib, «To\'ladim — tekshirish» ni bosing\n\nPremium to\'lov tushishi bilan o\'zi yoqiladi.', { reply_markup: { inline_keyboard: [[{ text: '💳 To\'lash', url: r.url }], [{ text: '✅ To\'ladim — tekshirish', callback_data: 'chk:' + r.bill }]] } });
    return;
  }
  if (d.indexOf('chk:') === 0) {
    const bill = d.slice(4);
    const row = all_('Payments').filter(function (x) { return x.bill === bill && x.acc === a.id; })[0];
    if (!row) { tg_('answerCallbackQuery', { callback_query_id: q.id, text: 'To\'lov topilmadi', show_alert: true }); return; }
    if (row.status === 'paid') { tg_('answerCallbackQuery', { callback_query_id: q.id, text: '✅ Premium faol — ' + fdate_(row.until) + ' gacha', show_alert: true }); return; }
    let v = { paid: false };
    try { v = payVerify_(bill); } catch (e) {}
    tg_('answerCallbackQuery', { callback_query_id: q.id, text: v.paid ? '🎉 Premium yoqildi!' : 'To\'lov hali tushmadi. Bir necha soniyadan keyin yana bosing.', show_alert: !v.paid });
    return;
  }
  tg_('answerCallbackQuery', { callback_query_id: q.id });
}

function balances_(accId) {
  const rt = rate_(), usd = rt && rt.usd || 0, bal = {}, due = {};
  all_('Tx').forEach(function (t) {
    if (t.acc !== accId) return;
    let v = Number(t.amount) || 0; if (t.cur === 'USD') v = usd ? v * usd : 0;
    const s = (t.type === 'lend' || t.type === 'paid') ? 1 : -1;
    bal[t.pid] = (bal[t.pid] || 0) + s * v;
    if (t.type === 'lend' && t.due && (!due[t.pid] || t.due < due[t.pid])) due[t.pid] = t.due;
  });
  return { bal: bal, due: due };
}

function botStatus_(chat, a) {
  const people = {}; all_('People').forEach(function (p) { if (p.acc === a.id) people[p.id] = p; });
  const b = balances_(a.id), td = today_();
  let owe = 0, oweN = 0, debt = 0, debtN = 0; const od = [], top = [];
  Object.keys(b.bal).forEach(function (pid) {
    const v = b.bal[pid]; if (!people[pid]) return;
    if (v > 0.5) { owe += v; oweN++; top.push({ n: people[pid].name, v: v }); if (b.due[pid] && b.due[pid] < td) od.push({ n: people[pid].name, v: v, d: b.due[pid] }); }
    else if (v < -0.5) { debt += -v; debtN++; }
  });
  top.sort(function (x, y) { return y.v - x.v; });
  const net = owe - debt, p = premium_(a);
  let t = '📊 <b>' + h_(a.name) + ', hisobingiz</b>\n\n';
  t += '👥 Odamlar: <b>' + Object.keys(people).length + '</b>\n';
  t += '🟢 Sizga qarzdor: <b>' + sum_(owe) + '</b> (' + oweN + ' kishi)\n';
  t += '🔴 Siz qarzdorsiz: <b>' + sum_(debt) + '</b> (' + debtN + ' kishi)\n';
  t += '⚖️ Sof balans: <b>' + (net < 0 ? '−' : '') + sum_(net) + '</b>\n';
  if (top.length) t += '\n🏆 <b>Eng katta qarzdorlar:</b>\n' + top.slice(0, 5).map(function (x, i) { return (i + 1) + '. ' + h_(x.n) + ' — ' + sum_(x.v); }).join('\n') + '\n';
  if (od.length) t += '\n⏰ <b>Muddati o\'tgan (' + od.length + '):</b>\n' + od.slice(0, 8).map(function (x) { return '• ' + h_(x.n) + ' — ' + sum_(x.v) + ' (' + fdate_(x.d) + ')'; }).join('\n') + '\n';
  t += '\n💎 Premium: ' + (p.on ? 'faol' + (p.until ? ' — ' + fdate_(p.until) + ' gacha' : '') : 'yo\'q');
  send_(chat, t, { reply_markup: { inline_keyboard: [[btnApp_()]] } });
}

const PREM_LBL_ = { shop: '🛒 Bozorlik ro\'yxati', toy: '💍 To\'yona daftari', loan: '🏦 Kredit va nasiyalar kalendari', gap: '👥 Gap boshqaruvi', yigin: '💰 Pul yig\'ish', kids: '👧 Farzandlar xazinasi', report: '📊 Oylik hisobot va grafiklar', excel: '📥 Excel fayl', remind: '💬 SMS eslatmalar', trust: '⭐ Ishonch reytingi', usd: '💵 Dollar va MB kursi', plan: '🗓 Bo\'lib to\'lash', confirm: '🤝 Ikki tomonlama tasdiq', ru: '🇷🇺 Rus tili' };
function premList_() { const f = feat_(); return Object.keys(PREM_LBL_).filter(function (k) { return f[k] === 'prem'; }).map(function (k) { return PREM_LBL_[k]; }); }
function botAbout_(chat, a) {
  send_(chat, '📒 <b>Oldi-Berdi</b> — qarz daftari ilovasi\n\nKimga qancha qarz berdingiz, kimdan qancha oldingiz — hammasi bir joyda. Ma\'lumotlar internetda saqlanadi: istalgan telefondan raqam va parol bilan kirasiz.\n\n<b>Bepul:</b>\n✅ Qarz berdim / oldim / qaytardi\n✅ Rasm va izoh\n✅ Muddat nazorati\n✅ Kontaktlardan tanlash\n✅ PIN va barmoq izi\n\n<b>Premium:</b> ' + premList_().map(function (x) { return x.replace(/^\S+\s/, ''); }).join(', ') + '.\n\n<b>O\'rnatish:</b>\n🤖 Android — «Android uchun yuklash» tugmasi\n🍏 iPhone — havolani Safari\'da oching → «Ulashish» → «Bosh ekranga qo\'shish»', { reply_markup: { inline_keyboard: [[btnApp_()], [{ text: '🤖 Android uchun yuklash', url: appUrl_() + 'Oldi-Berdi.apk' }], [{ text: '🍏 iPhone / brauzer', url: appUrl_() }]] } });
}

function botHelp_(chat, a) {
  send_(chat, '❓ <b>Yordam</b>\n\n<b>Qarz qanday yoziladi?</b>\nIlovada yashil «+» tugmasi → turini tanlang → odam va summani kiriting.\n\n<b>Premium qanday olinadi?</b>\n«💎 Premium» → tarif → «To\'lash». To\'lovdan keyin o\'zi yoqiladi.\n\n<b>Parol yoki PIN esdan chiqdimi?</b>\nShu yerga yozing — dasturchi yordam beradi.\n\n💬 Istalgan savolni shu chatga yozing, dasturchiga boradi.', { reply_markup: a ? kbMain_() : kbLink_() });
}

function botAdmin_(chat, text) {
  const parts = text.split(/\s+/), cmd = parts[0];
  if (cmd === '/stat') {
    const acc = all_('Accounts'), pay = all_('Payments').filter(function (x) { return x.status === 'paid'; }), mon = today_().slice(0, 7);
    const pm = pay.filter(function (x) { return Utilities.formatDate(new Date(Number(x.paidAt) || 0), Session.getScriptTimeZone(), 'yyyy-MM') === mon; });
    const s = function (l) { return l.reduce(function (z, x) { return z + (Number(x.amount) || 0); }, 0); };
    return send_(chat, '📈 <b>Statistika</b>\n\n👤 Foydalanuvchilar: <b>' + acc.length + '</b>\n🤖 Botga ulanganlar: <b>' + acc.filter(function (x) { return x.tg; }).length + '</b>\n💎 Premium faol: <b>' + acc.filter(function (x) { return premium_(x).on; }).length + '</b>\n\n💰 Shu oy: <b>' + sum_(s(pm)) + '</b> (' + pm.length + ' ta to\'lov)\n💰 Jami: <b>' + sum_(s(pay)) + '</b> (' + pay.length + ' ta)');
  }
  if (cmd === '/premium') {
    const ph = normPhone_(parts[1] || ''), v = String(parts[2] || '').toLowerCase();
    const a = all_('Accounts').filter(function (x) { return x.phone === ph; })[0];
    if (!a || !v) return send_(chat, 'Foydalanish:\n<code>/premium 901234567 30</code> — 30 kun qo\'shish\n<code>/premium 901234567 ha</code> — muddatsiz\n<code>/premium 901234567 0</code> — o\'chirish' + (ph && !a ? '\n\n⚠️ +' + ph + ' topilmadi' : ''));
    let until;
    if (v === 'ha') { a.premium = 'ha'; put_('Accounts', a, a._row); until = 'muddatsiz'; }
    else if (v === '0') { a.premium = ''; put_('Accounts', a, a._row); until = 'o\'chirildi'; }
    else { const n = parseInt(v, 10); if (!(n > 0)) return send_(chat, 'Kun sonini yozing, masalan 30'); until = fdate_(grant_(a.id, n)); }
    if (v !== '0') notify_(a.id, '🎉 Sizga <b>Premium</b> yoqildi — ' + until + (v === 'ha' ? '' : ' gacha') + '!\nIlovani oching, hammasi ochiq.');
    return send_(chat, '✅ ' + h_(a.name) + ' (+' + a.phone + '): Premium — ' + until);
  }
  if (cmd === '/biznes') {
    const ph = normPhone_(parts[1] || ''), v = String(parts[2] || '').toLowerCase();
    const a = all_('Accounts').filter(function (x) { return x.phone === ph; })[0];
    if (!a || !v) return send_(chat, 'Foydalanish:\n<code>/biznes 901234567 30</code> — 30 kun\n<code>/biznes 901234567 ha</code> — muddatsiz\n<code>/biznes 901234567 0</code> — o\'chirish' + (ph && !a ? '\n\n⚠️ +' + ph + ' topilmadi' : ''));
    let until;
    if (v === 'ha') { a.biz = 'ha'; put_('Accounts', a, a._row); until = 'muddatsiz'; }
    else if (v === '0') { a.biz = ''; put_('Accounts', a, a._row); until = 'o\'chirildi'; }
    else { const n = parseInt(v, 10); if (!(n > 0)) return send_(chat, 'Kun sonini yozing, masalan 30'); until = fdate_(grantBiz_(a.id, n)); }
    if (v !== '0') notify_(a.id, '🏪 Sizga <b>Biznes</b> tarif yoqildi — ' + until + (v === 'ha' ? '' : ' gacha') + '!');
    return send_(chat, '✅ ' + h_(a.name) + ' (+' + a.phone + '): Biznes — ' + until);
  }
  if (cmd === '/xabar') {
    const msg = text.replace(/^\/xabar\s*/, '');
    if (!msg) return send_(chat, '📢 <b>Hammaga xabar yuborish</b>\n\n• Matn: <code>/xabar Matn</code>\n• Rasm/video: rasm yoki videoni yuboring, izohiga <code>/xabar</code> va matn yozing\n• Tayyor post: postni shu chatga yuboring yoki forward qiling, keyin unga «Reply» qilib <code>/xabar</code> deb yozing');
    let n = 0;
    all_('Accounts').forEach(function (x) { if (x.tg && x.tg !== chat) { send_(x.tg, '📢 ' + h_(msg)); n++; Utilities.sleep(60); } });
    return send_(chat, '✅ ' + n + ' kishiga yuborildi');
  }
}

/* Admin: copy one message (text, photo, video, file, voice…) to every user linked to the bot */
function botBroadcast_(chat, msgId, caption) {
  let n = 0, bad = 0;
  all_('Accounts').forEach(function (x) {
    if (!x.tg || x.tg === chat) return;
    const p = { chat_id: x.tg, from_chat_id: chat, message_id: msgId };
    if (caption !== null) p.caption = caption;
    const r = tg_('copyMessage', p);
    if (r && r.ok) n++; else bad++;
    Utilities.sleep(50);
  });
  return send_(chat, '📢 Yuborildi: <b>' + n + '</b> kishiga' + (bad ? ' (' + bad + ' tasi botni bloklagan)' : ''));
}

/* Every morning (trigger): Premium expiry warnings and overdue-debt digest */
function kunlik() {
  if (!prop_('TG_TOKEN')) return;
  const td = today_(), in3 = addDays_(td, 3), tm = addDays_(td, 1);
  const peopleBy = {}; all_('People').forEach(function (p) { (peopleBy[p.acc] = peopleBy[p.acc] || {})[p.id] = p; });
  try { migrate_(); migrate2_(); } catch (e) {}
  const yd = addDays_(td, -1);
  all_('Accounts').forEach(function (a) {
    if (!a.tg) return;
    const p = premium_(a);
    if (p.trialUsed && p.trialEnd === yd && !p.until) { botTrialOver_(a.tg, a); return; }
    if (p.on) try { instDaily_(a); } catch (e) { console.error(e); }
    if (p.trial) {
      if (p.until === in3) send_(a.tg, '🎁 Premium sinov <b>3 kundan keyin</b> (' + fdate_(p.until) + ') tugaydi.\nKeyin ilova bepul rejimda ishlayveradi. Premium\'ni saqlab qolish uchun «💎 Premium» tugmasini bosing.', { reply_markup: kbMain_() });
      else if (p.until === td) send_(a.tg, '⏰ Premium sinov <b>bugun</b> tugaydi. Ertadan ilova bepul rejimda ishlaydi.\nPremium\'ni davom ettirish uchun «💎 Premium» ni bosing.', { reply_markup: kbMain_() });
    } else
    if (p.until && (p.until === in3 || p.until === td)) send_(a.tg, '⏰ Premium ' + (p.until === td ? '<b>bugun</b> tugaydi' : '3 kundan keyin (' + fdate_(p.until) + ') tugaydi') + '.\nUzaytirish uchun «💎 Premium» tugmasini bosing.', { reply_markup: kbMain_() });
    else if (p.until && p.until === addDays_(td, -1)) send_(a.tg, 'Premium muddati tugadi. Qayta yoqish uchun «💎 Premium» tugmasini bosing.', { reply_markup: kbMain_() });
    if (!p.on) return;
    const people = peopleBy[a.id] || {}, b = balances_(a.id), od = [], soon = [];
    Object.keys(b.bal).forEach(function (pid) {
      const v = b.bal[pid], d = b.due[pid]; if (v <= 0.5 || !d || !people[pid]) return;
      if (d < td) od.push({ n: people[pid].name, v: v, d: d }); else if (d === td || d === tm) soon.push({ n: people[pid].name, v: v, d: d });
    });
    if (!od.length && !soon.length) return;
    let t = 'Xayrli tong, ' + h_(a.name) + '! ☀️\n';
    if (soon.length) t += '\n📅 <b>Muddati yaqin:</b>\n' + soon.map(function (x) { return '• ' + h_(x.n) + ' — ' + sum_(x.v) + (x.d === td ? ' (bugun)' : ' (ertaga)'); }).join('\n') + '\n';
    if (od.length) t += '\n⏰ <b>Muddati o\'tgan:</b>\n' + od.slice(0, 10).map(function (x) { return '• ' + h_(x.n) + ' — ' + sum_(x.v) + ' (' + fdate_(x.d) + ')'; }).join('\n') + '\n';
    t += '\nIlovadan bir bosishda SMS eslatma yuborishingiz mumkin.';
    send_(a.tg, t, { reply_markup: { inline_keyboard: [[btnApp_()]] } });
    Utilities.sleep(60);
  });
}

/* Run ONCE from the editor after setting TG_TOKEN: connects the bot to this server */
function botSetup() {
  const me = tg_('getMe', {});
  if (!me || !me.ok) throw new Error('TG_TOKEN noto\'g\'ri yoki kiritilmagan');
  PropertiesService.getScriptProperties().setProperty('TG_BOT', me.result.username);
  const url = prop_('WEB_URL') || ScriptApp.getService().getUrl();
  const w = tg_('setWebhook', { url: url, allowed_updates: ['message', 'callback_query'], drop_pending_updates: true });
  tg_('setMyCommands', { commands: [{ command: 'start', description: 'Boshlash' }, { command: 'tarif', description: 'Premium narxlari' }, { command: 'holat', description: 'Mening hisobim' }, { command: 'ilova', description: 'Ilova haqida' }, { command: 'yordam', description: 'Yordam' }] });
  tg_('setChatMenuButton', { menu_button: { type: 'web_app', text: 'Ilova', web_app: { url: appUrl_() } } });
  const adm = adminTg_();
  if (adm) tg_('setMyCommands', { scope: { type: 'chat', chat_id: Number(adm) }, commands: [{ command: 'admin', description: '🛠 Admin panel' }, { command: 'start', description: 'Boshlash' }, { command: 'stat', description: 'Statistika' }, { command: 'tarif', description: 'Premium narxlari' }, { command: 'holat', description: 'Mening hisobim' }] });
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'kunlik') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('kunlik').timeBased().everyDays(1).atHour(9).create();
  const msg = 'Bot: @' + me.result.username + ' | webhook: ' + url + ' → ' + (w && w.ok ? 'OK' : JSON.stringify(w));
  Logger.log(msg);
  return msg;
}

/* =====================================================================
 * GRAFIK ESLATMALARI (oylik / kunlik bo'lib to'lash)
 * Har to'lov kuni botga va ilovaga "To'ladi / To'lamadi" so'rovi keladi.
 * "To'ladi" bosilmaguncha har kuni qayta eslatiladi.
 * ===================================================================== */
function allocLend_(txs, usd) {
  const out = {}, byP = {};
  txs.forEach(function (t) { (byP[t.pid] = byP[t.pid] || []).push(t); });
  Object.keys(byP).forEach(function (pid) {
    const list = byP[pid].slice().sort(function (a, b) { return String(a.date || '').localeCompare(String(b.date || '')) || (Number(a.createdAt) || 0) - (Number(b.createdAt) || 0); });
    const base = function (t) { const v = Number(t.amount) || 0; return t.cur === 'USD' ? (usd ? v * usd : 0) : v; };
    const loans = list.filter(function (t) { return t.type === 'lend'; }).map(function (t) {
      const f = t.cur === 'USD' ? (usd || 0) : 1; let c = 0;
      const plan = Array.isArray(t.plan) ? t.plan : [];
      const inst = plan.filter(function (x) { return x && x.d && Number(x.a) > 0; }).map(function (x) { c += Number(x.a) * f; return { d: x.d, a: Number(x.a), cum: c, paid: false }; });
      return { t: t, left: base(t), paid: 0, inst: inst };
    });
    let li = 0;
    list.filter(function (t) { return t.type === 'got'; }).forEach(function (r) {
      let amt = base(r);
      while (amt > 0.001 && li < loans.length) {
        const L = loans[li], take = Math.min(amt, L.left);
        L.left -= take; L.paid += take; amt -= take;
        L.inst.forEach(function (i) { if (!i.paid && L.paid >= i.cum - 0.5) i.paid = true; });
        if (L.left <= 0.5) { L.left = 0; li++; }
      }
    });
    loans.forEach(function (L) { out[L.t.id] = L; });
  });
  return out;
}
/* For every loan with a schedule: the earliest unpaid installment that is due today or earlier */
function dueInst_(accId) {
  const rt = rate_(), usd = rt && rt.usd || 0, td = today_();
  const al = allocLend_(all_('Tx').filter(function (t) { return t.acc === accId; }), usd);
  const res = [];
  Object.keys(al).forEach(function (id) {
    const L = al[id]; if (!L.inst.length || L.left <= 0.5) return;
    const idx = L.inst.findIndex(function (i) { return !i.paid; });
    if (idx < 0 || L.inst[idx].d > td) return;
    let n = 0, sum = 0; L.inst.forEach(function (i) { if (!i.paid && i.d < td) { n++; sum += i.a; } });
    res.push({ t: L.t, idx: idx, inst: L.inst[idx], total: L.inst.length, late: n, lateSum: sum, key: L.t.id + ':' + idx });
  });
  return { list: res, al: al };
}
function amtOf_(t, a) { return t.cur === 'USD' ? '$' + String(Math.round(a * 100) / 100) : sum_(a); }
function instText_(it, name) {
  let s = '💳 <b>To\'lov kuni</b>\n👤 <b>' + h_(name) + '</b>\n📅 ' + (it.idx + 1) + '/' + it.total + '-to\'lov · ' + fdate_(it.inst.d) + '\n💰 ' + amtOf_(it.t, it.inst.a);
  if (it.late > 0) s += '\n⚠️ Kechikkan: <b>' + it.late + ' ta to\'lov</b> (' + amtOf_(it.t, it.lateSum) + ')';
  return s;
}
function remRow_(key) { return all_('Reminders').filter(function (x) { return x.key === key; })[0]; }
function remEdit_(row, tail, kb) {
  if (!row || !row.chat || !row.msg) return;
  tg_('editMessageText', { chat_id: row.chat, message_id: Number(row.msg), text: String(row.text || '') + '\n\n' + tail, parse_mode: 'HTML', reply_markup: kb || { inline_keyboard: [] } });
}
function smsKb_(pid) { return { inline_keyboard: [[{ text: '📱 Mijozga SMS eslatma yuborish', url: appUrl_() + '?remind=' + encodeURIComponent(pid) }]] }; }
/* marks an installment (from the app or the bot); "paid" from the bot also records the payment */
function instMark_(a, key, status, from) {
  const p = key.split(':'), txId = p[0], idx = Number(p[1]);
  const t = all_('Tx').filter(function (x) { return x.id === txId && x.acc === a.id; })[0];
  if (!t) throw new Error('Yozuv topilmadi');
  let row = remRow_(key), td = today_();
  if (!row) { row = { key: key, acc: a.id, pid: t.pid, txId: txId, idx: idx, due: '', amount: '', status: '', markDay: '', chat: '', msg: '', text: '', updatedAt: '' }; }
  if (row.status === 'paid') return { already: true, row: row };
  const plan = Array.isArray(t.plan) ? t.plan : [], inst = plan[idx] || {};
  if (status === 'paid' && from === 'bot') {
    const rt = rate_(), al = allocLend_(all_('Tx').filter(function (x) { return x.acc === a.id; }), rt && rt.usd || 0)[txId];
    if (al && al.inst[idx] && !al.inst[idx].paid) {
      const now = Date.now();
      put_('Tx', { id: uid_(), acc: a.id, pid: t.pid, type: 'got', amount: Number(inst.a) || 0, date: td, due: '', note: (idx + 1) + "-to'lov (grafik)", photo: '', edits: [], createdAt: now, updatedAt: now, cur: t.cur === 'USD' ? 'USD' : '', plan: [] });
    }
  }
  row.status = status; row.markDay = td; row.due = inst.d || ''; row.amount = Number(inst.a) || 0; row.updatedAt = Date.now();
  put_('Reminders', row, row._row || 0);
  const who = from === 'bot' ? '' : ' (ilovada belgilandi)';
  if (status === 'paid') remEdit_(row, '✅ <b>To\'ladi</b>' + who + ' — ' + amtOf_(t, Number(inst.a) || 0) + ' yozib qo\'yildi.');
  else remEdit_(row, '❌ <b>To\'lamadi</b>' + who + '. Ertaga yana eslatamiz.\n💡 Maslahat: mijozga SMS eslatma yuboring.', smsKb_(t.pid));
  return { row: row };
}
/* daily: send/refresh installment reminders for one linked account */
function instDaily_(a) {
  const td = today_(), d = dueInst_(a.id), keys = {};
  const people = {}; all_('People').forEach(function (p) { if (p.acc === a.id) people[p.id] = p; });
  const rows = all_('Reminders').filter(function (x) { return x.acc === a.id; });
  rows.forEach(function (r) {   // close reminders whose installment got paid some other way
    if (r.status === 'paid') return;
    const L = d.al[r.txId], i = L && L.inst[Number(r.idx)];
    if (i && i.paid) { r.status = 'paid'; r.markDay = td; put_('Reminders', r, r._row); remEdit_(r, '✅ <b>To\'langan</b>'); }
  });
  d.list.forEach(function (it) {
    keys[it.key] = 1;
    let row = rows.filter(function (x) { return x.key === it.key; })[0];
    if (row && row.status === 'paid') return;
    if (row && row.status === 'missed' && row.markDay === td) return;
    if (row && row.msg) remEdit_(row, '⏳ <i>Bu eslatma eskirdi — yangisi pastda.</i>');
    const text = instText_(it, (people[it.t.pid] || {}).name || 'Mijoz') + '\n\nTo\'ladimi?';
    const r = send_(a.tg, text, { reply_markup: { inline_keyboard: [[{ text: '✅ To\'ladi', callback_data: 'ip:' + it.key }, { text: '❌ To\'lamadi', callback_data: 'im:' + it.key }]] } });
    const msg = r && r.ok && r.result ? r.result.message_id : '';
    if (!row) row = { key: it.key, acc: a.id, pid: it.t.pid, txId: it.t.id, idx: it.idx };
    row.due = it.inst.d; row.amount = it.inst.a; row.status = 'open'; row.chat = a.tg; row.msg = msg; row.text = text.replace(/\n\nTo'ladimi\?$/, ''); row.updatedAt = Date.now();
    put_('Reminders', row, row._row || 0);
    Utilities.sleep(50);
  });
}

/* ---------- 15 kunlik Premium sinov (faqat foydalanuvchi rozi bo'lsa) ---------- */
const TRIAL_DAYS = 15;
function migrate_() {
  if (meta_('prem_reset_1') === '1') return;
  const l = LockService.getScriptLock(); l.waitLock(25000);
  try {
    if (meta_('prem_reset_1') === '1') return;
    const te = addDays_(today_(), TRIAL_DAYS - 1), ad = adminPhone_();
    all_('Accounts').forEach(function (a) {
      if (a.phone === ad) { a.premium = 'ha'; } else { a.premium = ''; }
      put_('Accounts', a, a._row);
    });
    setMeta_('prem_reset_1', '1');
  } finally { l.releaseLock(); }
}
/* v27: ilova endi bloklanmaydi. Avtomatik berilgan va tugagan sinovlarni tozalaymiz —
   bu foydalanuvchilar Premium sinovni o'zlari xohlasa qayta boshlay oladi. */
function migrate2_() {
  if (meta_('trial_optin_2') === '1') return;
  const l = LockService.getScriptLock(); l.waitLock(25000);
  try {
    if (meta_('trial_optin_2') === '1') return;
    const td = today_();
    all_('Accounts').forEach(function (a) {
      const te = String(a.trialEnd || ''), v = String(a.premium || '').trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(te) && te < td && !v) { a.trialEnd = ''; put_('Accounts', a, a._row); }
    });
    setMeta_('trial_optin_2', '1');
  } finally { l.releaseLock(); }
}
function setMeta_(k, v) {
  const r = all_('Meta').filter(function (x) { return x.key === k; })[0];
  put_('Meta', { key: k, value: v }, r ? r._row : 0);
}

/* =====================================================================
 * ADMIN PANEL — Telegram Mini App (admin.html)
 * Botda /admin → «Admin panelni ochish». Har bir so'rov Telegram imzosi (initData)
 * bilan tekshiriladi: faqat admin Telegram ID'si o'ta oladi.
 * ===================================================================== */
function adminUrl_() { return appUrl_() + 'admin.html'; }
function botAdminPanel_(chat) {
  return send_(chat, '🛠 <b>Admin panel</b>\nMijozlar, tariflar, imkoniyatlar, narxlar va xabarlar — hammasi shu yerda.', { reply_markup: { inline_keyboard: [[{ text: '🛠 Admin panelni ochish', web_app: { url: adminUrl_() } }]] } });
}
function hex_(b) { return b.map(function (x) { return ('0' + ((x < 0 ? x + 256 : x).toString(16))).slice(-2); }).join(''); }
function admAuth_(r) {
  const tok = prop_('TG_TOKEN'), init = String(r.init || '');
  if (!tok || !init) throw new Error('ADMIN');
  let hash = ''; const kv = [], f = {};
  init.split('&').forEach(function (pair) {
    const i = pair.indexOf('='); if (i < 1) return;
    const k = decodeURIComponent(pair.slice(0, i)), v = decodeURIComponent(pair.slice(i + 1));
    if (k === 'hash') hash = v; else { kv.push([k, v]); f[k] = v; }
  });
  kv.sort(function (x, y) { return x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0; });
  const B = function (x) { return Utilities.newBlob(x).getBytes(); };
  const secret = Utilities.computeHmacSha256Signature(B(tok), B('WebAppData'));
  const sig = hex_(Utilities.computeHmacSha256Signature(B(kv.map(function (x) { return x[0] + '=' + x[1]; }).join('\n')), secret));
  if (!hash || sig !== hash) throw new Error('ADMIN');
  if (!(Date.now() / 1000 - Number(f.auth_date || 0) < 86400)) throw new Error('ADMIN_OLD');
  let u = {}; try { u = JSON.parse(f.user || '{}'); } catch (e) {}
  if (!isAdminChat_(String(u.id || ''))) throw new Error('ADMIN');
  return u;
}
function tariff_(a) { const p = premium_(a); return p.biz ? 'biz' : p.on ? (p.trial ? 'trial' : 'prem') : 'free'; }
function dayOf_(ms) { return Utilities.formatDate(new Date(Number(ms) || 0), Session.getScriptTimeZone(), 'yyyy-MM-dd'); }
function admAcc_(id) { const a = all_('Accounts').filter(function (x) { return x.id === String(id || ''); })[0]; if (!a) throw new Error('Mijoz topilmadi'); return a; }
function admCounts_() {
  const c = { p: {}, t: {}, last: {} };
  const bump = function (acc, ms) { ms = Number(ms) || 0; if (ms > (c.last[acc] || 0)) c.last[acc] = ms; };
  all_('People').forEach(function (x) { c.p[x.acc] = (c.p[x.acc] || 0) + 1; bump(x.acc, x.updatedAt); });
  all_('Tx').forEach(function (x) { c.t[x.acc] = (c.t[x.acc] || 0) + 1; bump(x.acc, x.updatedAt || x.createdAt); });
  all_('Sessions').forEach(function (x) { bump(x.acc, x.createdAt); });
  return c;
}
function admRow_(a, c) {
  const p = premium_(a);
  return { id: a.id, name: a.name, phone: a.phone, createdAt: Number(a.createdAt) || 0, tg: !!a.tg, t: tariff_(a), until: p.until || '', bizUntil: p.bizUntil || '', canTrial: !!p.canTrial,
    people: c.p[a.id] || 0, tx: c.t[a.id] || 0, last: Math.max(c.last[a.id] || 0, Number(a.createdAt) || 0), admin: a.phone === adminPhone_() };
}
/* Premium yoki Biznes: v = kun soni | 'ha' (muddatsiz) | '0' (o'chirish) */
function setPlan_(a, kind, v) {
  v = String(v || '').toLowerCase();
  const f = kind === 'biz' ? 'biz' : 'premium';
  if (v === 'ha') { a[f] = 'ha'; put_('Accounts', a, a._row); return 'muddatsiz'; }
  if (v === '0') { a[f] = ''; put_('Accounts', a, a._row); return "o'chirildi"; }
  const n = parseInt(v, 10);
  if (!(n > 0 && n <= 3650)) throw new Error('Kun sonini yozing (1–3650)');
  return fdate_(kind === 'biz' ? grantBiz_(a.id, n) : grant_(a.id, n)) + ' gacha';
}
Object.assign(API, {
  admMe: function (r) { const u = admAuth_(r); return { me: { id: u.id, name: [u.first_name, u.last_name].filter(String).join(' ') } }; },
  admStats: function (r) {
    admAuth_(r);
    const acc = all_('Accounts'), pay = all_('Payments').filter(function (x) { return x.status === 'paid'; }), td = today_();
    const t = { free: 0, trial: 0, prem: 0, biz: 0 }; acc.forEach(function (a) { t[tariff_(a)]++; });
    const signDays = {}; acc.forEach(function (a) { const d = dayOf_(a.createdAt); signDays[d] = (signDays[d] || 0) + 1; });
    const signups = []; for (let i = 29; i >= 0; i--) { const d = addDays_(td, -i); signups.push({ d: d, n: signDays[d] || 0 }); }
    const since = function (n) { const d = addDays_(td, -n + 1); return acc.filter(function (a) { return dayOf_(a.createdAt) >= d; }).length; };
    const revM = {}; pay.forEach(function (x) { const m = dayOf_(x.paidAt).slice(0, 7); revM[m] = (revM[m] || 0) + (Number(x.amount) || 0); });
    const rev = []; let ym = td.slice(0, 7);
    for (let i = 0; i < 6; i++) { rev.unshift({ m: ym, s: revM[ym] || 0 }); const y = +ym.slice(0, 4), mo = +ym.slice(5, 7) - 1; ym = mo < 1 ? (y - 1) + '-12' : y + '-' + ('0' + mo).slice(-2); }
    const sum = function (l) { return l.reduce(function (z, x) { return z + (Number(x.amount) || 0); }, 0); };
    const mon = pay.filter(function (x) { return dayOf_(x.paidAt).slice(0, 7) === td.slice(0, 7); });
    const newest = acc.slice().sort(function (x, y) { return (Number(y.createdAt) || 0) - (Number(x.createdAt) || 0); }).slice(0, 5), c = admCounts_();
    return { users: acc.length, tg: acc.filter(function (x) { return x.tg; }).length, tariffs: t, today: since(1), week: since(7), month: since(30),
      revMonth: sum(mon), payMonth: mon.length, revTotal: sum(pay), payTotal: pay.length, signups: signups, rev: rev,
      newest: newest.map(function (a) { return admRow_(a, c); }), feat: feat_(), prices: prices_(), bot: prop_('TG_BOT'), today_: td };
  },
  admUsers: function (r) {
    admAuth_(r);
    const c = admCounts_();
    return { users: all_('Accounts').map(function (a) { return admRow_(a, c); }).sort(function (x, y) { return y.createdAt - x.createdAt; }) };
  },
  admUser: function (r) {
    admAuth_(r);
    const a = admAcc_(r.id), c = admCounts_(), p = premium_(a);
    const docs = {}; all_('Docs').forEach(function (d) { if (d.acc === a.id) docs[d.kind] = (docs[d.kind] || 0) + 1; });
    return { user: Object.assign(admRow_(a, c), {
      premiumRaw: String(a.premium || ''), bizRaw: String(a.biz || ''), trialEnd: String(a.trialEnd || ''), trial: !!p.trial, trialUsed: !!p.trialUsed,
      lists: all_('Lists').filter(function (x) { return x.acc === a.id; }).length, kids: all_('Kids').filter(function (x) { return x.acc === a.id; }).length, docs: docs,
      sessions: all_('Sessions').filter(function (x) { return x.acc === a.id; }).length, pin: !!a.pinHash, currency: a.currency || "so'm" }),
      payments: all_('Payments').filter(function (x) { return x.acc === a.id; }).map(clean_).sort(function (x, y) { return (Number(y.createdAt) || 0) - (Number(x.createdAt) || 0); }) };
  },
  admSetPlan: function (r) {
    admAuth_(r);
    const a = admAcc_(r.id), kind = r.kind === 'biz' ? 'biz' : 'prem', v = String(r.v || '');
    const until = setPlan_(a, kind, v);
    if (r.notify && v !== '0') notify_(a.id, kind === 'biz' ? '🏪 Sizga <b>Biznes</b> tarif yoqildi — ' + until + '!' : '🎉 Sizga <b>Premium</b> yoqildi — ' + until + '!\nIlovani oching, hammasi ochiq.');
    return { until: until };
  },
  admTrial: function (r) {
    admAuth_(r);
    const a = admAcc_(r.id);
    if (r.v === 'start') { a.trialEnd = ''; put_('Accounts', a, a._row); startTrial_(a); }
    else if (r.v === 'end') { a.trialEnd = addDays_(today_(), -1); put_('Accounts', a, a._row); }
    else { a.trialEnd = ''; put_('Accounts', a, a._row); }
    return {};
  },
  admPass: function (r) {
    admAuth_(r);
    const a = admAcc_(r.id);
    let pass = ''; while (pass.length < 6) pass += String(Math.floor(Math.random() * 10));
    a.salt = uid_(); a.hash = pwHashV2_(a.salt, pass); a.pinSalt = ''; a.pinHash = '';
    put_('Accounts', a, a._row);
    delRows_('Sessions', all_('Sessions').filter(function (x) { return x.acc === a.id; }).map(function (x) { return x._row; }));
    let sent = false;
    if (r.notify && a.tg) { const m = send_(a.tg, '🔑 <b>Yangi vaqtinchalik parol</b>: <code>' + pass + '</code>\nIlovaga shu parol bilan kiring, keyin Profil → «Parolni o\'zgartirish» orqali o\'zingiznikini qo\'ying.'); sent = !!(m && m.ok); }
    return { pass: pass, sent: sent };
  },
  admLogout: function (r) {
    admAuth_(r);
    const a = admAcc_(r.id), rows = all_('Sessions').filter(function (x) { return x.acc === a.id; }).map(function (x) { return x._row; });
    delRows_('Sessions', rows);
    return { n: rows.length };
  },
  admMsg: function (r) {
    admAuth_(r);
    const a = admAcc_(r.id), text = str_(r.text, 3500).trim();
    if (!text) throw new Error('Xabar matnini yozing');
    if (!a.tg) throw new Error('Bu mijoz botga ulanmagan');
    const m = send_(a.tg, '💬 <b>Oldi-Berdi:</b>\n' + h_(text));
    if (!(m && m.ok)) throw new Error('Yuborilmadi (mijoz botni bloklagan bo\'lishi mumkin)');
    return {};
  },
  admBroadcast: function (r) {
    admAuth_(r);
    const text = str_(r.text, 3500).trim(), to = String(r.to || 'all');
    if (!text) throw new Error('Xabar matnini yozing');
    let n = 0, bad = 0;
    all_('Accounts').forEach(function (a) {
      if (!a.tg || isAdminChat_(a.tg)) return;
      if (to !== 'all' && tariff_(a) !== to && !(to === 'paid' && (tariff_(a) === 'prem' || tariff_(a) === 'biz'))) return;
      const m = send_(a.tg, '📢 ' + h_(text));
      if (m && m.ok) n++; else bad++;
      Utilities.sleep(50);
    });
    return { n: n, bad: bad };
  },
  admFeat: function (r) {
    admAuth_(r);
    const f = String(r.f || ''), mode = String(r.mode || '');
    if (!FEAT_DEF.hasOwnProperty(f) || (FEAT_MODES[f] || ['free', 'prem']).indexOf(mode) < 0) throw new Error("Noto'g'ri sozlama");
    const cur = feat_(), o = {}; Object.keys(cur).forEach(function (k) { o[k] = cur[k]; }); o[f] = mode;
    setMeta_('features', JSON.stringify(o)); FEAT_MEMO_ = null;
    return { feat: feat_() };
  },
  admPrices: function (r) {
    admAuth_(r);
    ['month', 'year', 'biz'].forEach(function (k) {
      if (r[k] === undefined || r[k] === null || r[k] === '') return;
      const n = Math.round(Number(String(r[k]).replace(/\s/g, '')));
      if (!(n >= 0 && n <= 100000000)) throw new Error("Narx noto'g'ri");
      setMeta_(PLANS[k].key, String(n));
    });
    return { prices: prices_() };
  },
  admPayments: function (r) {
    admAuth_(r);
    const names = {}; all_('Accounts').forEach(function (a) { names[a.id] = a.name; });
    return { payments: all_('Payments').map(function (x) { const o = clean_(x); o.name = names[x.acc] || ''; return o; }).sort(function (x, y) { return (Number(y.createdAt) || 0) - (Number(x.createdAt) || 0); }).slice(0, 300) };
  }
});
