import { createHash } from 'node:crypto';
import { type DatabaseSync } from 'node:sqlite';
import { DATABASE_VERSION, DAY_MS, type RetentionPolicy } from './retention.js';
import { StateError } from './state-error.js';

export const payloadHash = (to: string, body: string, reply: string | null) =>
  createHash('sha256').update(JSON.stringify([to, body, reply])).digest('hex');

const sessionsSql = `CREATE TABLE sessions (
  id TEXT PRIMARY KEY, tokenHash TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL, provider TEXT NOT NULL, workspace TEXT NOT NULL,
  createdAt INTEGER NOT NULL, lastSeenAt INTEGER NOT NULL
)`;
const messagesSql = (name: string) => `CREATE TABLE ${name} (
  id TEXT PRIMARY KEY,
  "from" TEXT NOT NULL REFERENCES sessions(id), "to" TEXT NOT NULL REFERENCES sessions(id),
  body TEXT NOT NULL, conversationId TEXT NOT NULL, inReplyTo TEXT,
  createdAt INTEGER NOT NULL, expiresAt INTEGER NOT NULL,
  offeredAt INTEGER, acknowledgedAt INTEGER, idempotencyKey TEXT NOT NULL,
  payloadHash TEXT NOT NULL, contentExpiresAt INTEGER NOT NULL,
  retentionUntil INTEGER NOT NULL, contentDeletedAt INTEGER,
  UNIQUE("from", idempotencyKey)
)`;

export function migrate(db: DatabaseSync, now: number, policy: RetentionPolicy): void {
  const version = db.prepare('PRAGMA user_version').get()!.user_version as number;
  if (version > DATABASE_VERSION) throw new StateError('DATABASE_NEWER',
    'Database schema is newer than this broker. Update the plugin before restarting.', 'Install a compatible broker; do not reset the schema version.');
  if (version < 0) throw new StateError('DATABASE_UNKNOWN_VERSION', 'Database has an unsupported schema version.',
    'Inspect or restore the database; do not change its schema version manually.');
  if (version === DATABASE_VERSION) return;
  if (version === 0 && db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all().length) {
    throw new StateError('DATABASE_UNVERSIONED', 'Database contains tables but has no recognized schema version.',
      'Inspect or restore the database; automatic initialization will not overwrite it.');
  }
  db.exec('PRAGMA foreign_keys = OFF; BEGIN IMMEDIATE;');
  try {
    if (version === 0) {
      db.exec(sessionsSql);
      db.exec(messagesSql('messages'));
    } else {
      db.exec(messagesSql('messages_v2'));
      const insert = db.prepare(`INSERT INTO messages_v2
        (id, "from", "to", body, conversationId, inReplyTo, createdAt, expiresAt, offeredAt, acknowledgedAt,
         idempotencyKey, payloadHash, contentExpiresAt, retentionUntil, contentDeletedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`);
      for (const value of db.prepare('SELECT * FROM messages').iterate()) {
        const row = value as Record<string, any>;
        // Upgrades grant the full retention period to existing content; migration never purges.
        const anchor = Math.max(row.createdAt, now);
        insert.run(row.id, row.from, row.to, row.body, row.conversationId, row.inReplyTo,
          row.createdAt, row.expiresAt, row.offeredAt, row.acknowledgedAt, row.idempotencyKey,
          payloadHash(row.to, row.body, row.inReplyTo), anchor + policy.contentDays * DAY_MS,
          anchor + policy.dedupDays * DAY_MS);
      }
      db.exec('DROP TABLE messages; ALTER TABLE messages_v2 RENAME TO messages;');
    }
    db.exec(`CREATE INDEX IF NOT EXISTS inbox ON messages("to", acknowledgedAt, createdAt);
      CREATE INDEX IF NOT EXISTS directory ON sessions(workspace, id);
      CREATE INDEX IF NOT EXISTS content_retention ON messages(contentDeletedAt, contentExpiresAt);
      CREATE INDEX IF NOT EXISTS metadata_retention ON messages(retentionUntil);`);
    if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Foreign key check failed');
    db.exec('PRAGMA user_version = 2');
    db.exec('COMMIT');
  } catch {
    db.exec('ROLLBACK');
    throw new StateError('MIGRATION_FAILED', 'Database migration failed and was rolled back.',
      'Keep the database and check permissions, disk space and integrity before retrying.');
  } finally { db.exec('PRAGMA foreign_keys = ON;'); }
}
