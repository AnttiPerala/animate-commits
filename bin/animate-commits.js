#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { capture } from '../src/capture.js';
import { defaults } from '../src/config.js';
import { version } from '../src/version.js';

const help = `Animate Commits v${version} — Git history → numbered PNG frames

Usage:
  animate-commits.exe <repository path or URL> [options]
  node bin/animate-commits.js <repository path or URL> [options]
  node bin/animate-commits.js --init

Options:
  --gui              Open the graphical interface (default with no arguments)
  --config FILE       JSON configuration (paths relative to this file)
  --output DIR        New/empty output folder, or existing with --update
  --update            Append newer commits to an existing capture folder
  --app-type TYPE     web (default), electron, or native (Windows)
  --window-title RE  Native window title regular expression
  --ref REF           Branch, tag, or commit to end at (default HEAD)
  --from REF          Start at this commit, inclusive, on first-parent history
  --every N           Take every Nth commit, always including the last
  --max-frames N      Evenly sample at most N commits, keeping both endpoints
  --start COMMAND    App server command; receives PORT and HOST variables
  --install COMMAND  Install/build command before each capture
  --directory DIR    App folder within the repository
  --static-dir DIR   Serve static files within the app folder (default .)
  --url URL          Capture URL (default http://127.0.0.1:{port}/)
  --width N          Viewport width (default 1920)
  --height N         Viewport height (default 1080)
  --delay N          Settle time in milliseconds (default 1000)
  --selector CSS     Wait for a visible element before capturing
  --fail-fast        Stop at the first failed commit
  --list            List selected commits without running app code
  --help            Show this help
  --version         Show the application version

Web mode without a start command uses the built-in static web server.
Electron mode launches the checkout's Electron binary; configure electronArgs in JSON.
Native mode uses --start "python app.py" and optionally --window-title "My App".
Only capture repositories you trust: configured commands run repository code.
`;

try {
  if (process.argv.length === 2 || (process.argv.length === 3 && process.argv[2] === '--gui')) {
    const { startGui } = await import('../src/gui.js');
    await startGui();
  } else {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    config: { type: 'string' }, output: { type: 'string' }, 'app-type': { type: 'string' }, 'window-title': { type: 'string' }, ref: { type: 'string' }, from: { type: 'string' },
    every: { type: 'string' }, 'max-frames': { type: 'string' }, start: { type: 'string' },
    install: { type: 'string' }, directory: { type: 'string' }, 'static-dir': { type: 'string' },
    url: { type: 'string' }, width: { type: 'string' }, height: { type: 'string' },
    delay: { type: 'string' }, selector: { type: 'string' }, 'fail-fast': { type: 'boolean' },
    list: { type: 'boolean' }, update: { type: 'boolean' }, init: { type: 'boolean' }, help: { type: 'boolean' }, version: { type: 'boolean' },
  } });
  if (values.version) { console.log(version); }
  else if (values.help) { console.log(help); }
  else if (values.init) {
    const file = resolve('animate-commits.json');
    await writeFile(file, JSON.stringify({ ...defaults, repo: '../my-app', output: './captures',
      install: 'npm ci', start: 'npm run dev -- --host 127.0.0.1 --port {port}' }, null, 2) + '\n', { flag: 'wx' });
    console.log(`Created ${file}`);
  } else {
    if (positionals.length > 1) throw new Error('Provide one repository. Use --help for usage.');
    const configFile = values.config ? resolve(values.config) : undefined;
    const config = configFile ? JSON.parse(await readFile(configFile, 'utf8')) : {};
    const map = { 'max-frames': 'maxFrames', 'static-dir': 'staticDir', 'fail-fast': 'failFast', 'app-type': 'appType', 'window-title': 'nativeWindowTitle' };
    const numbers = ['every', 'max-frames', 'width', 'height', 'delay'];
    for (const [key, value] of Object.entries(values)) {
      if (!['config', 'init', 'help'].includes(key)) config[map[key] || key] = numbers.includes(key) ? Number(value) : value;
    }
    if (positionals[0]) config.repo = positionals[0];
    // CLI paths are relative to the caller; JSON paths are relative to its file.
    if (values.output) config.output = resolve(values.output);
    if (positionals[0] && !/^(?:[\w+.-]+:\/\/|[^/\\]+@[^:]+:)/.test(positionals[0])) config.repo = resolve(positionals[0]);
    const controller = new AbortController();
    const stop = () => controller.abort(new Error('Capture cancelled'));
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    try {
      const result = await capture(config, { configFile, signal: controller.signal });
      if (result.runFailed ?? result.failed) process.exitCode = 1;
    } finally {
      process.removeListener('SIGINT', stop);
      process.removeListener('SIGTERM', stop);
    }
  }
  }
} catch (error) {
  console.error(`\nError: ${error.message}`);
  if (process.argv.length === 2 || process.argv[2] === '--gui') {
    const { showGuiError } = await import('../src/gui.js');
    await showGuiError(error);
  }
  process.exitCode = 1;
}
