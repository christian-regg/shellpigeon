import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, open, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve, sep} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {atomicWrite} from '../src/atomic-file.js';

async function withDirectory(run: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'asm-atomic-test-'));
  try { await run(directory); }
  finally {
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep + 'asm-atomic-test-'));
    await rm(directory, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
  }
}

const windows = {skip: process.platform !== 'win32', timeout: 10_000};

test('atomic replacement survives a temporary Windows read handle without removing the old descriptor', windows, () => withDirectory(async directory => {
  const path = join(directory, 'broker.json');
  const before = JSON.stringify({url: 'http://127.0.0.1:1234', protocolVersion: 2});
  const after = JSON.stringify({url: 'http://127.0.0.1:5678', protocolVersion: 2});
  await writeFile(path, before);
  // A real Node read handle reproduces the Windows rename failure without mocks.
  const reader = await open(path, 'r');
  let settled = false;
  const writing = atomicWrite(path, after).then(
    () => { settled = true; return undefined; },
    (error: unknown) => { settled = true; return error; },
  );
  let settledWhileLocked: boolean;
  let readableWhileLocked: string;
  try {
    await delay(100);
    settledWhileLocked = settled;
    readableWhileLocked = await readFile(path, 'utf8');
  } finally {
    await reader.close();
    await writing;
  }
  assert.equal(settledWhileLocked, false, 'replacement must wait for the temporary reader');
  assert.equal(readableWhileLocked, before, 'the previous descriptor must stay readable');
  assert.equal(await writing, undefined, 'replacement must complete after the reader closes');
  assert.equal(await readFile(path, 'utf8'), after);
  assert.deepEqual(await readdir(directory), ['broker.json']);
}));

test('a persistent Windows read handle fails within the retry limit and preserves the old descriptor', windows, () => withDirectory(async directory => {
  const path = join(directory, 'broker.json');
  await writeFile(path, 'original');
  const reader = await open(path, 'r');
  try {
    await assert.rejects(atomicWrite(path, 'replacement'), (error: NodeJS.ErrnoException) =>
      error.syscall === 'rename' && ['EACCES', 'EPERM', 'EBUSY'].includes(error.code ?? ''));
    assert.equal(await readFile(path, 'utf8'), 'original');
    assert.deepEqual(await readdir(directory), ['broker.json'], 'staged files must be cleaned up after failure');
  } finally { await reader.close(); }
}));
