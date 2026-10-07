import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { openFolder } from '../src/open-folder.js';
import { run } from '../src/process.js';

test('folder opener rejects missing paths and files with actionable errors', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'animate-folder-validation-'));
  try {
    await assert.rejects(openFolder(''), /Choose an output folder/);
    await assert.rejects(openFolder(join(temp, 'missing')), /does not exist or is not accessible/);
    await writeFile(join(temp, 'file.txt'), 'file');
    await assert.rejects(openFolder(join(temp, 'file.txt')), /does not exist or is not accessible/);
  } finally { await rm(temp, {recursive:true, force:true}); }
});

test('Windows opens visible local and UNC folders and reuses their windows', {
  skip: process.platform !== 'win32', timeout: 90000,
}, async () => {
  const roots = [tmpdir()];
  if(process.cwd().startsWith('\\\\')) roots.push(resolve('captures'));
  for(const root of roots) {
    const folder = await mkdtemp(join(root, 'Folder café, space & apostrophe\' '));
    const inspect = (close = false) => run('powershell.exe', ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', resolve('test/inspect-folder.ps1'), ...(close ? ['-Close'] : [])], {env:{ANIMATE_TEST_FOLDER:folder}, timeout:15000});
    try {
      await openFolder(folder);
      assert.equal((await inspect()).trim(), '1');
      await openFolder(folder);
      assert.equal((await inspect()).trim(), '1');
    } finally {
      await inspect(true);
      await rm(folder, {recursive:true, force:true, maxRetries:3});
    }
  }
});
