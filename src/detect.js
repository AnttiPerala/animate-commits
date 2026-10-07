import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { contained } from './config.js';

// Inspection only: never import repository code or run its commands.
export async function detectSetup(repo, directory = '.') {
  if (typeof repo !== 'string' || !repo.trim()) throw new Error('Choose a local repository first.');
  if (/^(?:[\w+.-]+:\/\/|[^/\\]+@[^:]+:)/.test(repo)) throw new Error('Setup detection currently needs a local repository. Clone the URL locally, then select that folder.');
  const root = await realpath(resolve(repo.trim()));
  const base = await realpath(resolve(root, directory || '.'));
  if (!contained(root, base)) throw new Error('App subfolder must stay inside the repository.');
  async function read(folder, file) {
    try {
      const target = await realpath(join(folder, file));
      if (!contained(root, target)) return '';
      const info = await stat(target);
      if (!info.isFile() || info.size > 1024 * 1024) return '';
      return await readFile(target, 'utf8');
    } catch(error) { if (['ENOENT','ENOTDIR'].includes(error.code)) return ''; throw error; }
  }
  const candidates = [], warnings = [];
  async function inspect(folder, relative) {
    const text = await read(folder, 'package.json');
    const index = await read(folder, 'index.html');
    const publicIndex = await read(folder, 'public/index.html');
    let pkg;
    if(text) {
      try { pkg = JSON.parse(text); }
      catch { warnings.push(`${relative}/package.json is invalid JSON; no Node setup suggested there.`); return; }
    }
    const add = (label, reason, settings, notes = []) => candidates.push({label:relative === '.' ? label : `${label} (${relative})`, reason,
      settings:{ directory:relative, staticDir:'.', install:null, start:null, url:'http://127.0.0.1:{port}/', selector:null, nativeWindowTitle:null,
        nativeReadyFile:null, electronExecutable:null, electronArgs:['.'], electronWindowUrl:null, ...settings }, notes});
    if(pkg) {
      const scripts = pkg.scripts || {}, deps = {...pkg.dependencies,...pkg.devDependencies};
      const pnpm = Boolean(await read(folder, 'pnpm-lock.yaml')) || String(pkg.packageManager).startsWith('pnpm@');
      const yarn = !pnpm && (Boolean(await read(folder, 'yarn.lock')) || String(pkg.packageManager).startsWith('yarn@'));
      const npmLock = Boolean(await read(folder, 'package-lock.json'));
      const manager = pnpm ? 'pnpm' : yarn ? 'yarn' : 'npm';
      const install = pnpm ? 'pnpm install' : yarn ? 'yarn install' : npmLock ? 'npm ci' : 'npm install';
      const run = name => `${manager} run ${name}`;
      const script = ['dev','start','serve'].find(name => typeof scripts[name] === 'string' && !/\belectron(?:-vite|mon)?\b/.test(scripts[name]));
      if(script) {
        const command = scripts[script];
        let start = run(script), label = 'Node web app', notes = [];
        if(/\bvite\b/.test(command) && !/\bvite\s+build\b/.test(command)) {
          label = 'Vite web app'; start += `${manager === 'npm' ? ' --' : ''} --host 127.0.0.1 --port {port} --strictPort`;
        } else if(/\bnext\s+dev\b/.test(command)) {
          label = 'Next.js web app'; start += `${manager === 'npm' ? ' --' : ''} --hostname 127.0.0.1 --port {port}`;
        } else if(/\breact-scripts\s+start\b/.test(command)) label = 'React web app';
        else notes.push('The server must use the PORT environment variable; otherwise adjust its command and URL.');
        const plainNode = /^node\s+(?:server|app|index)\.(?:js|cjs|mjs)\s*$/.test(command) && !scripts[`pre${script}`];
        add(label, `Found package.json script “${script}”: ${command}`, {appType:'web', install: install + (plainNode && manager === 'npm' ? ' --omit=dev' : ''), start}, notes);
      }
      if(deps.electron && typeof pkg.main === 'string') {
        add('Electron desktop app', `Found Electron and entry point ${pkg.main}.`, {appType:'electron',install},
          ['If the desktop app needs a separate renderer build or development server, add those commands before capture.']);
      }
      if(!script && !deps.electron && !Object.keys(deps).length && index) add('Static website', 'Found index.html with no application dependencies.', {appType:'web'});
    }
    const requirements = await read(folder, 'requirements.txt');
    const python = process.platform === 'win32' ? '.animate-venv\\Scripts\\python.exe' : './.animate-venv/bin/python';
    const installPython = 'python -m venv .animate-venv' + (requirements ? ` && ${python} -m pip install -r requirements.txt` : '');
    for(const entry of ['app.py','main.py','manage.py']) {
      const code = await read(folder, entry);
      if(!code) continue;
      let label, start, appType = 'web';
      if(/(?:from|import)\s+(?:tkinter|PyQt[56]|PySide[26]|customtkinter|wx)\b/.test(code)) {
        label = 'Python desktop app'; appType = 'native'; start = `${python} ${entry}`;
      } else if(/(?:from|import)\s+streamlit\b/.test(code)) {
        label = 'Streamlit web app'; start = `${python} -m streamlit run ${entry} --server.address 127.0.0.1 --server.port {port} --server.headless true`;
      } else if(/(?:from|import)\s+flask\b/.test(code)) {
        label = 'Flask web app'; start = `${python} -m flask --app ${entry} run --host 127.0.0.1 --port {port}`;
      } else if(entry === 'manage.py' && /django/.test(code)) {
        label = 'Django web app'; start = `${python} manage.py runserver 127.0.0.1:{port} --noreload`;
      }
      if(start) add(label, `Found ${entry} with a supported Python framework.`, {appType, install:installPython, start},
        requirements ? [] : ['No requirements.txt found. Third-party dependencies may need an install command.']);
    }
    if(!pkg && (index || publicIndex)) add('Static website', `Found ${index ? 'index.html' : 'public/index.html'}.`, {appType:'web',staticDir:index ? '.' : 'public'});
  }
  await inspect(base, directory || '.');
  if(!candidates.length && (!directory || directory === '.')) {
    for(const relative of ['web','frontend','client','app','website']) {
      try {
        const folder = await realpath(join(root, relative));
        if(contained(root, folder) && (await stat(folder)).isDirectory()) await inspect(folder, relative);
      } catch(error) { if (!['ENOENT','ENOTDIR'].includes(error.code)) throw error; }
    }
    for(const group of ['apps','packages']) {
      let entries = [];
      try { entries = await readdir(join(root, group), {withFileTypes:true}); } catch(error) { if(error.code !== 'ENOENT') throw error; }
      for(const entry of entries.filter(e=>e.isDirectory()).slice(0,12)) {
        const relative = `${group}/${entry.name}`, folder = await realpath(join(root, relative));
        if(contained(root, folder)) await inspect(folder, relative);
      }
    }
  }
  return {candidates, warnings, message:candidates.length ? 'Suggestions use the current local files. Review, apply, then capture; detection does not run or install anything.' : 'No supported setup found. Choose the app subfolder or enter launch commands manually.'};
}
