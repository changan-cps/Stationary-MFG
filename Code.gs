/* ===== Stationery Request & Stock — core logic (shared by Apps Script and the page's demo mode) ===== */
var SR_SCHEMA = {
  Items:    ['code','th','en','cn','unit','cat','priceEx','priceInc','supplier','onHand','min','max','location','active'],
  Requests: ['id','at','empId','name','dept','cc','tel','need','purpose','status','totalInc','note','actionBy','actionAt','issuedAt'],
  ReqLines: ['reqId','code','th','en','unit','qty','priceInc','supplier','issuedQty'],
  Txns:     ['id','at','type','code','th','qty','balance','ref','dept','by','note','priceInc']
};
var SR_PUBLIC = { init:1, submit:1, myRequests:1, cancel:1, checkPin:1 };

function srCore(store) {
  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  function str(v) { return v == null ? '' : String(v).trim(); }
  function now() { return new Date().toISOString(); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function bkk(d) { return new Date(d.getTime() + 7 * 3600 * 1000); }  // Asia/Bangkok, for ids
  function newId(prefix) {
    var d = bkk(new Date());
    return prefix + String(d.getUTCFullYear()).slice(2) + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) + '-' +
      pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds()) + Math.random().toString(36).slice(2, 4).toUpperCase();
  }
  function fail(msg) { throw new Error(msg); }
  function itemMap() { var m = {}; store.all('Items').forEach(function (r) { m[r.code] = r; }); return m; }
  function linesOf(ids) {
    var set = {}; ids.forEach(function (i) { set[i] = []; });
    store.all('ReqLines').forEach(function (l) { if (set[l.reqId]) set[l.reqId].push(clean(l)); });
    return set;
  }
  function clean(r) { var o = {}; for (var k in r) if (k !== '_row') o[k] = r[k]; return o; }
  function withLines(reqs) {
    var L = linesOf(reqs.map(function (r) { return r.id; }));
    return reqs.map(function (r) { var o = clean(r); o.lines = L[r.id] || []; return o; });
  }
  function findReq(id) {
    var r = store.all('Requests').filter(function (x) { return x.id === id; })[0];
    if (!r) fail('ไม่พบคำขอ ' + id);
    return r;
  }
  function addTxn(items, type, code, qty, ref, dept, by, note) {
    var it = items[code]; if (!it) fail('ไม่พบรหัสสินค้า ' + code);
    var bal = num(it.onHand) + qty;
    store.update('Items', it, { onHand: bal });
    it.onHand = bal;
    return { id: newId('T'), at: now(), type: type, code: code, th: it.th || it.en, qty: qty, balance: bal,
             ref: ref || '', dept: dept || '', by: by || '', note: note || '', priceInc: num(it.priceInc) };
  }

  var H = {
    checkPin: function () { return { ok: true }; },

    init: function () {
      var items = store.all('Items').map(function (r) {
        return { code: r.code, onHand: num(r.onHand), min: num(r.min), max: num(r.max), location: str(r.location),
                 active: !(r.active === false || str(r.active).toUpperCase() === 'FALSE'),
                 priceEx: num(r.priceEx), priceInc: num(r.priceInc), th: str(r.th), en: str(r.en), unit: str(r.unit), supplier: str(r.supplier) };
      });
      var depts = {}; store.all('Requests').forEach(function (r) { if (r.dept) depts[r.dept] = 1; });
      return { items: items, depts: Object.keys(depts).sort(), seeded: items.length > 0 };
    },

    submit: function (p) {
      var name = str(p.name), empId = str(p.empId), dept = str(p.dept);
      if (!name || !empId || !dept) fail('กรุณากรอก ชื่อ รหัสพนักงาน และแผนก');
      var items = itemMap(), lines = [], total = 0, id = newId('SR');
      (p.lines || []).forEach(function (l) {
        var it = items[l.code], q = Math.floor(num(l.qty));
        if (!it || q <= 0) return;
        lines.push({ reqId: id, code: it.code, th: it.th, en: it.en, unit: it.unit, qty: q, priceInc: num(it.priceInc), supplier: it.supplier, issuedQty: '' });
        total += q * num(it.priceInc);
      });
      if (!lines.length) fail('ไม่มีรายการสินค้าในคำขอ');
      store.append('Requests', [{ id: id, at: now(), empId: empId, name: name, dept: dept, cc: str(p.cc), tel: str(p.tel), need: str(p.need),
        purpose: str(p.purpose), status: 'pending', totalInc: Math.round(total * 100) / 100, note: '', actionBy: '', actionAt: '', issuedAt: '' }]);
      store.append('ReqLines', lines);
      return { id: id, totalInc: Math.round(total * 100) / 100 };
    },

    myRequests: function (p) {
      var emp = str(p.empId); if (!emp) return { requests: [] };
      var reqs = store.all('Requests').filter(function (r) { return str(r.empId).toLowerCase() === emp.toLowerCase(); });
      reqs.sort(function (a, b) { return String(b.at).localeCompare(String(a.at)); });
      return { requests: withLines(reqs.slice(0, 100)) };
    },

    cancel: function (p) {
      var r = findReq(str(p.id));
      if (str(r.empId).toLowerCase() !== str(p.empId).toLowerCase()) fail('รหัสพนักงานไม่ตรงกับคำขอ');
      if (r.status !== 'pending') fail('ยกเลิกได้เฉพาะคำขอที่รออนุมัติ');
      store.update('Requests', r, { status: 'cancelled', actionAt: now(), actionBy: r.name });
      return { ok: true };
    },

    /* ---------- admin ---------- */
    seed: function (p) {
      if (store.all('Items').length) fail('ชีต Items มีข้อมูลอยู่แล้ว');
      var rows = (p.items || []).map(function (x) {
        return { code: x.code, th: x.th, en: x.en, cn: x.cn, unit: x.unit, cat: x.cat, priceEx: x.ex, priceInc: x.inc, supplier: x.sup,
                 onHand: 0, min: 0, max: 0, location: '', active: true };
      });
      store.append('Items', rows);
      return { count: rows.length };
    },

    requests: function (p) {
      var st = str(p.status), m = str(p.month);
      var reqs = store.all('Requests').filter(function (r) {
        return (!st || r.status === st) && (!m || String(r.at).slice(0, 7) === m);
      });
      reqs.sort(function (a, b) { return String(b.at).localeCompare(String(a.at)); });
      var counts = {}; store.all('Requests').forEach(function (r) { counts[r.status] = (counts[r.status] || 0) + 1; });
      return { requests: withLines(reqs.slice(0, 500)), counts: counts };
    },

    setStatus: function (p) {
      var r = findReq(str(p.id)), s = str(p.status);
      if (['approved', 'rejected', 'pending'].indexOf(s) < 0) fail('สถานะไม่ถูกต้อง');
      if (r.status === 'issued' || r.status === 'cancelled') fail('คำขอนี้ ' + r.status + ' แล้ว เปลี่ยนสถานะไม่ได้');
      store.update('Requests', r, { status: s, note: str(p.note), actionBy: str(p.by), actionAt: now() });
      return { ok: true };
    },

    issue: function (p) {
      var r = findReq(str(p.id));
      if (r.status !== 'approved') fail('จ่ายของได้เฉพาะคำขอที่อนุมัติแล้ว');
      var items = itemMap(), want = {};
      (p.lines || []).forEach(function (l) { want[l.code] = Math.max(0, Math.floor(num(l.qty))); });
      var lines = store.all('ReqLines').filter(function (l) { return l.reqId === r.id; });
      lines.forEach(function (l) {
        var q = want[l.code] != null ? want[l.code] : num(l.qty);
        if (q > num(items[l.code] && items[l.code].onHand)) fail('Stock ไม่พอ: ' + (l.th || l.code) + ' (คงเหลือ ' + num(items[l.code] && items[l.code].onHand) + ')');
      });
      var tx = [];
      lines.forEach(function (l) {
        var q = want[l.code] != null ? want[l.code] : num(l.qty);
        store.update('ReqLines', l, { issuedQty: q });
        if (q > 0) tx.push(addTxn(items, 'OUT', l.code, -q, r.id, r.dept, str(p.by), r.name));
      });
      if (tx.length) store.append('Txns', tx);
      store.update('Requests', r, { status: 'issued', issuedAt: now(), actionBy: str(p.by), actionAt: now(), note: str(p.note) || r.note });
      return { ok: true, txns: tx.length };
    },

    receive: function (p) {
      var items = itemMap(), tx = [];
      (p.lines || []).forEach(function (l) {
        var q = Math.floor(num(l.qty)); if (q <= 0) return;
        tx.push(addTxn(items, 'IN', l.code, q, str(p.ref), '', str(p.by), str(p.note)));
      });
      if (!tx.length) fail('ไม่มีรายการรับเข้า');
      store.append('Txns', tx);
      return { ok: true, txns: tx.length };
    },

    count: function (p) {
      var items = itemMap(), tx = [], ref = newId('CNT');
      (p.counts || []).forEach(function (c) {
        if (c.counted === '' || c.counted == null) return;
        var it = items[c.code]; if (!it) return;
        var sys = num(it.onHand), cnt = Math.floor(num(c.counted)), diff = cnt - sys;
        if (diff !== 0) tx.push(addTxn(items, 'ADJ', c.code, diff, ref, '', str(p.by), 'ตรวจนับ: ระบบ ' + sys + ' → นับได้ ' + cnt));
      });
      if (tx.length) store.append('Txns', tx);
      return { ok: true, ref: ref, adjusted: tx.length };
    },

    setItems: function (p) {
      var items = itemMap(), n = 0;
      (p.changes || []).forEach(function (c) {
        var it = items[c.code]; if (!it) return;
        var patch = {};
        ['min', 'max'].forEach(function (k) { if (c[k] !== undefined && c[k] !== '') patch[k] = Math.max(0, Math.floor(num(c[k]))); });
        if (c.location !== undefined) patch.location = str(c.location);
        if (c.active !== undefined) patch.active = !!c.active;
        store.update('Items', it, patch); n++;
      });
      return { ok: true, updated: n };
    },

    txns: function (p) {
      var from = str(p.from), to = str(p.to), type = str(p.type), code = str(p.code);
      var t = store.all('Txns').filter(function (x) {
        var m = String(x.at).slice(0, 7);
        return (!from || m >= from) && (!to || m <= to) && (!type || x.type === type) && (!code || x.code === code);
      }).map(clean);
      t.sort(function (a, b) { return String(b.at).localeCompare(String(a.at)); });
      return { txns: t.slice(0, 3000) };
    }
  };

  return function handle(action, payload) {
    if (!H[action]) fail('Unknown action: ' + action);
    payload = payload || {};
    if (!SR_PUBLIC[action] || action === 'checkPin') {
      if (str(payload.pin) !== String(store.pin())) fail('PIN ไม่ถูกต้อง');
    }
    return H[action](payload);
  };
}

