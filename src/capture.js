import { mkdir, mkdtemp, readdir, writeFile, rename, realpath } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { launchBrowser } from './browser.js';
import { normalizeConfig, selectCommits, contained } from './config.js';
import { git, history, resolveRef } from './git.js';
import { launch, run, stop } from './process.js';
import { assertPortFree, staticServer } from './server.js';
import { previewHtml } from './preview.js';
import { openElectron } from './electron.js';
import { captureNative } from './native.js';
import { lockOutput, lockName, readExistingCapture, selectUpdates } from './updates.js';
import { cleanupWorkspace } from './cleanup.js';
import { detectSetup } from './detect.js';

async function ready(url, server, timeout, signal) {
  const deadline = Date.now() + timeout;
  let last = '';
  while (Date.now() < deadline) {
    signal?.throwIfAborted();
    if (server?.exited) throw new Error(`App server exited before capture: ${server.error?.message || server.tail()}`);
    try {
      const timeoutSignal = AbortSignal.timeout(Math.min(2000, Math.max(1, deadline - Date.now())));
      const response = await fetch(url, { signal: signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal });
      await response.body?.cancel();
      if (response.ok) return;
      last = `HTTP ${response.status}`;
    } catch (error) { last = error.message; }
    await delay(200, undefined, { signal });
  }
  throw new Error(`App did not become ready at ${url} within ${timeout}ms (${last})`);
}

async function save(output, manifest) {
  await writeFile(join(output, 'manifest.json.tmp'), JSON.stringify(manifest, null, 2) + '\n');
  await rename(join(output, 'manifest.json.tmp'), join(output, 'manifest.json'));
  await writeFile(join(output, 'preview.html'), previewHtml(manifest));
}

