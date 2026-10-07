import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { capture } from '../src/capture.js';
import { git } from '../src/git.js';
import { run } from '../src/process.js';
import { setTimeout as delay } from 'node:timers/promises';
import { captureNative } from '../src/native.js';
import { normalizeConfig } from '../src/config.js';

test('native Tkinter history captures own windows, skips failure, and terminates Python', {
  skip: process.platform !== 'win32', timeout: 120000,
}, async () => {
  const temp = await mkdtemp(join(tmpdir(), 'animate-native-test-'));
  try {
    await run('python', ['-c', 'import tkinter'], { cwd: temp });
    await git(['init', '.'], temp);
    await git(['config', 'user.email', 'fixture@example.invalid'], temp);
    await git(['config', 'user.name', 'Fixture'], temp);
    for (const [title, color] of [['Initial desktop', '#df6844'], ['Broken desktop', null], ['Updated desktop', '#306b97']]) {
      await writeFile(join(temp, 'app.py'), color ? `import tkinter as tk\nfrom pathlib import Path\nr=tk.Tk()\nr.title('Animate Native Fixture café')\nr.configure(bg='${color}')\nr.geometry('320x240')\ntk.Label(r,text='${title}',bg='${color}',fg='white',font=('Arial',24)).pack(pady=50)\nr.after(100,lambda:Path('ready.flag').touch())\nr.mainloop()\n` : 'raise RuntimeError("Deliberate historical failure")\n');
      await git(['add', '.'], temp); await git(['commit', '-m', title], temp);
    }
    const output = join(temp, 'output');
    const config = { repo: temp, output, appType: 'native', start: 'python app.py', nativeWindowTitle: '^Animate Native Fixture café$',
      nativeReadyFile: 'ready.flag', width: 640, height: 360, delay: 200, timeout: 15000 };
    let result;
    if (process.env.ANIMATE_TEST_EXE) {
      const configFile = join(temp, 'capture.json');
      await writeFile(configFile, JSON.stringify(config));
      await assert.rejects(run(process.env.ANIMATE_TEST_EXE, ['--config', configFile], { cwd: temp, timeout: 90000 }), /failed \(1\)/);
      result = JSON.parse(await readFile(join(output, 'manifest.json'), 'utf8'));
    } else result = await capture(config, { log: () => {} });
    assert.equal(result.captured, 2, JSON.stringify(result.frames));
    assert.equal(result.failed, 1);
    const first = await readFile(join(output, 'frames/frame-000001.png'));
    const last = await readFile(join(output, 'frames/frame-000002.png'));
    assert.equal(first.readUInt32BE(16), 640);
    assert.equal(first.readUInt32BE(20), 360);
    assert.ok(!first.equals(last));
    for (const frame of result.frames.filter(f => f.status === 'captured')) {
      assert.equal(frame.nativeWindow.title, 'Animate Native Fixture café');
      assert.throws(() => process.kill(frame.nativeWindow.processId, 0), /ESRCH/);
    }
  } finally { await rm(temp, { recursive: true, force: true, maxRetries: 3 }); }
});

test('native timeout and cancellation terminate launched applications', {
  skip: process.platform !== 'win32', timeout: 60000,
}, async () => {
  const temp = await mkdtemp(join(tmpdir(), 'animate-native-stop-test-'));
  try {
    await writeFile(join(temp, 'app.py'), `import tkinter as tk,os\nfrom pathlib import Path\nr=tk.Tk()\nr.title('Cleanup Fixture')\nPath('pid.txt').write_text(str(os.getpid()))\nr.mainloop()\n`);
    const config = normalizeConfig({ repo: temp, appType: 'native', start: 'python app.py', nativeWindowTitle: '^Does not exist$', timeout: 500, delay: 0 });
    const stream = { write() {} };
    await assert.rejects(captureNative(config, temp, {}, stream), /Timed out/);
    const firstPid = Number(await readFile(join(temp, 'pid.txt'), 'utf8'));
    assert.throws(() => process.kill(firstPid, 0), /ESRCH/);
    await rm(join(temp, 'pid.txt'));
    const controller = new AbortController();
    const running = captureNative({ ...config, timeout: 30000 }, temp, {}, stream, controller.signal);
    const rejected = assert.rejects(running, /Cancelled by test/);
    let secondPid;
    for (let attempts = 0; attempts < 100; attempts++) {
      try { secondPid = Number(await readFile(join(temp, 'pid.txt'), 'utf8')); if (secondPid) break; } catch {}
      await delay(100);
    }
    controller.abort(new Error('Cancelled by test'));
    await rejected;
    assert.ok(secondPid, 'Python must have started before cancellation');
    assert.throws(() => process.kill(secondPid, 0), /ESRCH/);
  } finally { await rm(temp, { recursive: true, force: true, maxRetries: 3 }); }
});
