import { stat, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from './process.js';

const helper = fileURLToPath(new URL('../helpers/open-folder.ps1', import.meta.url));

export async function openFolder(folder) {
  if (typeof folder !== 'string' || !folder.trim()) throw new Error('Choose an output folder first.');
  const path = resolve(folder.trim());
  try {
    if (!(await stat(path)).isDirectory()) throw new Error('Not a directory');
  } catch {
    throw new Error(`Output folder does not exist or is not accessible: ${path}. Run a capture first or choose an existing folder.`);
  }
  if (process.platform !== 'win32') throw new Error('Opening folders currently requires Windows.');
  // Pass the path as data: Explorer command-line parsing mishandles some paths.
  // Only the helper is hidden; it asks the Windows shell to show the actual folder.
  await run('powershell.exe', ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', helper], {
    env: { ANIMATE_OPEN_FOLDER: await realpath(path) }, timeout: 30000,
  });
  return path;
}