/* ===== Google Apps Script wrapper ===== */
var SR_READ_ONLY = { init: 1, myRequests: 1, requests: 1, txns: 1, checkPin: 1 };

/* หา Google Sheet ที่ใช้เก็บข้อมูล:
   1) ถ้าสคริปต์สร้างจากในชีต (ส่วนขยาย → Apps Script) ใช้ชีตนั้น
   2) ถ้ามี Script Property ชื่อ SHEET_ID ใช้ชีตตาม ID นั้น
   3) ถ้าไม่มีทั้งสองอย่าง สร้างชีตใหม่ชื่อ "Stationery Stock" ใน Drive แล้วจำ ID ไว้ */
function srSpreadsheet() {
  var ss = null;
  try { ss = SpreadsheetApp.getActiveSpreadsheet(); } catch (e) {}
  if (ss) return ss;
  var props = PropertiesService.getScriptProperties(), id = props.getProperty('SHEET_ID');
  if (id) return SpreadsheetApp.openById(id.trim());
  ss = SpreadsheetApp.create('Stationery Stock');
  props.setProperty('SHEET_ID', ss.getId());
  return ss;
}

function SheetStore() {
  var ss = srSpreadsheet();
  var cache = {};
  function sheet(name) {
    var sh = ss.getSheetByName(name);
    if (!sh) {
      sh = ss.insertSheet(name);
      var h = SR_SCHEMA[name];
      sh.getRange(1, 1, 1, h.length).setValues([h]).setFontWeight('bold').setBackground('#0b3d91').setFontColor('#ffffff');
      sh.getRange(1, 1, sh.getMaxRows(), h.length).setNumberFormat('@');
      sh.setFrozenRows(1);
    }
    return sh;
  }
  function headers(name) { return SR_SCHEMA[name]; }
  return {
    all: function (name) {
      if (cache[name]) return cache[name];
      var sh = sheet(name), h = headers(name), last = sh.getLastRow(), out = [];
      if (last > 1) {
        var vals = sh.getRange(2, 1, last - 1, h.length).getDisplayValues();
        for (var i = 0; i < vals.length; i++) {
          if (vals[i].join('') === '') continue;
          var o = { _row: i + 2 };
          for (var j = 0; j < h.length; j++) o[h[j]] = vals[i][j];
          out.push(o);
        }
      }
      cache[name] = out;
      return out;
    },
    append: function (name, rows) {
      if (!rows.length) return;
      var sh = sheet(name), h = headers(name), start = sh.getLastRow() + 1;
      var vals = rows.map(function (r) { return h.map(function (k) { return r[k] == null ? '' : String(r[k]); }); });
      var rg = sh.getRange(start, 1, vals.length, h.length);
      rg.setNumberFormat('@');
      rg.setValues(vals);
      if (cache[name]) rows.forEach(function (r, i) { var o = { _row: start + i }; h.forEach(function (k) { o[k] = r[k] == null ? '' : String(r[k]); }); cache[name].push(o); });
    },
    update: function (name, obj, patch) {
      var sh = sheet(name), h = headers(name);
      for (var k in patch) {
        var c = h.indexOf(k); if (c < 0) continue;
        var cell = sh.getRange(obj._row, c + 1);
        cell.setNumberFormat('@');
        cell.setValue(patch[k] == null ? '' : String(patch[k]));
        obj[k] = patch[k];
      }
    },
    pin: function () { return PropertiesService.getScriptProperties().getProperty('ADMIN_PIN') || '1234'; }
  };
}

function srRun(body) {
  var lock = null;
  try {
    var req = JSON.parse(body || '{}');
    if (!SR_READ_ONLY[req.action]) { lock = LockService.getScriptLock(); lock.waitLock(20000); }
    var data = srCore(SheetStore())(req.action, req.payload);
    return { ok: true, data: data };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  } finally {
    if (lock) try { lock.releaseLock(); } catch (x) {}
  }
}
function srJson(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function doPost(e) { return srJson(srRun(e && e.postData && e.postData.contents)); }
function doGet(e) {
  if (e && e.parameter && e.parameter.q) return srJson(srRun(e.parameter.q));
  return srJson({ ok: true, data: { service: 'Stationery Request & Stock API', time: new Date().toISOString() } });
}

/** Run once from the editor: creates the 4 sheets with headers. */
function setupSheets() {
  var st = SheetStore(), ss = srSpreadsheet();
  Object.keys(SR_SCHEMA).forEach(function (n) { st.all(n); });
  ['Sheet1', 'แผ่น1', 'ชีต1'].forEach(function (nm) {
    var def = ss.getSheetByName(nm);
    if (def && def.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(def);
  });
  Logger.log('Google Sheet ที่ใช้เก็บข้อมูล: ' + ss.getUrl());
}
