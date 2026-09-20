import {cp,mkdir,readFile,writeFile,stat,readdir,mkdtemp,rename} from 'node:fs/promises';
import {resolve,join,relative,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {writeNotices} from './third-party-notices.mjs';
const execute=promisify(execFile);
const metadata=JSON.parse(await readFile('package.json','utf8'));
const releases=resolve('artifacts/release');
await mkdir(releases,{recursive:true});
const stage=await mkdtemp(join(releases,'.staging-'));
const destination=join(releases,metadata.version);
const manifest={name:metadata.name,displayName:metadata.displayName,version:metadata.version,license:metadata.license??null,files:{}};
for(const host of ['claude','codex']){
 const source=resolve('plugins',host,metadata.name);
 const target=join(stage,host+'-marketplace/plugins',metadata.name);
 for(const required of ['dist/mcp.cjs','dist/broker.cjs','dist/peer.cjs','skills/session-messaging/SKILL.md','skills/session-messaging/references/durable-mailboxes.md','skills/session-messaging/references/codex-listener.md'])await stat(join(source,required));
 await mkdir(target,{recursive:true});
 for(const entry of [host==='claude'?'.claude-plugin':'.codex-plugin','.mcp.json','skills','dist'])await cp(join(source,entry),join(target,entry),{recursive:true});
 if(host==='codex')for(const entry of ['setup.cjs','setup-listener.ps1'])await cp(join(source,entry),join(target,entry));
 // Keep the document tree so relative links work in extracted plugin packages.
 await cp('docs',join(target,'docs'),{recursive:true});
 await writeFile(join(target,'INSTALLATION.de.md'),'# Installation\n\n[Installation und Updates](INSTALL.md) · [Betrieb und optionale Postfächer](docs/installed-plugin.de.md)\n');
 await cp('INSTALL.md',join(target,'INSTALL.md'));
 for(const file of ['LICENSE','CHANGELOG.md']){
  try{await cp(file,join(target,file));}catch(error){if(error.code!=='ENOENT'||file!=='LICENSE')throw error;}
 }
 await writeNotices(target);
}
await cp('plugin-assets/codex-marketplace/.agents',join(stage,'codex-marketplace/.agents'),{recursive:true});
await mkdir(join(stage,'claude-marketplace/.claude-plugin'),{recursive:true});
await writeFile(join(stage,'claude-marketplace/.claude-plugin/marketplace.json'),JSON.stringify({name:'agent-session-messaging',owner:{name:'Christian'},plugins:[{name:metadata.name,source:'./plugins/'+metadata.name,description:metadata.description}]},null,2)+'\n');
await cp('build/install.cjs',join(stage,'install.cjs'));
for(const file of ['INSTALL.md','CHANGELOG.md','LICENSE'])try{await cp(file,join(stage,file));}catch(error){if(error.code!=='ENOENT'||file!=='LICENSE')throw error;}
await cp('docs',join(stage,'docs'),{recursive:true});
await writeNotices(stage);
async function collect(directory){
 for(const entry of await readdir(directory,{withFileTypes:true})){
  const path=join(directory,entry.name);
  if(entry.isSymbolicLink())throw new Error('Symlink in release: '+path);
  if(entry.isDirectory())await collect(path);
  else manifest.files[relative(stage,path).split(sep).join('/')]=createHash('sha256').update(await readFile(path)).digest('hex');
 }
}
await collect(stage);
manifest.files=Object.fromEntries(Object.entries(manifest.files).sort(([a],[b])=>a.localeCompare(b)));
await writeFile(join(stage,'release.json'),JSON.stringify(manifest,null,2)+'\n');
// Preserve the previous build for diagnosis rather than merging files into it.
try{await stat(destination);await rename(destination,destination+'.previous-'+Date.now());}catch(error){if(error.code!=='ENOENT')throw error;}
await rename(stage,destination);
if(process.platform==='win32'){
 const archive=join(releases,metadata.artifactName+'-'+metadata.version+'-windows.zip');
 await execute('tar.exe',['-a','-c','-f',archive,'-C',destination,'.'],{windowsHide:true});
 await writeFile(archive+'.sha256',createHash('sha256').update(await readFile(archive)).digest('hex')+'  '+metadata.artifactName+'-'+metadata.version+'-windows.zip\n');
} else if(process.platform==='linux'){
 const name=metadata.artifactName+'-'+metadata.version+'-linux.tar.gz';
 const archive=join(releases,name);
 await execute('tar',['-czf',archive,'-C',destination,'.']);
 await writeFile(archive+'.sha256',createHash('sha256').update(await readFile(archive)).digest('hex')+'  '+name+'\n');
}
console.log('Built release: '+destination+' ('+Object.keys(manifest.files).length+' files; license '+(manifest.license??'pending')+').');
