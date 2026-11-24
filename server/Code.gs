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
  Accounts: ['id', 'name', 'phone', 'salt', 'hash', 'photo', 'currency', 'pinSalt', 'pinHash', 'createdAt', 'premium', 'tg', 'trialEnd', 'biz', 'badge', 'mode', 'bizTrialEnd', 'lastSeen', 'streak', 'points', 'level', 'notifyOff', 'lastNotify', 'lang', 'push', 'earned', 'ref', 'loyal', 'smsCfg'],
  Sessions: ['token', 'acc', 'createdAt'],
  People:   ['id', 'acc', 'name', 'phone', 'note', 'photo', 'log', 'createdAt', 'updatedAt', 'noAutoSms'],
  Tx:       ['id', 'acc', 'pid', 'type', 'amount', 'date', 'due', 'note', 'photo', 'edits', 'createdAt', 'updatedAt', 'cur', 'plan', 'items', 'pts'],
  Confirms: ['token', 'acc', 'txId', 'status', 'answeredAt', 'createdAt'],
  Meta:     ['key', 'value'],
  Reminders: ['key', 'acc', 'pid', 'txId', 'idx', 'due', 'amount', 'status', 'markDay', 'chat', 'msg', 'text', 'updatedAt'],
  Payments: ['bill', 'acc', 'phone', 'tarif', 'days', 'amount', 'status', 'createdAt', 'paidAt', 'until'],
  Lists:    ['id', 'acc', 'name', 'items', 'createdAt', 'updatedAt'],
  Docs:     ['id', 'acc', 'kind', 'name', 'data', 'createdAt', 'updatedAt'],
  Survey:   ['id', 'sid', 'acc', 'name', 'phone', 'mode', 'src', 'answers', 'createdAt', 'updatedAt'],
  SmsDevices: ['id', 'acc', 'token', 'model', 'sim', 'appVer', 'lastPing', 'status', 'createdAt'],
  SmsQueue: ['id', 'acc', 'pid', 'phone', 'text', 'source', 'status', 'attempts', 'error', 'createdAt', 'pickedAt', 'sentAt', 'deliveredAt', 'updatedAt']
};
const JSON_FIELDS = { log: true, edits: true, plan: true, items: true, data: true, lastNotify: true, loyal: true, answers: true, smsCfg: true };
/* Docs turlari va ular uchun kerakli tarif: '' — bepul, 'prem' — Premium, 'biz' — Biznes */
const DOC_KINDS = { toy: 'prem', toyg: 'prem', loan: 'prem', gap: 'prem', yigin: '', biz: 'biz' };
/* ---------- imkoniyatlar: admin paneldan boshqariladi ----------
 * off — ilovada ko'rinmaydi (ma'lumotlar o'chmaydi), free — hammaga bepul, prem — faqat Premium */
