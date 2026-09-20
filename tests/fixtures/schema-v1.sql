CREATE TABLE sessions (
 id TEXT PRIMARY KEY, tokenHash TEXT UNIQUE NOT NULL,
 name TEXT NOT NULL, provider TEXT NOT NULL, workspace TEXT NOT NULL,
 createdAt INTEGER NOT NULL, lastSeenAt INTEGER NOT NULL
);
CREATE TABLE messages (
 id TEXT PRIMARY KEY, "from" TEXT NOT NULL REFERENCES sessions(id),
 "to" TEXT NOT NULL REFERENCES sessions(id), body TEXT NOT NULL,
 conversationId TEXT NOT NULL, inReplyTo TEXT REFERENCES messages(id),
 createdAt INTEGER NOT NULL, expiresAt INTEGER NOT NULL,
 offeredAt INTEGER, acknowledgedAt INTEGER, idempotencyKey TEXT NOT NULL,
 UNIQUE("from", idempotencyKey)
);
CREATE INDEX inbox ON messages("to", acknowledgedAt, createdAt);
CREATE INDEX directory ON sessions(workspace, id);
PRAGMA user_version = 1;
