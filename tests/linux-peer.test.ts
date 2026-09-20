import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { linuxProcessStat, linuxProcesses } from '../src/peer-process.js';
import { claudeRecord, discoverClaude, controlSockets, sameDirectory, type Peer } from '../src/peer-discovery.js';
import { sendPeer } from '../src/peer-transport.js';
import { checkInventory } from '../src/distribution.js';

const id = '11111111-1111-4111-8111-111111111111';
const sourceId = '22222222-2222-4222-8222-222222222222';
const linux = {skip: process.platform !== 'linux'};

test('Linux process identity handles parentheses and rejects zombies or incomplete stat data', () => {
  const fields = ['S', '42', ...Array(17).fill('0'), '987654321', '0'];
  assert.deepEqual(linuxProcessStat('123 (odd ) process) '+fields.join(' ')), {pid: 123, name: 'odd ) process', ppid: 42, started: '987654321'});
  assert.equal(linuxProcessStat('123 (claude) Z '+fields.slice(1).join(' ')), null);
  assert.equal(linuxProcessStat('123 (claude) S 1'), null);
});

test('Linux Claude records require matching start time and PID namespace with an absolute Unix endpoint', () => {
  const record = {pid: 123, sessionId: id, cwd: '/project', peerProtocol: 1, procStart: '12345', pidDomain: 'linux:machine:pid:[42]', messagingSocketPath: '/tmp/cc-socks/123.sock'};
  const processes = [{pid: 123, ppid: 1, name: 'claude', command: 'claude', started: '12345', pidDomain: record.pidDomain}];
  assert.ok(claudeRecord(record, processes, '123.json', 'linux'));
  for (const change of [{procStart:'old'}, {pidDomain:'linux:other:pid:[42]'}, {pidDomain:undefined}, {messagingSocketPath:'relative.sock'}, {messagingSocketPath:'http://localhost/file.sock'}, {messagingSocketPath:'/tmp/file'}, {messagingSocketPath:'/tmp/a\0.sock'}]) {
    assert.equal(claudeRecord({...record,...change}, processes, '123.json', 'linux'), null);
  }
});

test('Linux command lines preserve spaces in explicit socket paths and directory case', linux, () => {
  const socket = '/tmp/space here/control.sock';
  const processes = [{pid: 1, ppid: 0, started: '', name: 'codex', command: '', argv: ['codex', 'app-server', '--listen', 'unix://'+socket]}];
  assert.ok(controlSockets(processes, {CODEX_HOME:'/tmp/home'}).includes(socket));
  assert.equal(sameDirectory('/tmp/Project','/tmp/project'),false);
  assert.throws(()=>checkInventory('codex','/tmp/Project',[{name:'agent-session-messaging',root:'/tmp/project'}],[]),/different directory/);
});

test('Linux IPC validates a real process and socket, sends one canonical peer message and rejects stale identities', {...linux, timeout: 15000}, async () => {
  const root = await mkdtemp(join(tmpdir(),'sp-linux-'));
  let child: ReturnType<typeof spawn> | undefined;
  try {
    const sessions = join(root, 'sessions');
    const entry = join(root, 'node_modules/@anthropic-ai/claude-code/fixture.cjs');
    const socket = join(root, 'peer.sock');
    await mkdir(sessions); await mkdir(join(entry,'..'),{recursive:true});
    await writeFile(entry, [
      "const fs=require('node:fs'); const net=require('node:net');",
      "let connections=0; const server=net.createServer(client=>{connections++;let text='';client.on('data',b=>text+=b);client.on('end',()=>{fs.writeFileSync(process.argv[3],JSON.stringify({connections,text}));});});",
      "server.listen(process.argv[2],()=>process.stdout.write('READY'));",
    ].join('\n'));
    const capture = join(root, 'received.json');
    child = spawn(process.execPath, [entry,socket,capture], {stdio:['pipe','pipe','pipe']});
    await once(child.stdout!, 'data');
    const processes = await linuxProcesses();
    const processRecord = processes.find(p=>p.pid===child!.pid);
    assert.ok(processRecord);
    const record = {pid: child.pid, sessionId:id,cwd:root,peerProtocol:1,procStart:processRecord.started,pidDomain:processRecord.pidDomain,messagingSocketPath:socket};
    const registry = join(sessions, child.pid+'.json');
    await writeFile(registry,JSON.stringify(record));
    const token='a'.repeat(32);
    await writeFile(join(sessions,child.pid+'.'+'b'.repeat(64)+'.key'),JSON.stringify({peerToken:token,procStart:record.procStart,pidDomain:record.pidDomain}));
    const peers = await discoverClaude(processes,{CLAUDE_CONFIG_DIR:root});
    assert.equal(peers.length,1);
    const source:Peer={provider:'codex',id:sourceId,address:'codex:'+sourceId,name:'sender',cwd:root,evidence:'writer-lock',transport:'codex-queue'};
    const receipt = await sendPeer(peers[0]!,source,'Linux test','literal < & message');
    assert.equal(receipt.state,'transport-written');
    let received;
    for(let attempt=0;attempt<100;attempt++) {
      try {received=JSON.parse(await readFile(capture,'utf8'));break;} catch {await new Promise(r=>setTimeout(r,10));}
    }
    assert.equal(received.connections,1,'Discovery must not probe the recipient socket');
    const lines=received.text.trim().split('\n').map((line:string)=>JSON.parse(line));
    assert.deepEqual(lines[0],{type:'auth',token});
    assert.equal(lines[1].priority,'immediate');
    assert.ok(lines[1].message.content.includes('<cross-session-message'));
    assert.ok(lines[1].message.content.includes('literal &lt; &amp; message'));
    assert.ok(lines[1].message.content.includes(source.address));
    await writeFile(registry,JSON.stringify({...record,procStart:'stale'}));
    await assert.rejects(sendPeer(peers[0]!,source,'test','must not send'),/changed or exited/);
    await writeFile(registry,JSON.stringify({...record,messagingSocketPath:join(root,'regular.sock')}));
    await writeFile(join(root,'regular.sock'),'not a socket');
    assert.deepEqual(await discoverClaude(processes,{CLAUDE_CONFIG_DIR:root}),[]);
    const alias=join(root,'alias.sock');await symlink(socket,alias);
    await writeFile(registry,JSON.stringify({...record,messagingSocketPath:alias}));
    assert.deepEqual(await discoverClaude(processes,{CLAUDE_CONFIG_DIR:root}),[]);
  } finally {
    if(child && child.exitCode===null){const ended=once(child,'close');child.kill();await ended;}
    assert.ok(root.startsWith(join(tmpdir(),'sp-linux-')));
    await rm(root,{recursive:true,force:true});
  }
});
