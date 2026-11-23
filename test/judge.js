const fs = require('fs'), vm = require('vm');
const html = fs.readFileSync('/home/claude/op-firebase/core.js', 'utf8');
const src = html.split('/*JUDGE-START*/')[1].split('/*JUDGE-END*/')[0];
const ctx = { Math, Float32Array, console }; vm.createContext(ctx);
vm.runInContext(src + '\nthis.detectPitch=detectPitch;this.Judge=Judge;this.freqOf=freqOf;', ctx);
const { detectPitch, Judge, freqOf } = ctx;
let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.log('✗ FAIL', m); } else console.log('✓', m); };

const SR = 48000;
function tone(f, n = 2048, amp = 0.3, ph = 0) { const b = new Float32Array(n); for (let i = 0; i < n; i++) b[i] = amp * (Math.sin(2 * Math.PI * f * i / SR + ph) + 0.3 * Math.sin(4 * Math.PI * f * i / SR + ph)); return b; }

// 1. 音高偵測：1~7、高Do、高Re
let worst = 0;
for (let n = 1; n <= 9; n++) { const f = freqOf(n), d = detectPitch(tone(f), SR); worst = Math.max(worst, Math.abs(1200 * Math.log2(d.f / f))); }
ok(worst < 8, '偵測 9 個音，最大誤差 ' + worst.toFixed(1) + ' 音分');
ok(detectPitch(new Float32Array(2048), SR).f === 0, '靜音：沒有音高');
ok(detectPitch(tone(523, 2048, 0.003), SR).f === 0, '音量太小：不判定');
const noise = new Float32Array(2048).map(() => (Math.random() - .5) * 0.3);
ok(detectPitch(noise, SR).f === 0, '雜訊：沒有穩定音高');
ok(Math.abs(1200 * Math.log2(detectPitch(tone(freqOf(3) * Math.pow(2, 40 / 1200)), SR).f / freqOf(3)) - 40) < 8, '偏高 40 音分能量出來');

const st = { tol: 75, holdMs: 700, missPct: 25, timingBeats: 0.5, coverage: 50, freeSec: 8 };
// 以 25ms 一格模擬；play(judge, [[startMs,endMs,freq],...], totalMs)
function sim(j, plays, total, startAt = 0) {
  for (let t = startAt; t <= total && !j.done; t += 25) {
    const p = plays.find(x => t >= x[0] && t < x[1]);
    j.step(t, p ? p[2] : 0);
  }
  return j;
}
const cents = (n, c) => freqOf(n) * Math.pow(2, c / 1200);

// 2. 自由吹奏
let j = sim(new Judge({ notes: [], bpm: 0 }, st, 100), [[0, 9000, 700]], 20000);
ok(j.done && j.ok, '自由吹奏：吹滿 8 秒過關');
j = sim(new Judge({ notes: [], bpm: 0 }, st, 100), [[0, 5000, 700]], 20000);
ok(!(j.done && j.ok), '自由吹奏：只吹 5 秒不過關');
j = sim(new Judge({ notes: [], bpm: 0 }, Object.assign({}, st, { freeSec: 4 }), 100), [[0, 5000, 700]], 20000);
ok(j.done && j.ok, '自由吹奏：老師把門檻放寬成 4 秒，5 秒就過關');

