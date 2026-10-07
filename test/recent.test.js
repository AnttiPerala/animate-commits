import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { recentRepositories } from '../src/recent.js';

test('recent repositories persist, cap at twenty, and move reopened items to the top', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'animate-recent-test-'));
  try {
    const file = join(temp, 'settings', 'recent.json');
    const store = recentRepositories(file);
    assert.deepEqual(await store.list(), []);
    await Promise.all(Array.from({length:25}, (_,i) => store.add(join(temp, `repo-${i}`))));
    const restarted = recentRepositories(file);
    const items = await restarted.list();
    assert.equal(items.length, 20);
    assert.equal(items[0], join(temp, 'repo-24'));
    assert.equal(items[19], join(temp, 'repo-5'));
    await restarted.add(join(temp, 'repo-10', '.'));
    const updated = await restarted.list();
    assert.equal(updated.length, 20);
    assert.equal(updated[0], resolve(temp, 'repo-10'));
    assert.equal(updated.filter(item => item === resolve(temp, 'repo-10')).length, 1);
    if(process.platform === 'win32') {
      await restarted.add(join(temp, 'REPO-10'));
      assert.equal((await restarted.list()).length, 20);
    }
    await restarted.add('https://user:secret@example.com/team/app.git?token=secret');
    assert.equal((await restarted.list())[0], 'https://example.com/team/app.git');
    await writeFile(file, '{broken');
    assert.deepEqual(await recentRepositories(file).list(), []);
    await restarted.add(join(temp, 'restored'));
    assert.deepEqual(await recentRepositories(file).list(), [join(temp, 'restored')]);
    await restarted.add(join(temp,'restored'),{output:join(temp,'saved sequence')});
    await restarted.add(join(temp,'another'));
    await restarted.add(join(temp,'restored'));
    assert.equal((await recentRepositories(file).get(join(temp,'restored'))).output,join(temp,'saved sequence'));
    await writeFile(file,JSON.stringify([join(temp,'legacy')]));
    assert.deepEqual(await recentRepositories(file).list(),[join(temp,'legacy')]);
    await restarted.add(join(temp,'legacy'),{output:join(temp,'legacy sequence')});
    assert.equal((await recentRepositories(file).get(join(temp,'legacy'))).output,join(temp,'legacy sequence'));
  } finally { await rm(temp, { recursive: true, force: true }); }
});
