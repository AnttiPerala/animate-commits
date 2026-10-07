import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { contained } from './config.js';

// Call only for a directory allocated by this invocation's mkdtemp.
export async function cleanupWorkspace(directory, log = () => {}, remove = rm) {
  if (!directory) return;
  const root = resolve(tmpdir()), target = resolve(directory);
  if (target === root || !contained(root, target)) {
    log(`Cleanup skipped: path is outside the temporary workspace: ${target}`);
    return;
  }
  try { await remove(target, { recursive: true, force: true, maxRetries: 6, retryDelay: 200 }); }
  catch (error) {
    log(`Cleanup warning (${error.code || 'error'}): Windows could not remove this run's temporary workspace: ${target}. It has been left in place; this does not change the capture result or your repository.`);
  }
}
