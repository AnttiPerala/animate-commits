import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { capture } from '../src/capture.js';
import { git } from '../src/git.js';
import { run } from '../src/process.js';

const executable = process.env.ANIMATE_ELECTRON_EXECUTABLE;
test('Electron history selects main window, captures fixed-size frames, and survives a broken revision', {
  skip: !executable && 'Set ANIMATE_ELECTRON_EXECUTABLE to an Electron binary to run this integration test', timeout: 90000,
}, async () => {
  const temp = await mkdtemp(join(tmpdir(), 'animate-electron-test-'));
  try {
    await git(['init', '.'], temp);
    await git(['config', 'user.email', 'fixture@example.invalid'], temp);
    await git(['config', 'user.name', 'Fixture'], temp);
    await writeFile(join(temp, 'package.json'), JSON.stringify({ main: 'main.cjs' }));
    await writeFile(join(temp, 'main.cjs'), `const {app,BrowserWindow}=require('electron');
      app.whenReady().then(()=>{
        const splash=new BrowserWindow({show:false});splash.loadURL('data:text/html,Splash');
        const main=new BrowserWindow({width:300,height:250,show:false});main.loadFile('index.html');
      });`);
    for (const [name, html] of [['First Electron UI', '<body style="background:tomato"><h1>First</h1>'], ['Broken Electron UI', null], ['Final Electron UI', '<body style="background:steelblue"><h1>Final</h1>']]) {
      if (html) await writeFile(join(temp, 'index.html'), html);
      else await rm(join(temp, 'index.html'));
      await git(['add', '.'], temp); await git(['commit', '-m', name], temp);
    }
    const output = join(temp, 'output');
    const config = { repo: temp, output, appType: 'electron', electronExecutable: executable,
      electronWindowUrl: 'index\\.html$', selector: 'h1', width: 640, height: 360, timeout: 15000, delay: 0 };
    let result;
    if (process.env.ANIMATE_TEST_EXE) {
      const configFile = join(temp, 'capture.json');
      await writeFile(configFile, JSON.stringify(config));
      await assert.rejects(run(process.env.ANIMATE_TEST_EXE, ['--config', configFile], { cwd: temp, timeout: 80000 }), /failed \(1\)/);
      result = JSON.parse(await readFile(join(output, 'manifest.json'), 'utf8'));
    } else result = await capture(config, { log: () => {} });
    assert.equal(result.captured, 2, JSON.stringify(result.frames));
    assert.equal(result.failed, 1);
    assert.deepEqual(result.frames.map(f => f.status), ['captured', 'failed', 'captured']);
    const first = await readFile(join(output, 'frames/frame-000001.png'));
    const last = await readFile(join(output, 'frames/frame-000002.png'));
    for (const png of [first, last]) { assert.equal(png.readUInt32BE(16), 640); assert.equal(png.readUInt32BE(20), 360); }
    assert.ok(!first.equals(last));
    assert.ok(result.frames[0].electronVersion);
  } finally { await rm(temp, { recursive: true, force: true, maxRetries: 3 }); }
});
