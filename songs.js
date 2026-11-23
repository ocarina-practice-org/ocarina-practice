/* 歌曲資料：解析與 build（曲目在 gloria-songs.js）
   格式（沿用《簡譜文字格式》）：每小節一個字串，音符以空格分開
     音符：[#|b]度數[' 高八度 | , 低八度]:時值（拍數，♩=1）　例 6:0.5　1':1　b7:0.75　#4:0.5
     休止：0:時值　　延音線：音符後加 ~（接下一個同音，合併成一個長音判分）
   音高：1=C，不標點的 1＝C5（陶笛實際音高；譜面低一個八度，與基本指法 1-1 相同）。
   小節編號 = 陣列索引+1，與原譜印出的小節號一致。 */
(function(g){
'use strict';
const PCS=[0,2,4,5,7,9,11];
function parseTok(s){
  let tie=false;if(s.endsWith('~')){tie=true;s=s.slice(0,-1);}
  const k=s.indexOf(':'),p=s.slice(0,k),dur=parseFloat(s.slice(k+1));
  if(!(dur>0))throw new Error('時值錯誤：'+s);
  if(p==='0')return {rest:true,dur};
  let i=0,acc=0;
  if(p[i]==='#'){acc=1;i++;}else if(p[i]==='b'){acc=-1;i++;}
  const deg=+p[i++];if(!(deg>=1&&deg<=7))throw new Error('度數錯誤：'+s);
  let oct=0;for(;i<p.length;i++){if(p[i]==="'")oct++;else if(p[i]===',')oct--;else throw new Error('符號錯誤：'+s);}
  return {rest:false,deg,acc,oct,midi:72+12*oct+PCS[deg-1]+acc,dur,tie};
}
function rep(s,n){return Array(n).fill(s);}

/* 曲目都在 gloria-songs.js（Gloria 一聲部（上）／（下））；這裡只放共用的解析與 build */
const SONGS={};
/* 取小節範圍 → {bars:[{no,beats,notes:[…]}], notes（顯示用）, events（判分用，延音線合併）, totalBeats} */
function build(songId,from,to){
  const sg=SONGS[songId];const beatsPerBar=sg.ts[0];
  from=Math.max(1,Math.min(from|0,sg.bars.length));to=Math.max(from,Math.min(to|0,sg.bars.length));
  const bars=[],notes=[];let beat=0;
  for(let b=from;b<=to;b++){
    const toks=sg.bars[b-1].split(/\s+/).filter(Boolean).map(parseTok);
    const sum=toks.reduce((a,t)=>a+t.dur,0);
    if(Math.abs(sum-beatsPerBar)>1e-9)throw new Error(sg.title+' 第 '+b+' 小節拍數 '+sum+'，應為 '+beatsPerBar);
    const bar={no:b,beats:beatsPerBar,notes:[]};let inBar=0;
    toks.forEach(t=>{const n=Object.assign({i:notes.length,bar:b,barIdx:bars.length,beat,beatInBar:inBar},t);
      notes.push(n);bar.notes.push(n);beat+=t.dur;inBar+=t.dur;});
    bars.push(bar);
  }
  const events=[];
  for(let k=0;k<notes.length;k++){
    const n=notes[k];if(n.rest)continue;
    const ev={i:events.length,midi:n.midi,beat:n.beat,dur:n.dur,notes:[n],bar:n.bar,beatInBar:n.beatInBar,prevSame:false};
    let cur=n;
    while(cur.tie&&k+1<notes.length&&!notes[k+1].rest&&notes[k+1].midi===n.midi){k++;cur=notes[k];ev.notes.push(cur);ev.dur+=cur.dur;}
    const prev=events[events.length-1];
    if(prev&&Math.abs(prev.beat+prev.dur-ev.beat)<1e-9&&prev.midi===ev.midi)ev.prevSame=true;
    events.push(ev);
  }
  notes.forEach(n=>{if(!n.rest&&n.tie){const nx=notes[n.i+1];n.tieNext=!!(nx&&!nx.rest&&nx.midi===n.midi);}});
  return {song:sg,from,to,bars,notes,events,totalBeats:beat};
}
g.OLM_SONGS={SONGS,build,parseTok};
if(typeof module!=='undefined')module.exports=g.OLM_SONGS;
})(typeof window!=='undefined'?window:globalThis);


