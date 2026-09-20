import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ensureBroker } from '../src/autostart.js';
import { loadBroker } from '../src/config.js';
import { BrokerClient } from '../src/client.js';
import { acquireBrokerOwner } from '../src/broker-owner.js';
import { DatabaseSync } from 'node:sqlite';
import { Store } from '../src/store.js';

async function waitFor(check: () => Promise<boolean>, timeout = 7000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await delay(50);
  }
  throw new Error('Timed out waiting for broker process cleanup.');
}
async function lockGone(directory: string) {
  try { await stat(join(directory, 'broker.lock')); return false; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return true; throw error; }
}
async function cleanup(directory: string) {
  assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep + 'asm-auto-'));
  try {
    const {url, token} = await loadBroker(directory);
    const client = new BrokerClient(url, token, {provider: 'test', workspace: directory}, 1000);
    const health = await client.health();
    await client.shutdown(health.instanceId as string);
  } catch { /* Broker may already have stopped. */ }
  await waitFor(() => lockGone(directory));
  await rm(directory, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
}
async function call(client: Client, name: string, args: Record<string, unknown>) {
  const result = await client.callTool({name, arguments: args});
  assert.equal(result.isError, undefined, JSON.stringify(result.content));
  return result.structuredContent as Record<string, any>;
}

test('installed bundles concurrently autostart one broker and recover mail after a hard crash', {timeout: 30_000}, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'asm-auto-ü spaced-'));
  const data = join(directory, 'data');
  const clients: Client[] = [];
  try {
    for (const host of ['claude', 'codex']) {
      const destination = join(directory, host, 'dist');
      await mkdir(destination, {recursive: true});
      for (const file of ['mcp.cjs', 'broker.cjs']) {
        await copyFile(resolve('plugins', host, 'agent-session-messaging/dist', file), join(destination, file));
      }
    }
    for (let i = 0; i < 6; i++) {
      const host = i % 2 ? 'claude' : 'codex';
      const client = new Client({name: 'autostart-test', version: '0.2.0'});
      await client.connect(new StdioClientTransport({
        command: process.execPath, args: [join(directory, host, 'dist/mcp.cjs'), '--provider', host === 'claude' ? 'claude-code' : 'codex'],
        cwd: directory, env: {BRIDGE_DATA_DIR: data, BRIDGE_WORKSPACE: directory, BRIDGE_AUTOSTART: '1'}, stderr: 'pipe',
      }));
      clients.push(client);
    }
    // No foreground broker, repo runtime files, or injected broker address.
    const mailboxes = await Promise.all(clients.map((client, i) => call(client, 'session_register', {name: 'installed-' + i})));
    const before = await loadBroker(data);
    const admin = new BrokerClient(before.url, before.token, {provider: 'test', workspace: directory});
    const firstHealth = await admin.health();
    const sent = await call(clients[0]!, 'message_send', {
      sessionHandle: mailboxes[0]!.sessionHandle, to: mailboxes[1]!.session.id,
      body: 'Still here after the broker crash.', idempotencyKey: 'crash-test',
    });
    const owner = JSON.parse(await readFile(join(data, 'broker.lock'), 'utf8'));
    assert.equal(firstHealth.instanceId, owner.instanceId);
    assert.notEqual(owner.pid, process.pid);
    process.kill(owner.pid, 'SIGKILL');
    await waitFor(async () => {
      try { process.kill(owner.pid, 0); return false; }
      catch (error) { return (error as NodeJS.ErrnoException).code === 'ESRCH'; }
    });
    // The OS lock is released on death; no test deletes broker.lock.
    const inboxes = await Promise.all(clients.map((client, i) => call(client, 'inbox_read', {sessionHandle: mailboxes[i]!.sessionHandle})));
    assert.equal(inboxes[1]!.messages[0].id, sent.message.id);
    assert.equal(inboxes[1]!.messages[0].status, 'offered');
    assert.ok(inboxes.filter((_, i) => i !== 1).every(inbox => inbox.messages.length === 0));
    const after = await loadBroker(data);
    assert.equal(before.token, after.token);
    const next = new BrokerClient(after.url, after.token, {provider: 'test', workspace: directory});
    const nextHealth = await next.health();
    assert.notEqual(firstHealth.instanceId, nextHealth.instanceId);
    await assert.rejects(next.shutdown(firstHealth.instanceId as string), /instance changed/);
    const listing = await call(clients[0]!, 'sessions_list', {sessionHandle: mailboxes[0]!.sessionHandle});
    assert.equal(listing.sessions.length, 6);
  } finally {
    await Promise.all(clients.map(client => client.close()));
    if (!await lockGone(data)) {
      const config = await loadBroker(data);
      const admin = new BrokerClient(config.url, config.token, {provider: 'test', workspace: directory});
      await admin.shutdown((await admin.health()).instanceId as string);
      await waitFor(() => lockGone(data));
    }
    await cleanup(directory);
  }
});

test('background broker exits when idle and discovery restarts it without changing its secret', {timeout: 15_000}, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'asm-auto-idle-'));
  try {
    const options = {brokerScript: resolve('build/src/cli.js'), idleTimeoutMs: 1000};
    const first = await ensureBroker(directory, options);
    const before = JSON.parse(await readFile(join(directory, 'broker.lock'), 'utf8'));
    await waitFor(() => lockGone(directory));
    const second = await ensureBroker(directory, options);
    const after = JSON.parse(await readFile(join(directory, 'broker.lock'), 'utf8'));
    assert.notEqual(before.instanceId, after.instanceId);
    assert.equal(first.token, second.token);
    const admin = new BrokerClient(second.url, second.token, {provider: 'test', workspace: directory});
    await admin.shutdown((await admin.health()).instanceId as string);
    // Race a new client against a broker whose shutdown has just been requested.
    const restarted = await ensureBroker(directory, options);
    assert.equal(restarted.token, first.token);
  } finally { await cleanup(directory); }
});

test('startup refuses a live legacy owner and a future database schema without altering either', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'asm-auto-compat-'));
  try {
    const legacy = JSON.stringify({pid: process.pid, startedAt: 'legacy'});
    await writeFile(join(directory, 'broker.lock'), legacy);
    await assert.rejects(acquireBrokerOwner(directory), /live PID/);
    assert.equal(await readFile(join(directory, 'broker.lock'), 'utf8'), legacy);
    const path = join(directory, 'future.sqlite');
    const db = new DatabaseSync(path);
    db.exec('PRAGMA user_version = 99');
    db.close();
    assert.throws(() => new Store(path), /newer than this broker/);
    const check = new DatabaseSync(path);
    assert.equal(check.prepare('PRAGMA user_version').get()!.user_version, 99);
    check.close();
  } finally {
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep + 'asm-auto-'));
    await rm(directory, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
  }
});
