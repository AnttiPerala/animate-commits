// npm uses cmd.exe on Windows, which drops UNC working directories. Restore the
// package path explicitly in the Node child so network-share projects work too.
const { dirname, join } = require('node:path');
const { spawnSync } = require('node:child_process');
const root = dirname(process.env.npm_package_json);
const commands = {
  test: ['--test', '--test-concurrency=1'],
  capture: [join(root, 'bin/animate-commits.js')],
  'build:exe': [join(root, 'scripts/build-exe.js')],
  'browser:install': [join(root, 'node_modules/playwright/cli.js'), 'install', 'chromium', '--only-shell'],
};
const result = spawnSync(process.execPath, [...commands[process.env.npm_lifecycle_event], ...process.argv.slice(1)], {
  cwd: root, stdio: 'inherit', windowsHide: true,
});
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
