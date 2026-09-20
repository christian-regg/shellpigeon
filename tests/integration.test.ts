import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, copyFile, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';
import { startBroker } from '../src/broker.js';
import { initializeData, writeDescriptor } from '../src/config.js';
import { BrokerClient } from '../src/client.js';
import { type Message, type Session } from '../src/protocol.js';

async function cleanup(directory: string) {
  assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep + 'asm-test-'));
  await rm(directory, {recursive: true, force: true});
}
async function connect(bundle: string, provider: string, directory: string) {
  const transport = new StdioClientTransport({
    command: process.execPath, args: [bundle, '--provider', provider],
    cwd: directory,
    env: {...getDefaultEnvironment(), BRIDGE_DATA_DIR: directory, BRIDGE_WORKSPACE: directory},
    stderr: 'pipe',
  });
  const client = new Client({name: 'integration-test', version: '0.1.0'});
  await client.connect(transport);
  return client;
}
async function call(client: Client, name: string, args: Record<string, unknown>) {
  const result = await client.callTool({name, arguments: args});
  assert.equal(result.isError, undefined, JSON.stringify(result.content));
  return result.structuredContent as Record<string, any>;
}

test('two packaged MCP subprocesses round-trip messages and survive broker/adapter restart', {timeout: 30_000}, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'asm-test-ü spaced-'));
  const token = await initializeData(directory);
  let broker = await startBroker({dbPath: join(directory, 'mail.sqlite'), token});
  const clients: Client[] = [];
  try {
    await writeDescriptor(directory, broker.url);
    // Standalone copied bundles prove that no relative repository/node_modules path is needed.
    const bundles: Record<string, string> = {};
    for (const host of ['claude', 'codex']) {
      const folder = join(directory, host + ' plugin');
      await mkdir(folder);
      bundles[host] = join(folder, 'mcp.cjs');
      await copyFile(resolve('plugins', host, 'agent-session-messaging/dist/mcp.cjs'), bundles[host]!);
    }
    const a = await connect(bundles.claude!, 'claude-code', directory);
    const b = await connect(bundles.codex!, 'codex', directory);
    clients.push(a, b);
    assert.equal((await a.listTools()).tools.length, 7);
    const alice = await call(a, 'session_register', {name: 'same-name'});
    const bob = await call(b, 'session_register', {name: 'same-name'});
    const bob2 = await call(b, 'session_register', {name: 'same-name'});
    assert.notEqual(bob.session.id, bob2.session.id);
    const directoryResult = await call(a, 'sessions_list', {sessionHandle: alice.sessionHandle});
    assert.equal(directoryResult.sessions.length, 3);
    const sent = await call(a, 'message_send', {
      sessionHandle: alice.sessionHandle, to: bob.session.id,
      body: 'Kannst du die API prüfen? Grüße 👋', idempotencyKey: 'request-1',
    });
    assert.equal((await call(b, 'inbox_read', {sessionHandle: bob2.sessionHandle})).messages.length, 0);
    const incoming = await call(b, 'inbox_read', {sessionHandle: bob.sessionHandle});
    assert.equal(incoming.messages[0].id, sent.message.id);
    // Offered, but not acknowledged: retain it through a full broker restart and adapter restart.
    await b.close();
    await broker.close();
    broker = await startBroker({dbPath: join(directory, 'mail.sqlite'), token});
    await writeDescriptor(directory, broker.url);
    const resumed = await connect(bundles.codex!, 'codex', directory);
    clients.push(resumed);
    const recovered = await call(resumed, 'session_register', {name: 'ignored', resumeHandle: bob.sessionHandle});
    assert.equal(recovered.session.id, bob.session.id);
    assert.equal((await call(resumed, 'inbox_read', {sessionHandle: bob.sessionHandle})).messages[0].id, sent.message.id);
    const reply = await call(resumed, 'message_reply', {
      sessionHandle: bob.sessionHandle, messageId: sent.message.id,
      body: 'Prüfung abgeschlossen.', idempotencyKey: 'reply-1',
    });
    await call(resumed, 'message_ack', {sessionHandle: bob.sessionHandle, messageIds: [sent.message.id]});
    const answer = await call(a, 'inbox_read', {sessionHandle: alice.sessionHandle});
    assert.equal(answer.messages[0].id, reply.message.id);
    assert.equal(answer.messages[0].conversationId, sent.message.conversationId);
    assert.equal((await call(a, 'message_status', {sessionHandle: alice.sessionHandle, messageId: sent.message.id})).message.status, 'acknowledged');
    const wrong = await resumed.callTool({name: 'inbox_read', arguments: {sessionHandle: alice.sessionHandle}});
    assert.equal(wrong.isError, true);
  } finally {
    await Promise.all(clients.map(client => client.close()));
    await broker.close();
    await cleanup(directory);
  }
});

test('HTTP authentication, origin rejection, concurrent send idempotency and workspace isolation', {timeout: 15_000}, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'asm-test-http-'));
  const token = await initializeData(directory);
  const broker = await startBroker({dbPath: join(directory, 'mail.sqlite'), token});
  try {
    assert.equal((await fetch(broker.url + '/health')).status, 401);
    assert.equal((await fetch(broker.url + '/health', {
      headers: {Authorization: 'Bearer ' + token, Origin: 'http://malicious.example'},
    })).status, 403);
    const a = new BrokerClient(broker.url, token, {provider: 'claude-code', workspace: directory});
    const b = new BrokerClient(broker.url, token, {provider: 'codex', workspace: directory});
    assert.equal((await a.health()).delivery, 'pull-only');
    const alice = await a.call('session_register', {name: 'a'}) as {session: Session; sessionHandle: string};
    const bob = await b.call('session_register', {name: 'b'}) as {session: Session; sessionHandle: string};
    const args = {sessionHandle: alice.sessionHandle, to: bob.session.id, body: 'one logical message', idempotencyKey: 'parallel'};
    const results = await Promise.all(Array.from({length: 12}, () => a.call('message_send', args)));
    assert.equal(new Set(results.map(x => (x.message as Message).id)).size, 1);
    assert.equal((await b.call('inbox_read', {sessionHandle: bob.sessionHandle})).messages instanceof Array, true);
    const dbText = (await readFile(join(directory, 'mail.sqlite'))).toString('utf8');
    assert.ok(!dbText.includes(alice.sessionHandle));
    assert.throws(() => new BrokerClient('http://example.com', token, {provider: 'codex', workspace: directory}));
  } finally { await broker.close(); await cleanup(directory); }
});
