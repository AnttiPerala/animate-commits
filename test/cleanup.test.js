import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { cleanupWorkspace } from '../src/cleanup.js';
import { launch, stop } from '../src/process.js';
import { git } from '../src/git.js';

test('cleanup failures warn without replacing results, and cannot remove the temp root', async () => {
  const messages = [];
  let calls = 0;
  const locked = async () => { calls++; throw Object.assign(new Error('locked'), {code:'EBUSY'}); };
  await cleanupWorkspace(join(tmpdir(), 'animate-owned-fixture'), message => messages.push(message), locked);
  assert.match(messages[0], /Cleanup warning \(EBUSY\)/);
  await cleanupWorkspace(tmpdir(), message => messages.push(message), locked);
  assert.equal(calls, 1);
});

test('a real locked Windows workspace does not fail cleanup', {skip:process.platform !== 'win32', timeout:20000}, async () => {
  const temp = await mkdtemp(join(tmpdir(), 'animate-cleanup-lock-'));
  const child = launch(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {cwd:temp});
  try {
    await delay(400);
    const messages = [];
    await cleanupWorkspace(temp, message => messages.push(message));
    assert.match(messages.join('\n'), /Cleanup warning/);
  } finally { await stop(child); await rm(temp, {recursive:true,force:true,maxRetries:3}); }
});

test('Git timeout and cancellation stop descendants before cleanup', {timeout:30000}, async () => {
  const temp = await mkdtemp(join(tmpdir(), 'animate-git-stop-'));
  try {
    await writeFile(join(temp, 'wait.cjs'), "require('fs').writeFileSync('pid.txt',String(process.pid));setInterval(()=>{},1000);");
    const args = ['-c', 'alias.wait=!node wait.cjs', 'wait'];
    await assert.rejects(git(args, temp, undefined, {timeout:2000}), /timed out/);
    const timedPid = Number(await readFile(join(temp, 'pid.txt'), 'utf8'));
    assert.throws(() => process.kill(timedPid, 0));
    await rm(join(temp, 'pid.txt'));
    const controller = new AbortController();
    const operation = git(args, temp, controller.signal);
    const rejection = assert.rejects(operation, /Requested cancellation/);
    let pid;
    for(let i=0;i<100;i++) {
      try { pid = Number(await readFile(join(temp, 'pid.txt'), 'utf8')); if(pid) break; } catch {}
      await delay(50);
    }
    controller.abort(new Error('Requested cancellation'));
    await rejection;
    assert.ok(pid, 'child started');
    assert.throws(() => process.kill(pid, 0));
    await assert.rejects(git(['clone', join(temp, 'does-not-exist'), join(temp, 'clone')], temp), /Git clone failed.*repository/s);
  } finally { await rm(temp, {recursive:true,force:true,maxRetries:3}); }
});
