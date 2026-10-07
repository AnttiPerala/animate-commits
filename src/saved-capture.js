import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { git } from './git.js';

export async function savedCapture(output) {
  const manifest=JSON.parse(await readFile(join(output,'manifest.json'),'utf8'));
  const frames=manifest.frames?.filter(frame=>frame.status==='captured') || [];
  if(!frames.length) throw new Error('No captured frames recorded in this folder.');
  if(frames.some(frame=>!/^frames\/frame-\d{6,}\.png$/.test(frame.file) || typeof frame.hash!=='string')) throw new Error('Invalid saved frame record.');
  const settings=manifest.settings || {};
  const config={output,update:true};
  for(const field of ['width','height','fps']) if(Number.isSafeInteger(settings[field]) && settings[field]>0) config[field]=settings[field];
  if(['web','electron','native'].includes(settings.appType)) config.appType=settings.appType;
  return {config,count:frames.length,hashes:frames.map(frame=>frame.hash),frame:frames.at(-1)};
}

// Older releases saved only repository names. Recover a link only when every
// captured commit belongs to this local repository's current first-parent history.
export async function findSavedCapture(repo, capturesRoot) {
  if(/^(?:[\w+.-]+:\/\/|[^/\\]+@[^:]+:)/.test(repo)) return null;
  let directories;
  try { directories=(await readdir(capturesRoot,{withFileTypes:true})).filter(item=>item.isDirectory()); }
  catch(error) { if(error.code==='ENOENT')return null; throw error; }
  const candidates=[];
  for(const entry of directories) {
    const output=join(capturesRoot,entry.name);
    try { candidates.push({output,...await savedCapture(output),modified:(await stat(join(output,'manifest.json'))).mtimeMs}); } catch { /* Not a saved capture. */ }
  }
  if(!candidates.length)return null;
  const hashes=new Set((await git(['log','--first-parent','--format=%H','HEAD','--'],repo,undefined,{timeout:30000})).split('\n'));
  return candidates.sort((a,b)=>b.modified-a.modified).find(item=>item.hashes.every(hash=>hashes.has(hash))) || null;
}
