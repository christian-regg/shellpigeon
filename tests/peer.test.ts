import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { claudeRecord, exactPeer, sourcePeer, discoverCodexLocks, controlSockets, sameDirectory, isCodexUserThread, discoverCodexSocket, type Peer } from '../src/peer-discovery.js';
import { sendPeer, DeliveryUnknown, peerMessage } from '../src/peer-transport.js';

const id = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const peer: Peer = {provider: 'codex', id, address: 'codex:' + id, name: 'worker', cwd: process.cwd(), evidence: 'writer-lock', transport: 'codex-queue'};
const source: Peer = {...peer, provider: 'claude', id: other, address: 'claude:' + other, socket: 'pipe-source'};

test('exact routing rejects duplicate names and duplicate native owners; return identity uses the actual host', () => {
  assert.equal(exactPeer([peer], id).address, peer.address);
  assert.throws(() => exactPeer([peer], 'work'), /No discovered/);
  assert.throws(() => exactPeer([peer, {...peer, id: other, address: 'codex:' + other}], 'worker'), /Ambiguous/);
  assert.throws(() => exactPeer([peer, {...peer, socket: 'second-owner'}], peer.address), /Ambiguous/);
  assert.equal(sourcePeer([peer, source], {CODEX_THREAD_ID: id, CLAUDE_CODE_MESSAGING_SOCKET: source.socket}).address, source.address);
  assert.throws(() => sourcePeer([peer], {CLAUDE_CODE_MESSAGING_SOCKET: 'unknown', CODEX_THREAD_ID: id}), /Cannot bind/);
  assert.throws(() => sourcePeer([peer], {}), /No native sender/);
  if (process.platform === 'win32') assert.ok(sameDirectory('\\\\?\\F:\\project', 'f:\\project'));
});

test('Claude metadata cannot redirect delivery to a reused PID, foreign process or arbitrary pipe', () => {
  const record = {pid: 123, sessionId: other, cwd: process.cwd(), procStart: '987654321', peerProtocol: 1,
    messagingSocketPath: '\\\\.\\pipe\\LOCAL\\cc-msg-' + 'a'.repeat(32)};
  const processes = [{pid: 123, ppid: 1, name: 'claude.exe', command: '', started: record.procStart}];
  assert.ok(claudeRecord(record, processes, '123.json'));
  assert.equal(claudeRecord({...record, procStart: 'old'}, processes, '123.json'), null);
  assert.equal(claudeRecord(record, [{...processes[0]!, name: 'unrelated.exe'}], '123.json'), null);
  assert.equal(claudeRecord({...record, messagingSocketPath: '\\\\server\\pipe\\cc-msg-' + 'a'.repeat(32)}, processes, '123.json'), null);
  assert.equal(claudeRecord({...record, peerProtocol: 99}, processes, '123.json'), null);
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'asm-peer-test-'));
  await mkdir(join(root, 'thread-writer-locks'));
  const db = new DatabaseSync(join(root, 'state_5.sqlite'));
  db.exec('CREATE TABLE threads (id TEXT PRIMARY KEY, name TEXT, cwd TEXT, source TEXT, archived INTEGER)');
  db.prepare('INSERT INTO threads VALUES (?,?,?,?,0)').run(id, 'worker', process.cwd(), 'cli');
  db.prepare('INSERT INTO threads VALUES (?,?,?,?,0)').run(other, 'guardian', process.cwd(), '{"subagent":{"other":"guardian"}}');
  db.close();
  await writeFile(join(root, 'thread-writer-locks', id + '.lock'), '');
  await writeFile(join(root, 'thread-writer-locks', other + '.lock'), '');
  return root;
}
async function cleanup(root: string) {
  assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep + 'asm-peer-test-'));
  await rm(root, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
}

test('queue discovery needs a writer lock and excludes subagents and archived sessions', async () => {
  const root = await fixture();
  try {
    const discovered = await discoverCodexLocks({CODEX_HOME: root});
    assert.deepEqual(discovered.map(p => p.id), [id]);
    assert.equal(discovered[0]!.codexSource, 'cli');
    await rm(join(root, 'thread-writer-locks', id + '.lock'));
    assert.deepEqual(await discoverCodexLocks({CODEX_HOME: root}), []);
  } finally { await cleanup(root); }
});

