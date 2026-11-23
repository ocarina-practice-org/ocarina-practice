/* 陶笛回家練習｜老師後台資料（admin-data.js，全域 OPAdmin）
   老師用 Firebase 的 Email／密碼登入（帳號必須等於 firebase-config.js 的 adminEmail），
   讀寫所有學生、任務、設定、練習紀錄；輸出的資料形狀給 admin.html 直接用。 */
(function (g) {
'use strict';
var OPC = g.OPC, S = g.OPStudent;
function E(msg, code) { var e = new Error(msg); e.code = code || 'other'; return e; }
function nowIso() { return new Date().toISOString(); }
function rid(p) { return p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function tsStr(v) {
  var d = v && v.toDate ? v.toDate() : new Date(v || 0);
  if (isNaN(d)) return '';
  return new Date(d.getTime() + 8 * 3600e3).toISOString().replace('T', ' ').slice(0, 16);
}
function mapErr(e) {
  var c = (e && e.code) || '';
  if (c === 'auth/invalid-credential' || c === 'auth/user-not-found' || c === 'auth/wrong-password' || c === 'auth/invalid-login-credentials') return E('Email 或密碼不對');
  if (c === 'auth/too-many-requests') return E('試太多次了，請稍後再試');
  if (c === 'auth/network-request-failed') return E('連不上網路，請檢查網路再試一次');
  if (c === 'auth/operation-not-allowed' || c === 'auth/configuration-not-found') return E('Firebase 還沒啟用「電子郵件／密碼」登入（見設定說明）');
  if (c === 'auth/invalid-email') return E('Email 格式不對');
  if (c === 'permission-denied' || c === 'firestore/permission-denied') return E('沒有權限（請確認 firestore.rules 已發佈，且管理者 email 一致）');
  return e && e.message ? e : E('發生錯誤');
}
function wrap(p) { return Promise.resolve(p).catch(function (e) { throw mapErr(e); }); }

function make(svc) {
  var sdk = svc.sdk, auth = svc.auth, db = svc.db, D = null;

  function col(n) { return sdk.collection(db, n); }
  function all(n, q) {
    return sdk.getDocs(q || col(n)).then(function (s) { var a = []; s.forEach(function (d) { var x = d.data(); x.id = d.id; a.push(x); }); return a; });
  }
  function adminEmails() {
    var c = g.OP_FIREBASE || {};
    var list = Array.isArray(c.adminEmails) ? c.adminEmails.slice() : [];
    if (c.adminEmail) list.push(c.adminEmail);
    return list.map(function (e) { return String(e || '').trim().toLowerCase(); }).filter(Boolean);
  }
  function isAdminEmail(email) { return adminEmails().indexOf(String(email || '').toLowerCase()) !== -1; }

  function groupsOf(students) {
    var m = {}; students.forEach(function (s) { if (s.group) m[s.group] = 1; });
    return Object.keys(m).sort(function (a, b) { return a.localeCompare(b, 'zh-Hant'); });
  }

  function load() {
    return Promise.all([all('students'), all('tasks'), all('logs'), all('adj'), sdk.getDoc(sdk.doc(db, 'settings', 'config')), sdk.getDoc(sdk.doc(db, 'pub', 'groups'))]).then(function (r) {
      var students = r[0], tasks = r[1], logs = r[2], adjs = r[3];
      var settings = OPC.cleanSettings(r[4].exists() ? r[4].data() : {});
      var today = OPC.todayDay(), ws = OPC.weekStartDay(today);
      var lg = {}, aj = {};
      logs.forEach(function (l) { (lg[l.sid] = lg[l.sid] || []).push({ task: l.task, day: Number(l.day), pct: Number(l.pct) || 100 }); });
      adjs.forEach(function (a) { (aj[a.sid] = aj[a.sid] || []).push({ delta: Number(a.delta) || 0 }); });
      var progress = {}, best = {}, elig = {}, done = {};
      tasks.forEach(function (t) { progress[t.id] = {}; best[t.id] = {}; elig[t.id] = 0; done[t.id] = 0; });
      var outStudents = students.map(function (s) {
        var c = OPC.compute(s.group, tasks, lg[s.id] || [], aj[s.id] || [], today);
        c.visible.forEach(function (t) {
          var p = c.per[t.id]; elig[t.id]++; progress[t.id][s.id] = p.count; if (p.bestPct) best[t.id][s.id] = p.bestPct; if (p.done) done[t.id]++;
        });
        return { id: s.id, name: s.name, group: s.group, points: c.points, level: c.level, total: c.total, week: c.week,
                 lastPractice: c.lastDay ? OPC.dayToDate(c.lastDay) : '', createdAt: String(s.created || '').slice(0, 10),
                 claimed: !!s.uid };
      });
      var outTasks = tasks.map(function (t) {
        return { id: t.id, title: t.title, note: t.note || '', group: t.group, target: t.target, points: t.points,
                 notes: OPC.notesStr(OPC.safeNotes(t.notes)), bpm: Number(t.bpm) || 0, startDate: t.startDate, endDate: t.endDate,
                 song: t.song || '', from: Number(t.from) || 0, to: Number(t.to) || 0,
                 eligible: elig[t.id], done: done[t.id], progress: progress[t.id], best: best[t.id] };
      }).sort(function (a, b) { return a.startDate < b.startDate ? 1 : a.startDate > b.startDate ? -1 : 0; });
      var names = {}, titles = {};
      students.forEach(function (s) { names[s.id] = s.name + '（' + s.group + '）'; });
      tasks.forEach(function (t) { titles[t.id] = t.title; });
      var outLogs = logs.slice().sort(function (a, b) {
        var x = (a.ts && a.ts.toMillis ? a.ts.toMillis() : +new Date(a.ts || 0)), y = (b.ts && b.ts.toMillis ? b.ts.toMillis() : +new Date(b.ts || 0));
        return y - x;
      }).slice(0, 200).map(function (l) {
        return { time: tsStr(l.ts), student: names[l.sid] || '（已刪除）', task: titles[l.task] || '（已刪除的任務）', delta: 1, pct: Number(l.pct) || 100 };
      });
      var groups = groupsOf(students);
      var stored = r[5].exists() && Array.isArray(r[5].data().groups) ? r[5].data().groups : null;
      var sync = (!stored || stored.join('|') !== groups.join('|'))
        ? sdk.setDoc(sdk.doc(db, 'pub', 'groups'), { groups: groups }).catch(function () {}) : Promise.resolve();
      return sync.then(function () {
        D = { today: OPC.dayToDate(today), weekStart: OPC.dayToDate(ws), weekEnd: OPC.dayToDate(ws + 6), groups: groups,
              students: outStudents, tasks: outTasks, settings: settings, defaults: OPC.DEFAULTS, ranges: OPC.RANGES, labels: OPC.LABELS, logs: outLogs };
        return D;
      });
    });
  }

  function bumpGen(key) {
    return sdk.getDoc(sdk.doc(db, 'gens', key)).then(function (s) {
      var n = (s.exists() && s.data().g > 0 ? s.data().g | 0 : 0) + 1;
      return sdk.setDoc(sdk.doc(db, 'gens', key), { g: n });
    });
  }
  function delWhere(name, field, val) {
    return all(name, sdk.query(col(name), sdk.where(field, '==', val))).then(function (a) {
      return a.reduce(function (p, x) { return p.then(function () { return sdk.deleteDoc(sdk.doc(db, name, x.id)); }); }, Promise.resolve());
    });
  }
  function cleanG(s) { return String(s || '').replace(/\s+/g, '').trim(); }

  return {
    signIn: function (email, pw) {
      email = String(email || '').trim();
      if (!email || !pw) return Promise.reject(E('請輸入 Email 和密碼'));
      return wrap(sdk.signInWithEmailAndPassword(auth, email, pw)).then(function (c) {
        if (!isAdminEmail(c.user.email)) {
          return sdk.signOut(auth).then(function () { throw E('這個帳號不是管理者'); });
        }
        return c.user;
      });
    },
    signOut: function () { return sdk.signOut(auth); },
    current: function () {
      return new Promise(function (res) {
        var done = false, off = null;
        function fin(v) { if (done) return; done = true; try { off && off(); } catch (e) {} res(v); }
        off = sdk.onAuthStateChanged(auth, function (u) { fin(u && isAdminEmail(u.email) ? u : null); });
        if (done) { try { off && off(); } catch (e) {} }
      });
    },
    load: function () { return wrap(load()); },

    saveTask: function (t) {
      var c = OPC.cleanTask(t), id = t.id || rid('t');
      var d = { title: c.title, note: c.note, group: c.group, target: c.target, points: c.points, startDate: c.startDate, endDate: c.endDate, notes: c.notes, bpm: c.bpm, song: c.song, from: c.from, to: c.to };
      if (!t.id) d.created = nowIso();
      return wrap(t.id ? sdk.updateDoc(sdk.doc(db, 'tasks', id), d) : sdk.setDoc(sdk.doc(db, 'tasks', id), d)).then(function () { return id; });
    },
    deleteTask: function (id) { return wrap(sdk.deleteDoc(sdk.doc(db, 'tasks', id))); },

    saveSettings: function (o) {
      var out = {};
      Object.keys(OPC.DEFAULTS).forEach(function (k) {
        var v = Number(o[k]), r = OPC.RANGES[k];
        if (o[k] === undefined || o[k] === '' || isNaN(v) || v < r[0] || v > r[1]) throw E(OPC.LABELS[k] + ' 請填 ' + r[0] + '～' + r[1] + ' 之間的數字');
        out[k] = v;
      });
      ['speed1', 'speed2', 'speed3'].forEach(function (k) { out[k] = Math.round(out[k]); });
      return wrap(sdk.setDoc(sdk.doc(db, 'settings', 'config'), out)).then(function () { return out; });
    },

    /* 重設密碼：世代 +1、清空 uid；學生用同樣的姓名＋分部重新建立帳號（設新密碼），進度保留 */
    resetPassword: function (id) {
      return wrap(bumpGen(id).then(function () { return sdk.updateDoc(sdk.doc(db, 'students', id), { uid: null }); }));
    },
    deleteStudent: function (id) {
      return wrap(delWhere('logs', 'sid', id).then(function () { return delWhere('adj', 'sid', id); })
        .then(function () { return delWhere('alias', 'key', id); })
        .then(function () { return sdk.deleteDoc(sdk.doc(db, 'students', id)); })
        .then(function () { return bumpGen(id); }));
    },
    adjustPoints: function (id, delta, reason) {
      delta = Math.round(Number(delta));
      if (!delta || Math.abs(delta) > 1000) return Promise.reject(E('請填 -1000～1000 之間、不是 0 的整數'));
      return wrap(sdk.setDoc(sdk.doc(db, 'adj', rid('a')), { sid: id, delta: delta, reason: String(reason || '').slice(0, 40), ts: sdk.serverTimestamp() }));
    },

    /* 分部合併／改名：學生的分部欄位和任務都改成新名稱，並寫別名，所以學生用新或舊的分部名稱都登入得進去 */
    renameGroup: function (from, to) {
      from = cleanG(from); to = cleanG(to);
      if (!from || !to) return Promise.reject(E('請填原本的分部和新的分部'));
      if (to === '全部' || to.length > 20 || /[<>&"'\/\\]/.test(to)) return Promise.reject(E('新的分部名稱不正確'));
      if (from === to) return Promise.reject(E('新舊名稱一樣'));
      return wrap(Promise.all([all('students'), all('tasks')]).then(function (r) {
        var mine = r[0].filter(function (s) { return s.group === from; });
        if (!mine.length && !r[1].some(function (t) { return t.group === from; })) throw E('找不到分部「' + from + '」');
        var taken = {};
        r[0].forEach(function (s) { if (s.group === to) taken[S.clean(s.name).toLowerCase()] = 1; });
        var dup = mine.filter(function (s) { return taken[S.clean(s.name).toLowerCase()]; });
        if (dup.length) throw E('「' + to + '」已經有同名的學生：' + dup.map(function (s) { return s.name; }).join('、') + '。請先處理（刪除其中一位）再合併');
        var p = Promise.resolve();
        mine.forEach(function (s) {
          p = p.then(function () { return S.keyOf(s.name, to); }).then(function (k) {
            return sdk.updateDoc(sdk.doc(db, 'students', s.id), { group: to }).then(function () {
              return k === s.id ? null : sdk.setDoc(sdk.doc(db, 'alias', k), { key: s.id });
            });
          });
        });
        r[1].filter(function (t) { return t.group === from; }).forEach(function (t) {
          p = p.then(function () { return sdk.updateDoc(sdk.doc(db, 'tasks', t.id), { group: to }); });
        });
        return p.then(function () { return { moved: mine.length }; });
      }));
    }
  };
}
g.OPAdmin = { make: make };
})(window);
