/* 陶笛回家練習｜共用核心（core.js，全域 OPC）
   學生頁（index.html）和老師後台（admin.html）共用：放寬設定、音符寫法、收音判定、積分與等級計算。
   積分、等級、完成次數都不另外存：由「任務＋練習紀錄＋老師手動加減」即時算出（兩個頁面用同一個函式，結果一定一樣）。 */
(function (g) {
'use strict';

/* ---------- 放寬設定（老師後台可改，存在 settings/config）---------- */
const DEFAULTS = { tol: 75, holdMs: 700, missPct: 25, timingBeats: 0.5, coverage: 50, freeSec: 8,
                   speed1: 100, speed2: 90, speed3: 80, clickOn: 1 };
const RANGES = { tol: [30, 90], holdMs: [300, 1500], missPct: [0, 50], timingBeats: [0.25, 1.5], coverage: [20, 100],
                 freeSec: [3, 20], speed1: [30, 100], speed2: [30, 100], speed3: [30, 100], clickOn: [0, 1] };
const LABELS = { tol: '音準容許（音分）', holdMs: '每個音要吹多久（毫秒）', missPct: '可以漏掉的音（%）',
                 timingBeats: '節奏可早晚（拍）', coverage: '每個音要吹到的比例（%）', freeSec: '自由吹奏需累積（秒）',
                 speed1: '速度階段 1（%）', speed2: '速度階段 2（%）', speed3: '速度階段 3（%）', clickOn: '節拍聲' };
const DAILY_CAP = 5;   /* 每人每項任務每天最多記幾次（firestore.rules 也限制 k ≤ 5，兩邊要一樣） */
const LEVELS = [
  { min: 0,   name: '陶笛蛋',     icon: '🥚' },
  { min: 20,  name: '小音符',     icon: '🎵' },
  { min: 50,  name: '陶笛學徒',   icon: '🎶' },
  { min: 100, name: '星星樂手',   icon: '⭐' },
  { min: 180, name: '音符冒險家', icon: '🧭' },
  { min: 300, name: '陶笛勇者',   icon: '🛡️' },
  { min: 500, name: '陶笛大師',   icon: '👑' }
];

function cleanSettings(o) {
  const s = {}; o = o || {};
  Object.keys(DEFAULTS).forEach(function (k) {
    const v = Number(o[k]), r = RANGES[k];
    s[k] = (o[k] !== undefined && o[k] !== '' && !isNaN(v) && v >= r[0] && v <= r[1]) ? v : DEFAULTS[k];
  });
  return s;
}
function speeds(s) {
  const seen = {}, out = [];
  [s.speed1, s.speed2, s.speed3].forEach(function (v) { v = Math.round(v); if (!seen[v]) { seen[v] = 1; out.push(v); } });
  return out.sort(function (a, b) { return a - b; });
}

/* ---------- 日期（台北時間）：用「第幾天」的整數，和 firestore.rules 的算法一致 ---------- */
function todayDay() { return Math.floor((Date.now() + 8 * 3600e3) / 864e5); }
function dayToDate(d) { return new Date(d * 864e5).toISOString().slice(0, 10); }
function dateToDay(s) { return Math.round(Date.parse(s + 'T00:00:00Z') / 864e5); }
function weekStartDay(d) { const dow = new Date(d * 864e5).getUTCDay(); return d - ((dow + 6) % 7); }
function validDate(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s)) && !isNaN(Date.parse(s + 'T00:00:00Z')); }

/* ---------- 收音音符 ----------
   簡譜數字 1~7，高音 1'～7'（或「高1」～「高7」，也可寫 8、9＝高Do、高Re），降 Si 寫 7b，0＝休止；拍數寫冒號後（5:2＝2 拍，沒寫＝1 拍）。
   回傳 [{n, b}]（n：1~7＝1~7、8~14＝高1~高7、15＝降Si、0＝休止）；空白＝自由吹奏模式。 */