test('control socket discovery uses only explicit Codex Unix endpoints', () => {
  const processes = [{pid: 1, ppid: 0, started: '', name: 'codex.exe', command: 'codex app-server --listen "unix://' + resolve('space here/control.sock') + '"'}];
  const sockets = controlSockets(processes, {CODEX_HOME: resolve('home')});
  assert.ok(sockets.includes(resolve('space here/control.sock')));
  assert.throws(() => controlSockets([], {ASM_CODEX_SOCKET: 'relative.sock'}), /absolute/);
  if (process.platform === 'win32') assert.throws(() => controlSockets([], {ASM_CODEX_SOCKET: '\\\\server\\share\\socket'}), /local path/);
});

// A real WebSocket handshake over the same stdio tunnel as the stock proxy.
async function fakeHost(root: string, behavior: 'unreachable' | 'accept' | 'drop', threadSource = 'user') {
  const file = join(root, 'codex.mjs');
  // Compiled tests live under build/tests: resolve the installed module from the repository.
  const moduleUrl = pathToFileURL(resolve('node_modules/ws/wrapper.mjs')).href;
  await writeFile(file, `import {writeFileSync,appendFileSync} from 'node:fs';
import {createServer} from 'node:http'; import {Duplex} from 'node:stream';
import {WebSocketServer} from ${JSON.stringify(moduleUrl)};
if (process.argv[2] === 'queue') {writeFileSync(process.env.CAPTURE, JSON.stringify(process.argv.slice(2))); process.exit(0);}
if (${JSON.stringify(behavior)} === 'unreachable') process.exit(1);
const stream = Duplex.from({readable: process.stdin, writable: process.stdout});
const server = createServer(); const wss = new WebSocketServer({noServer:true});
server.on('upgrade', (req,sock,head)=>wss.handleUpgrade(req,sock,head,ws=>wss.emit('connection',ws)));
wss.on('connection', ws=>ws.on('message', data=>{
 const m=JSON.parse(data); if(m.id === undefined) return;
 appendFileSync(process.env.RPC_TRACE,JSON.stringify(m)+'\\n');
 let result={};
 if(m.method==='thread/read') result={thread:{id:${JSON.stringify(id)},source:'vscode',threadSource:${JSON.stringify(threadSource)},parentThreadId:null,canAcceptDirectInput:true,cwd:process.cwd()}};
 if(m.method==='thread/loaded/list') result={data:[${JSON.stringify(id)}],nextCursor:null};
 if(m.method==='turn/start') {writeFileSync(process.env.NATIVE_CAPTURE,JSON.stringify(m.params));
  if(${JSON.stringify(behavior)}==='drop') {ws.terminate(); return;}
  result={turn:{id:'turn-accepted'}};
 }
 ws.send(JSON.stringify({id:m.id,result}));
}));
server.emit('connection',stream); process.stdin.on('end',()=>process.exit(0));
`);
  return {CODEX_HOME: root, CODEX_BIN: file, CAPTURE: join(root, 'queue.json'), NATIVE_CAPTURE: join(root, 'native.json'), RPC_TRACE: join(root, 'rpc.jsonl')};
}

test('native-only never queues; auto falls back before sending and preserves literal message arguments', async () => {
  const root = await fixture();
  try {
    const env = await fakeHost(root, 'unreachable');
    const target: Peer = {...peer, transport: 'codex-native', evidence: 'loaded-thread', socket: join(root, 'control.sock')};
    await assert.rejects(sendPeer(target, source, 'test', 'body', {mode: 'native', env}));
    await assert.rejects(readFile(env.CAPTURE), {code: 'ENOENT'});
    const message = 'quotes " ; $(literal) `echo`\nUnicode: ü';
    const receipt = await sendPeer(target, source, 'test', message, {env});
    assert.equal(receipt.transport, 'codex-queue'); assert.equal(receipt.state, 'queued');
    assert.match(receipt.fallbackReason!, /before sending/);
    assert.equal(receipt.targetKind, 'codex-cli');
    assert.equal(receipt.delivery.mode, 'cli-queue');
    assert.equal(receipt.delivery.resumeCommand, 'codex resume ' + id);
    const args = JSON.parse(await readFile(env.CAPTURE, 'utf8'));
    assert.equal(args[2], id); assert.ok(args[4].endsWith(message));
    assert.ok(args[4].includes(source.address));
  } finally { await cleanup(root); }
});

