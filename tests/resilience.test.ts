import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile, stat } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { initializeData, readToken, writeDescriptor } from '../src/config.js';
import { atomicWrite } from '../src/atomic-file.js';
import { ensureBroker } from '../src/autostart.js';
import { diagnose } from '../src/diagnostics.js';
import { RotatingLog } from '../src/rotating-log.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { BrokerClient } from '../src/client.js';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { StateError } from '../src/state-error.js';

const isError = (code: string) => (error: unknown) => error instanceof StateError && error.code === code;
async function withDirectory(run: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'asm-resilience-'));
  try { await run(directory); }
  finally {
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep + 'asm-resilience-'));
    await rm(directory, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
  }
}

test('concurrent first initialization publishes one complete secret; abandoned temp files are harmless', () => withDirectory(async directory => {
  await writeFile(join(directory, '.token.interrupted.tmp'), 'partial');
  const values = await Promise.all(Array.from({length: 20}, () => initializeData(directory)));
  assert.equal(new Set(values).size, 1);
  assert.match(values[0]!, /^[a-f0-9]{64}$/);
  const token = await readFile(join(directory, 'token'), 'utf8');
  await assert.rejects(atomicWrite(join(directory, 'token'), 'replacement', true), {code: 'EEXIST'});
  assert.equal(await readFile(join(directory, 'token'), 'utf8'), token);
  assert.deepEqual((await readdir(directory)).sort(), ['.token.interrupted.tmp', 'token']);
}));

test('invalid and lost secrets fail without replacement; startup surfaces permanent errors promptly', () => withDirectory(async directory => {
  const options = {brokerScript: resolve('build/src/cli.js'), timeoutMs: 5000};
  await writeFile(join(directory, 'token'), 'private-but-truncated');
  const started = Date.now();
  await assert.rejects(ensureBroker(directory, options), isError('TOKEN_INVALID'));
  assert.ok(Date.now() - started < 4000, 'must not wait for startup timeout');
  assert.equal(await readFile(join(directory, 'token'), 'utf8'), 'private-but-truncated');
  assert.ok(!(await readdir(directory)).includes('mail.sqlite'));
  await rm(join(directory, 'token'));
  await writeFile(join(directory, 'mail.sqlite'), 'existing data');
  await assert.rejects(initializeData(directory), isError('TOKEN_MISSING'));
  await assert.rejects(readToken(directory), isError('TOKEN_MISSING'));
  assert.equal(await readFile(join(directory, 'mail.sqlite'), 'utf8'), 'existing data');
}));

test('corrupt descriptors and future protocols are reported without spawning or modifying state', () => withDirectory(async directory => {
  await initializeData(directory);
  const options = {brokerScript: resolve('build/src/cli.js'), timeoutMs: 5000};
  for (const [text, code] of [
    ['{"url":', 'DESCRIPTOR_INVALID'],
    [JSON.stringify({url: 'https://example.org', protocolVersion: 2}), 'DESCRIPTOR_INVALID'],
    [JSON.stringify({url: 'http://127.0.0.1:54321', protocolVersion: 99}), 'PROTOCOL_MISMATCH'],
  ]) {
    await writeFile(join(directory, 'broker.json'), text!);
    await assert.rejects(ensureBroker(directory, options), isError(code!));
    assert.equal(await readFile(join(directory, 'broker.json'), 'utf8'), text);
    assert.ok(!(await readdir(directory)).includes('broker-owner.sqlite'));
  }
}));

