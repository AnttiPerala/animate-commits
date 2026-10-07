import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig, selectCommits } from '../src/config.js';
import { previewHtml } from '../src/preview.js';

const commits = Array.from({ length: 11 }, (_, i) => ({ hash: String(i) }));
test('samples chronologically, including endpoints after interval selection', () => {
  assert.deepEqual(selectCommits(commits, { every: 3, maxFrames: 3 }).map(c => c.hash), ['0', '6', '10']);
  assert.deepEqual(selectCommits(commits, { from: '4', every: 1, maxFrames: 3 }).map(c => c.hash), ['4', '7', '10']);
  assert.deepEqual(selectCommits(commits, { every: 1, maxFrames: 1 }), [commits.at(-1)]);
  assert.throws(() => selectCommits(commits, { from: 'missing', every: 1, maxFrames: 10 }), /first-parent/);
});
test('rejects invalid input before running any commands', () => {
  for (const patch of [{ every: 0 }, { width: NaN }, { port: 99999 }, { directory: '../other' }, { env: { KEY: 1 } }, { maxFrame: 3 }, { url: 'https://example.com' }, { appType: 'python' }, { electronArgs: 'main.js' }, { electronWindowUrl: '[' }]) {
    assert.throws(() => normalizeConfig({ repo: '.', ...patch }));
  }
});
test('commit text cannot escape preview data element', () => {
  const html = previewHtml({ frames: [{ status: 'captured', subject: '</script><script>alert(1)</script>' }], settings: { fps: 2 } });
  assert.ok(!html.includes('</script><script>alert(1)'));
  assert.ok(html.includes('\\u003c/script>'));
});
