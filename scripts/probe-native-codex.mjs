import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { connectCodex, delegatedTurn } from '../build/src/native-codex.js';
import { discoverCodexSocket } from '../build/src/peer-discovery.js';
import { sendPeer } from '../build/src/peer-transport.js';

const socketArg = process.argv.indexOf('--socket');
const socketPath = socketArg >= 0 ? process.argv[socketArg + 1] : undefined;
if (socketArg >= 0 && !socketPath) throw new Error('--socket requires a path.');
const report = {testedAt: new Date().toISOString(), host: 'codex', transport: socketPath ? 'stock proxy to test-owned control socket' : 'test-owned stdio app-server',
  ordinaryCliProven: false, tests: []};
const rpc = await connectCodex({args: socketPath ? ['app-server', 'proxy', '--sock', socketPath] : ['app-server', '--listen', 'stdio://', '-c', 'features.hooks=false'], timeout: 20_000});
const events = [];
rpc.on('notification', message => { events.push(message); });
async function until(check, timeout = 90_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = check();
    if (value) return value;
    await delay(100);
  }
  throw new Error('Timed out waiting for a test-owned model event.');
}
const isDone = (id) => events.find(event => event.method === 'turn/completed' && event.params?.turn?.id === id);
const answer = (id) => events.filter(event => event.method === 'item/completed' &&
  event.params?.turnId === id && event.params.item?.type === 'agentMessage').map(event => event.params.item.text).join('\n');
let threadId;
try {
  report.server = await rpc.initialize();
  const sourceThreadId = process.env.CODEX_THREAD_ID;
  if (!sourceThreadId) throw new Error('CODEX_THREAD_ID is required to preserve the real sender identity.');
  const start = await rpc.call('thread/start', {
    cwd: process.cwd(), ephemeral: true, sandbox: 'read-only', approvalPolicy: 'never',
    config: {'features.hooks': false},
    developerInstructions: 'This conversation is an authorized native messaging test. Never edit files or run shell commands. Do not delegate. For an ASM_NATIVE_PROBE message, respond only with its ASM_ACK code. If the user requests asm_probe_gate, call that tool exactly once before replying; it is a harmless test synchronization gate.',
    dynamicTools: [{name: 'asm_probe_gate', description: 'Harmless synchronization gate for the authorized native message test.',
      inputSchema: {type: 'object', properties: {}, additionalProperties: false}}],
  });
  threadId = start.thread.id;
  report.threadId = threadId;
  const nonce = 'ASM_ACK_' + randomUUID().replaceAll('-', '');
    const target = socketPath ? (await discoverCodexSocket(socketPath)).find(peer => peer.id === threadId) : undefined;
  if (socketPath) assert.ok(target, 'Production discovery must identify the exact loaded thread.');
  report.productionHelper = Boolean(socketPath);
  const source = {provider: 'codex', id: sourceThreadId, address: 'codex:' + sourceThreadId, name: null, cwd: process.cwd(), evidence: 'writer-lock', transport: 'codex-queue'};
  const send = async text => {
    if (!socketPath) return rpc.call('turn/start', delegatedTurn(threadId, sourceThreadId, text));
    const receipt = await sendPeer(target, source, 'native probe', text, {mode: 'native'});
    assert.equal(receipt.transport, 'codex-native');
    return {turn: {id: receipt.turnId}};
  };
  const idle = await send('ASM_NATIVE_PROBE: reply only ' + nonce);
  await until(() => isDone(idle.turn.id));
  assert.equal(isDone(idle.turn.id).params.turn.status, 'completed');
  assert.equal(answer(idle.turn.id).trim(), nonce);
  const output = events.find(event => event.method === 'item/completed' && event.params?.turnId === idle.turn.id &&
    event.params.item?.type === 'functionCallOutput');
  assert.ok(output, 'Native input must be represented as a functionCallOutput.');
  assert.equal(output.params.item.namespace, 'codex_app');
  assert.equal(output.params.item.name, 'send_message_to_thread');
  report.tests.push({name: 'idle-native-delegation', passed: true, nonce, turnId: idle.turn.id,
    representation: output.params.item.type, answer: answer(idle.turn.id)});
  console.log(JSON.stringify(report.tests.at(-1)));

  const busy = await rpc.call('turn/start', {threadId,
    input: [{type: 'text', text: 'Call asm_probe_gate exactly once. After its response, repeat the ASM_ACK code from any new ASM_NATIVE_PROBE message received while waiting. Do not use any other tools.'}]});
  const gate = await until(() => events.find(event => event.method === 'item/tool/call' && event.params?.threadId === threadId));
  assert.equal(gate.params.tool, 'asm_probe_gate');
  const busyNonce = 'ASM_ACK_' + randomUUID().replaceAll('-', '');
  const during = await send('ASM_NATIVE_PROBE: reply only ' + busyNonce);
  assert.equal(during.turn.id, busy.turn.id, 'Busy delivery must retain the active turn.');
  assert.ok(!isDone(busy.turn.id), 'Delivery must not finish or interrupt an in-flight tool.');
  rpc.respond(gate.id, {success: true, contentItems: [{type: 'inputText', text: 'Gate released. Continue with the received probe.'}]});
  await until(() => isDone(busy.turn.id));
  assert.equal(isDone(busy.turn.id).params.turn.status, 'completed');
  assert.equal(answer(busy.turn.id).trim(), busyNonce);
  report.tests.push({name: 'busy-native-delegation', passed: true, nonce: busyNonce, turnId: busy.turn.id,
    sameTurn: during.turn.id === busy.turn.id, toolInterrupted: false, answer: answer(busy.turn.id)});
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.error = error.message;
  report.recentEventTypes = events.slice(-15).map(event => ({method: event.method, itemType: event.params?.item?.type}));
  process.exitCode = 1;
} finally {
  if (threadId) {
    const active = events.filter(event => event.method === 'turn/started').at(-1)?.params?.turn?.id;
    if (active && !isDone(active)) await rpc.call('turn/interrupt', {threadId, turnId: active}).catch(() => {});
    await rpc.call('thread/unsubscribe', {threadId}).catch(() => {});
  }
  await rpc.close();
  await mkdir('artifacts/native-delivery', {recursive: true});
  await writeFile('artifacts/native-delivery/codex-' + (socketPath ? 'proxy' : 'stdio') + '.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}