const FEAT_DEF = { shop: 'prem', toy: 'off', loan: 'off', gap: 'off', yigin: 'free', report: 'prem', excel: 'prem', remind: 'prem', trust: 'prem', usd: 'prem', plan: 'prem', confirm: 'prem', ru: 'prem', biz: 'prem' };
const FEAT_MODES = { shop: ['off', 'free', 'prem'], toy: ['off', 'free', 'prem'], loan: ['off', 'free', 'prem'], gap: ['off', 'free', 'prem'], yigin: ['off', 'free', 'prem'], biz: ['off', 'prem'] };
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
const WRITE = { startTrial: 1, instMark: 1, payCreate: 1, payCheck: 1, shareTx: 1, answerConfirm: 1, mirrorConfirm: 1, register: 1, login: 1, logout: 1, saveProfile: 1, setBadge: 1, changePass: 1, setPin: 1, setCurrency: 1, savePerson: 1, deletePerson: 1, saveTx: 1, deleteTx: 1, saveList: 1, deleteList: 1, saveDoc: 1, deleteDoc: 1, setMode: 1, bulkImport: 1, setNotify: 1, redeem: 1, surveyGet: 1, surveySubmit: 1, smsPair: 1, smsPull: 1, smsReport: 1, smsEnqueue: 1, smsCancel: 1, smsUnpair: 1, smsSet: 1, admSmsSet: 1, admSurveySet: 1, admSurveySend: 1, admSetPlan: 1, admTrial: 1, admPass: 1, admLogout: 1, admFeat: 1, admPrices: 1 };

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
  return { id: a.id, name: a.name, phone: a.phone, photo: a.photo, currency: a.currency || "so'm", pinSalt: a.pinSalt, pinHash: a.pinHash, createdAt: a.createdAt, premium: premium_(a), tg: !!a.tg, badge: a.badge || '', mode: mode_(a), bizTrialUsed: !!a.bizTrialEnd, notifyOff: notifyOff_(a), push: String(a.push) === '1' };
}
/* Biznes tarif muddati: '' — yo'q, 'ha' — muddatsiz, aks holda sana */
function bizUntil_(a) {
  if (a.phone && a.phone === adminPhone_()) return 'ha';
  const v = String(a.biz || '').trim().toLowerCase();
  let paid = '';
  if (v && v !== '0' && v !== "yo'q" && v !== 'no') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return 'ha';
    if (v >= today_()) paid = v;
  }
  const t = bizTrial_(a);
  return t && (!paid || t > paid) ? t : paid;
}
/* Biznes yo'lini tanlaganda bir marta beriladigan 30 kunlik sinov */
const BIZ_TRIAL_DAYS = 30;
function bizTrial_(a) { const t = String(a.bizTrialEnd || ''); return mode_(a) === 'biz' && /^\d{4}-\d{2}-\d{2}$/.test(t) && t >= today_() ? t : ''; }
function mode_(a) { const m = String(a.mode || ''); return m === 'std' || m === 'biz' ? m : ''; }
/* Biznes faol bo'lsa, Premium ham faol hisoblanadi */
function premium_(a) {
  const p = premiumBase_(a), b = bizUntil_(a);
  if (!b) return p;
  const unlimited = p.on && p.until === '' && !p.trial;
  p.on = true; p.biz = true; p.bizUntil = b === 'ha' ? '' : b;
  if (b !== 'ha' && b === bizTrial_(a) && !(String(a.biz || '') >= b)) p.bizTrial = true;
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
  try { seen_(a, req); } catch (e) { console.error(e); }
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
    confirms: confirms,
    rate: rate_(),
    api: 17,
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
/* Biznes: nasiyadagi tovarlar [{n, q, p}] — faqat Biznes faol bo'lsa yoziladi, aks holda eskisi saqlanadi */
function items_(v, a, old) {
  if (!premium_(a).biz) return old && Array.isArray(old.items) ? old.items : [];
  return (Array.isArray(v) ? v : []).slice(0, 50).map(function (g) {
    return { n: str_(g && g.n, 60).trim(), q: Math.round((Number(g && g.q) || 0) * 1000) / 1000, p: Math.round(Number(g && g.p) || 0) };
  }).filter(function (g) { return g.n && g.q > 0 && g.p >= 0; });
}
function plan_(v) {
  if (!Array.isArray(v)) return [];
  return v.slice(0, 120).map(function (x) { return { d: str_(x && x.d, 10), a: Number(x && x.a) || 0 }; }).filter(function (x) { return x.d && x.a > 0; });
}
const FLIP = { lend: 'borrow', borrow: 'lend', got: 'paid', paid: 'got' };

/* ---------- online payment (TezCheck) ---------- */
const PLANS = { month: { days: 30, key: 'price_month', def: 59000, title: 'Oldi-Berdi Premium — 1 oy' }, year: { days: 365, key: 'price_year', def: 588000, title: 'Oldi-Berdi Premium — 1 yil' }, biz: { days: 30, key: 'price_biz', def: 49000, title: 'Oldi-Berdi Biznes — 1 oy', biz: true }, bizyear: { days: 365, key: 'price_biz_year', def: 490000, title: 'Oldi-Berdi Biznes — 1 yil', biz: true } };
function prices_() {
  const p = PropertiesService.getScriptProperties();
  const on = !!(p.getProperty('TC_KEY') && p.getProperty('TC_DESK'));
  const o = { online: on, bot: p.getProperty('TG_BOT') || '' };
  Object.keys(PLANS).forEach(function (k) { const v = meta_(PLANS[k].key); o[k] = v === '' ? PLANS[k].def : Number(String(v).replace(/\s/g, '')) || 0; });
  if (feat_().biz === 'off') { o.biz = 0; o.bizyear = 0; }
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
  const price = priceFor_(a, planKey);
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
  let from = /^\d{4}-\d{2}-\d{2}$/.test(v) && v >= today_() ? v : today_();
  const tr = bizTrial_(a); if (tr && tr > from) from = tr;   // sinov tugagan kundan davom etadi
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
  try { onPaid_(row.acc, row.tarif); } catch (e) { console.error(e); }
  try {
    const u = row.until === 'ha' ? 'muddatsiz' : fdate_(row.until) + ' gacha';
    notify_(row.acc, '🎉 To\'lov qabul qilindi! <b>' + (row.tarif === 'biz' ? 'Biznes' : 'Premium') + ' yoqildi</b> — ' + u + '.\nIlovani oching, hamma funksiyalar ochiq. Rahmat! 💚');
    notifyAdmin_('💰 <b>Yangi to\'lov</b>: ' + sum_(Number(row.amount) || 0) + '\n+' + row.phone + ' · ' + (row.tarif === 'year' ? '1 yil' : row.tarif === 'biz' ? 'Biznes 1 oy' : '1 oy') + ' · ' + u);
  } catch (e) {}
  return { paid: true, until: row.until };
}

/* ---------- farzandlar (bola akkauntlari) ---------- */
const API = {
  register: function (r) {
    const name = str_(r.name, 80).trim(), phone = normPhone_(r.phone), pass = String(r.pass || '');
    if (name.length < 2) throw new Error('Ismingizni yozing');
    if (phone.length < 9 || phone.length > 15) throw new Error("Telefon raqam noto'g'ri");
    if (pass.length < 6) throw new Error("Parol kamida 6 belgidan iborat bo'lsin");
    if (all_('Accounts').some(function (a) { return a.phone === phone; })) throw new Error("Bu raqam allaqachon ro'yxatdan o'tgan. «Kirish»ni tanlang.");
    const salt = uid_();
    const a = { id: uid_(), name: name, phone: phone, salt: salt, hash: pwHashV2_(salt, pass), photo: '', currency: "so'm", pinSalt: '', pinHash: '', createdAt: Date.now(), trialEnd: '' };
    const ref = str_(r.ref, 40); if (ref && all_('Accounts').some(function (x) { return x.id === ref; })) a.ref = ref;
    put_('Accounts', a);
    try { notifyAdmin_('🆕 Yangi foydalanuvchi: <b>' + h_(name) + '</b> (+' + phone + ')'); } catch (e) {}
    const d = data_(a.id);
    return { acc: pub_(a), token: newSession_(a.id), people: d.people, tx: d.tx, lists: d.lists, docs: d.docs, confirms: d.confirms, rate: d.rate, api: d.api, version: d.version, prices: myPrices_(a), marks: d.marks, feat: d.feat, loyal: loyal_(a), survey: surveyState_(a), sms: smsSum_(a) };
  },
  login: function (r) {
    const phone = normPhone_(r.phone);
    const a = all_('Accounts').filter(function (x) { return x.phone === phone; })[0];
    if (!a) throw new Error("Bu raqam ro'yxatdan o'tmagan");
    loginGuard_(phone);
    if (!checkPw_(a, String(r.pass || ''))) { loginFail_(phone); throw new Error("Parol noto'g'ri"); }
    CacheService.getScriptCache().remove('lf_' + phone);
    const d = data_(a.id);
    return { acc: pub_(a), token: newSession_(a.id), people: d.people, tx: d.tx, lists: d.lists, docs: d.docs, confirms: d.confirms, rate: d.rate, api: d.api, version: d.version, prices: myPrices_(a), marks: d.marks, feat: d.feat, loyal: loyal_(a), survey: surveyState_(a), sms: smsSum_(a) };
  },
  logout: function (r) {
    const rows = all_('Sessions').filter(function (x) { return x.token === String(r.token || ''); }).map(function (x) { return x._row; });
    delRows_('Sessions', rows);
    return {};
  },
  sync: function (r) {
    const a = auth_(r), d = data_(a.id);
    return { acc: pub_(a), people: d.people, tx: d.tx, lists: d.lists, docs: d.docs, confirms: d.confirms, rate: d.rate, api: d.api, version: d.version, prices: myPrices_(a), marks: d.marks, feat: d.feat, loyal: loyal_(a), survey: surveyState_(a), sms: smsSum_(a) };
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
  /* yo'nalish: std — shaxsiy, biz — do'kon. Biznes birinchi marta tanlanganda 30 kun sinov o'zi yoqiladi */
  setMode: function (r) {
    const a = auth_(r), m = String(r.mode || '');
    if (m !== 'std' && m !== 'biz') throw new Error("Yo'nalish noto'g'ri");
    const was = mode_(a);
    a.mode = m;
    let trial = false;
    if (m === 'biz' && !a.bizTrialEnd && !bizUntil_(a)) { a.bizTrialEnd = addDays_(today_(), BIZ_TRIAL_DAYS - 1); trial = true; }
    put_('Accounts', a, a._row);
    if (was !== m) try { notifyAdmin_((m === 'biz' ? '🏪 Biznes' : '👤 Standart') + " yo'nalishi: <b>" + h_(a.name) + '</b> (+' + a.phone + ')' + (trial ? ' · 30 kun sinov' : '')); } catch (e) {}
    return { acc: pub_(a) };
  },
  /* bildirishnoma sozlamalari: off — o'chirilgan kategoriyalar, push — telefon obunasi (1/0) */
  /* ballarni Premium'ga almashtirish: r7 — 7 kun, r30 — 1 oy */
  redeem: function (r) {
    const a = auth_(r), c = loyalCfg_(), k = String(r.r || '');
    if (!isStd_(a)) throw new Error("Ballar faqat Standart yo'lida");
    const cost = k === 'r7' ? c.r7 : k === 'r30' ? c.r30 : 0, days = k === 'r7' ? 7 : 30;
    if (!cost) throw new Error("Mukofot noto'g'ri");
    if ((Number(a.points) || 0) < cost) throw new Error("Ball yetarli emas");
    a.points = (Number(a.points) || 0) - cost;
    const L = lyl_(a); L.h = [{ at: Date.now(), p: -cost, t: days === 7 ? '7 kun Premium' : '1 oy Premium' }].concat(L.h || []).slice(0, 20); a.loyal = L;
    put_('Accounts', a, a._row);
    const until = grant_(a.id, days);
    const b = all_('Accounts').filter(function (x) { return x.id === a.id; })[0];
    try { notifyAdmin_('🎁 Ball almashtirildi: <b>' + h_(a.name) + '</b> — ' + (days === 7 ? '7 kun' : '1 oy') + ' Premium'); } catch (e) {}
    return { acc: pub_(b), loyal: loyal_(b), until: until };
  },
  loyal: function (r) { const a = auth_(r); return { loyal: loyal_(a), acc: pub_(a), prices: myPrices_(a) }; },
  setNotify: function (r) {
    const a = auth_(r);
    if (Array.isArray(r.off)) a.notifyOff = r.off.filter(function (x) { return NOTIFY_CATS_.indexOf(x) >= 0; }).join(',');
    if (r.push !== undefined) a.push = Number(r.push) ? '1' : '';
    put_('Accounts', a, a._row);
    return { acc: pub_(a) };
  },
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
      photo: photo_(a.id, it.photo), log: (Array.isArray(it.log) ? it.log : []).slice(-30), noAutoSms: it.noAutoSms !== undefined ? (it.noAutoSms ? '1' : '') : (old && old.noAutoSms) || '',
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
      cur: it.cur === 'USD' ? 'USD' : '', plan: plan_(it.plan), items: items_(it.items, a, old)
    };
    if (!old) { try { if (onNewTx_(a, t)) put_('Accounts', a, a._row); } catch (e) { console.error(e); } } else t.pts = old.pts || '';
    put_('Tx', t, old ? old._row : 0);
    return { item: clean_(t) };
  },
  /* Biznes: qog'oz daftarni ko'chirish — bir so'rovda ko'p mijoz va nasiya */
  bulkImport: function (r) {
    const a = auth_(r);
    if (!premium_(a).biz) throw new Error('Bu Biznes tarif funksiyasi');
    const rows = (Array.isArray(r.rows) ? r.rows : []).slice(0, 300);
    if (!rows.length) throw new Error("Qator yo'q");
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(r.date || '')) ? String(r.date) : today_();
    const ppl = all_('People').filter(function (p) { return p.acc === a.id; });
    const outP = [], outT = [], now = Date.now();
    rows.forEach(function (x, k) {
      const name = str_(x.name, 80).trim(), phone = normPhone_(x.phone), amount = Math.round(Number(x.amount) || 0);
      if (!name || !(amount > 0)) return;
      let p = ppl.filter(function (q) { return (phone && q.phone === phone) || String(q.name).toLowerCase() === name.toLowerCase(); })[0];
      if (!p) {
        p = { id: uid_(), acc: a.id, name: name, phone: phone.length >= 9 ? phone : '', note: '', photo: '', log: [{ at: now, t: "Daftardan ko'chirildi" }], createdAt: now + k, updatedAt: now + k };
        put_('People', p); ppl.push(p); outP.push(clean_(p));
      }
      const due = /^\d{4}-\d{2}-\d{2}$/.test(String(x.due || '')) ? String(x.due) : '';
      const t = { id: uid_(), acc: a.id, pid: p.id, type: 'lend', amount: amount, date: date, due: due, note: "Daftardan ko'chirildi", photo: '', edits: [], createdAt: now + k, updatedAt: now + k, cur: '', plan: [], items: [] };
      put_('Tx', t); outT.push(clean_(t));
    });
    return { people: outP, tx: outT };
  },
  deleteTx: function (r) {
    const a = auth_(r), id = String(r.id || '');
    const del = all_('Tx').filter(function (t) { return t.id === id && t.acc === a.id; });
    try { if (del[0] && onDelTx_(a, del[0])) put_('Accounts', a, a._row); } catch (e) { console.error(e); }
    delRows_('Tx', del.map(function (t) { return t._row; }));
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
  /* ---------- Avto-SMS ---------- */
  smsPairCode: function (r) {
    const a = auth_(r); smsNeedBiz_(a);
    if (!smsCfg_(a).agreed) throw new Error("Avval shartlarga rozilik bering");
    const cache = CacheService.getScriptCache();
    let code = ''; for (let i = 0; i < 5; i++) { code = String(100000 + Math.floor(Math.random() * 900000)); if (!cache.get('smspair_' + code)) break; }
    cache.put('smspair_' + code, a.id, 600);
    return { code: code, until: Date.now() + 600000 };
  },
  smsPair: function (r) {
    const code = String(r.code || '').replace(/\D/g, '');
    const cache = CacheService.getScriptCache(), accId = code.length === 6 ? cache.get('smspair_' + code) : null;
    if (!accId) throw new Error("Kod noto'g'ri yoki eskirgan. Ilovadan yangi kod oling");
    const a = all_('Accounts').filter(function (x) { return x.id === accId; })[0]; if (!a) throw new Error("Akkaunt topilmadi");
    smsNeedBiz_(a);
    cache.remove('smspair_' + code);
    all_('SmsDevices').forEach(function (d) { if (d.acc === a.id && d.status === 'active') { d.status = 'off'; put_('SmsDevices', d, d._row); } });
    const d = { id: uid_(), acc: a.id, token: uid_() + uid_(), model: str_(r.model, 60), sim: str_(r.sim, 60), appVer: str_(r.appVer, 20), lastPing: Date.now(), status: 'active', createdAt: Date.now() };
    put_('SmsDevices', d);
    try { notifyTg_(a.id, '📱 <b>Oldi-Berdi SMS</b> telefoni ulandi: ' + h_(d.model || 'Android')); } catch (e) {}
    const c = smsCfg_(a);
    return { dt: d.token, name: a.name, shop: bizDoc_(a.id).shop || '', cfg: { from: c.from, to: c.to, gap: c.gap, limit: c.limit } };
  },
  /* yordamchi ilova: navbatdagi ko'pi bilan 5 ta xabar ('sending' bo'ladi) */
  smsPull: function (r) {
    const x = devAuth_(r), d = x.d, a = x.a;
    d.lastPing = Date.now(); if (r.sim) d.sim = str_(r.sim, 60); if (r.appVer) d.appVer = str_(r.appVer, 20); put_('SmsDevices', d, d._row);
    const g = smsGlobal_(), c = smsCfg_(a), biz = !!premium_(a).biz;
    const out = { cfg: { from: c.from, to: c.to, gap: c.gap, limit: c.limit, off: g.off, biz: biz }, items: [] };
    if (g.off || !biz || r.ping) return out;
    smsRequeue_(a.id);
    const sentToday = smsToday_(a.id).filter(function (q) { return q.status === 'sent' || q.status === 'delivered' || q.status === 'sending'; }).length;
    let room = Math.min(5, c.limit - sentToday); if (room <= 0) { out.limit = true; return out; }
    all_('SmsQueue').filter(function (q) { return q.acc === a.id && q.status === 'queued'; }).sort(function (p, q) { return (Number(p.createdAt) || 0) - (Number(q.createdAt) || 0); }).slice(0, room).forEach(function (q) {
      q.status = 'sending'; q.pickedAt = Date.now(); q.attempts = (Number(q.attempts) || 0) + 1; q.updatedAt = Date.now(); put_('SmsQueue', q, q._row);
      out.items.push({ id: q.id, phone: q.phone, text: q.text });
    });
    return out;
  },
  smsReport: function (r) {
    const x = devAuth_(r), a = x.a, st = String(r.status || '');
    if (['sent', 'delivered', 'failed'].indexOf(st) < 0) throw new Error("Holat noto'g'ri");
    const q = all_('SmsQueue').filter(function (y) { return y.id === String(r.id || '') && y.acc === a.id; })[0];
    if (!q) return { ok: false };
    if (q.status === 'delivered' && st !== 'delivered') return { ok: true };
    q.status = st; q.updatedAt = Date.now();
    if (st === 'sent') { q.sentAt = Date.now(); q.error = ''; }
    if (st === 'delivered') { q.deliveredAt = Date.now(); if (!q.sentAt) q.sentAt = q.deliveredAt; }
    if (st === 'failed') q.error = str_(r.error, 200) || 'Xato';
    put_('SmsQueue', q, q._row);
    if (st === 'sent') try { smsLogPerson_(a.id, q.pid, 'Eslatma yuborildi (Avto-SMS' + (q.source === 'auto' ? '' : ' · qo\'lda') + ')'); } catch (e) {}
    return { ok: true };
  },
  smsEnqueue: function (r) {
    const a = auth_(r); smsNeedBiz_(a);
    if (!smsDevice_(a.id)) throw new Error("Avval telefonni ulang: Profil → Avto-SMS");
    const p = all_('People').filter(function (x) { return x.id === String(r.pid || '') && x.acc === a.id; })[0];
    if (!p) throw new Error("Odam topilmadi");
    const text = str_(r.text, 900).trim(); if (!text) throw new Error("Matn bo'sh");
    const q = smsQueuePut_(a, p, text, r.source === 'pc' ? 'pc' : 'manual');
    return { item: smsPub_(q, { [p.id]: p.name }) };
  },
  smsList: function (r) {
    const a = auth_(r);
    const names = {}; all_('People').forEach(function (p) { if (p.acc === a.id) names[p.id] = p.name; });
    const all = all_('SmsQueue').filter(function (q) { return q.acc === a.id; }).sort(function (x, y) { return (Number(y.createdAt) || 0) - (Number(x.createdAt) || 0); });
    const td = smsToday_(a.id), c = smsCfg_(a);
    return { biz: !!premium_(a).biz, off: smsGlobal_().off, device: devPub_(smsDevice_(a.id)), cfg: c,
      today: { all: td.length, sent: td.filter(function (q) { return q.status === 'sent' || q.status === 'delivered'; }).length, failed: td.filter(function (q) { return q.status === 'failed'; }).length, queued: td.filter(function (q) { return q.status === 'queued' || q.status === 'sending'; }).length },
      items: all.slice(0, 100).map(function (q) { return smsPub_(q, names); }) };
  },
  smsCancel: function (r) {
    const a = auth_(r);
    const q = all_('SmsQueue').filter(function (y) { return y.id === String(r.id || '') && y.acc === a.id; })[0];
    if (!q) throw new Error('Topilmadi');
    if (q.status !== 'queued') throw new Error("Bu SMS allaqachon telefonga uzatilgan");
    q.status = 'cancelled'; q.updatedAt = Date.now(); put_('SmsQueue', q, q._row);
    return { ok: true };
  },
  smsUnpair: function (r) {
    let accId;
    if (r.dt) { try { accId = devAuth_(r).a.id; } catch (e) { return { ok: true }; } } else accId = auth_(r).id;
    all_('SmsDevices').forEach(function (d) { if (d.acc === accId && d.status === 'active') { d.status = 'off'; put_('SmsDevices', d, d._row); } });
    all_('SmsQueue').forEach(function (q) { if (q.acc === accId && (q.status === 'queued' || q.status === 'sending')) { q.status = 'cancelled'; q.updatedAt = Date.now(); put_('SmsQueue', q, q._row); } });
    return { ok: true };
  },
  smsSet: function (r) {
    const a = auth_(r), c = smsCfg_(a), n = r.cfg || {};
    const o = { auto: n.auto !== undefined ? !!n.auto : c.auto, agreed: n.agreed !== undefined ? !!n.agreed : c.agreed, limit: n.limit !== undefined ? Math.min(150, Math.max(10, Number(n.limit) || c.limit)) : c.limit,
      from: /^\d{2}:\d{2}$/.test(String(n.from || '')) ? n.from : c.from, to: /^\d{2}:\d{2}$/.test(String(n.to || '')) ? n.to : c.to };
    if (o.auto) smsNeedBiz_(a);
    a.smsCfg = o; put_('Accounts', a, a._row);
    return { cfg: smsCfg_(a) };
  },
  /* so'rovnoma: savollar va holat (ochilganlar soni shu yerda sanaladi) */
  surveyGet: function (r) {
    const s = survey_();
    let me = null;
    if (r.token) try { const a = auth_(r); me = { name: a.name, phone: a.phone, mode: mode_(a), done: surveyState_(a).done }; } catch (e) {}
    if (s.on && !r.noCount) { s.opens = (Number(s.opens) || 0) + 1; surveySave_(s); }
    return { on: !!s.on, id: s.id, q: SURVEY_Q_, me: me };
  },
  surveySubmit: function (r) {
    const s = survey_(); if (!s.on) throw new Error("So'rovnoma yopilgan. Rahmat!");
    let a = null; if (r.token) try { a = auth_(r); } catch (e) {}
    const name = str_(r.name || (a && a.name), 80).trim(), phone = normPhone_(r.phone || (a && a.phone) || '');
    const ans = {}, src = r.answers || {};
    SURVEY_Q_.forEach(function (q) {
      const v = src[q.id];
      if (q.type === 'one') { const i = Number(v); if (v !== '' && v !== null && v !== undefined && i >= 0 && i < q.o.length) ans[q.id] = i; }
      else if (q.type === 'many') { if (Array.isArray(v)) ans[q.id] = v.map(Number).filter(function (i) { return i >= 0 && i < q.o.length; }).slice(0, q.o.length); }
      else if (q.type === 'scale') { const i = Number(v); if (i >= 1 && i <= 5) ans[q.id] = i; }
      else if (q.type === 'nps') { const i = Number(v); if (v !== '' && v !== null && v !== undefined && i >= 0 && i <= 10) ans[q.id] = i; }
      else if (q.type === 'text') { const t = str_(v, 1000).trim(); if (t) ans[q.id] = t; }
    });
    const need = SURVEY_Q_.filter(function (q) { return !q.opt && ans[q.id] === undefined; });
    if (need.length) throw new Error('Iltimos, barcha savollarga javob bering');
    if ((ans.q10 === 0 || ans.q10 === 1) && phone.length < 9) throw new Error('Video uchun telefon raqamingizni yozing');
    const ex = all_('Survey').filter(function (x) { return x.sid === s.id && ((a && x.acc === a.id) || (phone && x.phone === phone)); })[0];
    const now = Date.now();
    const row = ex || { id: uid_(), sid: s.id, createdAt: now };
    row.acc = a ? a.id : (ex && ex.acc) || ''; row.name = name; row.phone = phone; row.mode = a ? mode_(a) : ''; row.src = str_(r.src, 20); row.answers = ans; row.updatedAt = now;
    put_('Survey', row, ex ? ex._row : 0);
    try {
      let t = "📝 <b>So'rovnoma javobi</b>" + (ex ? ' (yangilandi)' : '') + '\n👤 ' + h_(name || 'Ismsiz') + (phone ? ' · +' + phone : '') + (a ? ' · ' + (mode_(a) === 'biz' ? '🏪 Biznes' : '👤 Standart') : ' · ilovaga kirmagan') + '\n';
      SURVEY_Q_.forEach(function (q, i) { if (q.if && !(q.if[1].indexOf(ans[q.if[0]]) >= 0)) return; t += '\n<b>' + (i + 1) + '. ' + h_(q.t[0]) + '</b>\n' + h_(surveyLine_(q, ans[q.id])); });
      if (ans.q10 === 0 || ans.q10 === 1) t += '\n\n🎥 <b>Video uchun rozi!</b> Bog\'lanish: +' + phone;
      notifyAdmin_(t.slice(0, 4000));
    } catch (e) { console.error(e); }
    return { ok: true };
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
function notifyTg_(accId, text, extra) { if (!prop_('TG_TOKEN')) return; const a = all_('Accounts').filter(function (x) { return x.id === accId; })[0]; if (a && a.tg) send_(a.tg, text, extra); }
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
    if (pl === 'biz') { if (a) return botBiz_(chat, a); CacheService.getScriptCache().put('tgp' + chat, 'biz', 3600); }
    return botStart_(chat, a);
  }
  if (text === 'ℹ️ Ilova haqida' || cmd === '/ilova') return botAbout_(chat, a);
  if (text === '📱 Ilovani ochish' || cmd === '/ochish') return send_(chat, '👇 Ilovani shu yerdan oching:', { reply_markup: { inline_keyboard: [[btnApp_()], [{ text: '🌐 Brauzerda ochish', url: appUrl_() }]] } });
  if (text === '❓ Yordam' || cmd === '/yordam') return botHelp_(chat, a);
  if (!a) return send_(chat, 'Avval akkauntingizni ulang: pastdagi <b>📲 Raqamni yuborish</b> tugmasini bosing.', { reply_markup: kbLink_() });
  if (cmd === '/biznes') return botBiz_(chat, a);
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
  const pend = CacheService.getScriptCache().get('tgp' + chat);
  if (pend) { CacheService.getScriptCache().remove('tgp' + chat); if (pend === 'biz') botBiz_(chat, a); else botPremium_(chat, a); }
}