test('doctor is useful offline, preserves state and never emits authentication material', () => withDirectory(async directory => {
  const cli = resolve('build/src/cli.js');
  const fresh = JSON.parse(execFileSync(process.execPath, [cli, 'doctor', '--data-dir', directory], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}));
  assert.equal(fresh.status, 'not-initialized');
  assert.deepEqual(await readdir(directory), []);
  const token = await initializeData(directory);
  await writeDescriptor(directory, 'http://127.0.0.1:1');
  const db = new DatabaseSync(join(directory, 'mail.sqlite'));
  db.exec('PRAGMA user_version = 1');
  db.close();
  const stopped = await diagnose(directory);
  assert.equal(stopped.status, 'stopped');
  assert.equal(stopped.checks.migrationPending, true);
  assert.ok(!JSON.stringify(stopped).includes(token));
  await writeFile(join(directory, 'retention.json'), '{"contentDays":30,"dedupDays":7}');
  assert.equal((await diagnose(directory)).status, 'attention');
  await writeFile(join(directory, 'token'), 'secret-corrupt');
  const broken = await diagnose(directory);
  assert.equal(broken.status, 'attention');
  assert.ok(!JSON.stringify(broken).includes('secret-corrupt'));
  assert.throws(() => execFileSync(process.execPath, [cli, 'doctor', '--data-dir', directory], {stdio: ['ignore', 'pipe', 'pipe']}),
    (error: any) => error.status === 1 && JSON.parse(error.stdout).status === 'attention');
}));

test('logs rotate within the byte budget, including long escaped text and oversized legacy files', () => withDirectory(async directory => {
  await writeFile(join(directory, 'broker.log'), ('legacy line\n').repeat(1000));
  await writeFile(join(directory, 'broker.log.2'), 'x'.repeat(9000));
  const log = new RotatingLog(directory, 512, 3);
  for (let i = 0; i < 80; i++) log.write('info', 'event-' + i, '\0🚀'.repeat(2000));
  const paths = (await readdir(directory)).filter(name => name.startsWith('broker.log'));
  assert.equal(paths.length, 4);
  for (const name of paths) assert.ok((await stat(join(directory, name))).size <= 512);
  assert.ok((await readFile(join(directory, 'broker.log'), 'utf8')).includes('event-79'));
}));

test('live legacy broker is inspectable and stoppable but normal discovery rejects protocol mixing', () => withDirectory(async directory => {
  const token = await initializeData(directory);
  const instanceId = randomUUID();
  let stopped = false;
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    assert.equal(req.headers.authorization, 'Bearer ' + token);
    if (req.url === '/health') res.end(JSON.stringify({protocolVersion: 1, version: '0.2.0', instanceId}));
    else if (req.url === '/shutdown') { stopped = true; res.end('{}'); }
    else { res.statusCode = 404; res.end('{}'); }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const url = 'http://127.0.0.1:' + address.port;
    await writeFile(join(directory, 'broker.json'), JSON.stringify({url, protocolVersion: 1}));
    await assert.rejects(ensureBroker(directory, {brokerScript: resolve('build/src/cli.js')}), isError('PROTOCOL_MISMATCH'));
    assert.ok(!(await readdir(directory)).includes('broker-owner.sqlite'));
    const adapter = new Client({name: 'manual-broker-compatibility-test', version: '0.3.0'});
    try {
      await adapter.connect(new StdioClientTransport({
        command: process.execPath, args: [resolve('build/src/mcp.js'), '--provider', 'codex'],
        env: {BRIDGE_DATA_DIR: directory, BRIDGE_WORKSPACE: directory, BRIDGE_AUTOSTART: '0'}, stderr: 'pipe',
      }));
      const result = await adapter.callTool({name: 'session_register', arguments: {name: 'should-not-register'}});
      assert.equal(result.isError, true);
      assert.match(JSON.stringify(result.content), /PROTOCOL_MISMATCH/);
    } finally { await adapter.close(); }
    const doctor = await diagnose(directory);
    assert.equal(doctor.status, 'attention');
    assert.equal(doctor.broker!.version, '0.2.0');
    const client = new BrokerClient(url, token, {provider: 'test', workspace: directory});
    await assert.rejects(client.health(), isError('PROTOCOL_MISMATCH'));
    const health = await client.health(true);
    await client.shutdown(health.instanceId as string);
    assert.equal(stopped, true);
  } finally {
    await new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeAllConnections(); });
  }
}));
