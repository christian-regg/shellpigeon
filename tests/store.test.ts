import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.js';
import { BridgeError, type CallerContext, type Session, type Message } from '../src/protocol.js';

const claude: CallerContext = {provider: 'claude-code', workspace: 'project'};
const codex: CallerContext = {provider: 'codex', workspace: 'project'};
type Registration = {session: Session; sessionHandle: string};
const register = (store: Store, context: CallerContext, name = 'worker') =>
  store.call('session_register', {name}, context) as Registration;
const isError = (code: string) => (error: unknown) => error instanceof BridgeError && error.code === code;

test('same name, same workspace, and shared adapter context still create separate mailboxes', () => {
  const store = new Store(':memory:');
  try {
    const a = register(store, codex);
    const b = register(store, codex);
    assert.notEqual(a.session.id, b.session.id);
    assert.notEqual(a.sessionHandle, b.sessionHandle);
    const page = store.call('sessions_list', {sessionHandle: a.sessionHandle, limit: 1}, codex);
    assert.equal((page.sessions as Session[]).length, 1);
    assert.ok(page.nextCursor);
    const second = store.call('sessions_list', {sessionHandle: a.sessionHandle, cursor: page.nextCursor}, codex);
    assert.equal((second.sessions as Session[]).length, 1);
    assert.equal(second.nextCursor, null);
    assert.ok(!JSON.stringify(page).includes('tokenHash'));
    assert.ok(!JSON.stringify(page).includes(a.sessionHandle));
  } finally { store.close(); }
});

test('handles are scoped to provider/workspace and send cannot forge an author or cross projects', () => {
  const store = new Store(':memory:');
  try {
    const a = register(store, claude);
    const foreignContext = {...codex, workspace: 'another-project'};
    const foreign = register(store, foreignContext);
    assert.throws(() => store.call('inbox_read', {sessionHandle: a.sessionHandle}, codex), isError('INVALID_SESSION'));
    assert.throws(() => store.call('message_send', {
      sessionHandle: a.sessionHandle, to: foreign.session.id, body: 'hello', idempotencyKey: 'one',
    }, claude), isError('RECIPIENT_NOT_FOUND'));
    assert.throws(() => store.call('message_send', {
      sessionHandle: a.sessionHandle, to: foreign.session.id, from: foreign.session.id,
      body: 'hello', idempotencyKey: 'two',
    }, claude));
  } finally { store.close(); }
});

test('send retry, reply correlation, non-consuming reads, recipient-only atomic ACK', () => {
  const store = new Store(':memory:');
  try {
    const a = register(store, claude);
    const b = register(store, codex);
    const c = register(store, codex);
    const args = {sessionHandle: a.sessionHandle, to: b.session.id, body: 'review', idempotencyKey: 'review-1'};
    const sent = store.call('message_send', args, claude).message as Message;
    assert.deepEqual(store.call('message_send', args, claude).message, sent);
    assert.throws(() => store.call('message_send', {...args, body: 'changed'}, claude), isError('IDEMPOTENCY_CONFLICT'));
    assert.equal(sent.from, a.session.id);
    const inbox = () => store.call('inbox_read', {sessionHandle: b.sessionHandle}, codex).messages as Message[];
    assert.equal(inbox()[0]!.status, 'offered');
    assert.equal(inbox().length, 1);
    assert.throws(() => store.call('message_ack', {sessionHandle: c.sessionHandle, messageIds: [sent.id]}, codex), isError('FORBIDDEN'));
    const unrelated = store.call('message_send', {...args, to: c.session.id, idempotencyKey: 'review-2'}, claude).message as Message;
    assert.throws(() => store.call('message_ack', {sessionHandle: b.sessionHandle, messageIds: [sent.id, unrelated.id]}, codex), isError('FORBIDDEN'));
    assert.equal(inbox().length, 1);
    const reply = store.call('message_reply', {sessionHandle: b.sessionHandle, messageId: sent.id, body: 'done', idempotencyKey: 'reply-1'}, codex).message as Message;
    assert.equal(reply.to, a.session.id);
    assert.equal(reply.inReplyTo, sent.id);
    assert.equal(reply.conversationId, sent.conversationId);
    const ack = {sessionHandle: b.sessionHandle, messageIds: [sent.id]};
    store.call('message_ack', ack, codex);
    store.call('message_ack', ack, codex);
    assert.equal(inbox().length, 0);
    assert.equal((store.call('message_status', {sessionHandle: a.sessionHandle, messageId: sent.id}, claude).message as Message).status, 'acknowledged');
  } finally { store.close(); }
});

test('UTF-8 limit and expiry are enforced, even when recipients never connect', () => {
  let now = 1000;
  const store = new Store(':memory:', () => now);
  try {
    const a = register(store, claude);
    const b = register(store, codex);
    const args = {sessionHandle: a.sessionHandle, to: b.session.id, body: 'pending', idempotencyKey: 'ttl'};
    assert.throws(() => store.call('message_send', {...args, body: '🚀'.repeat(5000)}, claude), isError('MESSAGE_TOO_LARGE'));
    const sent = store.call('message_send', args, claude).message as Message;
    now += 86_400_001;
    assert.deepEqual(store.call('inbox_read', {sessionHandle: b.sessionHandle}, codex).messages, []);
    assert.equal((store.call('message_status', {sessionHandle: a.sessionHandle, messageId: sent.id}, claude).message as Message).status, 'expired');
    assert.equal((store.call('message_send', args, claude).message as Message).id, sent.id);
  } finally { store.close(); }
});
