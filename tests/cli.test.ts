import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';

test('CLI publishes discoverable broker, rejects a second owner, and recovers after explicit stale-lock cleanup', {timeout: 60_000}, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'asm-cli-test-'));
  const cli = resolve('build/src/cli.js');
  const children: ChildProcess[] = [];
  const args = ['--data-dir', directory, '--port', '0'];
  async function start() {
    const child = spawn(process.execPath, [cli, 'broker', ...args], {stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true});
    children.push(child);
    const lines = createInterface({input: child.stdout!});
    await new Promise<void>((resolve, reject) => {
      // Shared CI runners can delay process startup while other test files spawn children.
      const timer = setTimeout(() => { lines.close(); reject(new Error('CLI startup timeout')); }, 15_000);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', code => { clearTimeout(timer); reject(new Error('CLI exited during startup: ' + code)); });
      lines.once('line', line => {
        clearTimeout(timer);
        lines.close();
        try { assert.match(JSON.parse(line).broker, /^http:\/\/127\.0\.0\.1:/); resolve(); }
        catch (error) { reject(error); }
      });
    });
    return child;
  }
  async function stop(child: ChildProcess) {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const ended = once(child, 'exit');
    child.kill();
    await ended;
  }
  try {
    const first = await start();
    const before = await readFile(join(directory, 'token'), 'utf8');
    const doctor = JSON.parse(execFileSync(process.execPath, [cli, 'doctor', '--data-dir', directory], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 7000,
    }));
    assert.equal(doctor.broker.delivery, 'pull-only');
    assert.throws(() => execFileSync(process.execPath, [cli, 'broker', ...args], {
      stdio: ['ignore', 'pipe', 'pipe'], timeout: 7000,
    }), (error: unknown) => String((error as {stderr: Buffer}).stderr).includes('Broker lock exists'));
    // Windows terminates the process directly; graceful POSIX shutdown may already remove the lock.
    await stop(first);
    await unlink(join(directory, 'broker.lock')).catch(error => {
      if (error.code !== 'ENOENT') throw error;
    });
    await start();
    assert.equal(await readFile(join(directory, 'token'), 'utf8'), before);
  } finally {
    await Promise.all(children.map(stop));
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep + 'asm-cli-test-'));
    await rm(directory, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
  }
});
