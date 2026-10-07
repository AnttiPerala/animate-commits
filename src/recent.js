import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';

export const recentFile = join(process.env.APPDATA || join(homedir(), '.config'), 'Animate Commits', 'recent-repositories.json');

function normalize(repo) {
  if (typeof repo !== 'string' || !repo.trim()) throw new Error('A repository path or URL is required');
  repo = repo.trim();
  if (/^https?:\/\//i.test(repo)) {
    const url = new URL(repo);
    url.username = ''; url.password = ''; url.search = ''; url.hash = '';
    return url.href;
  }
  return /^(?:[\w+.-]+:\/\/|[^/\\]+@[^:]+:)/.test(repo) ? repo : resolve(repo);
}
function key(repo) {
  return process.platform === 'win32' && !/^(?:[\w+.-]+:\/\/|[^/\\]+@[^:]+:)/.test(repo) ? repo.toLowerCase() : repo;
}

export function recentRepositories(file = recentFile) {
  let pending = Promise.resolve();
  async function read() {
    try {
      const data = JSON.parse(await readFile(file, 'utf8'));
      if (!Array.isArray(data)) return [];
      const seen = new Set();
      return data.filter(value => typeof value === 'string' && value.trim()).map(normalize).filter(value => {
        const id = key(value); if (seen.has(id)) return false; seen.add(id); return true;
      }).slice(0, 20);
    } catch (error) {
      if (error.code === 'ENOENT' || error instanceof SyntaxError || error instanceof TypeError) return [];
      throw error;
    }
  }
  return {
    list: async () => { await pending; return read(); },
    add(repo) {
      const operation = pending.then(async () => {
        const value = normalize(repo);
        const items = [value, ...(await read()).filter(item => key(item) !== key(value))].slice(0, 20);
        await mkdir(dirname(file), { recursive: true });
        const temporary = `${file}.${randomUUID()}.tmp`;
        try {
          await writeFile(temporary, JSON.stringify(items, null, 2) + '\n', { flag: 'wx' });
          await rename(temporary, file);
        } finally { await rm(temporary, { force: true }); }
        return items;
      });
      pending = operation.catch(() => {});
      return operation;
    },
  };
}
