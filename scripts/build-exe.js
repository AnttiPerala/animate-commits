import { mkdir, mkdtemp, readdir, readFile, writeFile, copyFile, rm } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { inject } from 'postject';
import { run } from '../src/process.js';

if (process.platform !== 'win32') throw new Error('Build the Windows executable on Windows using Node.js 22+');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const temp = await mkdtemp(join(tmpdir(), 'animate-commits-build-'));
const dist = process.env.ANIMATE_BUILD_DIR ? resolve(process.env.ANIMATE_BUILD_DIR) : join(root, 'dist');
try {
  const files = {};
  async function collect(relative) {
    const path = join(root, relative);
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const name = `${relative}/${entry.name}`;
      if (entry.isDirectory()) await collect(name);
      else if (entry.isFile()) files[name] = (await readFile(join(root, name))).toString('base64');
    }
  }
  for (const directory of ['bin', 'src', 'helpers', 'ui', 'node_modules/playwright', 'node_modules/playwright-core']) await collect(directory);
  files['package.json'] = Buffer.from(JSON.stringify({ type: 'module', name: 'animate-commits-runtime' })).toString('base64');
  const nodeLicense = await readFile(join(dirname(process.execPath), 'LICENSE'));
  files['NODE-LICENSE.txt'] = nodeLicense.toString('base64');
  const payload = join(temp, 'application.gz');
  await writeFile(payload, gzipSync(JSON.stringify(files), { level: 9 }));
  const blob = join(temp, 'application.blob');
  const config = join(temp, 'sea.json');
  await writeFile(config, JSON.stringify({ main: join(root, 'scripts/sea-bootstrap.cjs'), output: blob,
    disableExperimentalSEAWarning: true, useSnapshot: false, useCodeCache: false, execArgvExtension: 'none',
    assets: { 'application.gz': payload } }));
  console.log('Preparing embedded application and Node runtime…');
  await run(process.execPath, ['--experimental-sea-config', config], { cwd: temp });
  const executable = join(temp, 'animate-commits.exe');
  await copyFile(process.execPath, executable);
  await inject(executable, 'NODE_SEA_BLOB', await readFile(blob), { sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2' });
  const help = await run(executable, ['--help'], { cwd: temp, timeout: 60000 });
  if (!help.includes('Git history')) throw new Error('Executable smoke test did not show expected help');
  await mkdir(dist, { recursive: true });
  const target = join(dist, 'animate-commits.exe');
  await copyFile(executable, join(dist, 'animate-commits-cli.exe'));
  // GUI subsystem suppresses Windows' automatic console allocation on double-click.
  const guiBinary = await readFile(executable);
  const pe = guiBinary.readUInt32LE(0x3c);
  if (guiBinary.toString('ascii', pe, pe + 4) !== 'PE\0\0') throw new Error('Unexpected executable format');
  guiBinary.writeUInt16LE(2, pe + 24 + 68);
  await writeFile(target, guiBinary);
  await copyFile(join(root, 'README.md'), join(dist, 'README.md'));
  await mkdir(join(dist, 'licenses'), { recursive: true });
  await writeFile(join(dist, 'licenses/Node-LICENSE.txt'), nodeLicense);
  for (const name of ['LICENSE', 'NOTICE', 'ThirdPartyNotices.txt']) await copyFile(join(root, 'node_modules/playwright-core', name), join(dist, 'licenses', `Playwright-${name}`));
  await mkdir(join(dist, 'examples'), { recursive: true });
  for (const name of await readdir(join(root, 'examples'))) await copyFile(join(root, 'examples', name), join(dist, 'examples', name));
  const hash = createHash('sha256').update(guiBinary).digest('hex');
  const cliHash = createHash('sha256').update(await readFile(executable)).digest('hex');
  await writeFile(join(dist, 'SHA256SUMS.txt'), `${hash}  animate-commits.exe\n${cliHash}  animate-commits-cli.exe\n`);
  console.log(`Built ${target}\nSHA256 ${hash}`);
} finally { await rm(temp, { recursive: true, force: true, maxRetries: 3 }); }
