import { readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, run, stop } from './process.js';

export async function captureNative(c, cwd, env, stream, signal) {
  if (process.platform !== 'win32') throw new Error('Native desktop capture currently requires Windows');
  signal?.throwIfAborted();
  const app = launch(c.start, [], { cwd, env, log: stream, shell: true });
  const optionsFile = join(cwd, '.animate-native-options.json');
  const imageFile = join(cwd, '.animate-native-frame.png');
  const controller = new AbortController();
  const captureSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  const exited = app.done.then(() => controller.abort(new Error(`Native app exited before capture: ${app.error?.message || app.tail()}`)));
  try {
    await writeFile(optionsFile, JSON.stringify({ rootPid: app.child.pid, width: c.width, height: c.height,
      title: c.nativeWindowTitle, readyFile: c.nativeReadyFile ? join(cwd, c.nativeReadyFile) : null,
      timeout: c.timeout, delay: c.delay, output: imageFile }));
    const result = await run('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', fileURLToPath(new URL('../helpers/capture-window.ps1', import.meta.url)), '-OptionsFile', optionsFile],
    { cwd, signal: captureSignal, timeout: c.timeout + c.delay + 15000 });
    const metadata = JSON.parse(result);
    stream.write(`Native window: ${JSON.stringify(metadata)}\n`);
    signal?.throwIfAborted();
    return { screenshot: await readFile(imageFile), metadata };
  } finally {
    await stop(app);
    await exited;
    await rm(optionsFile, { force: true });
    await rm(imageFile, { force: true });
  }
}