function botPremium_(chat, a) {
  if (mode_(a) === 'biz') return botBiz_(chat, a);
  const p = premium_(a), pr = myPrices_(a);
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
    t += '\n\n' + (p.on && !p.trial ? 'Uzaytirish' : 'Sotib olish') + ' uchun tarifni tanlang 👇\n<i>Click, Payme, Uzum yoki karta orqali</i>';
  }
  send_(chat, t, rows.length ? { reply_markup: { inline_keyboard: rows } } : {});
}

/* Biznes tariflari: ilovadagi «Biznes'ni ulash» tugmasi botni ?start=biz bilan ochadi */
function botBiz_(chat, a) {
  const p = premium_(a), pr = myPrices_(a);
  let t = '🏪 <b>Oldi-Berdi Biznes</b> — do\'kon va savdo uchun\n\n';
  t += p.biz ? (p.bizTrial ? '🎁 Holat: <b>sinov — ' + fdate_(p.bizUntil) + ' gacha</b>\n\n' : '✅ Holat: <b>faol' + (p.bizUntil ? ' — ' + fdate_(p.bizUntil) + ' gacha' : ' (muddatsiz)') + '</b>\n\n') : '⏳ Holat: <b>faol emas</b>\nMa\'lumotlaringiz joyida, yozuv qo\'shish ishlaydi.\n\n';
  t += '🧾 Tovar bilan nasiya\n📣 Ommaviy eslatma — muddati o\'tganlarga ketma-ket SMS\n📋 Qarzdorlar ro\'yxati — Telegram yoki Excel\n🌙 Kechki hisobot — har kuni 20:00 da\n📥 Tez ko\'chirish — qog\'oz daftar yoki Excel\'dan\n🏷 Do\'kon nomi va manzili eslatmalarda\n➕ SMS eslatma, bo\'lib to\'lash, dollar kursi, hisobot va Excel';
  const rows = [];
  if (!(pr.biz > 0 || pr.bizyear > 0)) { send_(chat, t + '\n\nBiznes tarif hozircha sotuvda emas.'); return; }
  const full = pr.biz * 12, save = pr.biz > 0 && pr.bizyear > 0 ? full - pr.bizyear : 0, pct = save > 0 ? Math.round(save / full * 100) : 0;
  if (pr.online && !(p.biz && !p.bizUntil)) {
    if (pr.bizyear > 0) rows.push([{ text: '🔥 1 yil — ' + sum_(pr.bizyear) + (pct ? ' (−' + pct + '%)' : ''), callback_data: 'buy:bizyear' }]);
    if (pr.biz > 0) rows.push([{ text: '1 oy — ' + sum_(pr.biz), callback_data: 'buy:biz' }]);
    if (save > 0) t += '\n\n🔥 <b>Yillik foydali:</b> <s>' + sum_(full) + '</s> o\'rniga <b>' + sum_(pr.bizyear) + '</b> — ' + sum_(save) + ' tejaysiz.';
    t += '\n\n' + (p.biz && !p.bizTrial ? 'Uzaytirish' : 'Ulash') + ' uchun tarifni tanlang 👇\n<i>Click, Payme, Uzum yoki karta orqali</i>';
    if (p.bizTrial) t += '\n<i>Hozir to\'lasangiz, muddat sinov tugagan kundan boshlab qo\'shiladi.</i>';
  } else if (!(p.biz && !p.bizUntil)) {
    t += '\n\n💰 Narx: ' + (pr.biz > 0 ? '1 oy — <b>' + sum_(pr.biz) + '</b>' : '') + (pr.bizyear > 0 ? (pr.biz > 0 ? ', ' : '') + '1 yil — <b>' + sum_(pr.bizyear) + '</b>' : '') + '\nUlash uchun shu yerga yozing — dasturchi yoqib beradi.';
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
  if (d === 'biz') { tg_('answerCallbackQuery', { callback_query_id: q.id }); return botBiz_(chat, a); }
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
    send_(chat, '💳 <b>' + h_(PLANS[d.slice(4)].title) + '</b>\nSumma: <b>' + sum_(r.amount) + '</b>\n\n1) «To\'lash» tugmasini bosing va to\'lovni qiling\n2) Qaytib, «To\'ladim — tekshirish» ni bosing\n\n' + (PLANS[d.slice(4)].biz ? 'Biznes' : 'Premium') + ' to\'lov tushishi bilan o\'zi yoqiladi.', { reply_markup: { inline_keyboard: [[{ text: '💳 To\'lash', url: r.url }], [{ text: '✅ To\'ladim — tekshirish', callback_data: 'chk:' + r.bill }]] } });
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

const SITE_ = 'https://oldiberdi.uz/';
const PREM_LBL_ = { shop: '🛒 Bozorlik ro\'yxati', toy: '💍 To\'yona daftari', loan: '🏦 Kredit va nasiyalar kalendari', gap: '👥 Gap boshqaruvi', yigin: '💰 Pul yig\'ish', report: '📊 Oylik hisobot va grafiklar', excel: '📥 Excel fayl', remind: '💬 Bir bosishda SMS eslatma (SMS ilovasi tayyor matn bilan ochiladi)', trust: '⭐ Ishonch reytingi', usd: '💵 Dollar va MB kursi', plan: '🗓 Bo\'lib to\'lash', confirm: '🤝 Ikki tomonlama tasdiq', ru: '🇷🇺 Rus tili' };
function premList_() { const f = feat_(); return Object.keys(PREM_LBL_).filter(function (k) { return f[k] === 'prem'; }).map(function (k) { return PREM_LBL_[k]; }); }
function botAbout_(chat, a) {
  send_(chat, '📒 <b>Oldi-Berdi</b> — qarz daftari ilovasi\n\nKimga qancha qarz berdingiz, kimdan qancha oldingiz — hammasi bir joyda. Ma\'lumotlar internetda saqlanadi: telefon, kompyuter yoki saytdan — raqam va parol bilan kirasiz, hammasi bir xil ko\'rinadi.\n\n' + '🌐 <b>Sayt:</b> <a href="' + SITE_ + '">oldiberdi.uz</a>\n\n' + '<b>Bepul:</b>\n✅ Qarz berdim / oldim / qaytardi\n✅ Rasm va izoh\n✅ Muddat nazorati\n✅ Kontaktlardan tanlash\n✅ PIN va barmoq izi\n\n' + '<b>Premium:</b> ' + premList_().map(function (x) { return x.replace(/^\S+\s/, ''); }).join(', ') + '.\n\n' + '<b>Qayerda ishlaydi:</b>\n🤖 Android — «Android uchun yuklash» tugmasi\n🍏 iPhone — Safari\'da oldiberdi.uz → «Kirish», keyin «Ulashish» → «Bosh ekranga qo\'shish»\n💻 Kompyuter — Windows (7, 8, 10, 11) va Mac uchun dastur saytda: «Kompyuterga yuklash»\n📱 Telegram — pastdagi «Ilovani ochish» tugmasi', { disable_web_page_preview: true, reply_markup: { inline_keyboard: [[btnApp_()], [{ text: '🌐 Sayt — oldiberdi.uz', url: SITE_ }], [{ text: '🤖 Android uchun yuklash', url: appUrl_() + 'Oldi-Berdi.apk' }, { text: '💻 Kompyuterga yuklash', url: SITE_ + '#qurilmalar' }]] } });
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
function tgs_(a, text, extra) { if (a.tg) return send_(a.tg, text, extra); }
function kunlik() {
  if (!prop_('TG_TOKEN')) return;
  const td = today_(), in3 = addDays_(td, 3), tm = addDays_(td, 1);
  const peopleBy = {}; all_('People').forEach(function (p) { (peopleBy[p.acc] = peopleBy[p.acc] || {})[p.id] = p; });
  try { migrate_(); migrate2_(); } catch (e) {}
  const yd = addDays_(td, -1);
  all_('Accounts').forEach(function (a) {
    if (!a.tg && String(a.push) !== '1') return;
    if (pushFlush_(a)) put_('Accounts', a, a._row);
    const p = premium_(a);
    if (p.trialUsed && p.trialEnd === yd && !p.until) { if (a.tg) botTrialOver_(a.tg, a); return; }
    if (p.on) try { instDaily_(a); } catch (e) { console.error(e); }
    try {
      const left = p.trial ? p.until : p.bizTrial ? p.bizUntil : '';
      if (left && (left === in3 || left === tm)) {
        const from = addDays_(left, -(p.trial ? TRIAL_DAYS : BIZ_TRIAL_DAYS)), v = { kun: left === in3 ? 3 : 1 };
        if (p.bizTrial) { let g = 0; all_('Tx').forEach(function (t) { if (t.acc === a.id && t.type === 'got' && t.date >= from) g += Number(t.amount) || 0; }); v.summa = g; }
        else { let n = 0; all_('People').forEach(function (q) { if (q.acc === a.id) (q.log || []).forEach(function (l) { if (l && l.at && /eslatma/i.test(l.t || '') && Utilities.formatDate(new Date(l.at), Session.getScriptTimeZone(), 'yyyy-MM-dd') >= from) n++; }); }); v.soni = n; }
        notify_(a, 'trialEnd', v, { pushOnly: true });
      }
    } catch (e) { console.error(e); }
    if (p.trial) {
      if (p.until === in3) tgs_(a, '🎁 Premium sinov <b>3 kundan keyin</b> (' + fdate_(p.until) + ') tugaydi.\nKeyin ilova bepul rejimda ishlayveradi. Premium\'ni saqlab qolish uchun «💎 Premium» tugmasini bosing.', { reply_markup: kbMain_() });
      else if (p.until === td) tgs_(a, '⏰ Premium sinov <b>bugun</b> tugaydi. Ertadan ilova bepul rejimda ishlaydi.\nPremium\'ni davom ettirish uchun «💎 Premium» ni bosing.', { reply_markup: kbMain_() });
    } else
    if (!p.biz && p.until && (p.until === in3 || p.until === td)) tgs_(a, '⏰ Premium ' + (p.until === td ? '<b>bugun</b> tugaydi' : '3 kundan keyin (' + fdate_(p.until) + ') tugaydi') + '.\nUzaytirish uchun «💎 Premium» tugmasini bosing.', { reply_markup: kbMain_() });
    else if (!p.biz && p.until && p.until === addDays_(td, -1)) tgs_(a, 'Premium muddati tugadi. Qayta yoqish uchun «💎 Premium» tugmasini bosing.', { reply_markup: kbMain_() });
    if (p.biz && p.bizUntil && mode_(a) === 'biz' && (p.bizUntil === in3 || p.bizUntil === td)) tgs_(a, (p.bizTrial ? '🎁 Biznes sinov ' : '🏪 Biznes ') + (p.bizUntil === td ? '<b>bugun</b> tugaydi' : '3 kundan keyin (' + fdate_(p.bizUntil) + ') tugaydi') + '.\nMa\'lumotlar o\'chmaydi. Davom ettirish uchun /biznes yoki ilovadagi «Biznes\'ni uzaytirish».', { reply_markup: { inline_keyboard: [[{ text: '🏪 Biznes tariflari', callback_data: 'biz' }]] } });
    const people = peopleBy[a.id] || {}, b = balances_(a.id), od = [], soon = [];
    Object.keys(b.bal).forEach(function (pid) {
      const v = b.bal[pid], d = b.due[pid]; if (v <= 0.5 || !d || !people[pid]) return;
      if (d < td) od.push({ n: people[pid].name, v: v, d: d }); else if (d === td || d === tm) soon.push({ n: people[pid].name, v: v, d: d });
    });
    if (!od.length && !soon.length) return;
    try {
      const tdN = soon.filter(function (x) { return x.d === td; }).length, tmN = soon.length - tdN, odS = od.reduce(function (z, x) { return z + x.v; }, 0);
      const ru = a.lang === 'ru';
      const parts = [];
      if (tdN) parts.push(ru ? 'сегодня срок: ' + tdN : 'bugun muddati: ' + tdN + ' ta');
      if (tmN) parts.push(ru ? 'завтра: ' + tmN : 'ertaga: ' + tmN + ' ta');
      if (od.length) parts.push(ru ? 'просрочено: ' + od.length + ' (' + sum_(odS).replace("so'm", 'сум') + ')' : "muddati o'tgan: " + od.length + ' ta (' + sum_(odS) + ')');
      notify_(a, 'due', {}, { pushOnly: true, text: (ru ? '📅 Долги — ' : '📅 Qarzlar — ') + parts.join(', '), title: ru ? 'Сроки долгов' : 'Qarz muddatlari' });
    } catch (e) { console.error(e); }
    if (!a.tg) return;
    let t = 'Xayrli tong, ' + h_(a.name) + '! ☀️\n';
    if (soon.length) t += '\n📅 <b>Muddati yaqin:</b>\n' + soon.map(function (x) { return '• ' + h_(x.n) + ' — ' + sum_(x.v) + (x.d === td ? ' (bugun)' : ' (ertaga)'); }).join('\n') + '\n';
    if (od.length) t += '\n⏰ <b>Muddati o\'tgan:</b>\n' + od.slice(0, 10).map(function (x) { return '• ' + h_(x.n) + ' — ' + sum_(x.v) + ' (' + fdate_(x.d) + ')'; }).join('\n') + '\n';
    t += p.on ? '\nIlovadan bir bosishda SMS eslatma yuborishingiz mumkin.' : '';
    tgs_(a, t, { reply_markup: { inline_keyboard: [[btnApp_()]] } });
    Utilities.sleep(60);
  });
  nstatFlush_();
}


/* ======================= FAOLLIK VA XABARLAR (notify_) =======================
 * Har bir xabar turi: bir nechta matn varianti (std/biz, uz/ru), navbat bilan tanlanadi.
 * {ism} {soni} {summa} {dokon} {ball} {daraja} {streak} {qaytdi} {berildi} {mijoz} {dost} {dokon2} {kun}
 * Qiymati bo'sh yoki 0 bo'lgan o'zgaruvchili variant tanlanmaydi.
 * Kategoriyalar (foydalanuvchi Sozlamalarda o'chiradi): rem — eslatmalar, sog — sog'indik,
 * rep — hisobotlar, loyal — sodiqlik, offer — takliflar. */
const NOTIFY_CATS_ = ['rem', 'sog', 'rep', 'loyal', 'offer'];
const NOTIFY_KINDS_ = {
  sog1:   { cat: 'sog',   t: "Sog'indik (bugun kirmadi)" },
  sog3:   { cat: 'sog',   t: '3 kun kirmadi' },
  sog7:   { cat: 'sog',   t: '7 kun kirmadi' },
  sog14:  { cat: 'sog',   t: '14 va 30 kun kirmadi' },
  streak: { cat: 'loyal', t: 'Seriya (har 7 kunda)' },
  level:  { cat: 'loyal', t: 'Yangi daraja' },
  ball:   { cat: 'loyal', t: 'Ball yetdi (7 kun Premium)' },
  ref:    { cat: 'loyal', t: "Tavsiya: do'st qo'shildi" },
  monthly:{ cat: 'rep',   t: 'Oylik hisobot' },
  trialEnd:{ cat: 'rem',  t: 'Sinov tugashi' },
  due:    { cat: 'rem',   t: 'Qarz muddati (push)' },
  manual: { cat: 'offer', t: "Qo'lda yuborilgan" }
};
const MSG_DEF_ = {
  sog1: {
    std: { uz: ["Sizni sog'indik, {ism}! 💚 Bugun hech kimga qarz berdingizmi? Yozib qo'ying.", "{ism}, bugun ko'rinmadingiz 🙂 Qarzlaringiz joyida, bir qarab qo'ying.", "Bugungi oldi-berdilaringizni yozib qo'ysangiz, ertaga hammasi aniq bo'ladi ✍️", "Seriyangiz {streak} kun! Bugun ham kirib, uzib qo'ymang 🔥"],
           ru: ["Мы соскучились, {ism}! 💚 Сегодня давали кому-нибудь в долг? Запишите.", "{ism}, сегодня вас не было 🙂 Ваши долги на месте, загляните.", "Запишите сегодняшние долги — и завтра всё будет ясно ✍️", "Ваша серия — {streak} дн.! Зайдите и сегодня, не прерывайте 🔥"] },
    biz: { uz: ["Sizni sog'indik, {ism} aka! 🏪 Bugungi nasiyalar yozildimi?", "{dokon}da bugun nasiya bo'ldimi? Yozilmagan nasiya — unutilgan pul.", "Muddati o'tgan {soni} ta qarz bor ({summa} so'm). Bir bosishda eslatma yuboring 👉", "Kun yakunlanyapti. 1 daqiqa — bugungi nasiyalarni tekshiring ✅"],
           ru: ["Мы соскучились, {ism}! 🏪 Сегодняшние долги записаны?", "В «{dokon}» сегодня давали в долг? Незаписанный долг — забытые деньги.", "Просроченных долгов: {soni} ({summa} сум). Напомните в одно нажатие 👉", "День заканчивается. 1 минута — проверьте сегодняшние долги ✅"] }
  },
  sog3: {
    std: { uz: ["{ism}, 3 kundan beri ko'rinmaysiz. Hammasi joyidami? Qarzlaringiz sizni kutyapti 💚"], ru: ["{ism}, вас не видно уже 3 дня. Всё в порядке? Ваши долги ждут вас 💚"] },
    biz: { uz: ["3 kundan beri daftar ochilmadi. Muddati o'tganlar: {soni} ta. Pul o'zi qaytmaydi 🙂", "3 kundan beri daftar ochilmadi. Nasiyalar tartibda turishi uchun bir qarab qo'ying 🙂"], ru: ["Тетрадь не открывалась 3 дня. Просроченных: {soni}. Деньги сами не вернутся 🙂", "Тетрадь не открывалась 3 дня. Загляните, чтобы долги были в порядке 🙂"] }
  },
  sog7: {
    std: { uz: ["Bir haftadan beri yo'qsiz 🥺 Kimgadir qarz berganmisiz? Hozir yozib qo'ying."], ru: ["Вас нет уже неделю 🥺 Давали кому-то в долг? Запишите сейчас."] },
    biz: { uz: ["Bir hafta — {summa} so'm qarz kutib turibdi. Bugun eslatma yuborsangiz, ertaga qaytadi.", "Bir haftadan beri daftar ochilmadi. Bugun nasiyalarni tekshirib qo'ying 🏪"], ru: ["Уже неделю {summa} сум долга ждут. Напомните сегодня — завтра вернут.", "Тетрадь не открывалась неделю. Проверьте сегодня долги 🏪"] }
  },
  sog14: {
    std: { uz: ["Biz shu yerdamiz, {ism}. Qaytsangiz — 50 bonus ball sovg'a 🎁"], ru: ["Мы здесь, {ism}. Вернётесь — 50 бонусных баллов в подарок 🎁"] },
    biz: { uz: ["{ism} aka, qaytib keling — yordam kerak bo'lsa botga yozing, o'zimiz ko'rsatib beramiz."], ru: ["{ism}, возвращайтесь — если нужна помощь, напишите боту, всё покажем."] }
  },
  streak: {
    std: { uz: ["🔥 {streak} kun ketma-ket! +20 ball. Shunday davom eting!"], ru: ["🔥 {streak} дней подряд! +20 баллов. Так держать!"] },
    biz: { uz: ["🔥 {streak} kun ketma-ket nasiyalar tartibda. Zo'r ish!"], ru: ["🔥 {streak} дней подряд долги в порядке. Отличная работа!"] }
  },
  level: {
    std: { uz: ["🎉 Tabriklaymiz! Siz endi {daraja}. Mukofotlaringizni ko'ring 👉"], ru: ["🎉 Поздравляем! Теперь вы — {daraja}. Посмотрите награды 👉"] },
    biz: { uz: ["🎉 {dokon} endi {daraja} hamkor! Yangi chegirmangiz faol.", "🎉 Endi siz {daraja} hamkorsiz! Yangi chegirmangiz faol."], ru: ["🎉 «{dokon}» теперь партнёр уровня {daraja}! Новая скидка активна.", "🎉 Теперь вы партнёр уровня {daraja}! Новая скидка активна."] }
  },
  ball: {
    std: { uz: ["🎁 {ball} ball yig'dingiz — 7 kun Premium'ni bepul oling!"], ru: ["🎁 Вы набрали {ball} баллов — получите 7 дней Premium бесплатно!"] },
    biz: { uz: [], ru: [] }
  },
  ref: {
    std: { uz: ["👏 {dost} siz orqali qo'shildi! +{ball} ball"], ru: ["👏 {dost} присоединился по вашей ссылке! +{ball} баллов"] },
    biz: { uz: ["👏 {dokon2} siz orqali ulandi — sizga 1 oy bepul!"], ru: ["👏 «{dokon2}» подключился по вашей ссылке — вам 1 месяц бесплатно!"] }
  },
  monthly: {
    std: { uz: ["📊 O'tgan oy: {qaytdi} so'm qaytdi, {berildi} so'm berildi. Batafsil 👉", "📊 O'tgan oy {berildi} so'm qarz berdingiz. Batafsil 👉"], ru: ["📊 Прошлый месяц: вернули {qaytdi} сум, выдали {berildi} сум. Подробнее 👉", "📊 В прошлом месяце вы выдали {berildi} сум. Подробнее 👉"] },
    biz: { uz: ["📊 {dokon}: o'tgan oy {qaytdi} so'm nasiya qaytdi. Eng ishonchli mijoz — {mijoz}.", "📊 O'tgan oy {qaytdi} so'm nasiya qaytdi. Eng ishonchli mijoz — {mijoz}.", "📊 O'tgan oy {berildi} so'm nasiya berildi. Batafsil 👉"], ru: ["📊 «{dokon}»: в прошлом месяце вернули {qaytdi} сум. Самый надёжный клиент — {mijoz}.", "📊 В прошлом месяце вернули {qaytdi} сум. Самый надёжный клиент — {mijoz}.", "📊 В прошлом месяце выдано в долг {berildi} сум. Подробнее 👉"] }
  },
  trialEnd: {
    std: { uz: ["Premium sinovi {kun} kunda tugaydi. Shu vaqt ichida {soni} ta eslatma yubordingiz 💎", "Premium sinovi {kun} kunda tugaydi. Premium'ni saqlab qolasizmi? 💎"], ru: ["Пробный Premium закончится через {kun} дн. За это время вы отправили {soni} напоминаний 💎", "Пробный Premium закончится через {kun} дн. Оставите Premium? 💎"] },
    biz: { uz: ["Biznes sinovi {kun} kunda tugaydi. Bu davrda {summa} so'm qaytdi. Davom etamizmi?", "Biznes sinovi {kun} kunda tugaydi. Davom etamizmi? 🏪"], ru: ["Пробный Бизнес закончится через {kun} дн. За это время вернули {summa} сум. Продолжим?", "Пробный Бизнес закончится через {kun} дн. Продолжим? 🏪"] }
  },
  due: { std: { uz: ['{matn}'], ru: ['{matn}'] }, biz: { uz: ['{matn}'], ru: ['{matn}'] } },
  manual: { std: { uz: ['{matn}'], ru: ['{matn}'] }, biz: { uz: ['{matn}'], ru: ['{matn}'] } }
};
/* sahifa: push bosilganda ilovaning qaysi bo'limi ochiladi */
const NOTIFY_URL_ = { sog1: '', sog3: '', sog7: '', sog14: '', streak: 'loyal', level: 'loyal', ball: 'loyal', ref: 'loyal', monthly: 'report', trialEnd: 'prem', due: 'home', manual: '' };
let MSGCFG_MEMO_ = null;
function msgCfg_() {
  if (MSGCFG_MEMO_) return MSGCFG_MEMO_;
  let o = {}; try { o = JSON.parse(meta_('notify_cfg') || '{}') || {}; } catch (e) {}
  const r = {};
  Object.keys(MSG_DEF_).forEach(function (k) {
    const d = MSG_DEF_[k], c = o[k] || {};
    r[k] = { on: c.on !== false, std: { uz: lst_(c.std && c.std.uz, d.std.uz), ru: lst_(c.std && c.std.ru, d.std.ru) }, biz: { uz: lst_(c.biz && c.biz.uz, d.biz.uz), ru: lst_(c.biz && c.biz.ru, d.biz.ru) } };
  });
  return (MSGCFG_MEMO_ = r);
}
function lst_(v, def) { return Array.isArray(v) && v.length ? v.map(String).filter(function (x) { return x.trim(); }) : def; }
function notifyOff_(a) { return String(a.notifyOff || '').split(',').filter(Boolean); }
function nstate_(a) { const s = a.lastNotify; return s && typeof s === 'object' && !Array.isArray(s) ? s : {}; }
function fillOk_(t, v) {
  const m = String(t).match(/\{[a-z0-9]+\}/g) || [];
  return m.every(function (x) { const k = x.slice(1, -1), y = v[k]; return y !== undefined && y !== null && y !== '' && y !== 0 && y !== '0'; });
}
function fill_(t, v) { return String(t).replace(/\{([a-z0-9]+)\}/g, function (_, k) { const y = v[k]; return typeof y === 'number' ? String(Math.round(y)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') : String(y); }); }
function firstName_(n) { return String(n || '').trim().split(/\s+/)[0] || ''; }
function hourNow_() { return Number(Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'H')); }
let NSTAT_ = null;   // shu ishga tushishdagi statistika, oxirida Meta'ga yoziladi
function nstat_(key, field) {
  NSTAT_ = NSTAT_ || {};
  const k = key + ':' + (field || 's'); NSTAT_[k] = (NSTAT_[k] || 0) + 1;
}
function nstatFlush_() {
  if (!NSTAT_) return;
  let o = {}; try { o = JSON.parse(meta_('notify_stats') || '{}') || {}; } catch (e) {}
  const td = today_(), d = o[td] = o[td] || {};
  Object.keys(NSTAT_).forEach(function (k) { d[k] = (d[k] || 0) + NSTAT_[k]; });
  const keep = Object.keys(o).sort().slice(-60), n = {}; keep.forEach(function (k) { n[k] = o[k]; });
  setMeta_('notify_stats', JSON.stringify(n));
  NSTAT_ = null;
}
/* Bitta umumiy funksiya: xabarni botga (a.tg bo'lsa) va push'ga (a.push bo'lsa) yuboradi.
 * opt: { pushOnly, botOnly, text (tayyor matn), url, force (kunlik chegarasiz), noSave, kb (bot tugmalari) } */
function notify_(a, key, vars, opt) {
  opt = opt || {}; vars = vars || {};
  if (typeof a === 'string') { a = all_('Accounts').filter(function (x) { return x.id === a; })[0]; if (!a) return false; }
  if (typeof vars === 'string') return notifyTg_(a.id, vars, opt);   // eski chaqiruvlar
  const kind = NOTIFY_KINDS_[key]; if (!kind) return false;
  const cfg = msgCfg_()[key]; if (!cfg || cfg.on === false) return false;
  if (notifyOff_(a).indexOf(kind.cat) >= 0) return false;
  const st = nstate_(a), td = today_();
  if (st.day !== td) { st.day = td; st.n = 0; }
  if (kind.cat !== 'rem' && !opt.force && (st.n || 0) >= 2) return false;   // kuniga ko'pi bilan 2 ta
  const m = mode_(a) === 'biz' ? 'biz' : 'std', lang = a.lang === 'ru' ? 'ru' : 'uz';
  let text = opt.text || '';
  st.k = st.k || {};
  if (!text) {
    const list = (cfg[m][lang] && cfg[m][lang].length ? cfg[m][lang] : cfg[m].uz) || [];
    const ok = []; list.forEach(function (t, i) { if (fillOk_(t, vars)) ok.push(i); });
    if (!ok.length) return false;
    const last = st.k[key] ? Number(st.k[key].i) : -1;
    let i = ok.filter(function (x) { return x > last; })[0]; if (i === undefined) i = ok[0];
    if (ok.length > 1 && i === last) i = ok[(ok.indexOf(i) + 1) % ok.length];
    st.k[key] = { d: td, i: i };
    text = fill_(list[i], vars);
  } else st.k[key] = { d: td, i: -1 };
  let sent = false;
  if (!opt.pushOnly && a.tg && prop_('TG_TOKEN')) {
    try { send_(a.tg, h_(text), { reply_markup: opt.kb || { inline_keyboard: [[btnApp_()]] } }); sent = true; } catch (e) { console.error(e); }
  }
  if (!opt.botOnly && String(a.push) === '1') {
    const p = { t: opt.title || (m === 'biz' && bizShop_(a.id)) || 'Oldi-Berdi', b: text, u: opt.url !== undefined ? opt.url : (NOTIFY_URL_[key] || '') };
    const h = hourNow_();
    if (h >= 22 || h < 8) { st.q = (st.q || []).concat([p]).slice(-3); sent = true; }   // tunda navbatga
    else if (push_(a, p.t, p.b, p.u)) sent = true;
  }
  if (!sent) return false;
  if (kind.cat !== 'rem') st.n = (st.n || 0) + 1;
  if (/^sog/.test(key)) st.sog = td;
  a.lastNotify = st;
  if (!opt.noSave) put_('Accounts', a, a._row);
  nstat_(key);
  return true;
}
/* tunda navbatga qolgan push'larni ertalab yuborish */
function pushFlush_(a) {
  const st = nstate_(a); if (!st.q || !st.q.length) return false;
  st.q.forEach(function (p) { push_(a, p.t, p.b, p.u); });
  st.q = []; a.lastNotify = st; return true;
}
function bizShop_(accId) {
  const d = all_('Docs').filter(function (x) { return x.acc === accId && x.kind === 'biz'; })[0];
  return d && d.data && d.data.shop ? String(d.data.shop) : '';
}
/* Telefonga push — OneSignal REST API. Script Properties: ONESIGNAL_APP_ID, ONESIGNAL_API_KEY.
 * Foydalanuvchi ilovada OneSignal.login(Accounts.id) qiladi, shu external_id ga yuboriladi. */
function push_(a, title, body, url) {
  const id = prop_('ONESIGNAL_APP_ID'), key = prop_('ONESIGNAL_API_KEY');
  if (!id || !key || String(a.push) !== '1') return false;
  const link = appUrl_() + (url ? '#go=' + url : '');
  try {
    const res = UrlFetchApp.fetch('https://api.onesignal.com/notifications?c=push', {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { Authorization: 'Key ' + key },
      payload: JSON.stringify({ app_id: id, target_channel: 'push', include_aliases: { external_id: [a.id] }, headings: { en: String(title).slice(0, 60) }, contents: { en: String(body).slice(0, 300) }, url: link, chrome_web_icon: appUrl_() + 'icon-192.png' })
    });
    let j = {}; try { j = JSON.parse(res.getContentText()); } catch (e) {}
    const errs = j.errors && (j.errors.invalid_aliases || (Array.isArray(j.errors) ? j.errors : null));
    if (res.getResponseCode() === 200 && j.id && !errs) { nstat_('push'); return true; }
    if (j.errors && j.errors.invalid_aliases) { a.push = ''; }   // obuna yo'q — keyingi safar urinmaymiz
    return false;
  } catch (e) { console.error(e); return false; }
}

/* Ilova ochilganda (har qanday so'rovda, kuniga 1 marta): lastSeen, streak, til */
function seen_(a, req) {
  const td = today_(), lang = req && (req.lang === 'ru' || req.lang === 'uz') ? req.lang : '';
  if (a.lastSeen === td && (!lang || lang === a.lang)) return;
  if (lang) a.lang = lang;
  if (a.lastSeen !== td) {
    const prev = a.lastSeen;
    a.streak = prev === addDays_(td, -1) ? (Number(a.streak) || 0) + 1 : 1;
    a.lastSeen = td;
    const st = nstate_(a);
    if (st.sog && st.sog >= addDays_(td, -2)) { nstat_('ret'); st.sog = ''; a.lastNotify = st; }   // xabardan keyin qaytdi
    try { onSeen_(a, prev); } catch (e) { console.error(e); }
    if (a.streak > 1 && a.streak % 7 === 0) notify_(a, 'streak', { streak: a.streak }, { noSave: true });
  }
  put_('Accounts', a, a._row);
  nstatFlush_();
}

function daysBetween_(a, b) { return Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 864e5); }
function odSum_(accId, td) {
  const b = balances_(accId); let n = 0, s = 0, total = 0;
  Object.keys(b.bal).forEach(function (pid) { const v = b.bal[pid]; if (v <= 0.5) return; total += v; if (b.due[pid] && b.due[pid] < td) { n++; s += v; } });
  return { n: n, s: s, total: total };
}
/* 19:00 — bugun kirmaganlarga: 1, 3, 7, 14 va 30 kun */
function sogindik() {
  const td = today_();
  all_('Accounts').forEach(function (a) {
    if (!a.lastSeen || a.lastSeen >= td || (!a.tg && String(a.push) !== '1') || nstate_(a).sog === td) return;
    const d = daysBetween_(a.lastSeen, td);
    const key = d === 1 ? 'sog1' : d === 3 ? 'sog3' : d === 7 ? 'sog7' : (d === 14 || d === 30) ? 'sog14' : '';
    if (!key) return;
    const v = { ism: firstName_(a.name) };
    if (key === 'sog1' && Number(a.streak) >= 3) v.streak = Number(a.streak);
    if (mode_(a) === 'biz') { const o = odSum_(a.id, td); v.soni = o.n; v.summa = key === 'sog7' ? o.total : o.s; v.dokon = bizShop_(a.id); }
    try { notify_(a, key, v); } catch (e) { console.error(e); }
    Utilities.sleep(40);
  });
  nstatFlush_();
}
/* har kuni 10:00 — oyning 1-kuni oylik hisobot (Biznes uchun batafsil «foyda hisoboti» botda) */
function oylik() {
  const td = today_(); if (td.slice(8) !== '01') return;
  const from = addDays_(td, -1).slice(0, 8) + '01', to = addDays_(td, -1);
  const by = {}; all_('Tx').forEach(function (t) { if (t.date >= from && t.date <= to) (by[t.acc] = by[t.acc] || []).push(t); });
  const rt = rate_(), usd = rt && rt.usd || 0;
  const pplBy = {}; all_('People').forEach(function (p) { (pplBy[p.acc] = pplBy[p.acc] || []).push(p); });
  all_('Accounts').forEach(function (a) {
    const L = by[a.id]; if (!L || !L.length || (!a.tg && String(a.push) !== '1')) return;
    let got = 0, lend = 0; const per = {};
    L.forEach(function (t) { let v = Number(t.amount) || 0; if (t.cur === 'USD') v = usd ? v * usd : 0; if (t.type === 'got') { got += v; per[t.pid] = (per[t.pid] || 0) + v; } else if (t.type === 'lend') lend += v; });
    const ppl = {}; (pplBy[a.id] || []).forEach(function (p) { ppl[p.id] = p; });
    const top = Object.keys(per).filter(function (k) { return ppl[k]; }).sort(function (x, y) { return per[y] - per[x]; }).slice(0, 3);
    const v = { qaytdi: got, berildi: lend, mijoz: top[0] ? ppl[top[0]].name : '', dokon: bizShop_(a.id) };
    try {
      if (mode_(a) === 'biz' && a.tg) {
        let rem = 0; (pplBy[a.id] || []).forEach(function (p) { (p.log || []).forEach(function (l) { const d = l && l.at ? Utilities.formatDate(new Date(l.at), Session.getScriptTimeZone(), 'yyyy-MM-dd') : ''; if (d >= from && d <= to && /eslatma/i.test(l.t || '')) rem++; }); });
        const M = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'];
        let t = '📊 <b>' + h_(v.dokon || 'Oylik foyda hisoboti') + '</b> · ' + M[Number(from.slice(5, 7)) - 1] + '\n\n';
        t += '💵 Qaytgan nasiya: <b>' + sum_(got) + '</b>\n➕ Berilgan nasiya: <b>' + sum_(lend) + '</b>\n📣 Yuborilgan eslatmalar: <b>' + rem + ' ta</b>\n';
        if (top.length) t += '\n🏆 <b>Eng ishonchli mijozlar:</b>\n' + top.map(function (k, i) { return (i + 1) + '. ' + h_(ppl[k].name) + ' — ' + sum_(per[k]); }).join('\n');
        send_(a.tg, t, { reply_markup: { inline_keyboard: [[btnApp_()]] } });
        notify_(a, 'monthly', v, { pushOnly: true });
      } else notify_(a, 'monthly', v);
    } catch (e) { console.error(e); }
    Utilities.sleep(50);
  });
  nstatFlush_();
}


/* ======================= SODIQLIK DASTURI =======================
 * Standart: «Oldi-Berdi ballari» — ball va darajalar. Biznes: «Hamkor do'kon» — to'langan oylar (staj).
 * Hamma hisob SERVERDA. Qiymatlar admin panelda o'zgaradi (Meta: loyalty_cfg). */
const LOYAL_DEF_ = { login: 2, streak7: 20, tx: 3, txMax: 10, ontime: 10, invite: 100, invitePrem: 300, back: 50, lv1: 200, lv2: 600, lv3: 1500, r7: 300, r30: 1000, goldDisc: 20, bizSilverDisc: 10, bizGoldDisc: 15, bizRefDays: 30 };
const STD_LV_ = [['🌱', 'Yangi', 'Новичок'], ['🥉', 'Faol', 'Активный'], ['🥈', 'Ishonchli', 'Надёжный'], ['🥇', 'Oltin', 'Золотой']];
const BIZ_LV_ = [['🏪', 'Start', 'Старт', 0], ['🥈', 'Kumush', 'Серебро', 3], ['🥇', 'Oltin', 'Золото', 6], ['💎', 'Platina', 'Платина', 12]];
let LCFG_MEMO_ = null;
function loyalCfg_() {
  if (LCFG_MEMO_) return LCFG_MEMO_;
  let o = {}; try { o = JSON.parse(meta_('loyalty_cfg') || '{}') || {}; } catch (e) {}
  const r = {}; Object.keys(LOYAL_DEF_).forEach(function (k) { const v = Number(o[k]); r[k] = o[k] !== undefined && o[k] !== '' && v >= 0 ? v : LOYAL_DEF_[k]; });
  return (LCFG_MEMO_ = r);
}
function lyl_(a) { const v = a.loyal; return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; }
function stdLevel_(earned) { const c = loyalCfg_(); return earned >= c.lv3 ? 3 : earned >= c.lv2 ? 2 : earned >= c.lv1 ? 1 : 0; }
function lvName_(L, i, a) { return L[i][0] + ' ' + L[i][a && a.lang === 'ru' ? 2 : 1]; }
function isStd_(a) { return mode_(a) !== 'biz'; }
/* ball qo'shish/ayirish (faqat Standart yo'lida). why — tarix uchun qisqa izoh */
function addPts_(a, n, why) {
  if (!n || !isStd_(a)) return;
  const L = lyl_(a), c = loyalCfg_();
  const before = stdLevel_(Number(a.earned) || 0), hadR7 = (Number(a.points) || 0) >= c.r7;
  a.points = Math.max(0, (Number(a.points) || 0) + n);
  if (n > 0) a.earned = (Number(a.earned) || 0) + n;
  L.h = [{ at: Date.now(), p: n, t: why }].concat(L.h || []).slice(0, 20);
  a.loyal = L;
  const after = stdLevel_(Number(a.earned) || 0);
  a.level = String(after);
  if (after > before) try { notify_(a, 'level', { daraja: lvName_(STD_LV_, after, a) }, { noSave: true }); } catch (e) {}
  else if (!hadR7 && a.points >= c.r7 && c.r7 > 0) try { notify_(a, 'ball', { ball: a.points }, { noSave: true }); } catch (e) {}
}
/* ilovaga kirish: kuniga 1 marta */
function onSeen_(a, prev) {
  const c = loyalCfg_(), td = today_();
  if (!isStd_(a)) return;
  if (c.login) addPts_(a, c.login, 'Ilovaga kirish');
  if (a.streak > 1 && a.streak % 7 === 0 && c.streak7) addPts_(a, c.streak7, a.streak + ' kun ketma-ket');
  if (prev && daysBetween_(prev, td) >= 14 && c.back) addPts_(a, c.back, 'Qaytganingiz uchun sovg\'a');
}
/* yangi yozuv: +tx (kuniga ko'pi bilan txMax), o'z qarzini muddatida qaytarish: +ontime (kuniga 1) */
function onNewTx_(a, t, people) {
  const c = loyalCfg_(), td = today_(), L = lyl_(a);
  let changed = false;
  if (a.ref && !L.refOk) {   // taklif bilan kelgan do'st birinchi yozuvini qildi — taklif qilganga ball
    L.refOk = 1; a.loyal = L; changed = true;
    try { refReward_(a, 'join'); } catch (e) { console.error(e); }
  }
  if (!isStd_(a)) return changed;
  if (L.d !== td) { L.d = td; L.tx = 0; L.ot = 0; }
  if ((L.tx || 0) < c.txMax && c.tx) { L.tx = (L.tx || 0) + 1; a.loyal = L; addPts_(a, c.tx, 'Yangi yozuv'); t.pts = 1; changed = true; }
  if (t.type === 'paid' && !L.ot && c.ontime) {
    // shu odamdan olingan, muddati bugundan keyin/bugun bo'lgan va kamida 1 kun oldin yozilgan qarz bo'lsa
    const ok = all_('Tx').some(function (x) { return x.acc === a.id && x.pid === t.pid && x.type === 'borrow' && x.due && x.due >= t.date && (Number(x.createdAt) || 0) < Date.now() - 864e5; });
    if (ok) {
      const b = balances_(a.id); if ((b.bal[t.pid] || 0) >= -0.5) { L.ot = 1; a.loyal = L; addPts_(a, c.ontime, "Qarzni muddatida qaytardingiz"); changed = true; }
    }
  }
  return changed;
}
function onDelTx_(a, t) { if (t && String(t.pts) === '1' && isStd_(a)) { addPts_(a, -loyalCfg_().tx, "Yozuv o'chirildi"); return true; } return false; }
/* taklif: join — do'st birinchi yozuvini qildi; prem — do'st Premium sotib oldi; biz — do'kon Biznes uchun to'ladi */
function refReward_(inv, kind) {
  const r = all_('Accounts').filter(function (x) { return x.id === inv.ref; })[0]; if (!r) return;
  const c = loyalCfg_();
  if (kind === 'biz') {
    if (mode_(r) !== 'biz' || !c.bizRefDays) return;
    grantBiz_(r.id, c.bizRefDays);
    const r2 = all_('Accounts').filter(function (x) { return x.id === r.id; })[0];
    notify_(r2, 'ref', { dokon2: bizShop_(inv.id) || inv.name });
    return;
  }
  if (!isStd_(r)) return;
  const n = kind === 'prem' ? c.invitePrem : c.invite; if (!n) return;
  addPts_(r, n, (kind === 'prem' ? 'Do\'stingiz Premium oldi: ' : 'Do\'st taklifi: ') + inv.name);
  notify_(r, 'ref', { dost: firstName_(inv.name), ball: n }, { noSave: true });
  put_('Accounts', r, r._row);
}
/* Biznes staji: to'langan Biznes oylari (admin qo'lda bergani hisobga kirmaydi) */
function bizMonths_(accId, pays) {
  let d = 0; (pays || all_('Payments')).forEach(function (p) { if (p.acc === accId && p.status === 'paid' && PLANS[p.tarif] && PLANS[p.tarif].biz) d += Number(p.days) || 0; });
  return Math.floor(d / 30 + 0.01);
}
function bizLevel_(m) { return m >= 12 ? 3 : m >= 6 ? 2 : m >= 3 ? 1 : 0; }
/* shaxsiy narx: Oltin (Standart) — yillik −goldDisc%, Kumush/Oltin/Platina (Biznes) — yillik chegirma */
function discFor_(a, plan) {
  const c = loyalCfg_();
  if (plan === 'year' && isStd_(a) && stdLevel_(Number(a.earned) || 0) === 3) return c.goldDisc;
  if (plan === 'bizyear' && mode_(a) === 'biz') { const l = bizLevel_(bizMonths_(a.id)); return l === 1 ? c.bizSilverDisc : l >= 2 ? c.bizGoldDisc : 0; }
  return 0;
}
function priceFor_(a, plan) { const p = prices_()[plan] || 0, d = discFor_(a, plan); return d ? Math.round(p * (100 - d) / 100 / 100) * 100 : p; }
function myPrices_(a) { const p = prices_(); ['year', 'bizyear'].forEach(function (k) { if (p[k] > 0) { const d = discFor_(a, k); if (d) { p[k + 'Full'] = p[k]; p[k] = priceFor_(a, k); p[k + 'Disc'] = d; } } }); return p; }
/* to'lovdan keyin: taklif mukofoti, Biznes darajasi, Platina — har 12 oyda 1 oy bepul */
function onPaid_(accId, plan) {
  const a = all_('Accounts').filter(function (x) { return x.id === accId; })[0]; if (!a) return;
  const L = lyl_(a);
  if (a.ref) {
    if (PLANS[plan] && PLANS[plan].biz) { if (!L.refBiz) { L.refBiz = 1; a.loyal = L; put_('Accounts', a, a._row); refReward_(a, 'biz'); } }
    else if (!L.refPrem) { L.refPrem = 1; a.loyal = L; put_('Accounts', a, a._row); refReward_(a, 'prem'); }
  }
  if (PLANS[plan] && PLANS[plan].biz) {
    const m = bizMonths_(a.id), lv = bizLevel_(m), was = Number(L.bl) || 0;
    const a2 = all_('Accounts').filter(function (x) { return x.id === accId; })[0], L2 = lyl_(a2);
    if (lv > was) { L2.bl = lv; a2.loyal = L2; put_('Accounts', a2, a2._row); notify_(a2, 'level', { daraja: lvName_(BIZ_LV_, lv, a2), dokon: bizShop_(a2.id) }); }
    const years = Math.floor(m / 12), got = Number(L2.pf) || 0;
    if (years > got) { const a3 = all_('Accounts').filter(function (x) { return x.id === accId; })[0], L3 = lyl_(a3); L3.pf = years; a3.loyal = L3; put_('Accounts', a3, a3._row); grantBiz_(accId, 30); notifyTg_(accId, '💎 Platina hamkor sovg\'asi: Biznes tarifiga <b>1 oy bepul</b> qo\'shildi!'); }
  }
}
/* ilovaga yuboriladigan qisqa ma'lumot */
function loyal_(a) {
  const c = loyalCfg_(), L = lyl_(a), base = 'https://oldiberdi.uz/?ref=' + a.id;
  if (mode_(a) === 'biz') {
    const pays = all_('Payments'), m = bizMonths_(a.id, pays), lv = bizLevel_(m);
    const refs = all_('Accounts').filter(function (x) { return x.ref === a.id; });
    const paidRefs = refs.filter(function (x) { return pays.some(function (p) { return p.acc === x.id && p.status === 'paid' && PLANS[p.tarif] && PLANS[p.tarif].biz; }); }).length;
    return { kind: 'biz', months: m, level: lv, next: lv < 3 ? BIZ_LV_[lv + 1][3] - m : 0, disc: discFor_(a, 'bizyear'), silver: c.bizSilverDisc, gold: c.bizGoldDisc, refDays: c.bizRefDays, ref: base, refs: refs.length, paidRefs: paidRefs };
  }
  const e = Number(a.earned) || 0, lv = stdLevel_(e), th = [0, c.lv1, c.lv2, c.lv3];
  return { kind: 'std', points: Number(a.points) || 0, earned: e, level: lv, th: th, next: lv < 3 ? th[lv + 1] - e : 0, streak: Number(a.streak) || 0, r7: c.r7, r30: c.r30, goldDisc: c.goldDisc, disc: discFor_(a, 'year'),
    earn: { login: c.login, streak7: c.streak7, tx: c.tx, txMax: c.txMax, ontime: c.ontime, invite: c.invite, invitePrem: c.invitePrem },
    h: (L.h || []).slice(0, 12), ref: base, refs: all_('Accounts').filter(function (x) { return x.ref === a.id; }).length };
}


/* ======================= SO'ROVNOMA =======================
 * Havola: oldiberdi.uz/?s=1 (sayt ilovaga uzatadi). Kirmagan odam ham to'ldira oladi; kirgan bo'lsa akkauntga bog'lanadi.
 * Holat Meta.survey'da: { id, on, opens, sent, startedAt }. Javoblar Survey jadvalida. Har bir javob adminga botda keladi. */
const SURVEY_Q_ = [
  { id: 'q1', type: 'one', t: ["Oldi-Berdi'dan qancha vaqtdan beri foydalanasiz?", 'Как давно вы пользуетесь Oldi-Berdi?'], o: [['1 haftadan kam', 'Меньше недели'], ['1 oygacha', 'До месяца'], ['1–3 oy', '1–3 месяца'], ["3 oydan ko'p", 'Больше 3 месяцев']] },
  { id: 'q2', type: 'one', t: ['Ilovani qanchalik tez-tez ochasiz?', 'Как часто открываете приложение?'], o: [['Har kuni', 'Каждый день'], ['Haftada bir necha marta', 'Несколько раз в неделю'], ['Haftada bir marta', 'Раз в неделю'], ['Kamdan-kam', 'Редко']] },
  { id: 'q3', type: 'many', t: ['Asosan nima uchun ishlatasiz?', 'Для чего в основном используете?'], o: [["Shaxsiy qarz-haqlar (tanish, oila)", 'Личные долги (знакомые, семья)'], ["Do'kon yoki savdo nasiyasi", 'Долги в магазине или торговле'], ["Bo'lib to'lash grafigi", 'График рассрочки'], ['Eslatma SMS yuborish', 'Отправка SMS-напоминаний'], ['Hisobot va Excel', 'Отчёты и Excel'], ["Bozorlik ro'yxati", 'Список покупок']] },
  { id: 'q4', type: 'scale', t: ['Ilova sizga qanchalik foyda berdi?', 'Насколько приложение вам полезно?'], lo: ['umuman', 'совсем нет'], hi: ['juda katta', 'очень'] },
  { id: 'q5', type: 'one', t: ["Ilova tufayli qarzlar o'z vaqtida qaytishi o'zgardimi?", 'Стали ли долги возвращаться вовремя благодаря приложению?'], o: [['Ha, ancha tezlashdi', 'Да, заметно быстрее'], ['Biroz yaxshilandi', 'Немного лучше'], ["O'zgarmadi", 'Не изменилось'], ['Bilmayman', 'Не знаю']] },
  { id: 'q6', type: 'many', t: ['Qanday muammolarga duch keldingiz?', 'С какими проблемами столкнулись?'], o: [['Tushunish qiyin', 'Сложно разобраться'], ['Sekin ishlaydi yoki qotadi', 'Медленно работает или зависает'], ['Kirish yoki parol bilan muammo', 'Проблемы со входом или паролем'], ['SMS yuborish noqulay', 'Неудобно отправлять SMS'], ['Narxi qimmat', 'Дорого'], ["Kerakli imkoniyat yo'q", 'Нет нужной функции'], ["Muammo yo'q", 'Проблем нет']] },
  { id: 'q7', type: 'text', opt: true, t: ['Muammoni batafsil yozing', 'Опишите проблему подробнее'], ph: ['Masalan: SMS ochilmayapti, Samsung telefonda…', 'Например: не открывается SMS на Samsung…'] },
  { id: 'q8', type: 'text', opt: true, t: ["Ilovaga nima qo'shishimizni xohlaysiz?", 'Что добавить в приложение?'], ph: ["Istagan fikringizni yozing", 'Напишите любую идею'] },
  { id: 'q9', type: 'nps', t: ["Oldi-Berdi'ni do'stlaringizga tavsiya qilasizmi?", 'Порекомендуете Oldi-Berdi друзьям?'], lo: ["yo'q", 'нет'], hi: ['albatta', 'обязательно'] },
  { id: 'q10', type: 'one', t: ["Oldi-Berdi haqida 15–30 soniyalik video-fikringizni yozib olishimizga ruxsat berasizmi? Reklamada ishlatiladi.", 'Разрешите записать ваш видео-отзыв об Oldi-Berdi на 15–30 секунд? Он будет использован в рекламе.'], o: [['Ha, mamnuniyat bilan', 'Да, с удовольствием'], ['Faqat ovozli yoki yuzim ko\'rinmasin', 'Только голос или без лица'], ["Yo'q, rahmat", 'Нет, спасибо']] },
  { id: 'q11', type: 'one', opt: true, if: ['q10', [0, 1]], t: ['Qachon siz bilan bog\'lansak qulay?', 'Когда удобно связаться?'], o: [['Hafta ichi kunduzi', 'Будни днём'], ['Hafta ichi kechqurun', 'Будни вечером'], ['Dam olish kunlari', 'Выходные']] }
];
function survey_() { let o = {}; try { o = JSON.parse(meta_('survey') || '{}') || {}; } catch (e) {} if (!o.id) o = { id: 's1', on: true, opens: 0, startedAt: Date.now() }; return o; }
function surveySave_(o) { setMeta_('survey', JSON.stringify(o)); }
function surveyState_(a) {
  const s = survey_(); if (!s.on) return { on: false };
  const done = all_('Survey').some(function (x) { return x.sid === s.id && (x.acc === a.id || (a.phone && x.phone === a.phone)); });
  return { on: true, id: s.id, done: done };
}
function surveyLine_(q, v) {
  if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) return '—';
  if (q.type === 'one') return q.o[v] ? q.o[v][0] : '—';
  if (q.type === 'many') return v.map(function (i) { return q.o[i] ? q.o[i][0] : ''; }).filter(Boolean).join(', ');
  if (q.type === 'scale') return v + ' / 5';
  if (q.type === 'nps') return v + ' / 10';
  return String(v);
}


/* ======================= AVTO-SMS (faqat Biznes) =======================
 * Ilova/kompyuter → SmsQueue → do'kondor telefonidagi «Oldi-Berdi SMS» yordamchi ilovasi navbatni oladi (smsPull)
 * → SIM kartadan yuboradi → holatni qaytaradi (smsReport). Ulash: 6 xonali kod (10 daqiqa), bitta akkauntga 1 faol qurilma.
 * Global sozlama Meta.sms_cfg: { off, defLimit, gap }. Akkaunt sozlamasi Accounts.smsCfg: { auto, limit, from, to, agreed }. */
const SMS_DEF_ = { off: false, defLimit: 50, gap: 25 };
function smsGlobal_() { let o = {}; try { o = JSON.parse(meta_('sms_cfg') || '{}') || {}; } catch (e) {} return { off: !!o.off, defLimit: Number(o.defLimit) >= 10 ? Number(o.defLimit) : SMS_DEF_.defLimit, gap: Number(o.gap) >= 5 ? Number(o.gap) : SMS_DEF_.gap }; }
function smsCfg_(a) {
  const g = smsGlobal_(), c = a.smsCfg && typeof a.smsCfg === 'object' && !Array.isArray(a.smsCfg) ? a.smsCfg : {};
  const hm = function (v, d) { return /^\d{2}:\d{2}$/.test(String(v || '')) ? String(v) : d; };
  return { auto: !!c.auto, agreed: !!c.agreed, limit: Math.min(150, Math.max(10, Number(c.limit) || g.defLimit)), from: hm(c.from, '09:00'), to: hm(c.to, '21:00'), gap: g.gap };
}
function smsNeedBiz_(a) {
  if (!premium_(a).biz) throw new Error("Avto-SMS faqat Biznes tarifida ishlaydi");
  if (smsGlobal_().off) throw new Error("Avto-SMS vaqtincha to'xtatilgan. Keyinroq urinib ko'ring");
}
function smsDevice_(accId) { return all_('SmsDevices').filter(function (d) { return d.acc === accId && d.status === 'active'; })[0] || null; }
function smsOnline_(d) { return !!d && Date.now() - (Number(d.lastPing) || 0) < 3 * 60000; }
function smsToday_(accId) {
  const t0 = new Date(today_() + 'T00:00:00').getTime();
  return all_('SmsQueue').filter(function (q) { return q.acc === accId && (Number(q.createdAt) || 0) >= t0 && q.status !== 'cancelled'; });
}
function smsPub_(q, names) { return { id: q.id, pid: q.pid, name: names ? names[q.pid] || '' : '', phone: q.phone, text: q.text, source: q.source, status: q.status, error: q.error || '', attempts: Number(q.attempts) || 0, createdAt: Number(q.createdAt) || 0, sentAt: Number(q.sentAt) || 0, deliveredAt: Number(q.deliveredAt) || 0 }; }
function devPub_(d) { return d ? { model: d.model, sim: d.sim, appVer: d.appVer, lastPing: Number(d.lastPing) || 0, online: smsOnline_(d), createdAt: Number(d.createdAt) || 0 } : null; }
/* qurilma tokeni bilan kirish */
function devAuth_(r) {
  const tok = String(r.dt || '');
  const d = tok && all_('SmsDevices').filter(function (x) { return x.token === tok; })[0];
  if (!d || d.status !== 'active') throw new Error('DEVICE');
  const a = all_('Accounts').filter(function (x) { return x.id === d.acc; })[0];
  if (!a) throw new Error('DEVICE');
  return { d: d, a: a };
}
/* «aka»/«opa» — ilovadagi hon() bilan bir xil qoida */
const HON_MALE_A_ = ['musa', 'iso', 'isa', 'yahyo', 'zakariyo', 'mustafo', 'mustafa', 'murtazo', 'mirzo', 'mullo', 'ota', 'raja', 'hamza', 'usama', 'muso', 'safo', 'vafo', 'ziyo', 'luqmon'];
const HON_FEM_ = ['mohinur', 'gulnur', 'dilnur', 'oydin', 'nilufar', 'barno', 'yulduz', 'shirin', 'saodat', 'sabohat', 'mehrinoz', 'dilnoz', 'gulnoz', "ra'no", 'rano', 'mohigul', 'zebo', 'nasiba', 'mohlaroy', 'sevinch', 'dilorom', 'marhabo', 'shahlo', 'gavhar', 'surayyo', 'muhayyo', 'ziyoda', 'hilola', 'nargiz', 'kumush', 'oysha', 'zarina', 'ruxsor', 'gulruh', 'mohira'];
function hon_(name) {
  const n = String(name || '').trim(); if (!n) return n;
  if (/\b(aka|opa|ota|ona|xola|amaki|tog'a|buvi|bobo|xonim|janob|domla|ustoz|hoji|aya)\b/i.test(n)) return n;
  const f = n.split(/\s+/)[0].toLowerCase().replace(/[‘’`ʻʼ]/g, "'");
  if (!/^[a-z'-]+$/.test(f)) return n;
  if (HON_FEM_.indexOf(f) >= 0) return n + ' opa';
  if (/(xon|oy|gul|niso|nisa|bonu|bibi|begim|poshsha|noz|o'r|lo)$/.test(f)) return n + ' opa';
  if (/a$/.test(f) && HON_MALE_A_.indexOf(f) < 0) return n + ' opa';
  if (/(bek|jon|boy|ali|ulla|iddin|dor|mat|mad|mon|nur|sher|ur|im|in|on|il|ov|ev|ar|or|er|ir|zod|bor|tosh|qul|vali|mal|lol|od|iz|uz|am|an|un|at|ot|id|ib|ob|ub|ug|oh|ix|ux|qob|sur|mur|bur|jur|om)$/.test(f) || HON_MALE_A_.indexOf(f) >= 0) return n + ' aka';
  return n;
}
/* eslatma matni — ilovadagi remindText() bilan bir xil ko'rinish, oxirida do'kon nomi */
function smsRemindText_(a, p, bal, due) {
  const td = today_(), D = bizDoc_(a.id), shop = [D.shop, D.addr].filter(Boolean).join(', ');
  if (a.lang === 'ru') {
    let s = 'Oldi-Berdi\n\nЗдравствуйте, ' + p.name + '!\n\nХочу напомнить: за вами долг ' + sum_(bal).replace("so'm", 'сум') + '.';
    if (due) s += due < td ? '\nСрок возврата был ' + fdate_(due) + '.' : '\nСрок возврата: ' + fdate_(due) + '.';
    return s + '\n\nСпасибо!\n' + (shop ? shop + '\n' : '') + 'Oldiberdi.uz';
  }
  let s = 'Oldi-Berdi\n\nAssalomu alaykum, ' + hon_(p.name) + "!\n\nYodingizga solib qo'ymoqchi edim: sizda " + sum_(bal) + ' qarz bor.';
  if (due) s += due < td ? '\nQaytarish muddati ' + fdate_(due) + ' edi.' : '\nQaytarish muddati: ' + fdate_(due) + '.';
  return s + '\n\nRahmat!\n' + (shop ? shop + '\n' : '') + 'Oldiberdi.uz';
}
function bizDoc_(accId) { const d = all_('Docs').filter(function (x) { return x.acc === accId && x.kind === 'biz'; })[0]; return d && d.data || {}; }
/* odam jurnaliga yozib qo'yish (ilovadagi «Oxirgi eslatma» shu yerdan) */
function smsLogPerson_(accId, pid, text) {
  const p = all_('People').filter(function (x) { return x.id === pid && x.acc === accId; })[0]; if (!p) return;
  p.log = (Array.isArray(p.log) ? p.log : []).concat([{ at: Date.now(), t: text }]).slice(-30); p.updatedAt = Date.now();
  put_('People', p, p._row);
}
/* 10 daqiqada javob kelmagan 'sending' — qaytadan navbatga (3 urinishdan keyin 'failed') */
function smsRequeue_(accId) {
  const lim = Date.now() - 10 * 60000;
  all_('SmsQueue').forEach(function (q) {
    if (q.acc !== accId || q.status !== 'sending' || (Number(q.pickedAt) || 0) > lim) return;
    if ((Number(q.attempts) || 0) >= 3) { q.status = 'failed'; q.error = q.error || "Telefon javob bermadi"; }
    else q.status = 'queued';
    q.updatedAt = Date.now(); put_('SmsQueue', q, q._row);
  });
}
function smsQueuePut_(a, p, text, source) {
  const c = smsCfg_(a), today = smsToday_(a.id).length;
  if (today >= c.limit) throw new Error('Bugungi chegara tugadi (' + c.limit + ' ta). Ertaga davom etadi');
  const phone = normPhone_(p.phone);
  if (phone.length < 9) throw new Error("Bu odamning telefon raqami yozilmagan");
  const now = Date.now();
  const q = { id: uid_(), acc: a.id, pid: p.id, phone: phone, text: str_(text, 900), source: source, status: 'queued', attempts: 0, error: '', createdAt: now, pickedAt: 0, sentAt: 0, deliveredAt: 0, updatedAt: now };
  put_('SmsQueue', q);
  return q;
}
/* har kuni 10:00 — muddati 1, 3 va 7 kun o'tgan qarzlar uchun avto-SMS navbatga */
function smsSum_(a) { if (mode_(a) !== 'biz') return null; const d = smsDevice_(a.id), c = smsCfg_(a); return { paired: !!d, online: smsOnline_(d), lastPing: d ? Number(d.lastPing) || 0 : 0, auto: c.auto, agreed: c.agreed }; }
function avtoSms() {
  if (smsGlobal_().off) return;
  const td = today_(), days = {}; days[addDays_(td, -1)] = 1; days[addDays_(td, -3)] = 3; days[addDays_(td, -7)] = 7;
  const recent = {}, lim3 = Date.now() - 3 * 864e5;
  all_('SmsQueue').forEach(function (q) { if ((Number(q.createdAt) || 0) >= lim3 && q.status !== 'cancelled' && q.status !== 'failed') recent[q.acc + ':' + q.pid] = 1; });
  const pplBy = {}; all_('People').forEach(function (p) { (pplBy[p.acc] = pplBy[p.acc] || {})[p.id] = p; });
  let total = 0;
  all_('Accounts').forEach(function (a) {
    if (mode_(a) !== 'biz' || !premium_(a).biz) return;
    const c = smsCfg_(a); if (!c.auto || !c.agreed || !smsDevice_(a.id)) return;
    const b = balances_(a.id), ppl = pplBy[a.id] || {};
    let left = c.limit - smsToday_(a.id).length;
    Object.keys(b.bal).forEach(function (pid) {
      if (left <= 0) return;
      const p = ppl[pid], v = b.bal[pid], due = b.due[pid];
      if (!p || v <= 0.5 || !due || !days[due] || String(p.noAutoSms) === '1' || recent[a.id + ':' + pid]) return;
      if (normPhone_(p.phone).length < 9) return;
      try { smsQueuePut_(a, p, smsRemindText_(a, p, v, due), 'auto'); left--; total++; } catch (e) { console.error(e); }
    });
  });
  console.log('avtoSms: ' + total);
}

/* Biznes: har kuni 20:00 da do'kon egasiga kunlik natija (botSetup trigger qo'yadi) */
function kechki() {
  if (!prop_('TG_TOKEN')) return;
  const td = today_();
  const bizDocs = {}; all_('Docs').forEach(function (d) { if (d.kind === 'biz') bizDocs[d.acc] = d.data || {}; });
  const txBy = {}; all_('Tx').forEach(function (t) { if (t.date === td) (txBy[t.acc] = txBy[t.acc] || []).push(t); });
  const rt = rate_(), usd = rt && rt.usd || 0;
  all_('Accounts').forEach(function (a) {
    if (!a.tg || mode_(a) !== 'biz' || !premium_(a).biz) return;
    const D = bizDocs[a.id] || {};
    if (D.evening === false) return;
    let given = 0, back = 0;
    (txBy[a.id] || []).forEach(function (t) { let v = Number(t.amount) || 0; if (t.cur === 'USD') v = usd ? v * usd : 0; if (t.type === 'lend') given += v; else if (t.type === 'got') back += v; });
    const b = balances_(a.id); let odN = 0, odSum = 0, total = 0, n = 0;
    Object.keys(b.bal).forEach(function (pid) { const v = b.bal[pid]; if (v <= 0.5) return; total += v; n++; if (b.due[pid] && b.due[pid] < td) { odN++; odSum += v; } });
    let t = '🌙 <b>' + h_(D.shop || 'Kunlik hisobot') + '</b> · ' + fdate_(td) + '\n\n';
    t += '➕ Bugun nasiya: <b>' + sum_(given) + '</b>\n';
    t += '💵 Bugun qaytgan: <b>' + sum_(back) + '</b>\n';
    t += '⏰ Muddati o\'tgan: <b>' + odN + ' kishi</b>' + (odN ? ' (jami ' + sum_(odSum) + ')' : '') + '\n';
    t += '\n📒 Jami nasiya: <b>' + sum_(total) + '</b> (' + n + ' mijoz)';
    if (odN) t += '\n\nErtaga ilovada «Ommaviy eslatma» bilan hammasiga bir yo\'la eslatsangiz bo\'ladi.';
    try { send_(a.tg, t, { reply_markup: { inline_keyboard: [[btnApp_()]] } }); } catch (e) { console.error(e); }
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
  tg_('setMyShortDescription', { short_description: 'Qarz daftari: kim qancha qarzdor — telefon, kompyuter va saytda. oldiberdi.uz' });
  tg_('setMyDescription', { description: '📒 Oldi-Berdi — qarz daftari ilovasi.\n\nKimga qancha berdingiz, kimdan qancha oldingiz — hammasi bir joyda, internetda saqlanadi.\n\n📱 Telefon (Android, iPhone)\n💻 Kompyuter (Windows, Mac)\n🌐 Sayt: oldiberdi.uz\n\nBot orqali Premium olasiz, hisobingizni ko\'rasiz va eslatmalar olasiz.' });
  tg_('setChatMenuButton', { menu_button: { type: 'web_app', text: 'Ilova', web_app: { url: appUrl_() } } });
  const adm = adminTg_();
  if (adm) tg_('setMyCommands', { scope: { type: 'chat', chat_id: Number(adm) }, commands: [{ command: 'admin', description: '🛠 Admin panel' }, { command: 'start', description: 'Boshlash' }, { command: 'stat', description: 'Statistika' }, { command: 'tarif', description: 'Premium narxlari' }, { command: 'holat', description: 'Mening hisobim' }] });
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'kunlik') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('kunlik').timeBased().everyDays(1).atHour(9).create();
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'kechki') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('kechki').timeBased().everyDays(1).atHour(20).create();
  ScriptApp.getProjectTriggers().forEach(function (t) { if (['sogindik', 'oylik'].indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('sogindik').timeBased().everyDays(1).atHour(19).create();
  ScriptApp.newTrigger('oylik').timeBased().everyDays(1).atHour(10).create();
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'avtoSms') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('avtoSms').timeBased().everyDays(1).atHour(10).create();
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
  c.bm = {}; all_('Payments').forEach(function (x) { if (x.status === 'paid' && PLANS[x.tarif] && PLANS[x.tarif].biz) c.bm[x.acc] = (c.bm[x.acc] || 0) + (Number(x.days) || 0); });
  return c;
}
function admRow_(a, c) {
  const p = premium_(a);
  return { id: a.id, name: a.name, phone: a.phone, createdAt: Number(a.createdAt) || 0, tg: !!a.tg, t: tariff_(a), until: p.until || '', bizUntil: p.bizUntil || '', canTrial: !!p.canTrial,
    mode: mode_(a), bizTrial: !!p.bizTrial, lastSeen: a.lastSeen || '', streak: Number(a.streak) || 0, points: Number(a.points) || 0, push: String(a.push) === '1', lv: mode_(a) === 'biz' ? bizLevel_(Math.floor((c.bm && c.bm[a.id] || 0) / 30 + 0.01)) : stdLevel_(Number(a.earned) || 0), people: c.p[a.id] || 0, tx: c.t[a.id] || 0, last: Math.max(c.last[a.id] || 0, Number(a.createdAt) || 0), admin: a.phone === adminPhone_() };
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
    const modes = { std: 0, biz: 0, none: 0 }; acc.forEach(function (a) { modes[mode_(a) || 'none']++; });
    const signDays = {}; acc.forEach(function (a) { const d = dayOf_(a.createdAt); signDays[d] = (signDays[d] || 0) + 1; });
    const signups = []; for (let i = 29; i >= 0; i--) { const d = addDays_(td, -i); signups.push({ d: d, n: signDays[d] || 0 }); }
    const since = function (n) { const d = addDays_(td, -n + 1); return acc.filter(function (a) { return dayOf_(a.createdAt) >= d; }).length; };
    const revM = {}; pay.forEach(function (x) { const m = dayOf_(x.paidAt).slice(0, 7); revM[m] = (revM[m] || 0) + (Number(x.amount) || 0); });
    const rev = []; let ym = td.slice(0, 7);
    for (let i = 0; i < 6; i++) { rev.unshift({ m: ym, s: revM[ym] || 0 }); const y = +ym.slice(0, 4), mo = +ym.slice(5, 7) - 1; ym = mo < 1 ? (y - 1) + '-12' : y + '-' + ('0' + mo).slice(-2); }
    const sum = function (l) { return l.reduce(function (z, x) { return z + (Number(x.amount) || 0); }, 0); };
    const mon = pay.filter(function (x) { return dayOf_(x.paidAt).slice(0, 7) === td.slice(0, 7); });
    const newest = acc.slice().sort(function (x, y) { return (Number(y.createdAt) || 0) - (Number(x.createdAt) || 0); }).slice(0, 5), c = admCounts_();
    return { users: acc.length, tg: acc.filter(function (x) { return x.tg; }).length, tariffs: t, modes: modes, today: since(1), week: since(7), month: since(30),
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
      premiumRaw: String(a.premium || ''), bizRaw: String(a.biz || ''), bizTrialEnd: String(a.bizTrialEnd || ''), trialEnd: String(a.trialEnd || ''), trial: !!p.trial, trialUsed: !!p.trialUsed,
      lists: all_('Lists').filter(function (x) { return x.acc === a.id; }).length, docs: docs,
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
    ['month', 'year', 'biz', 'bizyear'].forEach(function (k) {
      if (r[k] === undefined || r[k] === null || r[k] === '') return;
      const n = Math.round(Number(String(r[k]).replace(/\s/g, '')));
      if (!(n >= 0 && n <= 100000000)) throw new Error("Narx noto'g'ri");
      setMeta_(PLANS[k].key, String(n));
    });
    return { prices: prices_() };
  },
  /* ---------- Avto-SMS (admin) ---------- */
  admSms: function (r) {
    admAuth_(r);
    const td = today_(), t0 = new Date(td + 'T00:00:00').getTime(), acc = {}; all_('Accounts').forEach(function (a) { acc[a.id] = a; });
    const per = {};
    all_('SmsQueue').forEach(function (q) { if ((Number(q.createdAt) || 0) < t0) return; const o = per[q.acc] = per[q.acc] || { sent: 0, failed: 0, queued: 0 }; if (q.status === 'sent' || q.status === 'delivered') o.sent++; else if (q.status === 'failed') o.failed++; else if (q.status === 'queued' || q.status === 'sending') o.queued++; });
    const devs = all_('SmsDevices').filter(function (d) { return d.status === 'active'; }).map(function (d) { const a = acc[d.acc] || {}; const c = a.id ? smsCfg_(a) : {}; return { acc: d.acc, name: a.name || '', phone: a.phone || '', shop: bizDoc_(d.acc).shop || '', model: d.model, sim: d.sim, appVer: d.appVer, lastPing: Number(d.lastPing) || 0, online: smsOnline_(d), auto: !!c.auto, limit: c.limit, today: per[d.acc] || { sent: 0, failed: 0, queued: 0 } }; });
    let tot = { sent: 0, failed: 0, queued: 0 }; Object.keys(per).forEach(function (k) { tot.sent += per[k].sent; tot.failed += per[k].failed; tot.queued += per[k].queued; });
    return { cfg: smsGlobal_(), devices: devs, today: tot };
  },
  admSmsSet: function (r) {
    admAuth_(r);
    const g = smsGlobal_(), o = { off: r.off !== undefined ? !!r.off : g.off, defLimit: r.defLimit !== undefined ? Math.min(150, Math.max(10, Number(r.defLimit) || g.defLimit)) : g.defLimit, gap: r.gap !== undefined ? Math.min(300, Math.max(5, Number(r.gap) || g.gap)) : g.gap };
    setMeta_('sms_cfg', JSON.stringify(o));
    if (o.off && !g.off) all_('SmsQueue').forEach(function (q) { if (q.status === 'sending') { q.status = 'queued'; put_('SmsQueue', q, q._row); } });
    return { cfg: smsGlobal_() };
  },
  /* ---------- So'rovnoma ---------- */
  admSurvey: function (r) {
    admAuth_(r);
    const s = survey_(), rows = all_('Survey').filter(function (x) { return x.sid === s.id; });
    const agg = {};
    SURVEY_Q_.forEach(function (q) {
      if (q.type === 'one' || q.type === 'many') { const c = q.o.map(function () { return 0; }); rows.forEach(function (x) { const v = x.answers && x.answers[q.id]; if (Array.isArray(v)) v.forEach(function (i) { if (c[i] !== undefined) c[i]++; }); else if (v !== undefined && c[v] !== undefined) c[v]++; }); agg[q.id] = c; }
      else if (q.type === 'scale' || q.type === 'nps') { const c = []; for (let i = q.type === 'nps' ? 0 : 1; i <= (q.type === 'nps' ? 10 : 5); i++) c.push(0); rows.forEach(function (x) { const v = x.answers && x.answers[q.id]; if (v !== undefined) c[v - (q.type === 'nps' ? 0 : 1)]++; }); agg[q.id] = c; }
    });
    const nps = rows.map(function (x) { return x.answers && x.answers.q9; }).filter(function (v) { return v !== undefined; });
    const npsScore = nps.length ? Math.round((nps.filter(function (v) { return v >= 9; }).length - nps.filter(function (v) { return v <= 6; }).length) / nps.length * 100) : null;
    const acc = all_('Accounts');
    return { survey: s, q: SURVEY_Q_, agg: agg, n: rows.length, nps: npsScore,
      reach: { all: acc.length, bot: acc.filter(function (a) { return a.tg; }).length, push: acc.filter(function (a) { return String(a.push) === '1'; }).length },
      rows: rows.sort(function (x, y) { return (Number(y.updatedAt) || 0) - (Number(x.updatedAt) || 0); }).slice(0, 300).map(function (x) { return { id: x.id, acc: x.acc, name: x.name, phone: x.phone, mode: x.mode, src: x.src, answers: x.answers, at: Number(x.updatedAt) || Number(x.createdAt) || 0 }; }) };
  },
  admSurveySet: function (r) {
    admAuth_(r);
    const s = survey_();
    if (r.on !== undefined) s.on = !!r.on;
    if (r.restart) { s.id = 's' + Date.now().toString(36); s.on = true; s.opens = 0; s.sent = null; s.startedAt = Date.now(); }
    surveySave_(s);
    return { survey: s };
  },
  /* mijozlarga bot + push orqali havola (javob berganlarga yuborilmaydi) */
  admSurveySend: function (r) {
    admAuth_(r);
    const s = survey_(); if (!s.on) throw new Error("Avval so'rovnomani yoqing");
    const to = String(r.to || 'all'), text = str_(r.text, 600).trim();
    if (!text) throw new Error('Xabar matnini yozing');
    const done = {}; all_('Survey').forEach(function (x) { if (x.sid === s.id) { if (x.acc) done[x.acc] = 1; if (x.phone) done['p' + x.phone] = 1; } });
    let n = 0, skip = 0;
    all_('Accounts').forEach(function (a) {
      if (isAdminChat_(a.tg) || done[a.id] || done['p' + a.phone]) return;
      const m = mode_(a) === 'biz' ? 'biz' : 'std';
      if (to !== 'all' && to !== m) return;
      if (!a.tg && String(a.push) !== '1') return;
      const ok = notify_(a, 'manual', {}, { text: text, force: true, url: 'survey', kb: { inline_keyboard: [[{ text: "📝 So'rovnomani ochish", url: 'https://oldiberdi.uz/?s=1' }]] } });
      if (ok) n++; else skip++;
      Utilities.sleep(40);
    });
    s.sent = { n: (s.sent && s.sent.n || 0) + n, at: Date.now() }; surveySave_(s); nstatFlush_();
    return { n: n, skip: skip, survey: s };
  },
  /* ---------- Sodiqlik bo'limi ---------- */
  admLoyal: function (r) {
    admAuth_(r);
    const td = today_(), acc = all_('Accounts'), pays = all_('Payments');
    const std = [0, 0, 0, 0], biz = [0, 0, 0, 0], inact = [];
    acc.forEach(function (a) {
      if (mode_(a) === 'biz') biz[bizLevel_(bizMonths_(a.id, pays))]++; else std[stdLevel_(Number(a.earned) || 0)]++;
      const d = a.lastSeen ? daysBetween_(a.lastSeen, td) : -1;
      if (d >= 1) inact.push({ id: a.id, name: a.name, phone: a.phone, mode: mode_(a), days: d, lastSeen: a.lastSeen, tg: !!a.tg, push: String(a.push) === '1' });
    });
    inact.sort(function (x, y) { return x.days - y.days; });
    let st = {}; try { st = JSON.parse(meta_('notify_stats') || '{}') || {}; } catch (e) {}
    const from = addDays_(td, -29), agg = {};
    Object.keys(st).forEach(function (day) { if (day < from) return; Object.keys(st[day]).forEach(function (k) { agg[k] = (agg[k] || 0) + st[day][k]; }); });
    let os = null;
    const id = prop_('ONESIGNAL_APP_ID'), key = prop_('ONESIGNAL_API_KEY');
    if (id && key) try {
      const res = UrlFetchApp.fetch('https://api.onesignal.com/notifications?app_id=' + encodeURIComponent(id) + '&limit=50&kind=1', { headers: { Authorization: 'Key ' + key }, muteHttpExceptions: true });
      const j = JSON.parse(res.getContentText() || '{}'); os = { sent: 0, clicked: 0, n: 0 };
      (j.notifications || []).forEach(function (x) { os.n++; os.sent += Number(x.successful) || 0; os.clicked += Number(x.converted) || 0; });
    } catch (e) { os = { err: String(e) }; }
    const kinds = {}; Object.keys(NOTIFY_KINDS_).forEach(function (k) { kinds[k] = { t: NOTIFY_KINDS_[k].t, cat: NOTIFY_KINDS_[k].cat }; });
    return { std: std, biz: biz, inact: inact.slice(0, 400), seenToday: acc.filter(function (a) { return a.lastSeen === td; }).length, total: acc.length,
      pushUsers: acc.filter(function (a) { return String(a.push) === '1'; }).length, tgUsers: acc.filter(function (a) { return a.tg; }).length,
      stats: agg, os: os, pushOn: !!(id && key), cfg: loyalCfg_(), def: LOYAL_DEF_, msgs: msgCfg_(), kinds: kinds };
  },
  admLoyalCfg: function (r) {
    admAuth_(r);
    const o = {}, c = r.cfg || {};
    Object.keys(LOYAL_DEF_).forEach(function (k) { if (c[k] === undefined || c[k] === '') return; const n = Number(c[k]); if (!(n >= 0 && n <= 1000000)) throw new Error("Qiymat noto'g'ri: " + k); o[k] = n; });
    if (o.goldDisc > 90 || o.bizSilverDisc > 90 || o.bizGoldDisc > 90) throw new Error("Chegirma 90% dan oshmasin");
    setMeta_('loyalty_cfg', JSON.stringify(o)); LCFG_MEMO_ = null;
    return { cfg: loyalCfg_() };
  },
  admMsgCfg: function (r) {
    admAuth_(r);
    const k = String(r.key || ''); if (!MSG_DEF_[k]) throw new Error("Xabar turi noto'g'ri");
    let o = {}; try { o = JSON.parse(meta_('notify_cfg') || '{}') || {}; } catch (e) {}
    const c = o[k] || {};
    if (r.on !== undefined) c.on = !!r.on;
    const L = function (v) { return (Array.isArray(v) ? v : []).map(function (x) { return str_(x, 400).trim(); }).filter(Boolean).slice(0, 10); };
    ['std', 'biz'].forEach(function (m) { if (r[m]) { c[m] = c[m] || {}; ['uz', 'ru'].forEach(function (l) { if (r[m][l] !== undefined) c[m][l] = L(r[m][l]); }); } });
    if (r.reset) delete o[k]; else o[k] = c;
    setMeta_('notify_cfg', JSON.stringify(o)); MSGCFG_MEMO_ = null;
    return { msgs: msgCfg_() };
  },
  /* qo'lda yuborish: push + bot. to: std | biz | all | lv:std:N | lv:biz:N | in:N (N va undan ko'p kun kirmagan) */
  admNotify: function (r) {
    admAuth_(r);
    const text = str_(r.text, 600).trim(), to = String(r.to || 'all');
    if (!text) throw new Error('Xabar matnini yozing');
    const td = today_(), pays = all_('Payments');
    let n = 0, skip = 0;
    all_('Accounts').forEach(function (a) {
      if (isAdminChat_(a.tg)) return;
      const m = mode_(a) === 'biz' ? 'biz' : 'std';
      let ok = to === 'all' || to === m;
      if (/^lv:/.test(to)) { const q = to.split(':'); ok = q[1] === m && String(m === 'biz' ? bizLevel_(bizMonths_(a.id, pays)) : stdLevel_(Number(a.earned) || 0)) === q[2]; }
      if (/^in:/.test(to)) { const nn = Number(to.slice(3)); ok = !!a.lastSeen && daysBetween_(a.lastSeen, td) >= nn; }
      if (!ok || (!a.tg && String(a.push) !== '1')) return;
      if (notify_(a, 'manual', {}, { text: text, force: true })) n++; else skip++;
      Utilities.sleep(40);
    });
    nstatFlush_();
    return { n: n, skip: skip };
  },
  admPayments: function (r) {
    admAuth_(r);
    const names = {}; all_('Accounts').forEach(function (a) { names[a.id] = a.name; });
    return { payments: all_('Payments').map(function (x) { const o = clean_(x); o.name = names[x.acc] || ''; return o; }).sort(function (x, y) { return (Number(y.createdAt) || 0) - (Number(x.createdAt) || 0); }).slice(0, 300) };
  }
});
