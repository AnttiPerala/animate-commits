import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { capture } from '../src/capture.js';
import { git } from '../src/git.js';
import { lockOutput, lockName, selectUpdates } from '../src/updates.js';

test('update appends frames, preserves existing data, rejects incompatible history, and is idempotent', { timeout: 120000 }, async () => {
  const temp = await mkdtemp(join(tmpdir(), 'animate-update-test-'));
  const repo = join(temp, 'repo'), output = join(temp, 'output');
  try {
    await mkdir(repo);
    await git(['init', '.'], repo);
    await git(['config', 'user.name', 'Fixture'], repo);
    await git(['config', 'user.email', 'fixture@example.invalid'], repo);
    const commit = async (message, html) => {
      if(html === null) await rm(join(repo, 'index.html'));
      else await writeFile(join(repo, 'index.html'), html);
      await git(['add', '.'], repo); await git(['commit', '-m', message], repo);
    };
    await commit('First', '<body style="background:tomato">First');
    await commit('Broken', null);
    const config = { repo, output, width: 640, height: 360, delay: 0, timeout: 1500 };
    const options = { log: () => {} };
    const first = await capture(config, options);
    assert.equal(first.captured, 1); assert.equal(first.failed, 1);
    const oldImage = await readFile(join(output, first.frames[0].file));
    const oldLogs = await Promise.all(first.frames.map(f => readFile(join(output, f.log))));
    // Captures from the previous release have no explicit checkpoint or lastRun.
    delete first.lastProcessedCommit; delete first.lastRun; delete first.added; delete first.runFailed;
    await writeFile(join(output, 'manifest.json'), JSON.stringify(first));
    const original = await readFile(join(output, 'manifest.json'));
    await commit('Second', '<body style="background:steelblue">Second');
    await commit('Third', '<body style="background:gold">Third');
    await writeFile(join(repo, 'index.html'), 'Keep uncommitted work');
    const head = await git(['rev-parse', 'HEAD'], repo);
    const update = { ...config, update: true };
    const listing = await capture({ ...update, list: true }, options);
    assert.deepEqual(listing.selected.map(c => c.subject), ['Second', 'Third']);
    assert.deepEqual(await readFile(join(output, 'manifest.json')), original);
    const result = await capture(update, options);
    assert.equal(result.captured, 3); assert.equal(result.added, 2);
    assert.equal(result.failed, 1); assert.equal(result.runFailed, 0);
    assert.deepEqual(await readdir(join(output, 'frames')), ['frame-000001.png', 'frame-000002.png', 'frame-000003.png']);
    assert.deepEqual(await readFile(join(output, first.frames[0].file)), oldImage);
    for(const [i,f] of first.frames.entries()) assert.deepEqual(await readFile(join(output, f.log)), oldLogs[i]);
    const backups = await readdir(join(output, 'history'));
    assert.equal(backups.length, 1);
    assert.deepEqual(await readFile(join(output, 'history', backups[0])), original);
    const saved = await readFile(join(output, 'manifest.json'));
    const preview = await readFile(join(output, 'preview.html'));
    assert.equal((await capture(update, options)).noNewCommits, true);
    assert.deepEqual(await readFile(join(output, 'manifest.json')), saved);
    assert.deepEqual(await readFile(join(output, 'preview.html')), preview);
    await assert.rejects(capture({ ...update, width: 800 }, options), /Existing sequence/);
    await assert.rejects(capture({ ...update, ref: 'HEAD~2' }, options), /history has changed/);
    await writeFile(join(output, 'frames/frame-000004.png'), oldImage);
    await assert.rejects(capture(update, options), /Unrecorded image/);
    assert.deepEqual(await readFile(join(output, 'manifest.json')), saved);
    assert.equal((await readdir(output)).includes(lockName), false);
    assert.equal(await readFile(join(repo, 'index.html'), 'utf8'), 'Keep uncommitted work');
    assert.equal(await git(['rev-parse', 'HEAD'], repo), head);
    const unlock = await lockOutput(output);
    try { await assert.rejects(capture(update, options), /locked by another capture/); }
    finally { await unlock(); }
  } finally { await rm(temp, { recursive: true, force: true, maxRetries: 3 }); }
});

test('updates retry cancelled attempts and sample only commits after the saved checkpoint', () => {
  const commits = Array.from({length:7}, (_,i) => ({hash:String(i)}));
  const existing = { manifest:{frames:[{hash:'0',status:'captured'},{hash:'2',status:'failed'},{hash:'3',status:'cancelled'}]},lastProcessed:'2' };
  assert.deepEqual(selectUpdates(commits, existing, {every:1,maxFrames:60}).map(c=>c.hash), ['3','4','5','6']);
  assert.deepEqual(selectUpdates(commits, existing, {every:2,maxFrames:60}).map(c=>c.hash), ['3','5','6']);
});
