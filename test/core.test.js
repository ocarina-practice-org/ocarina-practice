const fs = require('fs'), vm = require('vm');
const ctx = { console, Date, Math, TextEncoder, Promise }; ctx.window = ctx; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(__dirname + '/../core.js', 'utf8'), ctx);
const O = ctx.OPC; let f = 0; const ok = (c, m) => { if (!c) { f++; console.log('✗ FAIL', m); } else console.log('✓', m); };
ok(JSON.stringify(O.parseNotes("1 2' 0 5:2").map(x => x.n + ':' + x.b)) === '["1:1","9:1","0:1","5:2"]', '音符解析');
ok(O.notesStr(O.parseNotes("1  3,5 高1")) === "1 3 5 1'", '音符正規化');
['', '0 0', '1 x', '1:9', Array(70).fill('1').join(' ')].forEach(s => { let t = ''; try { O.parseNotes(s); } catch (e) { t = e.message; } ok(s === '' ? t === '' : !!t, '壞輸入：' + s.slice(0, 12)); });
ok(O.speeds({ speed1: 100, speed2: 90, speed3: 80 }).join() === '80,90,100', '速度階段由小到大');
ok(O.speeds({ speed1: 100, speed2: 100, speed3: 80 }).length === 2, '重複的速度合併');
ok(O.cleanSettings({ tol: 5, holdMs: 'x' }).tol === 75 && O.cleanSettings({ tol: 60 }).tol === 60, '設定超出範圍用預設');
ok(O.level(0).index === 1 && O.level(19).index === 1 && O.level(20).index === 2 && O.level(500).nextMin === null, '等級門檻');
const d = O.dateToDay('2026-11-23'); ok(O.dayToDate(d) === '2026-11-23', '日期互轉'); ok(O.dayToDate(O.weekStartDay(d + 3)) === '2026-11-23', '週一為週起點'); ok(O.dayToDate(O.weekStartDay(d + 6)) === '2026-11-23', '週日屬於同一週');
const tasks = [{ id: 'a', group: '全部', target: 2, points: 10, startDate: '2026-11-23', endDate: '2026-11-29' }, { id: 'b', group: '鳳山', target: 1, points: 5, startDate: '2026-11-23', endDate: '2026-11-29' }];
let c = O.compute('三民', tasks, [{ task: 'a', day: d, pct: 100 }, { task: 'a', day: d, pct: 90 }, { task: 'b', day: d }], [{ delta: 3 }], d);
ok(c.points === 13 && c.total === 2 && c.week === 2 && c.per.a.done && c.per.a.bestPct === 100, '積分：只算看得到的任務＋手動加分');
c = O.compute('鳳山', tasks, [{ task: 'a', day: d - 1, pct: 100 }, { task: 'a', day: d + 30, pct: 100 }], [{ delta: -50 }], d);
ok(c.points === 0 && c.per.a.count === 0, '期間外的紀錄不算；積分不會低於 0');
let e = ''; try { O.cleanTask({ title: 'x', target: 1, points: 1, startDate: '2026-11-29', endDate: '2026-11-23', notes: '', bpm: '' }); } catch (x) { e = x.message; } ok(/結束日/.test(e), '結束日早於開始日被擋');
e = ''; try { O.cleanTask({ title: 'x', target: 1, points: 1, startDate: '2026-11-23', endDate: '2026-11-29', notes: '', bpm: '70' }); } catch (x) { e = x.message; } ok(/音符/.test(e), '有 BPM 沒音符被擋');
// 學生登入鑰匙
const crypto = require('crypto').webcrypto; ctx.crypto = crypto; ctx.window = ctx; ctx.btoa = btoa; ctx.import = null;
vm.runInContext(fs.readFileSync(__dirname + '/../student-auth.js', 'utf8').replace('})(window);', '})(this);'), ctx);
(async () => {
  const S = ctx.OPStudent;
  const k1 = await S.keyOf('王小明', '鳳山分校'), k2 = await S.keyOf(' 王小明 ', '鳳山 分校'), k3 = await S.keyOf('ＡＢＣ', 'x'), k4 = await S.keyOf('abc', 'X');
  ok(k1.length === 24 && k1 === k2, '姓名、分部的空白不影響鑰匙'); ok(k3 === k4, '全形／大小寫不影響鑰匙');
  ok(S.emailOf(k1, 0) === k1 + '@op-students.example.com' && S.emailOf(k1, 2) === k1 + '-2@op-students.example.com' && S.keyFromEmail(S.emailOf(k1, 2)) === k1, '帳號 email 與世代');
  console.log(f ? '失敗 ' + f : '全部通過'); process.exit(f ? 1 : 0);
})();
