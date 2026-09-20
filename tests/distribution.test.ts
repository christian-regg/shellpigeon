import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {releasePath,verifyRelease,checkInventory,selectHosts} from '../src/distribution.js';

test('distribution rejects a foreign marketplace or duplicate plugin before writes',()=>{
 const root=resolve('fixture/codex-marketplace');
 assert.throws(()=>checkInventory('codex',root,[{name:'agent-session-messaging',root:resolve('other')}],[]),/different directory/);
 assert.throws(()=>checkInventory('codex',root,[],[{pluginId:'agent-session-messaging@personal',name:'agent-session-messaging'}]),/another marketplace/);
 assert.throws(()=>checkInventory('claude',root,[],[{id:'agent-session-messaging@old'}]),/another marketplace/);
 assert.equal(checkInventory('codex',root,[{name:'agent-session-messaging',root}],[]).current,undefined);
 assert.deepEqual(selectHosts('claude'),['claude']);assert.throws(()=>selectHosts('unknown'),/--host/);
});
test('release paths cannot escape the extracted directory',()=>{
 for(const path of ['../file','/file','C:/file','a/../file','a\\file','a//file'])assert.throws(()=>releasePath(resolve('fixture'),path),/path/i);
});
test('release verification detects damaged payloads and permits regeneration of local Codex configuration',async()=>{
 const root=await mkdtemp(join(tmpdir(),'asm-distribution-test-'));
 try{
  const files=['install.cjs','INSTALL.md','codex-marketplace/.agents/plugins/marketplace.json','claude-marketplace/.claude-plugin/marketplace.json',
  'codex-marketplace/plugins/agent-session-messaging/setup.cjs','codex-marketplace/plugins/agent-session-messaging/dist/peer.cjs','claude-marketplace/plugins/agent-session-messaging/dist/peer.cjs','codex-marketplace/plugins/agent-session-messaging/.mcp.json'];
  const hashes:Record<string,string>={};
  for(const file of files){const full=releasePath(root,file);await mkdir(join(full,'..'),{recursive:true});await writeFile(full,'fixture');hashes[file]=createHash('sha256').update('fixture').digest('hex');}
  await writeFile(join(root,'release.json'),JSON.stringify({name:'agent-session-messaging',version:'0.4.0-preview.5',files:hashes}));
  await verifyRelease(root);
  await writeFile(join(root,files[7]!),'locally generated');await verifyRelease(root);
  await writeFile(join(root,files[5]!),'damaged');await assert.rejects(verifyRelease(root),/checksum mismatch/);
  assert.equal(await readFile(join(root,files[5]!),'utf8'),'damaged');
 }finally{assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep+'asm-distribution-test-'));await rm(root,{recursive:true,force:true});}
});