export async function capture(input, { configFile, signal, log = console.log, onProgress = () => {} } = {}) {
  const c = normalizeConfig(input, configFile);
  // Catch the common missing-server setup before cloning and repeating 404s.
  if (!c.list && c.appType === 'web' && !c.start && !c.install && c.staticDir === '.' && new URL(c.url.replaceAll('{port}', String(c.port))).pathname === '/') {
    const setup = await detectSetup(c.repo, c.directory).catch(() => null);
    if(setup?.candidates.length && !setup.candidates.some(item => item.settings.appType === 'web' && !item.settings.start && !item.settings.install && item.settings.directory === c.directory && item.settings.staticDir === '.')) {
      const item = setup.candidates[0];
      throw new Error(`This project needs application setup (${item.label}). Click Detect setup, then Use these settings before capturing. Suggested install: ${item.settings.install || '(none)'}; start: ${item.settings.start || '(built-in capture)'}.`);
    }
  }
  if (c.appType === 'native' && process.platform !== 'win32') throw new Error('Native desktop capture currently requires Windows');
  const url = c.url.replaceAll('{port}', String(c.port));
  const urlPort = Number(new URL(url).port || (url.startsWith('https:') ? 443 : 80));
  if (urlPort !== c.port) throw new Error('The URL port must match the port configuration. Use {port} in the URL.');
  let temp, repo, unlock;
  let browser;
  let onAbort;
  let manifest;
  let initialCaptured = 0, initialFailed = 0;
  const runId = randomUUID();
  try {
    if (!c.list) {
      unlock = await lockOutput(c.output);
      if (!c.update && (await readdir(c.output)).some(name => name !== lockName)) throw new Error(`Output folder must be empty: ${c.output}. Enable Update existing capture to append new commits.`);
    } else if (c.update && (await readdir(c.output)).includes(lockName)) throw new Error('The existing capture is currently locked by another run');
    const existing = c.update ? await readExistingCapture(c) : null;
    temp = await mkdtemp(join(tmpdir(), 'animate-commits-'));
    repo = join(temp, 'repository');
    log('Cloning repository into an isolated temporary workspace…');
    await git(['clone', '--progress', '--no-local', '--no-checkout', '--', c.repo, repo], temp, signal, { timeout: c.cloneTimeout, log });
    log('Clone complete. Reading commit history…');
    const commits = await history(repo, c.ref, signal);
    const from = c.from ? await resolveRef(repo, c.from, signal) : null;
    const selected = existing ? selectUpdates(commits, existing, { ...c, from }) : selectCommits(commits, { ...c, from });
    log(`Selected ${selected.length} of ${commits.length} commits (oldest → newest).`);
    initialCaptured = existing?.manifest.captured || 0;
    initialFailed = existing?.manifest.failed || 0;
    onProgress({ phase: 'selected', total: selected.length, completed: 0, captured: initialCaptured, failed: initialFailed,
      frame: existing?.manifest.frames.filter(frame => frame.status === 'captured').at(-1) });
    if (c.list) {
      for (const commit of selected) log(`${commit.hash.slice(0,10)}  ${commit.date}  ${commit.subject}`);
      return { selected, failed: 0 };
    }
    if (existing && selected.length === 0) {
      log('Already up to date. No new commits; existing images and manifest were left unchanged.');
      return { ...existing.manifest, added: 0, runFailed: 0, noNewCommits: true };
    }
    if (existing) {
      await mkdir(join(c.output, 'history'), { recursive: true });
      if (!contained(await realpath(c.output), await realpath(join(c.output, 'history')))) throw new Error('history must stay inside the capture folder');
      await writeFile(join(c.output, 'history', `manifest-${runId}.json`), existing.original, { flag: 'wx' });
      manifest = existing.manifest;
      manifest.status = 'running';
      manifest.selected = manifest.frames.length + selected.length;
      manifest.lastProcessedCommit = existing.lastProcessed;
      delete manifest.error;
      delete manifest.finishedAt;
    } else {
      await mkdir(join(c.output, 'frames'));
      await mkdir(join(c.output, 'logs'));
      manifest = {
      version: 1, createdAt: new Date().toISOString(), status: 'running',
      // Commands, environment values, and repository URLs may contain credentials.
      settings: { appType: c.appType, ref: c.ref, from: c.from, width: c.width, height: c.height, fps: c.fps, every: c.every, maxFrames: c.maxFrames },
      selected: selected.length, captured: 0, failed: 0, frames: [],
      };
    }
    manifest.lastRun = { id: runId, update: c.update, startedAt: new Date().toISOString(), selected: selected.length,
      every: c.every, maxFrames: c.maxFrames, ref: c.ref, head: commits.at(-1).hash };
    const attemptOffset = manifest.frames.length;
    await save(c.output, manifest);
    if (c.appType === 'web') {
      browser = await launchBrowser(c.browser);
      manifest.browserVersion = browser.version();
    }
    onAbort = () => { browser?.close().catch(() => {}); };
    signal?.addEventListener('abort', onAbort, { once: true });
    for (const [index, commit] of selected.entries()) {
      signal?.throwIfAborted();
      const checkout = join(temp, `commit-${index}`);
      const logName = `logs/${String(attemptOffset + index + 1).padStart(6, '0')}-${commit.hash.slice(0, 10)}-${runId}.log`;
      const stream = createWriteStream(join(c.output, logName), { flags: 'wx' });
      // Surface disk errors through the commit operation instead of an uncaught event.
      let streamError;
      stream.on('error', error => { streamError = error; });
      let server, staticApp, context, electron;
      const frame = { ...commit, status: 'pending', log: logName };
      const startTime = Date.now();
      log(`[${index + 1}/${selected.length}] ${commit.hash.slice(0, 10)} ${commit.subject}`);
      onProgress({ phase: 'capturing', total: selected.length, completed: index, captured: manifest.captured, failed: manifest.failed, commit });
      try {
        await git(['worktree', 'add', '--detach', checkout, commit.hash], repo, signal);
        const cwd = await realpath(resolve(checkout, c.directory));
        if (!contained(await realpath(checkout), cwd)) throw new Error('App directory resolves outside the checkout');
        const env = { ...c.env, PORT: String(c.port), HOST: '127.0.0.1', CI: '1' };
        const expand = command => command.replaceAll('{port}', String(c.port));
        if (c.install) await run(expand(c.install), [], { cwd, env, log: stream, shell: true, signal, timeout: c.commandTimeout });
        if (c.appType === 'web' || (c.appType === 'electron' && c.start)) await assertPortFree(c.port);
        if (c.start && c.appType !== 'native') {
          server = launch(expand(c.start), [], { cwd, env, log: stream, shell: true });
          await ready(url, server, c.timeout, signal);
        } else if (c.appType === 'web') {
          const root = await realpath(resolve(cwd, c.staticDir));
          if (!contained(await realpath(checkout), root)) throw new Error('Static directory resolves outside the checkout');
          staticApp = await staticServer(root, c.port);
        }
        let page, screenshot;
        if (c.appType === 'native') {
          const native = await captureNative(c, cwd, env, stream, signal);
          screenshot = native.screenshot;
          frame.nativeWindow = native.metadata;
        } else if (c.appType === 'electron') {
          electron = await openElectron(c, cwd, env, stream, signal);
          page = electron.page;
          frame.electronVersion = electron.version;
        } else {
          if (!c.start) await ready(url, server, c.timeout, signal);
          context = await browser.newContext({ viewport: { width: c.width, height: c.height }, deviceScaleFactor: 1,
            colorScheme: c.colorScheme, reducedMotion: c.reducedMotion, locale: c.locale, timezoneId: c.timezoneId,
            serviceWorkers: 'block' });
          page = await context.newPage();
          const response = await page.goto(url, { waitUntil: 'load', timeout: c.timeout });
          if (!response?.ok()) throw new Error(`Navigation failed: HTTP ${response?.status()}`);
        }
        if (page) {
          page.setDefaultTimeout(c.timeout);
          page.on('pageerror', error => stream.write(`Browser error: ${error.message}\n`));
          if (c.selector) await page.locator(c.selector).first().waitFor({ state: 'visible' });
          await page.waitForFunction(() => !document.fonts || document.fonts.status === 'loaded');
          await delay(c.delay, undefined, { signal });
          screenshot = await page.screenshot({ animations: 'disabled', caret: 'hide', fullPage: false, scale: 'css', timeout: c.timeout });
        }
        if (server?.exited) throw new Error('App server exited during capture');
        if (streamError) throw streamError;
        signal?.throwIfAborted();
        const file = `frames/frame-${String(manifest.captured + 1).padStart(6, '0')}.png`;
        await writeFile(join(c.output, file), screenshot, { flag: 'wx' });
        Object.assign(frame, { status: 'captured', file, number: ++manifest.captured });
      } catch (error) {
        frame.status = signal?.aborted ? 'cancelled' : 'failed';
        frame.error = error.message;
        manifest.failed++;
        stream.write(`\nCapture failed: ${error.stack || error.message}\n`);
        log(`  ${frame.status}: ${error.message.split('\n')[0]}`);
      } finally {
        await electron?.close();
        await context?.close().catch(() => {});
        await stop(server);
        await staticApp?.close();
        await new Promise(resolve => { if (stream.destroyed) resolve(); else stream.end(resolve); });
        frame.durationMs = Date.now() - startTime;
        manifest.frames.push(frame);
        if (frame.status !== 'cancelled') manifest.lastProcessedCommit = frame.hash;
        await save(c.output, manifest);
        onProgress({ phase: 'frame', total: selected.length, completed: index + 1, captured: manifest.captured, failed: manifest.failed, frame });
        // Only this run's disposable checkout is removed, never the input repository.
        await git(['worktree', 'remove', '--force', checkout], repo).catch(() => {});
      }
      signal?.throwIfAborted();
      if (c.failFast && frame.status === 'failed') break;
    }
    manifest.status = manifest.failed ? 'completed-with-errors' : 'completed';
    manifest.finishedAt = new Date().toISOString();
    manifest.lastRun.finishedAt = manifest.finishedAt;
    manifest.lastRun.added = manifest.captured - initialCaptured;
    manifest.lastRun.failed = manifest.failed - initialFailed;
    if (c.update) manifest.updatedAt = manifest.finishedAt;
    await save(c.output, manifest);
    log(`\n${c.update ? 'Added' : 'Saved'} ${manifest.captured - initialCaptured} frames; ${manifest.failed - initialFailed} failed this run. ${manifest.captured} total frames.\nPreview: ${join(c.output, 'preview.html')}\nSequence: ${join(c.output, 'frames', 'frame-000001.png')}`);
    return { ...manifest, added: manifest.captured - initialCaptured, runFailed: manifest.failed - initialFailed };
  } catch (error) {
    if (manifest) {
      manifest.status = signal?.aborted ? 'cancelled' : 'failed';
      manifest.error = error.message;
      await save(c.output, manifest).catch(saveError => log(`Could not save failure details: ${saveError.message}`));
    }
    throw error;
  } finally {
    signal?.removeEventListener('abort', onAbort);
    await browser?.close().catch(error => log(`Browser cleanup warning: ${error.message}`));
    await cleanupWorkspace(temp, log);
    await unlock?.().catch(error => log(`Output lock cleanup warning: ${error.message}`));
  }
}
