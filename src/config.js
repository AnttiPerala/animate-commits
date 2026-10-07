import { resolve, dirname, isAbsolute, relative, sep } from 'node:path';

export const defaults = {
  ref: 'HEAD', from: null, every: 1, maxFrames: 60,
  directory: '.', staticDir: '.', install: null, start: null,
  url: 'http://127.0.0.1:{port}/', port: 4173,
  width: 1920, height: 1080, delay: 1000, selector: null,
  timeout: 60000, commandTimeout: 300000, fps: 2,
  colorScheme: 'light', reducedMotion: 'reduce', locale: 'en-US', timezoneId: 'UTC',
  failFast: false, env: {}, browser: 'auto',
  appType: 'web', electronExecutable: null, electronArgs: ['.'], electronWindowUrl: null,
  nativeWindowTitle: null, nativeReadyFile: null,
  update: false, cloneTimeout: 1800000,
};

export function normalizeConfig(input, configFile) {
  const allowed = new Set([...Object.keys(defaults), 'repo', 'output', 'list']);
  for (const key of Object.keys(input)) if (!allowed.has(key)) throw new Error(`Unknown configuration field: ${key}`);
  const c = { ...defaults, ...input };
  if (typeof c.update !== 'boolean') throw new Error('update must be true or false');
  if (typeof c.repo !== 'string' || !c.repo.trim()) throw new Error('A repository path or URL is required. Use --help for usage.');
  const base = configFile ? dirname(configFile) : process.cwd();
  if (!/^(?:[\w+.-]+:\/\/|[^/\\]+@[^:]+:)/.test(c.repo)) c.repo = resolve(base, c.repo);
  c.output = resolve(base, c.output || 'captures');
  for (const key of ['every', 'maxFrames', 'width', 'height', 'timeout', 'commandTimeout', 'cloneTimeout', 'fps', 'port']) {
    if (!Number.isSafeInteger(c[key]) || c[key] <= 0) throw new Error(`${key} must be a positive integer`);
  }
  if (c.port > 65535) throw new Error('port must be at most 65535');
  if (!Number.isSafeInteger(c.delay) || c.delay < 0) throw new Error('delay must be a nonnegative integer');
  for (const key of ['ref', 'directory', 'staticDir', 'url', 'locale', 'timezoneId']) {
    if (typeof c[key] !== 'string' || !c[key]) throw new Error(`${key} must be a nonempty string`);
  }
  for (const key of ['from', 'install', 'start', 'selector', 'electronExecutable', 'electronWindowUrl', 'nativeWindowTitle', 'nativeReadyFile']) {
    if (c[key] !== null && typeof c[key] !== 'string') throw new Error(`${key} must be a string or null`);
  }
  for (const key of ['directory', 'staticDir']) {
    if (isAbsolute(c[key]) || c[key].split(/[\\/]/).includes('..')) throw new Error(`${key} must stay within the checkout`);
  }
  if (!['light', 'dark', 'no-preference'].includes(c.colorScheme)) throw new Error('Invalid colorScheme');
  if (!['auto', 'chromium', 'chrome', 'msedge'].includes(c.browser)) throw new Error('browser must be auto, chromium, chrome, or msedge');
  if (!['web', 'electron', 'native'].includes(c.appType)) throw new Error('appType must be web, electron, or native');
  if (c.appType === 'native') {
    if (!c.start?.trim()) throw new Error('Native capture requires a start command, for example python app.py');
    if (c.selector) throw new Error('Native apps do not have CSS selectors; use nativeWindowTitle and nativeReadyFile');
  }
  if (c.nativeWindowTitle !== null) {
    try { new RegExp(c.nativeWindowTitle); } catch { throw new Error('nativeWindowTitle must be a valid regular expression'); }
  }
  if (c.nativeReadyFile && (isAbsolute(c.nativeReadyFile) || c.nativeReadyFile.split(/[\\/]/).includes('..'))) throw new Error('nativeReadyFile must stay within the app directory');
  if (!Array.isArray(c.electronArgs) || c.electronArgs.some(arg => typeof arg !== 'string')) throw new Error('electronArgs must be an array of strings');
  if (c.electronWindowUrl !== null) {
    try { new RegExp(c.electronWindowUrl); } catch { throw new Error('electronWindowUrl must be a valid regular expression'); }
  }
  if (!['reduce', 'no-preference'].includes(c.reducedMotion)) throw new Error('Invalid reducedMotion');
  if (!c.env || typeof c.env !== 'object' || Array.isArray(c.env) || Object.values(c.env).some(v => typeof v !== 'string')) throw new Error('env must contain string values');
  const url = new URL(c.url.replaceAll('{port}', String(c.port)));
  if (!['http:', 'https:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new Error('url must point to a local HTTP(S) server');
  return c;
}

export function contained(root, path) {
  const rel = relative(root, path);
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`));
}

export function selectCommits(commits, { from, every, maxFrames }) {
  let selected = commits;
  if (from) {
    const index = selected.findIndex(c => c.hash === from);
    if (index < 0) throw new Error('--from is not on the selected first-parent history');
    selected = selected.slice(index);
  }
  if (!selected.length) throw new Error('No commits found');
  const last = selected.at(-1);
  selected = selected.filter((_, index) => index % every === 0);
  if (selected.at(-1) !== last) selected.push(last);
  if (selected.length > maxFrames) {
    if (maxFrames === 1) return [last];
    selected = Array.from({ length: maxFrames }, (_, i) => selected[Math.round(i * (selected.length - 1) / (maxFrames - 1))]);
  }
  return selected;
}
