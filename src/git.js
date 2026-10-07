import { launch, stop } from './process.js';

export async function git(args, cwd, signal, { timeout = 300000, log } = {}) {
  signal?.throwIfAborted();
  const child = launch('git', args, { cwd });
  const chunks = [];
  let size = 0, timer, abort;
  try {
    const interrupted = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Git ${args[0]} timed out after ${Math.round(timeout / 1000)} seconds. For slow repositories, increase Git clone timeout in Advanced settings.`)), timeout);
      abort = () => reject(signal.reason || new Error('Git operation cancelled'));
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
      child.child.stdout.on('data', chunk => {
        size += chunk.length;
        if (size > 64 * 1024 * 1024) reject(new Error('Git output exceeded 64 MiB'));
        else chunks.push(chunk);
      });
    });
    if (log) child.child.stderr.on('data', chunk => {
      for (const line of chunk.toString('utf8').split(/[\r\n]+/)) if (line.trim()) log(line.trim());
    });
    const code = await Promise.race([child.done, interrupted]);
    if (code !== 0) throw new Error(`Git ${args[0]} failed (${code}): ${child.error?.message || child.tail()}`);
    return Buffer.concat(chunks).toString('utf8').trim();
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
    // Terminate this command's whole tree before releasing its temporary cwd.
    await stop(child);
  }
}

export async function resolveRef(repo, ref, signal) {
  try { return await git(['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`], repo, signal); }
  catch (error) {
    signal?.throwIfAborted();
    try { return await git(['rev-parse', '--verify', '--end-of-options', `refs/remotes/origin/${ref}^{commit}`], repo, signal); }
    catch { throw new Error(`Cannot resolve Git ref: ${ref}`, { cause: error }); }
  }
}

export async function history(repo, ref, signal) {
  const hash = await resolveRef(repo, ref, signal);
  const output = await git(['log', '--first-parent', '--reverse', '--format=%H%x00%cI%x00%s', hash, '--'], repo, signal);
  return output ? output.split('\n').map(line => {
    const [hash, date, subject] = line.split('\0');
    return { hash, date, subject };
  }) : [];
}
