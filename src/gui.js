import http from 'node:http';
import { readFile, writeFile, mkdtemp, rm, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { tmpdir, homedir } from 'node:os';
import { chromium } from 'playwright';
import { capture } from './capture.js';
import { defaults, normalizeConfig, contained } from './config.js';
import { run } from './process.js';
import { recentRepositories } from './recent.js';
import { openFolder } from './open-folder.js';

const assets = fileURLToPath(new URL('../ui/', import.meta.url));
const dialogScript = fileURLToPath(new URL('../helpers/gui-dialog.ps1', import.meta.url));

export async function showGuiError(error) {
  if (process.platform === 'win32') {
    await run('powershell.exe', ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', dialogScript, '-Kind', 'error'],
      { env: { ANIMATE_GUI_MESSAGE: error.message || String(error) }, timeout: 3600000 }).catch(() => {});
  } else console.error(error);
}

async function pick(kind, signal) {
  return (await run('powershell.exe', ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', dialogScript, '-Kind', kind], { timeout: 3600000, signal })).trim();
}

export async function createGuiServer({ historyFile, folderOpener = openFolder } = {}) {
  const recent = recentRepositories(historyFile);
  const token = randomBytes(24).toString('hex');
  const lifetime = new AbortController();
  const base = `/${token}/`;
  const initial = { ...defaults, repo: '', output: join(homedir(), 'Videos', 'Animate Commits', new Date().toISOString().replace(/[:.]/g, '-')) };
  let state = { status: 'idle', kind: null, logs: [], progress: null, result: null, latestFile: null, output: null, runId: 0 };
  let controller, job, closing = false, picking = false;
  const addLog = message => { state.logs.push(String(message)); if (state.logs.length > 400) state.logs.shift(); };
  async function body(req) {
    let text = '';
    for await (const chunk of req) { text += chunk; if (text.length > 1024 * 1024) throw new Error('Request is too large'); }
    return text ? JSON.parse(text) : {};
  }
  function json(res, value, code = 200) { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify(value)); }
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    try {
      const origin = `http://127.0.0.1:${server.address().port}`;
      if (req.headers.host !== `127.0.0.1:${server.address().port}` || (req.headers.origin && req.headers.origin !== origin)) return json(res, { error: 'Forbidden' }, 403);
      const url = new URL(req.url, origin);
      if (!url.pathname.startsWith(base)) return json(res, { error: 'Not found' }, 404);
      const path = url.pathname.slice(base.length);
      if (req.method === 'GET') {
        if (path === 'api/state') return json(res, state);
        if (path === 'api/defaults') return json(res, initial);
        if (path === 'api/recent') return json(res, await recent.list());
        if (['', 'app.js', 'style.css'].includes(path)) {
          const file = path || 'index.html';
          res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; frame-src 'self'; object-src 'none'; base-uri 'none'");
          res.writeHead(200, { 'Content-Type': file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html; charset=utf-8' });
          return res.end(await readFile(join(assets, file)));
        }
        if (state.output && /^output\/(preview\.html|frames\/frame-\d{6,}\.png)$/.test(path)) {
          const file = resolve(state.output, path.slice(7));
          if (!contained(await realpath(state.output), await realpath(file))) return json(res, { error: 'Forbidden' }, 403);
          res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self'; object-src 'none'; base-uri 'none'");
          res.writeHead(200, { 'Content-Type': file.endsWith('.png') ? 'image/png' : 'text/html; charset=utf-8' });
          return res.end(await readFile(file));
        }
        return json(res, { error: 'Not found' }, 404);
      }
      if (req.method !== 'POST' || req.headers['content-type'] !== 'application/json') return json(res, { error: 'JSON POST required' }, 405);
      const data = await body(req);
      if (path === 'api/recent') return json(res, await recent.add(data.repo));
      if (path === 'api/cancel') {
        if (controller && ['running', 'cancelling'].includes(state.status)) {
          state.status = 'cancelling'; controller.abort(new Error('Capture cancelled'));
        }
        return json(res, { ok: true });
      }
      if (path === 'api/start') {
        if (closing || ['running', 'cancelling'].includes(state.status)) return json(res, { error: 'A capture is already running' }, 409);
        const config = normalizeConfig(data.config);
        if (data.kind !== 'capture' && data.kind !== 'inspect') throw new Error('Invalid operation');
        delete config.list;
        config.list = data.kind === 'inspect';
        controller = new AbortController();
        state = { status: 'running', kind: data.kind, logs: [], progress: null, result: null, latestFile: null,
          output: config.list ? null : config.output, runId: state.runId + 1 };
        job = capture(config, { signal: controller.signal, log: addLog, onProgress: progress => {
          state.progress = progress;
          if (state.output && progress.frame?.file) state.latestFile = progress.frame.file;
        } }).then(result => {
          state.result = result; state.status = (result.runFailed ?? result.failed) ? 'completed-with-errors' : 'completed';
        }).catch(error => { state.status = controller.signal.aborted ? 'cancelled' : 'failed'; state.error = error.message; addLog(error.message); });
        const repositories = await recent.add(config.repo).catch(error => { addLog(`Could not save recent repositories: ${error.message}`); return null; });
        return json(res, { ok: true, repositories });
      }
      if (path === 'api/browse' || path === 'api/load' || path === 'api/save') {
        if (picking || ['running', 'cancelling'].includes(state.status)) return json(res, { error: 'Finish the current operation first' }, 409);
        picking = true;
        try {
          if (path === 'api/browse') {
            const folder = await pick('folder', lifetime.signal);
            const repositories = folder && data.target === 'repo' ? await recent.add(folder) : undefined;
            return json(res, { path: folder, repositories });
          }
          if (path === 'api/load') {
            const file = await pick('load', lifetime.signal);
            if (!file) return json(res, { cancelled: true });
            const config = normalizeConfig(JSON.parse((await readFile(file, 'utf8')).replace(/^\uFEFF/, '')), file);
            return json(res, { config, repositories: await recent.add(config.repo) });
          }
          const config = normalizeConfig(data.config);
          delete config.list;
          const file = await pick('save', lifetime.signal);
          if (file) await writeFile(file, JSON.stringify(config, null, 2) + '\n');
          return json(res, { path: file });
        } finally { picking = false; }
      }
      if (path === 'api/open-output') {
        const folder = await folderOpener(data.output ?? state.output);
        return json(res, { ok: true, path: folder });
      }
      json(res, { error: 'Not found' }, 404);
    } catch (error) { if (!res.headersSent) json(res, { error: error.message }, 400); else res.end(); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return {
    url: `http://127.0.0.1:${server.address().port}${base}`,
    close: async () => {
      closing = true; controller?.abort(new Error('Window closed; capture cancelled'));
      lifetime.abort(new Error('Window closed'));
      await job;
      await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    },
  };
}

export async function startGui() {
  const app = await createGuiServer();
  const profile = await mkdtemp(join(tmpdir(), 'animate-commits-ui-'));
  let context;
  try {
    for (const channel of ['msedge', 'chrome', undefined]) {
      try {
        context = await chromium.launchPersistentContext(profile, { ...(channel ? { channel } : {}), headless: false, chromiumSandbox: true,
          viewport: null, ignoreDefaultArgs: ['--enable-automation', 'about:blank'], args: [`--app=${app.url}`, '--window-size=1320,940', '--no-first-run'] });
        break;
      } catch { /* Try another installed browser engine. */ }
    }
    if (!context) throw new Error('The graphical interface needs Microsoft Edge or Google Chrome. Install one and open Animate Commits again.');
    const page = context.pages().find(page => page.url().startsWith(app.url)) || context.pages()[0] || await context.newPage();
    if (!page.url().startsWith(app.url)) await page.goto(app.url);
    for (const other of context.pages()) if (other !== page && other.url() === 'about:blank') await other.close();
    await new Promise(resolve => { page.once('close', resolve); context.once('close', resolve); });
  } finally {
    await app.close();
    await context?.close().catch(() => {});
    await rm(profile, { recursive: true, force: true, maxRetries: 3 });
  }
}
