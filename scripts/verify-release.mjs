import assert from 'node:assert/strict';
import {readFile,readdir,stat} from 'node:fs/promises';
import {resolve,join,relative,sep} from 'node:path';
import {verifyRelease} from '../build/src/distribution.js';
const metadata=JSON.parse(await readFile('package.json','utf8'));
const root=resolve('artifacts/release',metadata.version);
const release=await verifyRelease(root);
assert.equal(release.version,metadata.version);
const actual=[];
async function walk(dir){for(const entry of await readdir(dir,{withFileTypes:true})){const path=join(dir,entry.name);if(entry.isDirectory())await walk(path);else actual.push(relative(root,path).split(sep).join('/'));}}
await walk(root);
assert.deepEqual(actual.filter(p=>p!=='release.json').sort(),Object.keys(release.files).sort(),'Unlisted or stale release files');
for(const path of actual){
 assert.ok(!/(?:^|\/)(?:node_modules|\.git|auth\.json|\.env)(?:\/|$)|\.(?:sqlite|log)(?:$|-)/i.test(path),'Private/development file: '+path);
 const content=await readFile(join(root,path),'utf8');
 assert.ok(!/[A-Z]:[\\/]Users[\\/](?!Public\b|Default\b|<)[^\\/\s]+/i.test(content),'Personal path in release: '+path);
}
for(const host of ['claude','codex']){
 const plugin=join(root,host+'-marketplace/plugins/agent-session-messaging');
 const descriptor=JSON.parse(await readFile(join(plugin,host==='codex'?'.codex-plugin/plugin.json':'.claude-plugin/plugin.json'),'utf8'));
 assert.equal(descriptor.version,metadata.version);
 const inventory=JSON.parse(await readFile(join(plugin,'BUNDLED-DEPENDENCIES.json'),'utf8'));
 assert.ok(inventory.some(p=>p.name==='ws'));
 assert.ok(inventory.every(p=>p.license&&p.files.length));
 await stat(join(plugin,'THIRD-PARTY-NOTICES.txt'));
 const skill=await readFile(join(plugin,'skills/session-messaging/SKILL.md'),'utf8');
 assert.match(skill,/newly opened, empty Codex CLI/);
}
if(process.argv.includes('--require-license')){
 assert.ok(metadata.license,'An explicit project license decision is still required before publication.');
 for(const prefix of ['', 'codex-marketplace/plugins/agent-session-messaging/', 'claude-marketplace/plugins/agent-session-messaging/'])await stat(join(root,prefix+'LICENSE'));
}
console.log(JSON.stringify({version:release.version,files:actual.length,checksums:true,packageInventory:true,thirdPartyNotices:true,personalPathsAbsent:true,projectLicense:metadata.license??'pending'},null,2));