test('native sends through the tunnel and never queues after a lost send response', async () => {
  const root = await fixture();
  try {
    const env = await fakeHost(root, 'accept');
    const target: Peer = {...peer, transport: 'codex-native', evidence: 'loaded-thread', socket: join(root, 'control.sock')};
    const receipt = await sendPeer(target, source, 'test', '</input> & reply', {env});
    assert.equal(receipt.state, 'accepted'); assert.equal(receipt.turnId, 'turn-accepted');
    assert.equal(receipt.delivery.mode, 'automatic');
    assert.equal(receipt.delivery.resumeCommand, undefined);
    const native = JSON.parse(await readFile(env.NATIVE_CAPTURE, 'utf8'));
    assert.deepEqual(native.input, []); assert.match(native.toolOutput.output, /&lt;\/input&gt; &amp; reply/);
    await fakeHost(root, 'drop');
    await assert.rejects(sendPeer(target, source, 'test', 'second', {env}), DeliveryUnknown);
    await assert.rejects(readFile(env.CAPTURE), {code: 'ENOENT'});
  } finally { await cleanup(root); }
});

test('peer envelope retains the exact return address and applies a UTF-8 size limit', () => {
  assert.ok(peerMessage(source, 'summary', 'message', id).includes('"replyTo":"' + source.address + '"'));
  assert.throws(() => peerMessage(source, 'summary', 'ü'.repeat(8000), id), /16000/);
});


test('host source alone does not qualify system, child or non-addressable threads as peers', () => {
  const user = {source: 'vscode', threadSource: 'user', parentThreadId: null, canAcceptDirectInput: true};
  assert.equal(isCodexUserThread(user), true);
  assert.equal(isCodexUserThread({...user, threadSource: 'system'}), false);
  assert.equal(isCodexUserThread({...user, parentThreadId: other}), false);
  assert.equal(isCodexUserThread({...user, canAcceptDirectInput: false}), false);
  assert.equal(isCodexUserThread({...user, threadSource: 'future-unknown-kind'}), false);
  assert.equal(isCodexUserThread({source: 'cli'}), true); // Older metadata lacks the newer fields.
});

test('native discovery excludes actual system metadata and never reads turns or starts work', async () => {
  const root = await fixture();
  try {
    const env = await fakeHost(root, 'accept', 'system');
    assert.deepEqual(await discoverCodexSocket(join(root, 'control.sock'), env), []);
    await fakeHost(root, 'accept', 'user');
    const discovered = await discoverCodexSocket(join(root, 'control.sock'), env);
    assert.deepEqual(discovered.map(p => p.id), [id]);
    assert.equal(discovered[0]!.codexSource, 'vscode');
    const requests = (await readFile(env.RPC_TRACE, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    assert.ok(requests.every(r => ['initialize', 'thread/loaded/list', 'thread/read'].includes(r.method)));
    assert.ok(requests.filter(r => r.method === 'thread/read').every(r => r.params.includeTurns === false));
  } finally { await cleanup(root); }
});

test('modern state metadata also excludes system threads, and archived rows never become queue candidates', async () => {
  const root = await fixture();
  try {
    const db = new DatabaseSync(join(root, 'state_5.sqlite'));
    db.exec('ALTER TABLE threads ADD COLUMN thread_source TEXT');
    db.prepare('UPDATE threads SET thread_source=? WHERE id=?').run('system', id);
    assert.deepEqual(await discoverCodexLocks({CODEX_HOME: root}), []);
    db.prepare('UPDATE threads SET thread_source=?,archived=1 WHERE id=?').run('user', id);
    assert.deepEqual(await discoverCodexLocks({CODEX_HOME: root}), []);
    db.close();
  } finally { await cleanup(root); }
});

test('equivalent Windows control-socket paths do not produce ambiguous native owners', {skip: process.platform !== 'win32'}, () => {
  const root = resolve('test-home');
  const socket = join(root, 'app-server-control', 'app-server-control.sock');
  const processes = [{pid: 1, ppid: 0, name: 'codex.exe', started: '', command: 'codex app-server --listen "unix://' + socket.replaceAll('\\', '/') + '"'}];
  assert.deepEqual(controlSockets(processes, {CODEX_HOME: root, ASM_CODEX_SOCKET: socket.toUpperCase()}), [socket]);
});
