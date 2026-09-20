import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';
import { startBroker } from '../build/src/broker.js';
import { initializeData, writeDescriptor } from '../build/src/config.js';

const directory = await mkdtemp(join(tmpdir(), 'asm-demo-'));
const token = await initializeData(directory);
const broker = await startBroker({dbPath: join(directory, 'mail.sqlite'), token});
await writeDescriptor(directory, broker.url);
const clients = [];
try {
  for (const [host, provider] of [['claude', 'claude-code'], ['codex', 'codex']]) {
    const client = new Client({name: host + '-demo', version: '0.1.0'});
    clients.push(client);
    await client.connect(new StdioClientTransport({
      command: process.execPath,
      args: [resolve('plugins', host, 'agent-session-messaging/dist/mcp.cjs'), '--provider', provider],
      env: {...getDefaultEnvironment(), BRIDGE_DATA_DIR: directory, BRIDGE_WORKSPACE: process.cwd()},
      stderr: 'pipe',
    }));
  }
  async function call(index, name, args) {
    const result = await clients[index].callTool({name, arguments: args});
    assert.ok(!result.isError, JSON.stringify(result.content));
    return result.structuredContent;
  }
  const a = await call(0, 'session_register', {name: 'claude-reviewer'});
  const b = await call(1, 'session_register', {name: 'codex-worker'});
  const sent = await call(0, 'message_send', {sessionHandle: a.sessionHandle, to: b.session.id,
    body: 'Bitte prüfe die neue API.', idempotencyKey: 'demo-request'});
  const inbox = await call(1, 'inbox_read', {sessionHandle: b.sessionHandle});
  assert.equal(inbox.messages[0].id, sent.message.id);
  console.log('Claude adapter -> Codex adapter: ' + inbox.messages[0].body);
  await call(1, 'message_reply', {sessionHandle: b.sessionHandle, messageId: sent.message.id,
    body: 'Die API ist geprüft.', idempotencyKey: 'demo-reply'});
  await call(1, 'message_ack', {sessionHandle: b.sessionHandle, messageIds: [sent.message.id]});
  const answer = await call(0, 'inbox_read', {sessionHandle: a.sessionHandle});
  console.log('Codex adapter -> Claude adapter: ' + answer.messages[0].body);
  await call(0, 'message_ack', {sessionHandle: a.sessionHandle, messageIds: [answer.messages[0].id]});
  console.log('PASS: two real MCP subprocesses; durable broker; explicit receipts. No LLM calls or native host wake.');
} finally {
  await Promise.all(clients.map(client => client.close()));
  await broker.close();
  assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep + 'asm-demo-'));
  await rm(directory, {recursive: true, force: true});
}
