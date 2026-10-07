export function previewHtml(manifest) {
  const fps = Number(manifest.settings?.fps);
  const data = JSON.stringify({ frames: manifest.frames.filter(f => f.status === 'captured'), fps: Number.isFinite(fps) && fps > 0 ? fps : 2 }).replaceAll('<', '\\u003c');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Animate Commits · Preview</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#101419;color:#edf2f7;font:15px system-ui,sans-serif}main{max-width:1280px;margin:auto;padding:32px}header{display:flex;align-items:center;justify-content:space-between;gap:16px}h1{font-size:24px;letter-spacing:-1px;margin:8px 0}small,.muted{color:#9aa8b7}small{letter-spacing:2px;text-transform:uppercase}.stage{margin:24px 0;background:#080a0d;border:1px solid #2b3540;border-radius:12px;overflow:hidden;aspect-ratio:16/9;display:grid;place-items:center}.stage img{width:100%;height:100%;object-fit:contain}.controls{display:flex;align-items:center;gap:16px;flex-wrap:wrap}button,select{background:#202b36;border:1px solid #354351;color:inherit;border-radius:6px;padding:10px 16px}button{cursor:pointer}button:focus-visible,input:focus-visible,select:focus-visible{outline:2px solid #86efac}button.primary{background:#b6f3d0;color:#102a1c;border:0;min-width:100px}input{flex:1;min-width:180px;accent-color:#b6f3d0}#message{font-size:19px;overflow-wrap:anywhere}code{color:#b6f3d0}.note{border-top:1px solid #2b3540;margin-top:28px;padding-top:18px;line-height:1.7}label{display:flex;align-items:center;gap:8px}
.stage{height:clamp(140px,calc(100vh - 300px),620px);aspect-ratio:auto}.stage img{min-height:0}.controls{display:block}.transport,.seek{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.seek{margin-top:14px;gap:16px}button:disabled{opacity:.4;cursor:default}.transport button{padding:10px 13px}.shortcuts{font-size:12px;margin:12px 0}@media(max-width:600px){main{padding:16px}.stage{margin:16px 0;height:35vh}.transport button{font-size:13px;padding:9px}}
</style></head><body><main><header><div><small>Repository time machine</small><h1>Animate Commits</h1></div><span class="muted" id="count"></span></header>
<div class="stage"><img id="frame" alt="Application screenshot at selected commit"></div>
<div class="controls"><div class="transport" role="group" aria-label="Playback controls"><button id="rewind" title="Return to frame 1; keep playing if already playing">Rewind to start</button><button id="prev" aria-label="Previous frame" title="Pause and step backward one frame">← Previous frame</button><button id="play" class="primary">Play</button><button id="stop" title="Stop playback and return to frame 1">Stop</button><button id="next" aria-label="Next frame" title="Pause and step forward one frame">Next frame →</button></div><div class="seek"><input id="scrub" type="range" min="0" value="0" aria-label="Timeline"><label>Speed <select id="speed"><option value="1">1 fps</option><option value="2">2 fps</option><option value="4">4 fps</option><option value="8">8 fps</option><option value="12">12 fps</option><option value="24">24 fps</option></select></label></div></div>
<p class="shortcuts muted">Space: play / pause · ← / →: step one frame · Home: rewind · End: last frame</p>
<p id="message"></p><p class="muted"><code id="hash"></code> <span id="date"></span></p>
<p class="note muted">Import <code>frames/frame-000001.png</code> as an image sequence in your video editor. Every image has the same dimensions. Commit details and failures are recorded in <code>manifest.json</code>.</p>
</main><script type="application/json" id="data">${data}</script><script>
const {frames,fps}=JSON.parse(document.getElementById('data').textContent);
const $=id=>document.getElementById(id);let index=0,timer=null;
if(![...$('speed').options].some(o=>Number(o.value)===fps))$('speed').add(new Option(fps+' fps',fps));
$('speed').value=String(fps);$('scrub').max=Math.max(0,frames.length-1);
function show(i){if(!frames.length){$('message').textContent='No frames captured. See manifest.json and logs for details.';return}index=(i+frames.length)%frames.length;const f=frames[index];$('frame').src=f.file;$('scrub').value=index;$('count').textContent=(index+1)+' / '+frames.length+' frames';$('message').textContent=f.subject;$('hash').textContent=f.hash.slice(0,10);$('date').textContent=' · '+f.date;$('prev').disabled=index===0;$('next').disabled=index===frames.length-1;}
function pause(){clearInterval(timer);timer=null;$('play').textContent='Play'}
function play(){if(frames.length<2||timer)return;timer=setInterval(()=>show(index+1),1000/Number($('speed').value));$('play').textContent='Pause'}
function step(i){pause();show(Math.max(0,Math.min(frames.length-1,i)))}
function rewind(){const playing=Boolean(timer);pause();show(0);if(playing)play()}
$('play').onclick=()=>timer?pause():play();$('stop').onclick=()=>step(0);$('rewind').onclick=rewind;
$('prev').onclick=()=>step(index-1);$('next').onclick=()=>step(index+1);
$('scrub').oninput=()=>step(Number($('scrub').value));$('speed').onchange=()=>{if(timer){pause();play()}};
document.addEventListener('keydown',e=>{if(['INPUT','SELECT','BUTTON'].includes(e.target.tagName))return;if(['Space','ArrowLeft','ArrowRight','Home','End'].includes(e.code))e.preventDefault();if(e.code==='Space'){timer?pause():play()}if(e.code==='ArrowLeft')step(index-1);if(e.code==='ArrowRight')step(index+1);if(e.code==='Home')rewind();if(e.code==='End')step(frames.length-1)});show(0);
if(new URLSearchParams(location.search).get('autoplay')==='1')play();
$('play').disabled=frames.length<2;$('rewind').disabled=$('stop').disabled=$('scrub').disabled=!frames.length;
if(!frames.length)$('prev').disabled=$('next').disabled=true;
window.addEventListener('pagehide',pause);
</script></body></html>`;
}
