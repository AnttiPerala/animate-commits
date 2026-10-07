import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { git } from '../src/git.js';
import { run } from '../src/process.js';

test('standalone executable captures a web repository from an unrelated directory', {
  skip: !process.env.ANIMATE_TEST_EXE, timeout: 90000,
}, async () => {
  const temp = await mkdtemp(join(tmpdir(), 'animate-exe-test-'));
  try {
    await git(['init', '.'], temp);
    await git(['config', 'user.email', 'fixture@example.invalid'], temp);
    await git(['config', 'user.name', 'Fixture'], temp);
    await writeFile(join(temp, 'index.html'), '<h1>Packaged browser capture</h1>');
    await git(['add', '.'], temp); await git(['commit', '-m', 'Web app'], temp);
    await run(process.env.ANIMATE_TEST_EXE, [temp, '--output', join(temp, 'output'), '--width', '640', '--height', '360'], { cwd: temp, timeout: 60000 });
    const manifest = JSON.parse(await readFile(join(temp, 'output/manifest.json'), 'utf8'));
    assert.equal(manifest.captured, 1);
    assert.equal(manifest.failed, 0);
    const frame = await readFile(join(temp, 'output/frames/frame-000001.png'));
    assert.equal(frame.readUInt32BE(16), 640);
    assert.equal(frame.readUInt32BE(20), 360);
    await writeFile(join(temp, 'index.html'), '<h1>New packaged revision</h1>');
    await git(['add', 'index.html'], temp); await git(['commit', '-m', 'New revision'], temp);
    const args = [temp, '--update', '--output', join(temp, 'output'), '--width', '640', '--height', '360'];
    await run(process.env.ANIMATE_TEST_EXE, args, { cwd: temp, timeout: 60000 });
    const updated = await readFile(join(temp, 'output/manifest.json'));
    assert.equal(JSON.parse(updated).captured, 2);
    assert.deepEqual(await readFile(join(temp, 'output/frames/frame-000001.png')), frame);
    await run(process.env.ANIMATE_TEST_EXE, args, { cwd: temp, timeout: 60000 });
    assert.deepEqual(await readFile(join(temp, 'output/manifest.json')), updated);
  } finally { await rm(temp, { recursive: true, force: true, maxRetries: 3 }); }
});