function parseNotes(s) {
  const raw = String(s == null ? '' : s).replace(/[,，、\-－]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!raw) return [];
  const out = [];
  raw.split(' ').forEach(function (tk) {
    let beats = 1;
    if (tk.indexOf(':') >= 0) {
      const p = tk.split(':'); tk = p[0]; beats = Number(p[1]);
      if (!(beats >= 0.25 && beats <= 8)) throw new Error('拍數請填 0.25～8（例如 5:2）');
    }
    tk = tk.replace(/[’˙̇·]/g, "'");
    let n = 0, m;
    if (/^[0-7]$/.test(tk)) n = Number(tk);
    else if ((m = /^([1-7])'$/.exec(tk)) || (m = /^高([1-7])$/.exec(tk))) n = 7 + Number(m[1]);
    else if (/^[89]$/.test(tk)) n = Number(tk);
    else if (/^(7b|降7)$/.test(tk)) n = 15;
    else throw new Error('音符「' + tk + '」看不懂，請用 1 2 3 4 5 6 7，高音加單引號（1\' ～ 7\'），降 Si 寫 7b，休止用 0');
    out.push({ n: n, b: beats });
  });
  if (out.length > 200) throw new Error('音符最多 200 個（約 16～20 小節）');
  if (!out.some(function (x) { return x.n > 0; })) throw new Error('至少要有一個音（不能全是休止）');
  return out;
}
function safeNotes(s) { try { return parseNotes(s); } catch (e) { return []; } }
function notesStr(arr) {
  return arr.map(function (x) {
    return (x.n === 0 ? '0' : x.n === 15 ? '7b' : x.n <= 7 ? String(x.n) : (x.n - 7) + "'") + (x.b !== 1 ? ':' + x.b : '');
  }).join(' ');
}

/* ---------- 任務驗證（老師後台存檔前）---------- */
function cleanTask(t, knownGroups) {
  const title = String(t.title || '').replace(/\s+/g, ' ').trim(), note = String(t.note || '').replace(/\s+/g, ' ').trim();
  const group = String(t.group || '全部').replace(/\s+/g, '').trim() || '全部';
  const target = Math.floor(Number(t.target)), points = Math.floor(Number(t.points));
  if (!title || title.length > 40) throw new Error('請輸入任務名稱（40 字內）');
  if (note.length > 80) throw new Error('說明請在 80 字內');
  if (group.length > 20) throw new Error('分部名稱太長了');
  if (!(target >= 1 && target <= 50)) throw new Error('次數請填 1～50');
  if (!(points >= 0 && points <= 100)) throw new Error('積分請填 0～100');
  if (!validDate(t.startDate) || !validDate(t.endDate)) throw new Error('日期格式不正確');
  if (t.endDate < t.startDate) throw new Error('結束日不能早於開始日');
  const parsed = parseNotes(t.notes), bpm = Math.floor(Number(t.bpm)) || 0;
  if (bpm && (bpm < 30 || bpm > 200)) throw new Error('速度（BPM）請填 30～200，或留空');
  if (bpm && !parsed.length) throw new Error('要設定速度，請先填收音音符');
  const song = String(t.song || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
  const from = Math.floor(Number(t.from)) || 0, to = Math.floor(Number(t.to)) || 0;
  if (song && !(from >= 1 && to >= from)) throw new Error('歌曲的小節範圍不正確');
  return { title: title, note: note, group: group, target: target, points: points,
           startDate: t.startDate, endDate: t.endDate, notes: notesStr(parsed), bpm: bpm,
           song: song, from: song ? from : 0, to: song ? to : 0 };
}

/* ---------- 積分、等級、進度（學生頁、老師後台共用）----------
   tasks：[{id,title,group,target,points,startDate,endDate,notes,bpm}]
   logs：這位學生的紀錄 [{task,day,pct}]；adjs：老師手動加減 [{delta}]
   規則：只算「這位學生看得到的任務」、而且紀錄日期落在任務的開始～結束日內；
        任務次數達標才得該任務的積分；積分不會低於 0。 */
function level(pts) {
  let idx = 0;
  LEVELS.forEach(function (l, i) { if (pts >= l.min) idx = i; });
  const cur = LEVELS[idx], next = LEVELS[idx + 1] || null;
  return { index: idx + 1, name: cur.name, icon: cur.icon, min: cur.min,
           nextMin: next ? next.min : null, nextName: next ? next.name : null };
}
function compute(group, tasks, logs, adjs, today) {
  const vis = tasks.filter(function (t) { return t.group === '全部' || t.group === group; });
  const per = {}, byId = {};
  vis.forEach(function (t) { byId[t.id] = t; per[t.id] = { count: 0, todayCount: 0, bestPct: 0, lastDay: 0, done: false }; });
  const ws = weekStartDay(today);
  let total = 0, week = 0, lastDay = 0;
  (logs || []).forEach(function (l) {
    const t = byId[l.task]; if (!t) return;
    const day = Number(l.day);
    if (day < dateToDay(t.startDate) || day > dateToDay(t.endDate)) return;
    const p = per[t.id]; p.count++;
    if (day === today) p.todayCount++;
    if ((l.pct || 100) > p.bestPct) p.bestPct = l.pct || 100;
    if (day > p.lastDay) p.lastDay = day;
    total++; if (day >= ws && day <= ws + 6) week++;
    if (day > lastDay) lastDay = day;
  });
  let points = 0;
  vis.forEach(function (t) { const p = per[t.id]; p.done = p.count >= t.target; if (p.done) points += t.points; });
  (adjs || []).forEach(function (a) { points += Number(a.delta) || 0; });
  points = Math.max(0, points);
  return { points: points, level: level(points), per: per, total: total, week: week, lastDay: lastDay, visible: vis };
}


/*JUDGE-START*/
/* ====== 收音判定（純計算，不碰畫面）====== */
const SEMI = [0, 2, 4, 5, 7, 9, 11, 12, 14, 16, 17, 19, 21, 23, 10];  // 1~7、高1~高7、降Si 距離 Do 的半音數
const NAMES = ['Do', 'Re', 'Mi', 'Fa', 'Sol', 'La', 'Si', '高Do', '高Re', '高Mi', '高Fa', '高Sol', '高La', '高Si', '降Si'];
const NUMS = ['1', '2', '3', '4', '5', '6', '7', "1̇", "2̇", "3̇", "4̇", "5̇", "6̇", "7̇", "7♭"];
const C5 = 523.251;                                       // 中音 Do＝C5，標準音高 A=440
const freqOf = n => C5 * Math.pow(2, SEMI[n - 1] / 12);
const centsBetween = (f, g) => 1200 * Math.log2(f / g);

/* YIN 音高偵測：回傳 {f: Hz（0＝沒有穩定音高）, rms: 音量} */
function detectPitch(buf, sr) {
  const n = buf.length, half = n >> 1;
  let e = 0; for (let i = 0; i < n; i++) e += buf[i] * buf[i];
  const rms = Math.sqrt(e / n);
  if (rms < 0.008) return { f: 0, rms: rms };
  const tmin = Math.max(2, Math.floor(sr / 1500)), tmax = Math.min(half - 1, Math.ceil(sr / 400));
  const d = new Float32Array(tmax + 2);
  for (let tau = 1; tau <= tmax; tau++) {
    let s = 0; for (let i = 0; i < half; i++) { const x = buf[i] - buf[i + tau]; s += x * x; }
    d[tau] = s;
  }
  const c = new Float32Array(tmax + 2); let run = 0; c[0] = 1;
  for (let tau = 1; tau <= tmax; tau++) { run += d[tau]; c[tau] = run ? d[tau] * tau / run : 1; }
  let tau = -1;
  for (let t = tmin; t <= tmax; t++) {
    if (c[t] < 0.15) { while (t + 1 <= tmax && c[t + 1] < c[t]) t++; tau = t; break; }
  }
  if (tau < 0) return { f: 0, rms: rms };
  let b = tau;
  if (tau > 1 && tau < tmax) {
    const a0 = c[tau - 1], b0 = c[tau], c0 = c[tau + 1], den = a0 - 2 * b0 + c0;
    if (den) b = tau + (a0 - c0) / (2 * den);
  }
  return { f: sr / b, rms: rms };
}

/* 三種判定：free 自由吹奏 / hold 依序吹準每個音 / paced 跟著節拍（有 BPM） */
class Judge {
  constructor(task, st, pct) {
    this.st = st; this.pct = pct || 100; this.tol = st.tol;
    const src = task.notes || [];
    this.mode = !src.length ? 'free' : (task.bpm > 0 ? 'paced' : 'hold');
    this.t0 = null; this.last = 0; this.t = 0; this.done = false; this.ok = false;
    this.misses = 0; this.msg = ''; this.progress = 0; this.cents = null; this.cur = -1; this.allow = 0; this.items = [];
    if (this.mode === 'free') {
      this.need = st.freeSec * 1000; this.freeMs = 0;
    } else if (this.mode === 'hold') {
      this.items = src.filter(x => x.n > 0).map(x => ({ n: x.n, b: x.b, res: '' }));
      this.idx = 0; this.held = 0; this.heldNext = 0; this.lastGood = 0; this.noteStart = 0; this.quiet = 0; this.needRelease = false;
      this.allow = Math.floor(this.items.length * st.missPct / 100);
    } else {
      this.spb = 60000 / (task.bpm * this.pct / 100);
      let b = 4;                                                   // 先數 4 拍預備
      this.items = src.map(x => {
        const it = { n: x.n, b: x.b, res: x.n === 0 ? 'rest' : '', good: 0, s: b * this.spb, e: (b + x.b) * this.spb };
        it.need = Math.max(250, st.coverage / 100 * x.b * this.spb);
        b += x.b; return it;
      });
      this.win = st.timingBeats * this.spb;
      this.allow = Math.floor(this.items.filter(i => i.n > 0).length * st.missPct / 100);
      this.end = b * this.spb + this.win;
      this.totalBeats = b;
    }
  }
  start(t0) { this.t0 = t0; this.last = t0; }
  finish(ok) { this.done = true; this.ok = ok; }
  step(now, f) {
    if (this.t0 === null) this.start(now);
    const t = now - this.t0, dt = Math.min(100, Math.max(0, now - this.last));
    this.last = now; this.t = t;
    if (this.done) return;
    if (this.mode === 'free') return this._free(t, dt, f);
    if (this.mode === 'hold') return this._hold(t, dt, f);
    return this._paced(t, dt, f);
  }
  _free(t, dt, f) {
    if (f && f >= 440 && f <= 1900) this.freeMs += dt;
    this.progress = Math.min(1, this.freeMs / this.need);
    if (this.freeMs >= this.need) return this.finish(true);
    if (t > 90000) { this.msg = '時間到了，再試一次'; this.finish(false); }
  }
  _hold(t, dt, f) {
    const it = this.items[this.idx], target = freqOf(it.n);
    let good = false; this.cents = null;
    if (f) { this.cents = centsBetween(f, target); good = Math.abs(this.cents) <= this.tol; }
    if (this.needRelease) {
      if (good) this.quiet = 0; else { this.quiet += dt; if (this.quiet >= 120) { this.needRelease = false; this.quiet = 0; } }
    } else {
      // 放寬：這個音吹不出來時，只要直接吹準「下一個音」，就把這個音算漏掉、跳到後面，不用乾等
      let goodNext = false;
      const nx = this.items[this.idx + 1];
      if (f && nx && nx.n !== it.n) goodNext = Math.abs(centsBetween(f, freqOf(nx.n))) <= this.tol;
      if (good) { this.held += dt; this.lastGood = t; this.heldNext = 0; }
      else if (goodNext) {
        this.heldNext += dt;
        if (this.heldNext >= this.st.holdMs) { it.res = 'miss'; this.misses++; nx.res = 'ok'; this.idx++; return this._adv(t); }
      } else {
        this.heldNext = 0;
        if (this.held > 0 && t - this.lastGood > 450) this.held = Math.max(0, this.held - dt);
      }
      if (this.held >= this.st.holdMs) { it.res = 'ok'; return this._adv(t); }
    }
    this.progress = Math.min(1, this.held / this.st.holdMs);
    if (t - this.noteStart > 10000) { it.res = 'miss'; this.misses++; this._adv(t); }
  }
  _adv(t) {
    const prev = this.items[this.idx];
    this.idx++; this.held = 0; this.heldNext = 0; this.quiet = 0; this.noteStart = t; this.progress = 0;
    if (this.misses > this.allow) { this.msg = '漏掉太多音了'; return this.finish(false); }
    if (this.idx >= this.items.length) return this.finish(true);
    this.needRelease = this.items[this.idx].n === prev.n && prev.res === 'ok';
  }
  _paced(t, dt, f) {
    const items = this.items; this.cents = null; this.cur = -1;
    for (let i = 0; i < items.length; i++) if (t >= items[i].s && t < items[i].e) { this.cur = i; break; }
    if (f) {
      let ref = this.cur >= 0 ? this.cur : items.findIndex(x => x.res === '' && x.n > 0);
      if (ref >= 0 && items[ref].n > 0) this.cents = centsBetween(f, freqOf(items[ref].n));
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (it.n === 0 || it.res !== '') continue;
        if (t < it.s - this.win || t > it.e + this.win) continue;
        if (Math.abs(centsBetween(f, freqOf(it.n))) <= this.tol) {
          it.good += dt; if (it.good >= it.need) it.res = 'ok';
          break;
        }
      }
    }
    for (const it of items) if (it.n > 0 && it.res === '' && t > it.e + this.win) { it.res = 'miss'; this.misses++; }
    this.progress = Math.max(0, Math.min(1, t / this.end));
    if (this.misses > this.allow) { this.msg = '漏掉太多音了'; return this.finish(false); }
    if (t >= this.end || items.every(x => x.res !== '')) this.finish(true);
  }
}

/*JUDGE-END*/

g.OPC = {
  DEFAULTS: DEFAULTS, RANGES: RANGES, LABELS: LABELS, DAILY_CAP: DAILY_CAP, LEVELS: LEVELS,
  cleanSettings: cleanSettings, speeds: speeds,
  todayDay: todayDay, dayToDate: dayToDate, dateToDay: dateToDay, weekStartDay: weekStartDay, validDate: validDate,
  parseNotes: parseNotes, safeNotes: safeNotes, notesStr: notesStr, cleanTask: cleanTask,
  level: level, compute: compute,
  SEMI: SEMI, NAMES: NAMES, NUMS: NUMS, C5: C5, freqOf: freqOf, centsBetween: centsBetween,
  detectPitch: detectPitch, Judge: Judge
};
})(typeof window !== 'undefined' ? window : this);
