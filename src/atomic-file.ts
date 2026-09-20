import { open, link, rename, unlink } from 'node:fs/promises';
import { dirname, basename, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const windowsRenameDelays = [10, 20, 40, 80, 160, 320];

async function replaceFile(source: string, destination: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try { await rename(source, destination); return; }
    catch (error) {
      const wait = windowsRenameDelays[attempt];
      const code = (error as NodeJS.ErrnoException).code;
      // Windows readers can briefly prevent replacement. Keep the original file
      // in place; persistent permissions/sharing failures retain their error.
      if (process.platform !== 'win32' || wait === undefined ||
          !['EACCES', 'EPERM', 'EBUSY'].includes(code ?? '')) throw error;
      await delay(wait);
    }
  }
}

/** Readers see an entire synced file or the previous file. Exclusive publication never replaces it. */
export async function atomicWrite(path: string, content: string, exclusive = false): Promise<void> {
  const temporary = join(dirname(path), '.' + basename(path) + '.' + randomUUID() + '.tmp');
  const file = await open(temporary, 'wx', 0o600);
  try {
    try { await file.writeFile(content); await file.sync(); }
    finally { await file.close(); }
    if (exclusive) await link(temporary, path);
    else await replaceFile(temporary, path);
    // Directory fsync is available on POSIX. Windows publication is atomic, but power-loss
    // durability of the directory entry remains a filesystem/OS guarantee.
    if (process.platform !== 'win32') {
      const directory = await open(dirname(path), 'r');
      try { await directory.sync(); } finally { await directory.close(); }
    }
  } finally {
    await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}
