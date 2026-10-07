import { mkdir, open, readFile, readdir, realpath, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { contained, selectCommits } from './config.js';

export const lockName = '.animate-commits.lock';

export async function lockOutput(output) {
  await mkdir(output, { recursive: true });
  let handle;
  try { handle = await open(join(output, lockName), 'wx'); }
  catch (error) {
    if (error.code === 'EEXIST') throw new Error('This output folder is locked by another capture. If a previous process crashed, confirm it has stopped before removing .animate-commits.lock.');
    throw error;
  }
  try { await handle.writeFile(JSON.stringify({ pid: process.pid, host: hostname(), createdAt: new Date().toISOString(), id: randomUUID() })); }
  catch (error) { await handle.close(); await unlink(join(output, lockName)); throw error; }
  return async () => { await handle.close(); await unlink(join(output, lockName)); };
}

export async function readExistingCapture(c) {
  let original;
  try { original = await readFile(join(c.output, 'manifest.json'), 'utf8'); }
  catch (error) { throw new Error('Update needs an existing capture folder with manifest.json. Select the folder used for the previous capture.', { cause: error }); }
  let manifest;
  try { manifest = JSON.parse(original); } catch { throw new Error('The existing manifest.json is not valid JSON'); }
  if (manifest.version !== 1 || !Array.isArray(manifest.frames) || !manifest.settings) throw new Error('Unsupported or invalid capture manifest');
  const settings = manifest.settings;
  if (settings.width !== c.width || settings.height !== c.height || (settings.appType || 'web') !== c.appType) {
    throw new Error(`Existing sequence uses ${settings.width}×${settings.height} and app type ${settings.appType || 'web'}. Use those settings to append frames.`);
  }
  const output = await realpath(c.output);
  for (const name of ['frames', 'logs']) {
    if (!contained(output, await realpath(join(c.output, name)))) throw new Error(`${name} must stay inside the capture folder`);
  }
  let count = 0, failed = 0;
  const files = new Set(), capturedHashes = new Set();
  for (const frame of manifest.frames) {
    if (!frame || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(frame.hash) || !['captured', 'failed', 'cancelled'].includes(frame.status)) throw new Error('Invalid frame record in the capture manifest');
    if (frame.status !== 'captured') { failed++; continue; }
    count++;
    const expected = `frames/frame-${String(count).padStart(6, '0')}.png`;
    if (frame.file !== expected || frame.number !== count || capturedHashes.has(frame.hash)) throw new Error('The existing frame sequence is inconsistent; update stopped to protect its images');
    const file = join(c.output, frame.file);
    if (!contained(output, await realpath(file))) throw new Error('An existing image points outside the capture folder');
    const handle = await open(file, 'r');
    try {
      const header = Buffer.alloc(24);
      const { bytesRead } = await handle.read(header, 0, 24, 0);
      if (bytesRead !== 24 || !header.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) || header.readUInt32BE(16) !== c.width || header.readUInt32BE(20) !== c.height) throw new Error(`Missing, invalid, or incorrectly sized frame: ${frame.file}`);
    } finally { await handle.close(); }
    files.add(frame.file.slice(7)); capturedHashes.add(frame.hash);
  }
  if (!count) throw new Error('This folder has no recorded captured images. Use a new empty output folder instead.');
  if (manifest.captured !== count || manifest.failed !== failed) throw new Error('Manifest frame counts are inconsistent');
  for (const file of await readdir(join(c.output, 'frames'))) {
    if (/^frame-\d+\.png$/i.test(file) && !files.has(file)) throw new Error(`Unrecorded image ${file} found. Update stopped so no image is overwritten.`);
  }
  const lastProcessed = manifest.frames.filter(frame => frame.status !== 'cancelled').at(-1)?.hash;
  if (manifest.lastProcessedCommit && manifest.lastProcessedCommit !== lastProcessed) throw new Error('Manifest history checkpoint is inconsistent');
  return { manifest, original, lastProcessed };
}

export function selectUpdates(commits, existing, c) {
  const positions = new Map(commits.map((commit, index) => [commit.hash, index]));
  let previous = -1;
  for (const frame of existing.manifest.frames) {
    if (frame.status === 'cancelled') continue;
    const position = positions.get(frame.hash);
    if (position === undefined || position <= previous) throw new Error('The saved commits are not on this first-parent history. The repository, branch, or history has changed; use a new output folder.');
    previous = position;
  }
  let pending = commits.slice(positions.get(existing.lastProcessed) + 1);
  if (c.from) {
    const from = positions.get(c.from);
    if (from === undefined) throw new Error('--from is not on the selected first-parent history');
    pending = pending.filter(commit => positions.get(commit.hash) >= from);
  }
  return pending.length ? selectCommits(pending, { ...c, from: null }) : [];
}
