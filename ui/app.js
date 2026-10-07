const $ = id => document.getElementById(id);
const fields = ['repo','output','update','appType','install','start','url','nativeWindowTitle','maxFrames','width','height','ref','from','every','delay','directory','fps','timeout','commandTimeout','port','selector','staticDir','browser','electronArgs','electronExecutable','electronWindowUrl','nativeReadyFile','env','failFast'];
fields.push('cloneTimeout');
const numeric = new Set(['maxFrames','width','height','every','delay','fps','timeout','commandTimeout','cloneTimeout','port']);
const nullable = new Set(['install','start','nativeWindowTitle','from','selector','electronExecutable','electronWindowUrl','nativeReadyFile']);
let loaded = {}, lastState = {}, imageKey = '', logText = '', listKey = '', submitting = false, openingOutput = false;
let detected = [], detectionKey = '', detecting = false, detectionId = 0;
const setupKey = () => JSON.stringify([$('repo').value.trim(), $('directory').value || '.']);
function clearDetection() { detectionId++; detected=[]; detectionKey=''; $('suggestions').hidden=true; $('detectStatus').textContent='Choose Detect setup to inspect this repository.'; }
function describeSetup() {
  const item = detected[Number($('setupChoice').value)];
  if(!item) return;
  $('setupReason').textContent = [item.reason, ...item.notes].join(' ');
  $('setupCommands').textContent = `App: ${item.settings.appType}\nFolder: ${item.settings.directory}\nInstall: ${item.settings.install || '(none)'}\nStart: ${item.settings.start || '(built-in capture)'}\n${item.settings.appType === 'web' ? 'URL: '+item.settings.url : ''}`;
}
async function detect() {
  if(detecting || !$('repo').value.trim()) return;
  const id = ++detectionId, key = setupKey(); detecting=true;
  $('detectStatus').textContent='Inspecting project files…'; $('suggestions').hidden=true; busy(['running','cancelling'].includes(lastState.status) || submitting);
  try {
    const result = await api('detect',{repo:$('repo').value,directory:$('directory').value || '.'});
    if(id !== detectionId || key !== setupKey()) return;
    detected=result.candidates; detectionKey=key;
    $('detectStatus').textContent=[result.message,...result.warnings].join(' ');
    $('setupChoice').replaceChildren(...detected.map((item,i)=>new Option(item.label,String(i))));
    $('suggestions').hidden=!detected.length; describeSetup();
  } catch(e) { if(id === detectionId) $('detectStatus').textContent=e.message; }
  finally { detecting=false; busy(['running','cancelling'].includes(lastState.status) || submitting); }
}
$('detect').onclick = detect;
$('setupChoice').onchange = describeSetup;
$('repo').addEventListener('input',clearDetection);
$('repo').addEventListener('change',detect);
$('directory').addEventListener('input',clearDetection);
$('applySetup').onclick = () => {
  if(detectionKey !== setupKey()) { clearDetection(); return; }
  const item=detected[Number($('setupChoice').value)]; if(!item)return;
  try { fill({...config(),...item.settings}); $('detectStatus').textContent=`Applied ${item.label}. Ready to capture; settings remain editable.`; error(''); }
  catch(e) { error(e.message); }
};
async function api(path, value) {
  const response = await fetch('api/' + path, value === undefined ? {} : {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});
  const data = await response.json(); if(!response.ok) throw new Error(data.error || 'Request failed'); return data;
}
function error(message) { $('error').hidden = !message; $('error').textContent = message || ''; }
function showRecent(items) {
  if(!items) return;
  const placeholder = new Option(items.length ? 'Choose a recent repository…' : 'No recent repositories yet', '');
  $('recentRepos').replaceChildren(placeholder, ...items.map(repo => new Option(repo, repo)));
}
$('recentRepos').onchange = async () => {
  const repo = $('recentRepos').value;
  if(!repo) return;
  $('repo').value = repo;
  clearDetection(); detect();
  try { showRecent(await api('recent', {repo})); } catch(e) { error(e.message); }
};
function mode() {
  $('capture').textContent = $('update').checked ? 'Update capture' : 'Start capture';
  $('outputHint').textContent = $('update').checked ? 'Select the previous capture folder containing manifest.json. Existing images are kept; only newer commits are captured.' : 'Choose a new or empty folder, preferably outside your repository.';
  const type = $('appType').value;
  document.querySelectorAll('.mode-field').forEach(el => { el.hidden = !el.dataset.modes.split(' ').includes(type); });
  $('start').required = type === 'native'; $('startOptional').hidden = type === 'native';
  $('modeHint').textContent = {web:'Leave the start command empty to capture a static website.',electron:'Electron launches separately. A start command is only needed for a renderer development server.',native:'Capture a native app window. Python and your app’s dependencies must be installed.'}[type];
  $('start').placeholder = type === 'native' ? 'python app.py' : 'e.g. npm run dev -- --port {port}';
}
function fill(config) {
  loaded = {...config};
  for(const id of fields) {
    const value = config[id];
    if(['failFast','update'].includes(id)) $(id).checked = Boolean(value);
    else $(id).value = ['env','electronArgs'].includes(id) ? JSON.stringify(value ?? (id==='env'?{}:['.']),null,id==='env'?2:0) : value ?? '';
  }
  mode();
}
function config() {
  const c = {...loaded}; delete c.list;
  for(const id of fields) {
    const value = $(id).value;
    if(['failFast','update'].includes(id)) c[id] = $(id).checked;
    else if(numeric.has(id)) c[id] = Number(value);
    else if(['env','electronArgs'].includes(id)) { try { c[id] = JSON.parse(value); } catch { throw new Error(id + ' must be valid JSON'); } }
    else c[id] = nullable.has(id) && !value.trim() ? null : value;
  }
  if(c.appType==='native') c.selector = null;
  return c;
}
function busy(value) {
  $('settings').disabled = value;
  ['load','save','inspect','capture','detect'].forEach(id => $(id).disabled = value || detecting);
}
async function start(kind) {
  if(submitting || detecting || !$('captureForm').reportValidity()) return;
  submitting = true; error(''); busy(true);
  try { const result = await api('start',{kind,config:config()}); showRecent(result.repositories); await refresh(); }
  catch(e) { error(e.message); busy(false); }
  finally { submitting = false; }
}
$('captureForm').onsubmit = e => { e.preventDefault(); start('capture'); };
$('inspect').onclick = () => start('inspect');
$('appType').onchange = mode;
$('update').onchange = mode;
for(const [button,input] of [['browseRepo','repo'],['browseOutput','output']]) $(button).onclick = async () => {
  $(button).disabled = true;
  try { const result = await api('browse',{target:input}); if(result.path) { $(input).value = result.path; if(input==='repo') { clearDetection(); detect(); } } showRecent(result.repositories); } catch(e) { error(e.message); }
  finally { $(button).disabled = false; }
};
$('load').onclick = async () => { try { const result = await api('load',{}); if(result.config) { clearDetection(); fill(result.config); showRecent(result.repositories); error(''); } } catch(e) { error(e.message); } };
$('save').onclick = async () => { if(!$('captureForm').reportValidity())return; try { await api('save',{config:config()}); error(''); } catch(e) { error(e.message); } };
$('stop').onclick = async () => { try { await api('cancel',{}); await refresh(); } catch(e) { error(e.message); } };
function outputButton() {
  $('openOutput').disabled = openingOutput || !$('output').value.trim();
  $('openOutput').textContent = openingOutput ? 'Opening folder…' : 'Open output folder';
}
$('output').addEventListener('input', outputButton);
$('openOutput').onclick = async () => {
  openingOutput = true; outputButton(); error('');
  try { await api('open-output',{output:$('output').value}); }
  catch(e) { error(e.message); }
  finally { openingOutput = false; outputButton(); }
};
$('preview').onclick = () => { $('previewFrame').src = 'output/preview.html?run=' + lastState.runId; $('previewDialog').showModal(); };
$('closePreview').onclick = () => { $('previewDialog').close(); $('previewFrame').src = 'about:blank'; };
async function refresh() {
  const state = await api('state'); lastState = state;
  const running = ['running','cancelling'].includes(state.status);
  busy(running || submitting);
  $('stop').disabled = state.status !== 'running';
  $('stop').textContent = state.status === 'cancelling' ? 'Cancelling…' : state.kind === 'inspect' ? 'Cancel inspection' : 'Cancel capture';
  const labels = {idle:'Ready to capture',running:state.kind==='inspect'?'Inspecting history':'Capturing',cancelling:'Cancelling…',completed:state.kind==='inspect'?'History ready':'Capture complete','completed-with-errors':'Completed with skipped commits',cancelled:'Cancelled',failed:'Capture failed'};
  if(state.result?.noNewCommits) labels.completed = 'Already up to date';
  $('status').textContent = labels[state.status] || state.status;
  $('progressTitle').textContent = state.status==='idle'?'Ready when you are':labels[state.status];
  const p = state.progress || {};
  $('progressCount').textContent = `${p.completed || 0} / ${p.total || 0}`;
  $('progress').max = p.total || 1; $('progress').value = p.completed || 0;
  $('frameCount').textContent = p.captured ? `${p.captured} FRAMES · ${p.failed || 0} FAILED` : 'NO FRAMES YET';
  const commit = p.commit || p.frame;
  $('currentCommit').textContent = commit ? `${commit.hash.slice(0,10)} · ${commit.subject}` : running?'Preparing an isolated checkout…':state.kind==='inspect'?'Commit selection is ready below.':'Inspect commits to see which revisions will be captured.';
  outputButton();
  $('preview').disabled = running || !state.latestFile;
  if(state.latestFile) {
    const key = `${state.runId}/${state.latestFile}`;
    if(key!==imageKey) { imageKey=key; $('latest').src='output/'+state.latestFile+'?run='+state.runId; }
    $('latest').hidden=false; $('empty').hidden=true;
  } else { $('latest').hidden=true; $('empty').hidden=false; imageKey=''; }
  const text = state.logs.join('\n');
  if(text!==logText) { logText=text; $('logs').textContent=text || 'No capture running.'; $('logs').scrollTop=$('logs').scrollHeight; }
  if(state.error) error(state.error);
  const selected = state.result?.selected;
  $('commitList').hidden = !Array.isArray(selected);
  if(Array.isArray(selected) && listKey!==String(state.runId)) {
    listKey=String(state.runId); $('commits').replaceChildren(...selected.map(c=>{const li=document.createElement('li');li.textContent=`${c.hash.slice(0,10)}  ${c.subject}`;return li;}));
  }
}
async function poll() { try { await refresh(); } catch(e) { error('Connection to the capture engine was lost. '+e.message); } setTimeout(poll,700); }
try {
  const {version} = await api('version');
  $('version').textContent = `v${version}`; $('version').hidden = false;
  document.title = `Animate Commits v${version}`;
  fill(await api('defaults')); showRecent(await api('recent')); await poll();
} catch(e) { error(e.message); }
