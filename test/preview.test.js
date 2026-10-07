import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createGuiServer } from '../src/gui.js';
import { launchBrowser } from '../src/browser.js';

test('existing capture opens playing after restart, loops, pauses, and uses fresh manifest data', {timeout:60000}, async () => {
  const temp = await mkdtemp(join(tmpdir(),'animate-preview-test-'));
  const app = await createGuiServer({historyFile:join(temp,'recent.json')});
  const browser = await launchBrowser();
  try {
    const output=join(temp,'existing capture');
    await mkdir(join(output,'frames'),{recursive:true});
    const page=await browser.newPage({viewport:{width:1000,height:900}});
    for(const [i,color] of ['red','blue','green'].entries()) {
      await page.setContent(`<body style="background:${color}">Frame ${i+1}</body>`);
      await page.screenshot({path:join(output,`frames/frame-00000${i+1}.png`)});
    }
    const manifest={version:1,settings:{fps:2},frames:[1,2,3].map(n=>({status:'captured',file:`frames/frame-00000${n}.png`,hash:String(n).repeat(40),date:'2026-10-08',subject:`Frame ${n}`}))};
    const original=JSON.stringify(manifest);
    await writeFile(join(output,'manifest.json'),original);
    // No preview.html: old/stale/missing player files must not require recapture.
    const errors=[]; page.on('pageerror',e=>errors.push(e.message));
    await page.goto(app.url);
    await page.waitForFunction(()=>document.getElementById('width').value==='1920');
    await page.locator('#output').fill(output);
    await page.locator('#preview').click();
    const player=page.frameLocator('#previewFrame');
    await player.locator('#play').filter({hasText:'Pause'}).waitFor();
    await player.locator('#count').filter({hasText:'2 / 3 frames'}).waitFor();
    await player.locator('#frame').evaluate(img=>img.decode());
    await player.locator('#count').filter({hasText:'3 / 3 frames'}).waitFor();
    await player.locator('#stop').click();
    assert.equal(await player.locator('#count').textContent(),'1 / 3 frames');
    assert.equal(await player.locator('#play').textContent(),'Play');
    assert.equal(await player.locator('#prev').isDisabled(),true);
    await page.waitForTimeout(350);
    assert.equal(await player.locator('#count').textContent(),'1 / 3 frames');
    await player.locator('#next').click();
    assert.equal(await player.locator('#count').textContent(),'2 / 3 frames');
    await player.locator('#next').click();
    assert.equal(await player.locator('#next').isDisabled(),true);
    await player.locator('#prev').click();
    assert.equal(await player.locator('#count').textContent(),'2 / 3 frames');
    await player.locator('#rewind').click();
    assert.equal(await player.locator('#count').textContent(),'1 / 3 frames');
    assert.equal(await player.locator('#play').textContent(),'Play');
    await player.locator('#play').click();
    await player.locator('#rewind').click();
    assert.equal(await player.locator('#play').textContent(),'Pause');
    await player.locator('#count').filter({hasText:'3 / 3 frames'}).waitFor();
    await player.locator('#count').filter({hasText:'1 / 3 frames'}).waitFor();
    await player.locator('#play').click();
    const paused=await player.locator('#count').textContent();
    await page.waitForTimeout(650);
    assert.equal(await player.locator('#count').textContent(),paused);
    await player.locator('#scrub').evaluate(input=>{input.value='1';input.dispatchEvent(new Event('input',{bubbles:true}));});
    assert.equal(await player.locator('#message').textContent(),'Frame 2');
    await player.locator('#speed').selectOption('4');
    await player.locator('#play').click();
    await player.locator('#count').filter({hasText:'3 / 3 frames'}).waitFor();
    await page.locator('#closePreview').click();
    await page.locator('#preview').click();
    await player.locator('#play').filter({hasText:'Pause'}).waitFor();
    assert.equal(await page.locator('#status').textContent(),'Ready to capture');
    await page.locator('#closePreview').click();
    assert.equal(await readFile(join(output,'manifest.json'),'utf8'),original);
    manifest.frames=[];
    await writeFile(join(output,'manifest.json'),JSON.stringify(manifest));
    await page.locator('#preview').click();
    await page.locator('#error').filter({hasText:'no captured frames'}).waitFor();
    assert.deepEqual(errors,[]);
  } finally { await browser.close(); await app.close(); await rm(temp,{recursive:true,force:true,maxRetries:3}); }
});
