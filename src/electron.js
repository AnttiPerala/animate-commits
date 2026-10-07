import { _electron } from 'playwright';
import { createRequire } from 'node:module';
import { isAbsolute, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { stop } from './process.js';

// The capture loop consumes a Playwright Page; other desktop adapters can expose
// a different screenshot implementation later without changing history/export.
export async function openElectron(c, cwd, env, stream, signal) {
  signal?.throwIfAborted();
  let executablePath = c.electronExecutable;
  if (executablePath) executablePath = isAbsolute(executablePath) ? executablePath : resolve(cwd, executablePath);
  else {
    try { executablePath = createRequire(join(cwd, 'package.json'))('electron'); }
    catch { throw new Error('Electron is not installed in this checkout. Set install to "npm ci" (or your package manager command), or set electronExecutable.'); }
  }
  if (typeof executablePath !== 'string') throw new Error('The checkout electron package did not provide an executable path');
  const electronEnv = { ...process.env, ...env };
  // Desktop hosts may set this themselves. Even an empty value enables Node
  // mode in Electron; it must be absent for renderer windows to launch.
  for (const key of Object.keys(electronEnv)) if (key.toUpperCase() === 'ELECTRON_RUN_AS_NODE') delete electronEnv[key];
  const app = await _electron.launch({
    executablePath, cwd, timeout: c.timeout,
    args: ['--force-device-scale-factor=1', `--user-data-dir=${join(cwd, '.animate-electron-profile')}`, ...c.electronArgs],
    env: electronEnv,
    colorScheme: c.colorScheme, locale: c.locale, timezoneId: c.timezoneId,
  });
  const child = app.process();
  const state = { child, exited: child.exitCode !== null, done: null };
  state.done = state.exited ? Promise.resolve() : new Promise(resolve => child.once('exit', () => { state.exited = true; resolve(); }));
  child.stdout?.on('data', data => stream.write(data));
  child.stderr?.on('data', data => stream.write(data));
  let closing;
  const close = () => closing ||= (async () => {
    signal?.removeEventListener('abort', onAbort);
    await Promise.race([app.close().catch(() => {}), delay(2000)]);
    // Playwright owns a non-detached process on Unix, so terminate the child
    // directly there; taskkill terminates its process tree on Windows.
    if (process.platform === 'win32') await stop(state);
    else if (!state.exited) { child.kill('SIGKILL'); await state.done; }
  })();
  const onAbort = () => { close().catch(() => {}); };
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    signal?.throwIfAborted();
    let page = await app.firstWindow({ timeout: c.timeout });
    if (c.electronWindowUrl) {
      const pattern = new RegExp(c.electronWindowUrl);
      const deadline = Date.now() + c.timeout;
      while (!(page = app.windows().find(window => pattern.test(window.url())))) {
        signal?.throwIfAborted();
        if (state.exited) throw new Error('Electron exited before the selected window opened');
        if (Date.now() >= deadline) throw new Error(`No Electron window matched electronWindowUrl: ${c.electronWindowUrl}`);
        await delay(100, undefined, { signal });
      }
    }
    page.setDefaultTimeout(c.timeout);
    await page.waitForLoadState('load', { timeout: c.timeout });
    const window = await app.browserWindow(page);
    await window.evaluate((window, size) => {
      window.setMinimumSize(0, 0);
      window.setContentSize(size.width, size.height);
      // Hidden/minimized windows may stop producing Chromium compositor frames.
      // Show the selected window without taking keyboard focus before capture.
      if (window.isMinimized()) window.restore();
      window.showInactive();
    }, { width: c.width, height: c.height });
    await page.setViewportSize({ width: c.width, height: c.height });
    await page.emulateMedia({ colorScheme: c.colorScheme, reducedMotion: c.reducedMotion });
    const version = await app.evaluate(() => process.versions.electron);
    return { page, close, version };
  } catch (error) { await close(); throw error; }
}
