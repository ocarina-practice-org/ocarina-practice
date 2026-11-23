/* 墊片：讓 song.html（歌曲練習＋樂譜）在「陶笛回家練習」網站中運作，取代 homework-pack 的 wk-core.js。
   任務資訊由網址參數帶入（?task=&song=&from=&to=&name=&target=&bpm=&done=）；
   練習結果用 postMessage 傳給外層的 index.html，由它寫入練習紀錄（只有「全對」才算一次）。
   次數、星星糖、島嶼等遊戲機制不使用。 */
(function () {
  var q = new URLSearchParams(location.search);
  var id = q.get('task');
  var TASK = id ? {
    id: id,
    type: 'song',
    song: q.get('song') || '',
    from: parseInt(q.get('from'), 10) || 1,
    to: parseInt(q.get('to'), 10) || 1,
    name: q.get('name') || '本週任務',
    T: parseInt(q.get('target'), 10) || 5,
    speed: parseInt(q.get('bpm'), 10) || 0,
    mock: false
  } : null;
  var P = { tasks: {}, played: 0, week: 0, given: 0 };
  if (id) P.tasks[id] = parseInt(q.get('done'), 10) || 0;

  function send(m) {
    try {
      if (window.parent && window.parent !== window) window.parent.postMessage(Object.assign({ src: 'song-practice' }, m), '*');
    } catch (e) {}
  }

  window.OLM_WK = {
    BUDGET: 0,
    P: P,
    taskById: function (x) { return TASK && TASK.id === x ? TASK : null; },
    recordPlayed: function () { P.played++; },
    recordLog: function (tid, perfect, errs) {
      send({ type: 'songLog', task: tid, perfect: !!perfect, errs: errs || [] });
    },
    recordPerfect: function (tid) { P.tasks[tid] = (P.tasks[tid] | 0) + 1; return ''; },
    errsFrom: function (res, fn) {
      return res.filter(function (r) { return r.pitch !== 'ok' || r.timing !== 'ok' || r.short; }).map(fn);
    }
  };
})();
