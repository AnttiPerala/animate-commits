// Embedded in the executable. Dependencies retain their original file layout so
// Playwright can resolve its browser metadata and helper scripts normally.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { gunzipSync } = require('node:zlib');
const { getAsset } = require('node:sea');
const { pathToFileURL } = require('node:url');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'animate-commits-runtime-'));
process.once('exit', () => {
  // Only delete this invocation's mkdtemp directory.
  try { fs.rmSync(root, { recursive: true, force: true, maxRetries: 3 }); } catch {}
});
try {
  const files = JSON.parse(gunzipSync(Buffer.from(getAsset('application.gz'))).toString('utf8'));
  for (const [name, base64] of Object.entries(files)) {
    const target = path.resolve(root, name);
    if (!target.startsWith(root + path.sep)) throw new Error('Invalid embedded application path');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, Buffer.from(base64, 'base64'));
  }
  const entry = path.join(root, 'bin/animate-commits.js');
  // SEA uses the same [executable, entry, ...arguments] layout as Node scripts.
  process.argv[1] = entry;
  if (process.argv.length === 2 && path.basename(process.execPath).endsWith('-cli.exe')) process.argv.push('--help');
  import(pathToFileURL(entry).href).catch(error => { console.error(error); process.exitCode = 1; });
} catch (error) { console.error(error); process.exitCode = 1; }
