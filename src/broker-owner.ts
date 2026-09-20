import { StateError, stateFileError } from './state-error.js';
import { atomicWrite } from './atomic-file.js';
import { DatabaseSync } from 'node:sqlite';
import { mkdir, readFile, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

/** A separate SQLite transaction is the OS-released, cross-process broker lock. */
export async function acquireBrokerOwner(directory: string) {
  try { await mkdir(directory, {recursive: true, mode: 0o700}); }
  catch (error) { stateFileError(error, directory, 'DATA_DIRECTORY_MISSING'); }
  let db: DatabaseSync;
  try { db = new DatabaseSync(join(directory, 'broker-owner.sqlite')); }
  catch { throw new StateError('OWNER_STATE_ERROR', 'Cannot open broker ownership state.', 'Check data directory permissions and disk space.'); }
  try { db.exec('PRAGMA busy_timeout = 0; BEGIN EXCLUSIVE;'); }
  catch (error) {
    db.close();
    const code = ((error as {errcode?: number}).errcode ?? 0) & 255;
    if (code === 5 || code === 6) throw new StateError('BROKER_BUSY',
      'Broker lock exists: another broker owns this data directory.', 'Wait for the current broker or use doctor.');
    throw new StateError('OWNER_STATE_ERROR', 'Cannot lock broker ownership state.',
      'Check disk space, directory permissions and broker-owner.sqlite integrity.');
  }
  const lockPath = join(directory, 'broker.lock');
  const instanceId = randomUUID();
  try {
    let previous: {pid?: number} | undefined;
    try { previous = JSON.parse(await readFile(lockPath, 'utf8')); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new StateError('LOCK_INVALID', 'Cannot read broker.lock.', 'Inspect the owner and permissions before repair.');
      }
    }
    if (previous) {
      if (!Number.isSafeInteger(previous.pid) || previous.pid! <= 0) {
        throw new StateError('LOCK_INVALID', 'Invalid broker.lock PID.', 'Inspect the owner before repairing the lock.');
      }
      let alive = true;
      try { process.kill(previous.pid!, 0); }
      catch (error) { alive = (error as NodeJS.ErrnoException).code !== 'ESRCH'; }
      if (alive) {
        throw new StateError('BROKER_BUSY', 'Broker lock exists for a live PID (' + previous.pid + '). Stop that broker before restarting.', 'Use doctor to inspect the current owner.');
      }
    }
    await atomicWrite(lockPath, JSON.stringify({pid: process.pid, instanceId, startedAt: new Date().toISOString()}));
  } catch (error) { db.close(); throw error; }
  let released = false;
  return {
    instanceId,
    async release() {
      if (released) return;
      released = true;
      try {
        const current = JSON.parse(await readFile(lockPath, 'utf8'));
        if (current.instanceId === instanceId) await unlink(lockPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      } finally { db.close(); }
    },
  };
}