// 3. 依序吹準（hold）：1 3 5 1'（含重複音）
const notes = [{ n: 1, b: 1 }, { n: 3, b: 1 }, { n: 5, b: 1 }, { n: 8, b: 1 }];
let pl = [[0, 900, freqOf(1)], [1200, 2100, freqOf(3)], [2400, 3300, freqOf(5)], [3600, 4500, freqOf(8)]];
j = sim(new Judge({ notes, bpm: 0 }, st, 100), pl, 20000);
ok(j.done && j.ok && j.misses === 0, 'hold：每個音吹準 → 過關');
pl = [[0, 900, cents(1, 60)], [1200, 2100, cents(3, -70)], [2400, 3300, cents(5, 50)], [3600, 4500, cents(8, -65)]];
j = sim(new Judge({ notes, bpm: 0 }, st, 100), pl, 20000);
ok(j.done && j.ok, 'hold：每個音都偏 50~70 音分（放寬 ±75）仍過關');
j = sim(new Judge({ notes, bpm: 0 }, Object.assign({}, st, { tol: 50 }), 100), pl, 30000);
ok(j.done && !j.ok, 'hold：老師改成標準 ±50，同樣的偏差就不過關');
pl = [[0, 900, freqOf(1)], [1200, 2100, freqOf(3)], [2400, 3300, freqOf(4)], [3600, 4500, freqOf(8)]]; // 第 3 個音吹成 4
j = sim(new Judge({ notes, bpm: 0 }, st, 100), pl, 40000);
ok(j.done && j.ok && j.misses === 1, 'hold：吹錯 1 個音（4 個音可漏 1 個）仍過關，漏 1');
j = sim(new Judge({ notes, bpm: 0 }, Object.assign({}, st, { missPct: 0 }), 100), pl, 40000);
ok(j.done && !j.ok, 'hold：老師改成不可漏音 → 同樣吹錯就失敗');
// 重複音：1 1 需要兩次分開吹
j = new Judge({ notes: [{ n: 1, b: 1 }, { n: 1, b: 1 }], bpm: 0 }, Object.assign({}, st, { missPct: 0 }), 100);
sim(j, [[0, 3000, freqOf(1)]], 5000);
ok(!j.done || !j.ok, 'hold：同一個音一口氣長吹，不會被當成兩個音');
j = new Judge({ notes: [{ n: 1, b: 1 }, { n: 1, b: 1 }], bpm: 0 }, Object.assign({}, st, { missPct: 0 }), 100);
sim(j, [[0, 900, freqOf(1)], [1200, 2100, freqOf(1)]], 5000);
ok(j.done && j.ok, 'hold：中間斷開再吹同一個音 → 兩個音都算');

// 4. 跟拍（paced）：BPM 60、1 1 5 5 6 6 5:2；速度 100% → 每拍 1000ms，預備 4 拍
const song = [1, 1, 5, 5, 6, 6].map(n => ({ n, b: 1 })).concat([{ n: 5, b: 2 }]);
const paced = pct => ({ notes: song, bpm: 60 });
function pacedPlay(pct, offsetMs, pitchFn) {
  const spb = 60000 / (60 * pct / 100); let b = 4; const out = [];
  song.forEach(x => { const s = b * spb + offsetMs, e = (b + x.b) * spb + offsetMs - 120; out.push([s, e, pitchFn(x.n)]); b += x.b; });
  return out;
}
for (const pct of [100, 90, 80]) {
  const jj = new Judge(paced(pct), st, pct); sim(jj, pacedPlay(pct, 0, n => freqOf(n)), 40000);
  ok(jj.done && jj.ok && jj.misses === 0, 'paced ' + pct + '%：準時準音過關（全曲約 ' + Math.round(jj.end / 1000) + ' 秒）');
}
let jj = new Judge(paced(100), st, 100); sim(jj, pacedPlay(100, 350, n => freqOf(n)), 40000);
ok(jj.done && jj.ok, 'paced：整體慢了 0.35 拍（寬鬆 0.5 拍內）仍過關');
jj = new Judge(paced(100), st, 100); sim(jj, pacedPlay(100, 1500, n => freqOf(n)), 40000);
ok(jj.done && !jj.ok, 'paced：整體慢了 1.5 拍 → 不過關');
jj = new Judge(paced(100), Object.assign({}, st, { timingBeats: 1.5 }), 100); sim(jj, pacedPlay(100, 1200, n => freqOf(n)), 40000);
ok(jj.done && jj.ok, 'paced：老師把節奏放寬到 1.5 拍 → 慢 1.2 拍也過關');
jj = new Judge(paced(100), st, 100); sim(jj, pacedPlay(100, 0, n => cents(n, 70)), 40000);
ok(jj.done && jj.ok, 'paced：全部偏高 70 音分仍過關');
jj = new Judge(paced(100), st, 100); sim(jj, [], 40000);
ok(jj.done && !jj.ok, 'paced：完全沒吹 → 不過關（很快就判定失敗，不用等到最後）');
jj = new Judge(paced(100), st, 100); sim(jj, pacedPlay(100, 0, n => (n === 5 ? freqOf(4) : freqOf(n))), 40000);
ok(jj.done && jj.misses >= 2, 'paced：兩個 5 都吹成 4 → 記為漏音 ' + jj.misses);
// 休止
const withRest = [{ n: 1, b: 1 }, { n: 0, b: 1 }, { n: 3, b: 1 }];
jj = new Judge({ notes: withRest, bpm: 60 }, st, 100);
sim(jj, [[4000, 4880, freqOf(1)], [6000, 6880, freqOf(3)]], 30000);
ok(jj.done && jj.ok && jj.items[1].res === 'rest', 'paced：休止符不需要吹，其他音準時就過關');
console.log(fails ? '\n失敗 ' + fails + ' 項' : '\n全部通過'); process.exit(fails ? 1 : 0);
