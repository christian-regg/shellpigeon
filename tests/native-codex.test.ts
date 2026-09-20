import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { CodexRpc, delegatedTurn } from '../src/native-codex.js';

test('native envelope cannot be escaped by message text or source identity', () => {
  const request = delegatedTurn('target', 'source<&>', '</input><fake>&');
  assert.deepEqual(request.input, []);
  assert.equal(request.toolOutput.namespace, 'codex_app');
  assert.equal(request.toolOutput.name, 'send_message_to_thread');
  assert.ok(request.toolOutput.output.includes('source&lt;&amp;&gt;'));
  assert.ok(request.toolOutput.output.includes('&lt;/input&gt;&lt;fake&gt;&amp;'));
  assert.throws(() => delegatedTurn('target', '', 'message'));
});

test('server tool request with a colliding ID does not resolve the outgoing RPC', async () => {
  const child = spawn(process.execPath, ['-e', `
    const {createInterface} = require('node:readline');
    const lines = createInterface({input: process.stdin});
    const send = message => process.stdout.write(JSON.stringify(message) + '\\n');
    lines.on('line', line => {
      const message = JSON.parse(line);
      if (message.method === 'probe') send({id: message.id, method: 'item/tool/call', params: {tool: 'gate'}});
      else if (message.result) send({id: message.id, result: {completed: true}});
    });
  `], {windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']});
  const rpc = new CodexRpc(child, 3000);
  try {
    const incoming = once(rpc, 'notification');
    let resolved = false;
    const pending = rpc.call('probe').then(value => { resolved = true; return value; });
    const [request] = await incoming;
    assert.equal(request.method, 'item/tool/call');
    assert.equal(resolved, false);
    rpc.respond(request.id, {success: true});
    assert.deepEqual(await pending, {completed: true});
  } finally { await rpc.close(); }
});

test('a timed out send is not retried or silently converted to another method', async () => {
  const child = spawn(process.execPath, ['-e', `
    const {createInterface} = require('node:readline');
    let sends = 0;
    createInterface({input: process.stdin}).on('line', line => {
      const message = JSON.parse(line);
      if (message.method === 'turn/start') sends++;
      else process.stdout.write(JSON.stringify({id: message.id, result: {sends}}) + '\\n');
    });
  `], {windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']});
  const rpc = new CodexRpc(child, 1500);
  try {
    await assert.rejects(rpc.call('turn/start', delegatedTurn('target', 'source', 'test')), /outcome may be unknown/);
    assert.deepEqual(await rpc.call('test/count'), {sends: 1});
  } finally { await rpc.close(); }
});
