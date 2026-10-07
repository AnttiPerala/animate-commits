import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

export function launch(command, args, { cwd, env, log, shell = false } = {}) {
  const child = spawn(command, args, {
    cwd, env: { ...process.env, ...env }, shell, windowsHide: true,
    detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'],
  });
  let tail = '';
  const output = data => { tail = (tail + data).slice(-8000); log?.write(data); };
  child.stdout.on('data', output);
  child.stderr.on('data', output);
  const state = { child, exited: false, error: null, tail: () => tail };
  state.done = new Promise(resolve => {
    child.once('error', error => { state.error = error; state.exited = true; resolve(-1); });
    child.once('close', code => { state.exited = true; resolve(code ?? -1); });
  });
  return state;
}

export async function stop(state) {
  if (!state?.child.pid) return;
  const pid = state.child.pid;
  if (process.platform === 'win32') {
    if (!state.exited) {
      await new Promise(resolve => {
        const killer = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        killer.once('error', resolve); killer.once('exit', resolve);
      });
    }
  } else {
    try { process.kill(-pid, 'SIGTERM'); } catch { /* already stopped */ }
    await Promise.race([state.done, delay(500)]);
    try { process.kill(-pid, 'SIGKILL'); } catch { /* already stopped */ }
  }
  await Promise.race([state.done, delay(3000)]);
}

export async function run(command, args, options = {}) {
  options.signal?.throwIfAborted();
  const state = launch(command, args, options);
  let timer;
  let abort;
  try {
    const code = await Promise.race([
      state.done,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`Command timed out: ${command}`)), options.timeout || 300000); }),
      new Promise((_, reject) => {
        abort = () => reject(options.signal.reason);
        options.signal?.addEventListener('abort', abort, { once: true });
      }),
    ]);
    if (code !== 0) throw new Error(`${command} failed (${code}): ${state.error?.message || state.tail()}`);
    return state.tail();
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
    await stop(state);
  }
}
