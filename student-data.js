/* 陶笛回家練習｜學生資料（student-data.js，全域 OPStudentData）
   從 Firestore 讀任務、設定、自己的練習紀錄、老師加減分，組成學生頁要的資料；過關時寫入一筆練習紀錄。
   積分和等級不存在資料庫，一律由 core.js 的 OPC.compute 算出。 */
(function (g) {
'use strict';
var OPC = g.OPC;
function E(msg, code) { var e = new Error(msg); e.code = code || 'other'; return e; }
function isDenied(e) { return !!e && (e.code === 'permission-denied' || e.code === 'firestore/permission-denied'); }
function dateOf(s) { return String(s || ''); }

function make(svc, who) {
  var sdk = svc.sdk, db = svc.db, C = null;     // C：快取 {tasks, settings, logs, adjs}

  function load() {
    return Promise.all([
      sdk.getDocs(sdk.collection(db, 'tasks')),
      sdk.getDoc(sdk.doc(db, 'settings', 'config')).catch(function () { return null; }),
      sdk.getDocs(sdk.query(sdk.collection(db, 'logs'), sdk.where('sid', '==', who.sid))),
      sdk.getDocs(sdk.query(sdk.collection(db, 'adj'), sdk.where('sid', '==', who.sid)))
    ]).then(function (r) {
      var tasks = [], logs = [], adjs = [];
      r[0].forEach(function (d) { var x = d.data(); x.id = d.id; tasks.push(x); });
      r[2].forEach(function (d) { var x = d.data(); logs.push({ task: x.task, day: Number(x.day), k: Number(x.k), pct: Number(x.pct) || 100 }); });
      r[3].forEach(function (d) { adjs.push({ delta: Number(d.data().delta) || 0 }); });
      C = { tasks: tasks, settings: OPC.cleanSettings(r[1] && r[1].exists() ? r[1].data() : {}), logs: logs, adjs: adjs };
    }, function (e) { throw E(isDenied(e) ? '請重新登入' : '連不上資料庫，請檢查網路再試一次', isDenied(e) ? 'denied' : 'net'); });
  }

  function build() {
    var today = OPC.todayDay(), st = C.settings;
    var comp = OPC.compute(who.group, C.tasks, C.logs, C.adjs, today);
    var tasks = comp.visible.filter(function (t) {
      return OPC.dateToDay(t.startDate) <= today && OPC.dateToDay(t.endDate) >= today - 14;
    }).sort(function (a, b) { return a.startDate < b.startDate ? 1 : a.startDate > b.startDate ? -1 : 0; }).map(function (t) {
      var p = comp.per[t.id];
      return { id: t.id, title: t.title, note: t.note || '', target: t.target, points: t.points,
               notes: OPC.safeNotes(t.notes), bpm: Number(t.bpm) || 0, bestPct: p.bestPct,
               song: t.song || '', from: Number(t.from) || 0, to: Number(t.to) || 0,
               startDate: dateOf(t.startDate), endDate: dateOf(t.endDate),
               status: OPC.dateToDay(t.endDate) >= today ? 'current' : 'past',
               count: Math.min(p.count, t.target), done: p.done, todayCount: p.todayCount };
    });
    return { id: who.sid, name: who.name, group: who.group, points: comp.points, level: comp.level, tasks: tasks,
             dailyCap: OPC.DAILY_CAP, today: OPC.dayToDate(today), settings: st, speeds: OPC.speeds(st) };
  }

  function writeLog(taskId, pct, retry) {
    var today = OPC.todayDay(), k = 0;
    C.logs.forEach(function (l) { if (l.task === taskId && l.day === today && l.k > k) k = l.k; });
    k++;
    if (k > OPC.DAILY_CAP) return Promise.reject(E('今天這個任務記滿囉，明天再來'));
    var id = who.sid + '_' + taskId + '_' + today + '_' + k;
    var d = { sid: who.sid, task: taskId, day: today, k: k, pct: pct, ts: sdk.serverTimestamp() };
    return sdk.setDoc(sdk.doc(db, 'logs', id), d).then(function () {
      C.logs.push({ task: taskId, day: today, k: k, pct: pct });
    }, function (e) {
      if (isDenied(e) && !retry) return load().then(function () { return writeLog(taskId, pct, true); });   // 可能別台裝置剛記過：重讀後再試一次
      throw E(isDenied(e) ? '這次沒有記到（今天可能記滿了，或任務已結束）' : '連不上資料庫，請再試一次', 'other');
    });
  }

  return {
    me: function () { return load().then(build); },
    practice: function (taskId, pct) {
      pct = Math.round(Number(pct));
      var run = C ? Promise.resolve() : load();
      return run.then(function () {
        var task = C.tasks.filter(function (t) { return t.id === taskId; })[0], today = OPC.todayDay();
        if (!task) throw E('找不到這個任務，請重新整理');
        if (OPC.dateToDay(task.startDate) > today || OPC.dateToDay(task.endDate) < today) throw E('這個任務不在進行中');
        if (task.group !== '全部' && task.group !== who.group) throw E('這個任務不是派給你的分部');
        if (OPC.speeds(C.settings).indexOf(pct) < 0 && !(Number(task.bpm) === 0 && pct === 100)) throw E('速度不正確，請重新整理');
        var before = build(), bt = before.tasks.filter(function (t) { return t.id === taskId; })[0];
        return writeLog(taskId, pct).then(function () {
          var me = build(), at = me.tasks.filter(function (t) { return t.id === taskId; })[0];
          return { me: me, awarded: at && at.done && !(bt && bt.done) ? at.points : 0,
                   leveledUp: me.level.index > before.level.index };
        });
      });
    },
    groups: function () {
      return sdk.getDoc(sdk.doc(db, 'pub', 'groups')).then(function (s) { return s.exists() && Array.isArray(s.data().groups) ? s.data().groups : []; }, function () { return []; });
    }
  };
}
g.OPStudentData = { make: make };
})(window);
