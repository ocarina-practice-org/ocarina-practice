/* 測試用的假 Firebase（存在 localStorage，跨頁面共用），並照 firestore.rules 的邏輯做簡易權限檢查。只給測試用，不要放到網站上。 */
(function (g) {
var AD = 'a0929870116@gmail.com', DOM = '@op-students.example.com';
function load() { try { return JSON.parse(localStorage.getItem('fb_db') || '{}'); } catch (e) { return {}; } }
function save(d) { localStorage.setItem('fb_db', JSON.stringify(d)); }
function users() { try { return JSON.parse(localStorage.getItem('fb_users') || '{}'); } catch (e) { return {}; } }
function cur() { try { return JSON.parse(sessionStorage.getItem('fb_cur') || 'null'); } catch (e) { return null; } }
function err(code) { var e = new Error(code); e.code = code; return e; }
var DENY = () => err('permission-denied');
function dayNow() { return Math.floor((Date.now() + 28800000) / 86400000); }
function keyOfEmail(e) { return e.split('@')[0].split('-')[0]; }
function isStu(u) { return u && u.email.endsWith(DOM); }
function ex(db, col, id) { return db[col] && db[col][id] !== undefined; }

/* op: get | list | create | update | delete */
function allowed(op, col, id, user, db, old, nu, listFilter) {
  var admin = user && user.email === AD;
  if (admin) return true;
  var read = op === 'get' || op === 'list';
  if (col === 'gens' || col === 'alias' || col === 'pub') return op === 'get';
  if (!user) return false;
  var key = isStu(user) ? keyOfEmail(user.email) : null;
  if (col === 'students') {
    if (op === 'get') return !!old && (old.uid || null) === user.uid;
    if (!isStu(user) || id !== key) return false;
    if (op === 'create') {
      var ks = Object.keys(nu).sort().join(',');
      return ks === 'ack,created,group,name,uid' && nu.uid === user.uid && nu.ack === true && typeof nu.name === 'string' && nu.name.length >= 1 && nu.name.length <= 16
        && typeof nu.group === 'string' && nu.group.length >= 1 && nu.group.length <= 20 && nu.group !== '全部';
    }
    if (op === 'update') {
      if ((old.uid || null) !== null) return false;
      if (nu.uid !== user.uid || nu.ack !== true) return false;
      return Object.keys(nu).every(function (k) { return JSON.stringify(nu[k]) === JSON.stringify(old[k]) || k === 'uid' || k === 'ack'; });
    }
    return false;
  }
  if (col === 'tasks') return isStu(user) && read;
  if (col === 'settings') return read && op === 'get';
  if (col === 'logs' || col === 'adj') {
    if (!isStu(user)) return false;
    if (read) return op === 'list' ? (listFilter && listFilter.sid === key) : (old && old.sid === key);
    if (col === 'adj' || op !== 'create') return false;
    var ks2 = Object.keys(nu).sort().join(',');
    var me = db.students && db.students[key];
    return ks2 === 'day,k,pct,sid,task,ts' && nu.sid === key && typeof nu.task === 'string' && nu.task.length >= 1 && nu.task.length <= 40
      && Number.isInteger(nu.day) && nu.day === dayNow() && Number.isInteger(nu.k) && nu.k >= 1 && nu.k <= 5 && Number.isInteger(nu.pct) && nu.pct >= 30 && nu.pct <= 100
      && nu.ts === 'SERVERTS' && id === key + '_' + nu.task + '_' + nu.day + '_' + nu.k && ex(db, 'tasks', nu.task) && !!me && me.uid === user.uid;
  }
  return false;
}

var sdk = {
  doc: function (db, col, id) { return { col: col, id: id }; },
  collection: function (db, col) { return { col: col, wheres: [] }; },
  where: function (f, op, v) { return { f: f, v: v }; },
  query: function (c) { return { col: c.col, wheres: [].slice.call(arguments, 1) }; },
  serverTimestamp: function () { return { __ts: 1 }; },
  getDoc: function (ref) {
    var db = load(), old = ex(db, ref.col, ref.id) ? db[ref.col][ref.id] : null;
    if (!allowed('get', ref.col, ref.id, cur(), db, old, null)) return Promise.reject(DENY());
    return Promise.resolve({ id: ref.id, exists: () => !!old, data: () => old && JSON.parse(JSON.stringify(old)) });
  },
  getDocs: function (q) {
    var db = load(), c = db[q.col] || {}, user = cur(), filt = {};
    (q.wheres || []).forEach(function (w) { filt[w.f] = w.v; });
    if (!allowed('list', q.col, null, user, db, null, null, filt)) return Promise.reject(DENY());
    var docs = Object.keys(c).filter(function (id) { return Object.keys(filt).every(function (f) { return c[id][f] === filt[f]; }); })
      .map(function (id) { return { id: id, data: () => JSON.parse(JSON.stringify(c[id])) }; });
    return Promise.resolve({ size: docs.length, docs: docs, forEach: function (f) { docs.forEach(f); } });
  },
  setDoc: function (ref, data) {
    var db = load(), old = ex(db, ref.col, ref.id) ? db[ref.col][ref.id] : null, nu = JSON.parse(JSON.stringify(data, function (k, v) { return v && v.__ts ? 'SERVERTS' : v; }));
    var user = cur(), ok;
    if (old) ok = allowed('update', ref.col, ref.id, user, db, old, nu);
    else ok = allowed('create', ref.col, ref.id, user, db, null, nu);
    if (!ok) return Promise.reject(DENY());
    (db[ref.col] = db[ref.col] || {})[ref.id] = JSON.parse(JSON.stringify(nu, function (k, v) { return v === 'SERVERTS' ? new Date().toISOString() : v; }));
    save(db); return Promise.resolve();
  },
  updateDoc: function (ref, patch) {
    var db = load();
    if (!ex(db, ref.col, ref.id)) return Promise.reject(err('not-found'));
    var old = db[ref.col][ref.id], nu = Object.assign({}, old, JSON.parse(JSON.stringify(patch)));
    if (!allowed('update', ref.col, ref.id, cur(), db, old, nu)) return Promise.reject(DENY());
    db[ref.col][ref.id] = nu; save(db); return Promise.resolve();
  },
  deleteDoc: function (ref) {
    var db = load();
    if (!allowed('delete', ref.col, ref.id, cur(), db, db[ref.col] && db[ref.col][ref.id], null)) return Promise.reject(DENY());
    if (db[ref.col]) delete db[ref.col][ref.id]; save(db); return Promise.resolve();
  },
  createUserWithEmailAndPassword: function (a, email, pw) {
    var u = users(); if (u[email]) return Promise.reject(err('auth/email-already-in-use'));
    if (String(pw).length < 6) return Promise.reject(err('auth/weak-password'));
    var rec = { uid: 'u' + Math.random().toString(36).slice(2, 10), pw: pw }; u[email] = rec; localStorage.setItem('fb_users', JSON.stringify(u));
    sessionStorage.setItem('fb_cur', JSON.stringify({ uid: rec.uid, email: email })); return Promise.resolve({ user: { uid: rec.uid, email: email } });
  },
  signInWithEmailAndPassword: function (a, email, pw) {
    var r = users()[email]; if (!r || r.pw !== pw) return Promise.reject(err('auth/invalid-credential'));
    sessionStorage.setItem('fb_cur', JSON.stringify({ uid: r.uid, email: email })); return Promise.resolve({ user: { uid: r.uid, email: email } });
  },
  signOut: function () { sessionStorage.removeItem('fb_cur'); return Promise.resolve(); },
  deleteUser: function (u) { var us = users(); delete us[u.email]; localStorage.setItem('fb_users', JSON.stringify(us)); sessionStorage.removeItem('fb_cur'); return Promise.resolve(); },
  onAuthStateChanged: function (a, cb) { var u = cur(); setTimeout(function () { cb(u); }, 0); return function () {}; }
};
g.OP_FAKE = { sdk: sdk, auth: {}, db: {} };
g.OP_FAKE_SEED_ADMIN = function () { var u = users(); if (!u[AD]) { u[AD] = { uid: 'admin1', pw: 'teacher123' }; localStorage.setItem('fb_users', JSON.stringify(u)); } };
})(window);
