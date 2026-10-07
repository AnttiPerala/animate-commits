import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { reserveBuildVersion } from '../scripts/build-version.js';

test('build versions increment, keep package metadata consistent, and prevent concurrent builds', async () => {
  const root = await mkdtemp(join(tmpdir(), 'animate-version-test-'));
  try {
    await writeFile(join(root, 'package.json'), JSON.stringify({version:'0.1.9'}));
    await writeFile(join(root, 'package-lock.json'), JSON.stringify({version:'0.1.9',packages:{'':{version:'0.1.9'}}}));
    const first = await reserveBuildVersion(root);
    try {
      assert.equal(first.version, '0.1.10');
      await assert.rejects(reserveBuildVersion(root), /Another versioned build/);
      const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
      const lock = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8'));
      assert.equal(pkg.version, first.version);
      assert.equal(lock.version, first.version);
      assert.equal(lock.packages[''].version, first.version);
    } finally { await first.release(); }
    const next = await reserveBuildVersion(root);
    try { assert.equal(next.version, '0.1.11'); } finally { await next.release(); }
  } finally { await rm(root, {recursive:true,force:true}); }
});
