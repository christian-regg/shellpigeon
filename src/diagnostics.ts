import { stat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { readDescriptor, readToken } from './config.js';
import { readRetention, DATABASE_VERSION } from './retention.js';
import { BrokerClient } from './client.js';
import { errorDetails } from './state-error.js';
import { BridgeError, PROTOCOL_VERSION } from './protocol.js';

export async function diagnose(directory: string) {
  const checks: Record<string, unknown> = {};
  const issues: ReturnType<typeof errorDetails>[] = [];
  let descriptor: Awaited<ReturnType<typeof readDescriptor>> | undefined;
  let token: string | undefined;
  try { token = await readToken(directory); checks.token = 'valid'; }
  catch (error) { checks.token = errorDetails(error).code; issues.push(errorDetails(error)); }
  try { descriptor = await readDescriptor(directory); checks.descriptor = {url: descriptor.url, protocolVersion: descriptor.protocolVersion}; }
  catch (error) { checks.descriptor = errorDetails(error).code; issues.push(errorDetails(error)); }
  try { checks.retention = await readRetention(directory); }
  catch (error) { checks.retention = errorDetails(error).code; issues.push(errorDetails(error)); }
  let databaseExists = false;
  try {
    const path = join(directory, 'mail.sqlite');
    const info = await stat(path);
    databaseExists = true;
    const db = new DatabaseSync(path, {readOnly: true});
    try {
      const version = db.prepare('PRAGMA user_version').get()!.user_version as number;
      const integrity = db.prepare('PRAGMA quick_check(1)').get()?.quick_check === 'ok';
      checks.database = {bytes: info.size, schemaVersion: version, supportedSchemaVersion: DATABASE_VERSION, integrity: integrity ? 'ok' : 'failed'};
      if (!integrity) issues.push({code: 'DATABASE_INTEGRITY', message: 'SQLite quick_check failed. Preserve the database and restore a trusted backup.'});
      if (version > DATABASE_VERSION) issues.push({code: 'DATABASE_NEWER', message: 'Database schema is newer than this broker.'});
      if (version === 1) checks.migrationPending = true;
      if (version <= 0) issues.push({code: 'DATABASE_UNVERSIONED', message: 'Database has no supported schema version; inspect before repair.'});
    } finally { db.close(); }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') checks.database = 'missing';
    else { checks.database = 'unreadable'; issues.push({code: 'DATABASE_UNREADABLE', message: 'Cannot inspect mail.sqlite; check permissions and database integrity.'}); }
  }
  try {
    const owner = JSON.parse(await readFile(join(directory, 'broker.lock'), 'utf8'));
    if (!Number.isSafeInteger(owner.pid) || owner.pid <= 0) throw new Error('Invalid owner');
    let alive = true;
    try { process.kill(owner.pid, 0); }
    catch (error) { alive = (error as NodeJS.ErrnoException).code !== 'ESRCH'; }
    checks.owner = {pid: owner.pid, instanceId: owner.instanceId, pidAlive: alive};
  } catch (error) {
    checks.owner = (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'absent' : 'invalid';
    if (checks.owner === 'invalid') issues.push({code: 'LOCK_INVALID', message: 'broker.lock is invalid; inspect it before repair.'});
  }
  const logs: Record<string, number> = {};
  for (const name of ['broker.log', 'broker.log.1', 'broker.log.2', 'broker.log.3']) {
    try { logs[name] = (await stat(join(directory, name))).size; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') logs[name] = -1; }
  }
  checks.logBytes = logs;
  let broker: Record<string, unknown> | undefined;
  if (descriptor && token) {
    try {
      broker = await new BrokerClient(descriptor.url, token, {provider: 'test', workspace: directory}, 1000).health(true);
      if (Array.isArray(broker.runtimeIssues) && broker.runtimeIssues.includes('LOG_IO_ERROR')) {
        issues.push({code: 'LOG_IO_ERROR', message: 'Broker cannot write logs. Check disk space and log file permissions.'});
      }
      if (broker.protocolVersion !== PROTOCOL_VERSION) {
        issues.push({code: 'PROTOCOL_MISMATCH', message: 'An older broker is running. Stop it and reopen both updated plugins.'});
      }
    } catch (error) {
      issues.push(error instanceof BridgeError ? errorDetails(error)
        : {code: 'BROKER_UNREACHABLE', message: 'Configured broker is stopped or unreachable. Normal plugin use can start it.'});
    }
  }
  const onlyUninitialized = !databaseExists && issues.every(issue =>
    issue.code === 'TOKEN_MISSING' || issue.code === 'DESCRIPTOR_MISSING');
  const status = !issues.length && broker ? 'ready' : onlyUninitialized ? 'not-initialized'
    : issues.every(issue => issue.code === 'BROKER_UNREACHABLE') ? 'stopped' : 'attention';
  return {status, node: process.version, dataDirectory: directory, checks, issues, broker};
}
