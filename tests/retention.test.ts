import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.js';
import { DAY_MS, DEFAULT_RETENTION } from '../src/retention.js';
import { BridgeError, type CallerContext, type Message, type Session } from '../src/protocol.js';
import { startBroker } from '../src/broker.js';
import { BrokerClient } from '../src/client.js';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdtemp, rm } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';

const context: CallerContext = {provider: 'test', workspace: 'project'};
const isError = (code: string) => (error: unknown) => error instanceof BridgeError && error.code === code;
const register = (store: Store) => store.call('session_register', {name: 'worker'}, context) as {session: Session; sessionHandle: string};

test('TTL, text retention, dry run and bounded deduplication have distinct boundaries', () => {
  let now = 1000;
  const store = new Store(':memory:', () => now);
  try {
    const a = register(store), b = register(store);
    const args = {sessionHandle: a.sessionHandle, to: b.session.id, body: 'private content', idempotencyKey: 'stable'};
    const sent = store.call('message_send', args, context).message as Message;
    assert.equal(sent.contentExpiresAt, now + 7 * DAY_MS);
    now += DAY_MS;
    assert.deepEqual(store.call('inbox_read', {sessionHandle: b.sessionHandle}, context).messages, []);
    now = sent.contentExpiresAt - 1;
    assert.equal(store.maintenance(false).applied.redacted, 0);
    now++;
    assert.deepEqual(store.maintenance().due, {texts: 1, metadata: 0});
    assert.equal((store.call('message_send', args, context).message as Message).body, args.body);
    assert.equal(store.maintenance(false).applied.redacted, 1);
    const retry = store.call('message_send', args, context).message as Message;
    assert.equal(retry.id, sent.id);
    assert.equal(retry.body, '');
    assert.equal(retry.contentDeletedAt, now);
    assert.equal(retry.acknowledgedAt, null);
    assert.ok(!('payloadHash' in retry));
    assert.throws(() => store.call('message_send', {...args, body: 'different'}, context), isError('IDEMPOTENCY_CONFLICT'));
    now = sent.retentionUntil - 1;
    assert.equal(store.maintenance(false).applied.deleted, 0);
    now++;
    assert.equal(store.maintenance(false).applied.deleted, 1);
    assert.throws(() => store.call('message_status', {sessionHandle: a.sessionHandle, messageId: sent.id}, context), isError('NOT_FOUND'));
    assert.notEqual((store.call('message_send', args, context).message as Message).id, sent.id);
  } finally { store.close(); }
});

test('retained replies remain readable and retryable after original metadata expires', () => {
  let now = 1000;
  const store = new Store(':memory:', () => now);
  try {
    const a = register(store), b = register(store);
    const first = store.call('message_send', {sessionHandle: a.sessionHandle, to: b.session.id, body: 'question', idempotencyKey: 'question'}, context).message as Message;
    now += DAY_MS / 2;
    const args = {sessionHandle: b.sessionHandle, messageId: first.id, body: 'answer', idempotencyKey: 'answer'};
    const reply = store.call('message_reply', args, context).message as Message;
    now = first.retentionUntil;
    assert.equal(store.maintenance(false).applied.deleted, 1);
    const retried = store.call('message_reply', args, context).message as Message;
    assert.equal(retried.id, reply.id);
    assert.equal(retried.inReplyTo, first.id);
    assert.equal(retried.conversationId, first.id);
    assert.equal(retried.body, '');
    assert.throws(() => store.call('message_reply', {...args, body: 'changed'}, context), isError('IDEMPOTENCY_CONFLICT'));
    assert.throws(() => store.call('message_reply', {...args, messageId: randomUUID()}, context), isError('IDEMPOTENCY_CONFLICT'));
  } finally { store.close(); }
});

test('maintenance is bounded and does not delete registered sessions', () => {
  let now = 1000;
  const store = new Store(':memory:', () => now);
  try {
    const a = register(store), b = register(store);
    for (let i = 0; i < 1005; i++) {
      const sent = store.call('message_send', {sessionHandle: a.sessionHandle, to: b.session.id, body: 'message', idempotencyKey: String(i)}, context).message as Message;
      store.call('message_ack', {sessionHandle: b.sessionHandle, messageIds: [sent.id]}, context);
    }
    now += 31 * DAY_MS;
    assert.deepEqual(store.maintenance(false).applied, {redacted: 1000, deleted: 1000});
    assert.deepEqual(store.maintenance(false).applied, {redacted: 5, deleted: 5});
    assert.equal((store.call('sessions_list', {sessionHandle: a.sessionHandle}, context).sessions as Session[]).length, 2);
  } finally { store.close(); }
});

test('automatic maintenance and explicit manual maintenance use the same authenticated instance guard', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'asm-retention-'));
  try {
    for (const mode of ['manual', 'automatic'] as const) {
      const path = join(directory, mode + '.sqlite');
      const seed = new Store(path, () => Date.now() - 8 * DAY_MS);
      const a = register(seed), b = register(seed);
      const message = seed.call('message_send', {sessionHandle: a.sessionHandle, to: b.session.id, body: 'old', idempotencyKey: mode}, context).message as Message;
      seed.close();
      const instanceId = randomUUID(), token = 'a'.repeat(64);
      const broker = await startBroker({dbPath: path, token, instanceId, retention: {...DEFAULT_RETENTION, mode}, maintenanceIntervalMs: 10});
      try {
        const client = new BrokerClient(broker.url, token, context);
        const db = new DatabaseSync(path, {readOnly: true});
        try {
          if (mode === 'automatic') {
            const deadline = Date.now() + 3000;
            while (db.prepare('SELECT body FROM messages').get()!.body !== '' && Date.now() < deadline) await delay(20);
          } else await delay(60);
          assert.equal(db.prepare('SELECT body FROM messages').get()!.body, mode === 'manual' ? 'old' : '');
          await assert.rejects(client.maintenance(randomUUID(), false), isError('WRONG_INSTANCE'));
          const stranger = new BrokerClient(broker.url, 'b'.repeat(64), context);
          await assert.rejects(stranger.maintenance(instanceId, false), isError('UNAUTHORIZED'));
          const preview = await client.maintenance(instanceId);
          assert.equal(preview.dryRun, true);
          await client.maintenance(instanceId, false);
          assert.equal(db.prepare('SELECT body FROM messages').get()!.body, '');
          assert.equal((await client.call('message_status', {sessionHandle: a.sessionHandle, messageId: message.id})).message !== undefined, true);
        } finally { db.close(); }
      } finally { await broker.close(); }
    }
  } finally {
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep + 'asm-retention-'));
    await rm(directory, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
  }
});
