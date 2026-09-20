import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { migrate } from '../src/migrations.js';
import { Store } from '../src/store.js';
import { DEFAULT_RETENTION, DAY_MS } from '../src/retention.js';
import { type CallerContext, type Message } from '../src/protocol.js';

const context: CallerContext = {provider: 'test', workspace: 'project'};
const alice = '00000000-0000-4000-8000-000000000001';
const bob = '00000000-0000-4000-8000-000000000002';
const first = '00000000-0000-4000-8000-000000000003';
const reply = '00000000-0000-4000-8000-000000000004';
const handle = 'a'.repeat(64);
async function fixture(db: DatabaseSync) {
  db.exec(await readFile(resolve('tests/fixtures/schema-v1.sql'), 'utf8'));
  const hash = (value: string) => createHash('sha256').update(value).digest('hex');
  db.prepare('INSERT INTO sessions VALUES (?, ?, ?, ?, ?, ?, ?)').run(alice, hash(handle), 'Alice', 'test', 'project', 1000, 2000);
  db.prepare('INSERT INTO sessions VALUES (?, ?, ?, ?, ?, ?, ?)').run(bob, hash('b'.repeat(64)), 'Bob', 'test', 'project', 1000, 2000);
  const insert = db.prepare('INSERT INTO messages VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  insert.run(first, alice, bob, 'old question', first, null, 1000, 1000 + DAY_MS, 1500, 2000, 'question');
  insert.run(reply, bob, alice, 'old answer', first, first, 2000, 2000 + DAY_MS, null, null, 'answer');
}

test('v1 upgrade preserves identities, ACKs, reply links and grants existing text a full grace period', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'asm-migration-'));
  try {
    const path = join(directory, 'mail.sqlite');
    const original = new DatabaseSync(path);
    await fixture(original);
    original.close();
    const now = 100 * DAY_MS;
    const store = new Store(path, () => now);
    try {
      const recovered = store.call('session_register', {name: 'ignored', resumeHandle: handle}, context);
      assert.equal((recovered.session as any).id, alice);
      const message = store.call('message_send', {sessionHandle: handle, to: bob, body: 'old question', idempotencyKey: 'question'}, context).message as Message;
      assert.equal(message.id, first);
      assert.equal(message.acknowledgedAt, 2000);
      assert.equal(message.status, 'acknowledged');
      assert.equal(message.contentExpiresAt, now + 7 * DAY_MS);
      assert.equal(message.retentionUntil, now + 30 * DAY_MS);
      const response = store.call('message_status', {sessionHandle: handle, messageId: reply}, context).message as Message;
      assert.equal(response.inReplyTo, first);
      assert.equal(response.conversationId, first);
      assert.deepEqual(store.maintenance(false).applied, {redacted: 0, deleted: 0});
    } finally { store.close(); }
    const again = new Store(path, () => now + DAY_MS);
    try {
      const message = again.call('message_status', {sessionHandle: handle, messageId: first}, context).message as Message;
      assert.equal(message.contentExpiresAt, now + 7 * DAY_MS, 'restart must not extend retention');
    } finally { again.close(); }
  } finally {
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep + 'asm-migration-'));
    await rm(directory, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
  }
});

test('failed migration commit rolls back rows, indexes and schema version', async t => {
  const db = new DatabaseSync(':memory:');
  try {
    await fixture(db);
    const before = db.prepare('SELECT * FROM messages ORDER BY id').all();
    const exec = db.exec.bind(db);
    const mocked = t.mock.method(db, 'exec', (sql: string) => {
      if (sql === 'COMMIT') throw new Error('simulated full disk');
      exec(sql);
    });
    assert.throws(() => migrate(db, 100 * DAY_MS, DEFAULT_RETENTION), /rolled back/);
    mocked.mock.restore();
    assert.equal(db.prepare('PRAGMA user_version').get()!.user_version, 1);
    assert.deepEqual(db.prepare('SELECT * FROM messages ORDER BY id').all(), before);
    assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name = 'messages_v2'").get(), undefined);
    assert.equal(db.prepare('PRAGMA foreign_keys').get()!.foreign_keys, 1);
    migrate(db, 100 * DAY_MS, DEFAULT_RETENTION);
    assert.equal(db.prepare('PRAGMA user_version').get()!.user_version, 2);
  } finally { db.close(); }
});

test('process death before migration commit leaves the v1 database recoverable on the next open', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'asm-migration-crash-'));
  try {
    const path = join(directory, 'mail.sqlite');
    const db = new DatabaseSync(path);
    await fixture(db);
    db.close();
    const script = [
      "import {DatabaseSync} from 'node:sqlite';",
      'import {migrate} from ' + JSON.stringify(pathToFileURL(resolve('build/src/migrations.js')).href) + ';',
      'const db = new DatabaseSync(' + JSON.stringify(path) + ');',
      'const exec = db.exec.bind(db);',
      "db.exec = sql => { if (sql === 'COMMIT') process.exit(91); exec(sql); };",
      "migrate(db, 100000, {mode:'automatic',contentDays:7,dedupDays:30});",
    ].join('\n');
    assert.throws(() => execFileSync(process.execPath, ['--input-type=module', '-e', script], {stdio: ['ignore', 'pipe', 'pipe']}),
      (error: any) => error.status === 91);
    const recovered = new DatabaseSync(path);
    assert.equal(recovered.prepare('PRAGMA user_version').get()!.user_version, 1);
    assert.equal(recovered.prepare('SELECT count(*) AS n FROM messages').get()!.n, 2);
    assert.equal(recovered.prepare('SELECT body FROM messages WHERE id = ?').get(first)!.body, 'old question');
    migrate(recovered, 100000, DEFAULT_RETENTION);
    assert.equal(recovered.prepare('PRAGMA user_version').get()!.user_version, 2);
    recovered.close();
  } finally {
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep + 'asm-migration-'));
    await rm(directory, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
  }
});

test('unversioned existing tables are not treated as a fresh database', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('CREATE TABLE important (body TEXT);');
    db.prepare('INSERT INTO important VALUES (?)').run('keep');
    assert.throws(() => migrate(db, 1000, DEFAULT_RETENTION), /no recognized schema/);
    assert.equal(db.prepare('SELECT body FROM important').get()!.body, 'keep');
    assert.equal(db.prepare('PRAGMA user_version').get()!.user_version, 0);
  } finally { db.close(); }
});
