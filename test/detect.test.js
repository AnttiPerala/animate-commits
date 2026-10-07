import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { detectSetup } from '../src/detect.js';
import { capture } from '../src/capture.js';
import { git } from '../src/git.js';
import net from 'node:net';

async function fixture(files, check) {
  const root = await mkdtemp(join(tmpdir(), 'animate-detect-test-'));
  try {
    for(const [name,content] of Object.entries(files)) { await mkdir(join(root,name,'..'),{recursive:true}); await writeFile(join(root,name),content); }
    await check(root);
  } finally { await rm(root,{recursive:true,force:true}); }
}

test('Node/Electron projects suggest a browser server first, without running scripts', async () => {
  await fixture({'package.json':JSON.stringify({scripts:{start:'node server.js',desktop:'electron .',postinstall:'echo SHOULD_NOT_RUN'},dependencies:{express:'*'},devDependencies:{electron:'*'},main:'desktop/main.cjs'}), 'package-lock.json':'{}', 'public/index.html':'<h1>App</h1>'}, async root => {
    const before = await readdir(root);
    const {candidates} = await detectSetup(root);
    assert.equal(candidates.length,2);
    assert.equal(candidates[0].settings.start,'npm run start');
    assert.equal(candidates[0].settings.install,'npm ci --omit=dev');
    assert.equal(candidates[1].settings.appType,'electron');
    assert.equal(candidates[1].settings.install,'npm ci');
    assert.deepEqual(await readdir(root),before);
    const logs=[];
    await assert.rejects(capture({repo:root,output:join(root,'output')},{log:line=>logs.push(line)}), /Click Detect setup/);
    assert.deepEqual(logs,[]);
    assert.deepEqual(await readdir(root),before);
  });
});

test('Vite and nested Next.js apps get explicit port arguments and matching package managers', async () => {
  await fixture({'package.json':JSON.stringify({scripts:{dev:'vite'},packageManager:'pnpm@10.0.0'}),'pnpm-lock.yaml':'lockfileVersion: 9'}, async root => {
    const setup=(await detectSetup(root)).candidates[0].settings;
    assert.equal(setup.install,'pnpm install');
    assert.equal(setup.start,'pnpm run dev --host 127.0.0.1 --port {port} --strictPort');
  });
  await fixture({'package.json':'{"workspaces":["apps/*"]}','apps/site/package.json':'{"scripts":{"dev":"next dev"}}'}, async root => {
    const setup=(await detectSetup(root)).candidates[0].settings;
    assert.equal(setup.directory,'apps/site');
    assert.match(setup.start,/--hostname 127.0.0.1 --port \{port\}/);
  });
});

test('Python detection uses an isolated environment and distinguishes desktop from web', async () => {
  await fixture({'app.py':'import tkinter as tk\nraise Exception("Do not execute")'}, async root => {
    const setup=(await detectSetup(root)).candidates[0].settings;
    assert.equal(setup.appType,'native');
    assert.equal(setup.install,'python -m venv .animate-venv');
    assert.match(setup.start,/python(?:\.exe)? app.py$/);
  });
  await fixture({'app.py':'from flask import Flask','requirements.txt':'Flask'}, async root => {
    const setup=(await detectSetup(root)).candidates[0].settings;
    assert.equal(setup.appType,'web');
    assert.match(setup.install,/pip install -r requirements.txt/);
    assert.match(setup.start,/-m flask --app app.py run --host 127.0.0.1 --port \{port\}/);
  });
});

test('static sites, unknown projects, invalid manifests, and remote URLs are handled explicitly', async () => {
  await fixture({'public/index.html':'<h1>Hello</h1>'},async root => {
    const setup=(await detectSetup(root)).candidates[0].settings;
    assert.equal(setup.staticDir,'public'); assert.equal(setup.start,null);
  });
  await fixture({'README.md':'Run a custom command'},async root => assert.equal((await detectSetup(root)).candidates.length,0));
  await fixture({'package.json':'{'},async root => assert.match((await detectSetup(root)).warnings[0],/invalid JSON/));
  await assert.rejects(detectSetup('https://example.com/repo.git'), /local repository/);
  await fixture({},async root => await assert.rejects(detectSetup(root,'..'),/stay inside/));
});

test('suggested Node settings install and launch an isolated app and produce a frame', {timeout:90000}, async () => {
  await fixture({'package.json':'{"name":"detected-fixture","version":"1.0.0","private":true,"scripts":{"start":"node server.js"}}',
    'server.js':"require('http').createServer((req,res)=>res.end('<h1>Detected app works</h1>')).listen(Number(process.env.PORT),'127.0.0.1');"}, async root => {
    await git(['init','.'],root); await git(['config','user.name','Fixture'],root); await git(['config','user.email','fixture@example.invalid'],root);
    await git(['add','.'],root); await git(['commit','-m','Node app'],root);
    const probe=net.createServer();
    await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));
    const port=probe.address().port; await new Promise(resolve=>probe.close(resolve));
    const settings=(await detectSetup(root)).candidates[0].settings;
    const result=await capture({...settings,repo:root,output:join(root,'output'),port,width:640,height:360,delay:0},{log:()=>{}});
    assert.equal(result.captured,1); assert.equal(result.failed,0);
    assert.equal((await readdir(root)).includes('package-lock.json'),false,'install must not modify the source');
    assert.equal((await readdir(root)).includes('node_modules'),false);
  });
});
