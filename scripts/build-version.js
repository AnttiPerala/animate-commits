import { open, readFile, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';

export async function reserveBuildVersion(root) {
  const lockPath = join(root, '.version-build.lock');
  let lock;
  try { lock = await open(lockPath, 'wx'); }
  catch (error) {
    if (error.code === 'EEXIST') throw new Error('Another versioned build is running. If it crashed, remove .version-build.lock after confirming it has stopped.');
    throw error;
  }
  const release = async () => { await lock.close(); await unlink(lockPath); };
  try {
    await lock.writeFile(String(process.pid));
    const packageFile = join(root, 'package.json'), lockFile = join(root, 'package-lock.json');
    const pkg = JSON.parse(await readFile(packageFile, 'utf8'));
    const dependencies = JSON.parse(await readFile(lockFile, 'utf8'));
    const parts = /^(\d+)\.(\d+)\.(\d+)$/.exec(pkg.version);
    if (!parts) throw new Error('Build version must use major.minor.patch format');
    const version = `${parts[1]}.${parts[2]}.${Number(parts[3]) + 1}`;
    pkg.version = dependencies.version = dependencies.packages[''].version = version;
    await writeFile(packageFile, JSON.stringify(pkg, null, 2) + '\n');
    await writeFile(lockFile, JSON.stringify(dependencies, null, 2) + '\n');
    return { version, release };
  } catch (error) { await release(); throw error; }
}
