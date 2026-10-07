import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { launch, run, stop } from '../src/process.js';

test('double-click entry opens the graphical window without a console and closes cleanly', {
  skip: !process.env.ANIMATE_GUI_EXE || process.platform !== 'win32', timeout: 120000,
}, async () => {
  const executable = process.env.ANIMATE_GUI_EXE;
  const binary = await readFile(executable);
  assert.equal(binary.readUInt16LE(binary.readUInt32LE(0x3c) + 24 + 68), 2, 'EXE must use the Windows GUI subsystem');
  const temp = await mkdtemp(join(tmpdir(), 'animate-gui-exe-test-'));
  const app = launch(executable, [], { cwd: temp });
  try {
    await mkdir(resolve('captures/gui'), { recursive: true });
    const options = join(temp, 'window.json');
    const screenshot = resolve('captures/gui/executable-window.png');
    await writeFile(options, JSON.stringify({ rootPid: app.child.pid, title: 'Animate Commits', width: 1320, height: 900,
      timeout: 60000, delay: 2000, output: screenshot, readyFile: null }));
    const output = await run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', resolve('helpers/capture-window.ps1'), '-OptionsFile', options], { timeout: 80000 });
    const metadata = JSON.parse(output);
    assert.match(metadata.title, /Animate Commits/);
    assert.equal(app.exited, false, app.tail());
    const frame = await readFile(screenshot);
    assert.equal(frame.readUInt32BE(16), 1320);
    await run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', resolve('test/close-gui-window.ps1'), '-TargetProcessId', String(metadata.processId)]);
    const exit = await Promise.race([app.done, delay(20000).then(() => 'timeout')]);
    assert.equal(exit, 0, `Closing the GUI should stop its engine: ${app.tail()}`);
  } finally { await stop(app); await rm(temp, { recursive: true, force: true, maxRetries: 3 }); }
});
