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
      return data.map(value => typeof value === 'string' ? {repo:value} : value).filter(value => value && typeof value.repo === 'string' && value.repo.trim()).map(value => ({repo:normalize(value.repo), ...(typeof value.output === 'string' && value.output ? {output:resolve(value.output)} : {})})).filter(value => {
        const id = key(value.repo); if (seen.has(id)) return false; seen.add(id); return true;
      }).slice(0, 20);
    } catch (error) {
      if (error.code === 'ENOENT' || error instanceof SyntaxError || error instanceof TypeError) return [];
      throw error;
    }
  }
  return {
    list: async () => { await pending; return (await read()).map(item=>item.repo); },
    get: async repo => { await pending; return (await read()).find(item=>key(item.repo)===key(normalize(repo))) || null; },
    add(repo, {output} = {}) {
      const operation = pending.then(async () => {
        const value = normalize(repo);
        const previous = await read();
        const saved = previous.find(item=>key(item.repo)===key(value));
        const entry = { ...saved, repo:value, ...(output ? {output:resolve(output)} : {}) };
        const items = [entry, ...previous.filter(item => key(item.repo) !== key(value))].slice(0, 20);
        await mkdir(dirname(file), { recursive: true });
        const temporary = `${file}.${randomUUID()}.tmp`;
        try {
          await writeFile(temporary, JSON.stringify(items, null, 2) + '\n', { flag: 'wx' });
          await rename(temporary, file);
        } finally { await rm(temporary, { force: true }); }
        return items.map(item=>item.repo);
      });
      pending = operation.catch(() => {});
      return operation;
    },
  };
}
