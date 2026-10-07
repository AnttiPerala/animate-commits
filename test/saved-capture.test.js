import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { git } from '../src/git.js';
import { createGuiServer } from '../src/gui.js';
import { recentRepositories } from '../src/recent.js';

test('legacy recent entries recover a matching capture and preserve missing saved locations',async()=>{
  const temp=await mkdtemp(join(tmpdir(),'animate-reconnect-test-'));
  let app;
  try {
    const repo=join(temp,'repo'),capturesRoot=join(temp,'captures'),historyFile=join(temp,'recent.json');
    await mkdir(repo); await git(['init','.'],repo); await git(['config','user.name','Fixture'],repo); await git(['config','user.email','fixture@example.invalid'],repo);
    await writeFile(join(repo,'index.html'),'First'); await git(['add','.'],repo); await git(['commit','-m','First'],repo);
    const hash=await git(['rev-parse','HEAD'],repo);
    const output=join(capturesRoot,'saved'),unrelated=join(capturesRoot,'unrelated');
    const manifest={settings:{width:640,height:360,appType:'web',fps:2},frames:[{status:'captured',hash,file:'frames/frame-000001.png'}]};
    await mkdir(output,{recursive:true}); await writeFile(join(output,'manifest.json'),JSON.stringify(manifest));
    await mkdir(unrelated); await writeFile(join(unrelated,'manifest.json'),JSON.stringify({...manifest,frames:[{status:'captured',hash:'f'.repeat(40)}]}));
    await writeFile(historyFile,JSON.stringify([repo]));
    app=await createGuiServer({historyFile,capturesRoot});
    const reopen=async()=>{const response=await fetch(new URL('api/reopen',app.url),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({repo})});assert.equal(response.status,200);return response.json();};
    const restored=await reopen();
    assert.equal(restored.config.output,output); assert.equal(restored.config.update,true);
    assert.match(restored.message,/Restored 1 saved frames/);
    assert.equal((await recentRepositories(historyFile).get(repo)).output,output);
    // A rejected run against another nonempty folder cannot replace this link.
    const invalidOutput=join(temp,'other-output'); await mkdir(invalidOutput);
    await writeFile(join(invalidOutput,'manifest.json'),JSON.stringify(manifest));
    const start=await fetch(new URL('api/start',app.url),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind:'capture',config:{repo,output:invalidOutput}})});
    assert.equal(start.status,200);
    for(let i=0;i<100;i++) { const state=await (await fetch(new URL('api/state',app.url))).json(); if(state.status==='failed')break; await new Promise(resolve=>setTimeout(resolve,20)); }
    assert.equal((await recentRepositories(historyFile).get(repo)).output,output);
    await rm(output,{recursive:true,force:true});
    const missing=await reopen();
    assert.equal(missing.config.output,output); assert.match(missing.message,/missing or unavailable/);
    assert.equal((await recentRepositories(historyFile).get(repo)).output,output);
  }finally{await app?.close();await rm(temp,{recursive:true,force:true,maxRetries:3});}
});
