import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { git } from '../src/git.js';
import { capture } from '../src/capture.js';

const temp = await mkdtemp(join(tmpdir(), 'animate-commits-demo-'));
const output = resolve(process.argv[2] || 'captures/demo');
try {
  await git(['init', '.'], temp);
  await git(['config', 'user.name', 'Demo'], temp);
  await git(['config', 'user.email', 'demo@example.invalid'], temp);
  const titles = ['Start with a simple task list', 'Introduce navigation and a project board', 'Add task cards and team activity', 'Polish the dashboard with progress metrics'];
  for (let stage = 0; stage < titles.length; stage++) {
    const html = `<!doctype html><html lang="en"><meta charset="utf-8"><title>Orbit · Project dashboard</title><style>
    *{box-sizing:border-box}body{margin:0;background:#f4f6f8;color:#25313d;font:16px system-ui,sans-serif}aside{position:fixed;inset:0 auto 0 0;width:240px;background:#17222d;color:#a6b3bf;padding:38px 28px}aside h2{color:#fff;font-size:27px;margin:0 0 50px}nav div{padding:14px;margin:7px 0;border-radius:8px}nav div:first-child{background:#2f414e;color:#b7f7d5}main{margin-left:${stage ? 240 : 0}px;padding:48px 54px}header{display:flex;justify-content:space-between;align-items:center}small{color:#798694;letter-spacing:2px;font-size:11px;font-weight:700}h1{font-size:36px;letter-spacing:-1.5px;margin:12px 0}p{color:#7b8793}button{border:0;border-radius:8px;background:#216c51;color:white;padding:14px 22px;font-weight:600}.stats,.board{display:grid;grid-template-columns:repeat(3,1fr);gap:22px;margin:34px 0}.stats article{padding:22px;background:white;border-radius:12px;border:1px solid #e4e8ec}.stats strong{display:block;font-size:30px;margin-top:14px}.column{background:#eaf0f2;border-radius:12px;padding:18px;min-height:330px}.column h3{font-size:13px;margin:4px 0 23px;color:#657380}.card{padding:21px;background:white;border-radius:9px;box-shadow:0 3px 9px #182d3a08;margin:14px 0}.card b{display:block;font-size:15px;margin:16px 0}.tag{font-size:10px;letter-spacing:1px;border-radius:4px;background:#e4f3eb;color:#327153;padding:5px 8px}.meta{font-size:12px;color:#8995a0}.bar{height:5px;background:#e6ecf0;border-radius:10px;margin-top:14px}.bar span{display:block;width:72%;height:100%;background:#57b58c}.activity{background:white;border-radius:12px;padding:24px;margin-top:30px}.avatar{background:#ddece4;color:#3b6b52;border-radius:50%;padding:8px;font-size:11px;margin-right:12px}footer{margin-top:24px;font-size:12px;color:#8a97a2}
    </style><body>${stage ? '<aside><h2>◒ orbit</h2><nav><div>◈ Overview</div><div>▤ Projects</div><div>◷ Activity</div><div>♧ Team</div></nav></aside>' : ''}<main><header><div><small>WORKSPACE / PRODUCT</small><h1>${stage ? 'A little closer. Every day.' : 'Project tasks'}</h1><p>${stage ? 'Your team’s work, all in one place.' : 'A simple place to keep track of what’s next.'}</p></div>${stage >= 2 ? '<button>+ New project</button>' : ''}</header>
    ${stage >= 3 ? '<section class="stats"><article><small>ACTIVE PROJECTS</small><strong>12</strong></article><article><small>TASKS COMPLETED</small><strong>84 <span style="font-size:13px;color:#39966b">↑ 16%</span></strong></article><article><small>SPRINT PROGRESS</small><strong>72%</strong><div class="bar"><span></span></div></article></section>' : ''}
    ${stage === 0 ? '<ul><li>Design the landing page</li><li>Build project navigation</li><li>Invite the team</li></ul>' : `<section class="board">${['TO DO', 'IN PROGRESS', 'DONE'].map((name, i) => `<div class="column"><h3>${name} <span style="float:right">${stage >= 2 ? 2 : 0}</span></h3>${stage >= 2 ? [0, 1].map((_, j) => `<article class="card"><span class="tag">${['DESIGN', 'PRODUCT', 'ENGINEERING'][i]}</span><b>${[['Refresh the landing page', 'Explore navigation concepts'], ['Build the project board', 'Connect team invitations'], ['Set up the workspace', 'Define design tokens']][i][j]}</b><div class="meta">${['AL', 'JM', 'SK'][i]} <span style="float:right">${j ? 'Tomorrow' : 'Today'}</span></div></article>`).join('') : ''}</div>`).join('')}</section>`}
    ${stage >= 2 ? '<section class="activity"><small>RECENT ACTIVITY</small><p><span class="avatar">AL</span>Alex completed <b style="color:#43515d">Define design tokens</b><span style="float:right;font-size:12px">12 minutes ago</span></p></section>' : ''}<footer>Orbit workspace · Product team</footer></main></body></html>`;
    await writeFile(join(temp, 'index.html'), html);
    await git(['add', '.'], temp);
    await git(['commit', '-m', titles[stage]], temp);
  }
  const result = await capture({ repo: temp, output, width: 1440, height: 900, delay: 100, maxFrames: 4 });
  if (result.failed) process.exitCode = 1;
} finally {
  await rm(temp, { recursive: true, force: true, maxRetries: 3 });
}
