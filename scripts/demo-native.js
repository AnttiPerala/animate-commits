import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { git } from '../src/git.js';
import { run } from '../src/process.js';

const temp = await mkdtemp(join(tmpdir(), 'animate-native-demo-'));
try {
  await git(['init', '.'], temp);
  await git(['config', 'user.email', 'demo@example.invalid'], temp);
  await git(['config', 'user.name', 'Desktop demo'], temp);
  for (let stage = 0; stage < 3; stage++) {
    await writeFile(join(temp, 'app.py'), `import tkinter as tk
from pathlib import Path
root=tk.Tk()
root.title('Orbit Python Desktop')
root.configure(bg='#eff3f5')
root.geometry('960x600')
stage=${stage}
if stage>0:
    sidebar=tk.Frame(root,bg='#172735',width=180)
    sidebar.pack(side='left',fill='y')
    sidebar.pack_propagate(False)
    tk.Label(sidebar,text='orbit',bg='#172735',fg='white',font=('Segoe UI',26,'bold')).pack(anchor='w',padx=24,pady=30)
    for label in ['Overview','Projects','Activity','Team']:
        tk.Label(sidebar,text=label,bg='#172735',fg='#afc6d2',font=('Segoe UI',12)).pack(anchor='w',padx=24,pady=12)
main=tk.Frame(root,bg='#eff3f5')
main.pack(side='left',fill='both',expand=True,padx=30,pady=30)
tk.Label(main,text='PROJECT WORKSPACE',bg='#eff3f5',fg='#67808a',font=('Segoe UI',10)).pack(anchor='w')
tk.Label(main,text='Every day, a little closer.' if stage else 'Project tasks',bg='#eff3f5',fg='#213645',font=('Segoe UI',24,'bold')).pack(anchor='w',pady=(12,5))
tk.Label(main,text='A native Python desktop app, evolving through Git.',bg='#eff3f5',fg='#67808a',font=('Segoe UI',11)).pack(anchor='w',pady=(0,25))
if stage==2:
    stats=tk.Frame(main,bg='#ffffff',padx=20,pady=18)
    stats.pack(fill='x',pady=(0,20))
    tk.Label(stats,text='12 projects       84 tasks complete       72% progress',bg='white',fg='#267953',font=('Segoe UI',15,'bold')).pack(anchor='w')
for index,title in enumerate(['Design the landing page','Build project navigation','Invite the team']):
    card=tk.Frame(main,bg='white',padx=20,pady=15)
    card.pack(fill='x',pady=6)
    tk.Label(card,text=title,bg='white',fg='#213645',font=('Segoe UI',12,'bold')).pack(anchor='w')
    if stage==2:
        tk.Label(card,text=['Complete','In progress','Planned'][index],bg='white',fg='#328764',font=('Segoe UI',10)).pack(anchor='w',pady=(6,0))
root.after(100,lambda:Path('ready.flag').touch())
root.mainloop()
`);
    await git(['add', '.'], temp);
    await git(['commit', '-m', ['Start a native task list', 'Add workspace navigation', 'Show progress and task status'][stage]], temp);
  }
  const config = join(temp, 'capture.json');
  await writeFile(config, JSON.stringify({ repo: temp, output: resolve(process.argv[2] || 'captures/native-demo'),
    appType: 'native', start: 'python app.py', nativeWindowTitle: '^Orbit Python Desktop$', nativeReadyFile: 'ready.flag',
    width: 960, height: 600, delay: 300, timeout: 15000 }));
  const result = await run(resolve('dist/animate-commits.exe'), ['--config', config], { timeout: 120000 });
  console.log(result);
} finally { await rm(temp, { recursive: true, force: true, maxRetries: 3 }); }
