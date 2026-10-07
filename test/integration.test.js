import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import net from 'node:net';
import { capture } from '../src/capture.js';
import { git } from '../src/git.js';
import { launchBrowser } from '../src/browser.js';

async function freePort() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

test('real Git history → screenshots, skipped failure, preview, source unchanged', { timeout: 90000 }, async () => {
  const temp = await mkdtemp(join(tmpdir(), 'animate-commits-test-'));
  try {
    await git(['init', '.'], temp);
    await git(['config', 'user.email', 'fixture@example.invalid'], temp);
    await git(['config', 'user.name', 'Fixture'], temp);
    const commit = async message => { await git(['add', '.'], temp); await git(['commit', '-m', message], temp); };
    await writeFile(join(temp, 'index.html'), '<!doctype html><body style="background:#e74c3c"><h1>First version</h1></body>');
    await commit('First version');
    await rm(join(temp, 'index.html'));
    await writeFile(join(temp, 'broken.txt'), 'No index file in this revision');
    await commit('Broken historical version');
    await writeFile(join(temp, 'index.html'), '<!doctype html><body style="background:#3498db"><h1>Final version</h1></body>');
    await commit('Final version');
    await writeFile(join(temp, 'untracked.txt'), 'Keep this');
    await writeFile(join(temp, 'index.html'), 'Uncommitted changes must survive');
    const before = await git(['status', '--porcelain'], temp);
    const head = await git(['rev-parse', 'HEAD'], temp);
    const output = join(temp, 'output');
    const result = await capture({ repo: temp, output, width: 640, height: 360, delay: 0, timeout: 1500, port: await freePort() }, { log: () => {} });
    assert.equal(result.captured, 2);
    assert.equal(result.failed, 1);
    assert.deepEqual(result.frames.map(f => f.status), ['captured', 'failed', 'captured']);
    assert.deepEqual(await readdir(join(output, 'frames')), ['frame-000001.png', 'frame-000002.png']);
    const first = await readFile(join(output, 'frames/frame-000001.png'));
    const last = await readFile(join(output, 'frames/frame-000002.png'));
    assert.equal(first.readUInt32BE(16), 640);
    assert.equal(first.readUInt32BE(20), 360);
    assert.ok(!first.equals(last), 'different revisions must produce different images');
    assert.equal(await readFile(join(temp, 'index.html'), 'utf8'), 'Uncommitted changes must survive');
    assert.equal(await git(['rev-parse', 'HEAD'], temp), head);
    assert.equal((await git(['status', '--porcelain'], temp)).replace('?? output/\n', '').replace('\n?? output/', ''), before);
    const browser = await launchBrowser();
    try {
      const page = await browser.newPage();
      const { pathToFileURL } = await import('node:url');
      await page.goto(pathToFileURL(join(output, 'preview.html')).href);
      await page.locator('#frame').evaluate(img => img.decode());
      assert.equal(await page.locator('#message').textContent(), 'First version');
      await page.locator('#next').click();
      assert.equal(await page.locator('#message').textContent(), 'Final version');
      await page.locator('#play').click();
      assert.equal(await page.locator('#play').textContent(), 'Pause');
    } finally { await browser.close(); }
    await assert.rejects(capture({ repo: temp, output }, { log: () => {} }), /must be empty/);
  } finally { await rm(temp, { recursive: true, force: true, maxRetries: 3 }); }
});

test('custom server receives PORT, is stopped between commits, and fail-fast works', { timeout: 90000 }, async () => {
  const temp = await mkdtemp(join(tmpdir(), 'animate-commits-server-test-'));
  try {
    await git(['init', '.'], temp);
    await git(['config', 'user.email', 'fixture@example.invalid'], temp);
    await git(['config', 'user.name', 'Fixture'], temp);
    await writeFile(join(temp, 'server.cjs'), `require('http').createServer((req,res)=>res.end('<h1>Working</h1>')).listen(Number(process.env.PORT),process.env.HOST);`);
    await git(['add', '.'], temp); await git(['commit', '-m', 'Working server'], temp);
    await writeFile(join(temp, 'server.cjs'), 'process.exit(1);');
    await git(['add', '.'], temp); await git(['commit', '-m', 'Broken server'], temp);
    await writeFile(join(temp, 'later.txt'), 'later');
    await git(['add', '.'], temp); await git(['commit', '-m', 'Later commit'], temp);
    const port = await freePort();
    const result = await capture({ repo: temp, output: join(temp, 'output'), start: 'node server.cjs', delay: 0, timeout: 2000, port, failFast: true }, { log: () => {} });
    assert.equal(result.captured, 1);
    assert.equal(result.failed, 1);
    assert.equal(result.frames.length, 2);
    const { assertPortFree } = await import('../src/server.js');
    await assertPortFree(port);
  } finally { await rm(temp, { recursive: true, force: true, maxRetries: 3 }); }
});
