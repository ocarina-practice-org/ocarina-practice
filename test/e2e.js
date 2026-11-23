const http = require('http'), fs = require('fs'), path = require('path'), { spawn } = require('child_process');
const ROOT = path.join(__dirname, '..');
const srv = http.createServer((q, r) => {
  let u = q.url.split('?')[0]; if (u === '/') u = '/index.html';
  const f = path.join(ROOT, u); if (!f.startsWith(ROOT) || !fs.existsSync(f)) { r.writeHead(404); return r.end('no'); }
  let b = fs.readFileSync(f);
  if (u.endsWith('.html')) b = Buffer.from(b.toString('utf8').replace('<script src="core.js"></script>', '<script src="/test/fakefb.js"></script><script src="core.js"></script>').replace('</body>', '<script>OP_FAKE_SEED_ADMIN();</script></body>'));
  r.writeHead(200, { 'content-type': u.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/javascript; charset=utf-8' }); r.end(b);
});
const get = u => new Promise((res, rej) => http.get(u, r => { let b = ''; r.on('data', c => b += c); r.on('end', () => res(b)); }).on('error', rej));
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log('✗ FAIL: ' + m); } };
(async () => {
  await new Promise(r => srv.listen(8791, r));
  const ch = spawn('google-chrome', ['--headless=new', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=9444', '--user-data-dir=/tmp/opfb-prof-' + Date.now(), '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', 'about:blank'], { stdio: 'ignore' });
  let tabs; for (let i = 0; i < 40; i++) { try { tabs = JSON.parse(await get('http://localhost:9444/json')); if (tabs.length) break; } catch (e) {} await sleep(250); }
  const ws = new WebSocket(tabs.find(t => t.type === 'page').webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
  let id = 0; const pend = {}; const errs = [];
  ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && pend[d.id]) { pend[d.id](d); delete pend[d.id]; } else if (d.method === 'Runtime.exceptionThrown') errs.push(d.params.exceptionDetails.exception ? d.params.exceptionDetails.exception.description : d.params.exceptionDetails.text); };
  const send = (method, params) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Runtime.enable');
  const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: '(async()=>{' + expr + '})()', awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails.exception && r.result.exceptionDetails.exception.description || r.result.exceptionDetails.text)); return r.result.result.value; };
  const nav = async (u) => { await send('Page.navigate', { url: 'http://localhost:8791/' + u }); await sleep(900); };
  const txt = () => ev('return document.body.innerText');
  const wait = async (fn, ms = 4000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await ev(fn)) return true; } catch (e) {} await sleep(100); } return false; };
  const set = async (i, v) => { if (!(await wait(`return !!document.getElementById('${i}')`))) console.log('no element', i, (await txt()).slice(0,200)); return ev(`document.getElementById('${i}').value=${JSON.stringify(v)};`); };
  const click = async (sel) => { await wait(`return !!document.querySelector(${JSON.stringify(sel)})`); return ev(`const e=document.querySelector(${JSON.stringify(sel)}); if(!e) return 'NOEL'; e.click(); return 'ok'`); };

  // ===== 老師：登入、設定、派任務 =====
  await nav('admin.html');
  ok((await txt()).includes('老師後台'), '後台登入畫面');
  await set('aPw', 'wrongpw'); await click('[data-act=adminLogin]'); await sleep(400);
  ok((await txt()).includes('Email 或密碼不對'), '老師密碼錯誤的提示');
  await set('aPw', 'teacher123'); await click('[data-act=adminLogin]');
  ok(await wait("return document.body.innerText.includes('學生總覽')"), '老師登入成功');
  await click('[data-act=tab][data-v=settings]'); await sleep(200);
  await set('s_tol', '60'); await set('s_speed2', '85'); await click('[data-act=saveSettings]'); await sleep(400);
  ok(await ev("return (JSON.parse(localStorage.getItem('fb_db')).settings.config||{}).tol===60"), '放寬設定寫入 Firestore');
  await set('s_tol', '5'); await click('[data-act=saveSettings]'); await sleep(300);
  ok((await txt()).includes('音準容許'), '超出範圍的設定被擋下');
  await set('s_tol', '75'); await set('s_speed2', '90'); await click('[data-act=saveSettings]'); await sleep(300);
  await click('[data-act=tab][data-v=tasks]'); await sleep(200);
  const mkTask = async (title, group, target, points, notes, bpm) => {
    await click('[data-act=newTask]'); await sleep(150);
    await set('tTitle', title); await set('tGroup', group); await set('tTarget', target); await set('tPoints', points); await set('tNotes', notes); await set('tBpm', bpm);
    await click('[data-act=saveTask]'); await sleep(500);
  };
  await mkTask('自由吹奏', '全部', 2, 10, '', '');
  await mkTask('跟拍任務', '全部', 3, 20, "1 1 5 5 6 6 5:2", '60');
  await mkTask('鳳山專屬', '鳳山分校', 1, 5, "1 3 5 1'", '');
  ok((await ev("return Object.keys(JSON.parse(localStorage.getItem('fb_db')).tasks).length")) === 3, '三個任務已建立');
  await click('[data-act=newTask]'); await set('tTitle', '壞音符'); await set('tNotes', '1 9x'); await click('[data-act=saveTask]'); await sleep(300);
  ok((await txt()).includes('看不懂'), '壞音符被擋下並提示');
  await click('[data-act=cancelTask]');

  // ===== 學生：註冊 =====
  await nav('index.html');
  ok((await txt()).includes('登入'), '學生登入畫面');
  await set('fName', '王小明'); await set('fGroup', '鳳山分校'); await set('fPw', 'abcd'); await click('[data-act=login]'); await sleep(500);
  ok((await txt()).includes('第一次來'), '沒有帳號時登入失敗提示');
  await click('[data-act=setMode][data-v=create]'); await sleep(100);
  await set('fName', '王小明'); await set('fGroup', '鳳山分校'); await set('fPw', 'abcd'); await click('[data-act=register]'); await sleep(400);
  ok((await txt()).includes('請先勾選'), '沒勾家長確認不能建立');
  await ev("document.getElementById('fAck').checked=true;"); await click('[data-act=register]');
  const w1 = await wait("return document.body.innerText.includes('Lv.1')"); if (!w1) console.log('DEBUG', (await txt()).slice(0,400), errs);
  ok(w1, '註冊後進入學生頁');
  let t = await txt();
  ok(t.includes('自由吹奏') && t.includes('跟拍任務') && t.includes('鳳山專屬'), '看到全部＋自己分部的任務');
  ok(t.includes('陶笛蛋'), '初始等級');

  // ===== 過關、積分、每日上限 =====
  const tid = n => ev(`return S.me.tasks.find(t=>t.title===${JSON.stringify(n)}).id`);
  const free = await tid('自由吹奏');
  await ev(`await submitPractice(${JSON.stringify(free)}, 100)`); await sleep(300);
  ok((await ev('return S.me.tasks.find(t=>t.title==="自由吹奏").count')) === 1, '過關 1 次計 1');
  await ev(`await submitPractice(${JSON.stringify(free)}, 100)`); await sleep(300);
  ok((await ev('return S.me.points')) === 10, '達標拿 10 分');
  ok((await ev('return S.me.tasks.find(t=>t.title==="自由吹奏").done')), '任務標示完成');
  // 每天最多 5 次（含達標後）
  for (let i = 0; i < 4; i++) await ev(`await submitPractice(${JSON.stringify(free)}, 100)`);
  ok((await ev('return JSON.stringify(Object.keys(JSON.parse(localStorage.getItem("fb_db")).logs).length)')) === '5', '每天每任務最多寫 5 筆');
  ok((await ev('return S.me.points')) === 10, '超過次數不重複給分');
  const pace = await tid('跟拍任務');
  await ev(`await submitPractice(${JSON.stringify(pace)}, 80)`); await sleep(200);
  ok((await ev('return S.me.tasks.find(t=>t.title==="跟拍任務").bestPct')) === 80, '記下最高通過速度 80%');
  const bad = await ev(`try{ await DATA.practice(${JSON.stringify(pace)}, 77); return 'no'; }catch(e){ return e.message }`);
  ok(/速度/.test(bad), '不在三階段的速度被拒絕：' + bad);

  // ===== 登出／登入／錯誤 =====
  await click('[data-act=logout]'); await sleep(300);
  await set('fName', '王小明'); await set('fGroup', '鳳山分校'); await set('fPw', 'xxxx'); await click('[data-act=login]'); await sleep(500);
  ok((await txt()).includes('密碼不對'), '密碼錯誤提示');
  await set('fName', '王小明'); await set('fGroup', '鳳山分校'); await set('fPw', 'abcd'); await click('[data-act=login]');
  ok(await wait("return document.body.innerText.includes('Lv.')"), '重新登入成功');
  ok((await ev('return S.me.points')) === 10, '積分保留');
  await nav('index.html');
  ok(await wait("return document.body.innerText.includes('Lv.')"), '重新開網頁仍保持登入');
  await click('[data-act=logout]'); await sleep(200);
  await click('[data-act=setMode][data-v=create]');
  await set('fName', '王小明'); await set('fGroup', '鳳山分校'); await set('fPw', 'zzzz'); await ev("document.getElementById('fAck').checked=true;"); await click('[data-act=register]'); await sleep(500);
  ok((await txt()).includes('已經有人建立過'), '同名同分部不能重複建立');
  // 另一位、不同分部
  await set('fName', '李小華'); await set('fGroup', '三民分校'); await set('fPw', 'pass1'); await ev("document.getElementById('fAck').checked=true;"); await click('[data-act=register]');
  ok(await wait("return document.body.innerText.includes('Lv.1')"), '第二位學生註冊');
  t = await txt(); ok(t.includes('自由吹奏') && !t.includes('鳳山專屬'), '三民學生看不到鳳山專屬任務');
  await click('[data-act=logout]');

  // ===== 老師：總覽、改分部、重設密碼、加減分 =====
  await nav('admin.html');
  await ev("if(document.getElementById('aPw')){} return 1");
  if (await ev("return !!document.getElementById('aPw')")) { await set('aPw','teacher123'); await click('[data-act=adminLogin]'); }  /* 假 Firebase 只有一個登入槽，學生登入會蓋掉老師；真的 Firebase 兩邊是分開的 */
  ok(await wait("return document.body.innerText.includes('學生總覽')"), '老師重新登入');
  t = await txt(); ok(t.includes('王小明') && t.includes('李小華'), '總覽列出學生');
  ok(/王小明[\s\S]*?10/.test(t), '總覽顯示積分');
  await click('[data-act=renameGroup]'); await sleep(100);
  await set('rf', '三民分校'); await set('rt', '鳳山分校'); await click('#mOk'); await sleep(700);
  ok(/同名/.test(await txt()) === false, '不同名的分部可合併');
  ok((await ev("return Object.values(JSON.parse(localStorage.getItem('fb_db')).students).every(s=>s.group==='鳳山分校')")), '分部合併後都改成鳳山分校');
  ok((await ev("return Object.keys(JSON.parse(localStorage.getItem('fb_db')).alias||{}).length")) === 1, '寫了別名');
  // 加減分
  await ev("A.group=''; viewAdmin()"); 
  const sid = await ev("return A.data.students.find(s=>s.name==='李小華').id");
  await ev(`await api('adjustPoints',{id:${JSON.stringify(sid)},delta:7,reason:'測試'}); await loadAdmin();`); await sleep(200);
  ok((await ev("return A.data.students.find(s=>s.name==='李小華').points")) === 7, '老師加 7 分');
  await ev(`await api('adjustPoints',{id:${JSON.stringify(sid)},delta:-100,reason:'測試'}); await loadAdmin();`);
  ok((await ev("return A.data.students.find(s=>s.name==='李小華').points")) === 0, '積分不會低於 0');
  // 重設密碼
  await ev(`await api('resetPassword',{id:${JSON.stringify(sid)}}); await loadAdmin();`);
  await nav('index.html');
  await set('fName', '李小華'); await set('fGroup', '三民分校'); await set('fPw', 'pass1'); await click('[data-act=login]'); await sleep(500);
  ok((await txt()).includes('密碼不對'), '重設後舊密碼失效');
  await click('[data-act=setMode][data-v=create]');
  await set('fName', '李小華'); await set('fGroup', '三民分校'); await set('fPw', 'newpw'); await ev("document.getElementById('fAck').checked=true;"); await click('[data-act=register]');
  ok(await wait("return document.body.innerText.includes('Lv.')"), '重設後用「舊分部名稱」＋新密碼重新建立，認領原帳號');
  ok((await ev("return Object.keys(JSON.parse(localStorage.getItem('fb_db')).students).length")) === 2, '沒有多出重複的學生');
  ok((await ev('return S.me.group')) === '鳳山分校', '分部已是合併後的名稱');
  await click('[data-act=logout]'); await sleep(200);
  // 用新分部名稱＋新密碼也進得去（別名）
  await set('fName', '李小華'); await set('fGroup', '鳳山分校'); await set('fPw', 'newpw'); await click('[data-act=login]');
  ok(await wait("return document.body.innerText.includes('Lv.')"), '用新分部名稱也能登入（別名）');
  await click('[data-act=logout]');
  // 刪除學生
  await nav('admin.html'); if (await ev("return !!document.getElementById('aPw')")) { await set('aPw','teacher123'); await click('[data-act=adminLogin]'); } await wait("return document.body.innerText.includes('學生總覽')");
  const sid2 = await ev("return A.data.students.find(s=>s.name==='王小明').id");
  await ev(`await api('deleteStudent',{id:${JSON.stringify(sid2)}}); await loadAdmin();`);
  ok((await ev("return A.data.students.length")) === 1, '刪除學生');
  ok((await ev("return Object.keys(JSON.parse(localStorage.getItem('fb_db')).logs||{}).length")) === 0, '刪除學生時一併刪除他的紀錄');
  // 老師分頁都能渲染
  for (const tab of ['students', 'tasks', 'settings', 'logs']) { await click(`[data-act=tab][data-v=${tab}]`); await sleep(400); ok((await ev("return document.getElementById('adminBody').innerText.length")) > 10, '老師分頁 ' + tab); }
  // 非管理者帳號不能當老師
  await ev("await AD.signOut();"); await nav('admin.html');
  await set('aEm', 'x@y.com'); await set('aPw', 'whatever'); await click('[data-act=adminLogin]'); await sleep(400);
  ok((await txt()).includes('Email 或密碼不對'), '非老師帳號進不了後台');
  // 學生端面板能開（麥克風假裝置）
  await nav('index.html');
  await click('[data-act=setMode][data-v=create]');
  await set('fName', '測試生'); await set('fGroup', '鳳山分校'); await set('fPw', 'abcd'); await ev("document.getElementById('fAck').checked=true;"); await click('[data-act=register]');
  await wait("return document.body.innerText.includes('Lv.')");
  // 任務都過期（上一步刪光？）→ 補一個今天的任務給面板測試
  const pace2 = await ev('return S.me.tasks.find(t=>t.bpm>0).id');
  await ev(`openPractice(${JSON.stringify(pace2)})`); await sleep(200);
  ok(await ev("return !!document.getElementById('pCard') && document.querySelectorAll('[data-pact=pct]').length===3"), '收音面板開啟，三個速度階段');
  await click('[data-pact=start]'); await sleep(1800);
  ok((await ev('return P.state')) === 'run' || (await ev('return P.state')) === 'running' || (await ev('return !!P.judge')), '開始收音（假麥克風）');
  await click('[data-pact=stop]'); await sleep(200); await ev('closePanel()');
  await ev(`openPractice(${JSON.stringify(await ev('return S.me.tasks.find(t=>!t.notes.length).id'))})`); await sleep(150);
  ok((await txt()).includes('累積'), '自由吹奏面板'); await ev('closePanel()');
  console.log('錯誤：' + (errs.join(' | ') || '無'));
  console.log(`通過 ${pass}，失敗 ${fail}`);
  ch.kill(); srv.close(); process.exit(fail ? 1 : 0);
})().catch(e => { console.log('例外', e.message); require('child_process').execSync('pkill -f "[r]emote-debugging-port=9444" || true', {stdio:'ignore'}); process.exit(2); });
