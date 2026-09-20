import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify, parseArgs} from 'node:util';
import {mkdtemp, mkdir, copyFile, readFile, writeFile, rm, lstat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve, relative, isAbsolute, sep} from 'node:path';
import {connectCodex} from '../build/src/native-codex.js';

const execute = promisify(execFile);
const {values} = parseArgs({options: {'codex-exe': {type: 'string'}}});
assert.equal(process.platform, 'win32', 'This lifecycle proof targets Windows.');
assert.ok(values['codex-exe'], 'Usage: probe-codex-daemon.mjs --codex-exe <stock codex.exe>');
const executable = resolve(values['codex-exe']);
assert.ok((await lstat(executable)).isFile());
const root = await mkdtemp(join(tmpdir(), 'asm-d-'));
const socket = join(root, 'app-server-control/app-server-control.sock');
assert.ok(Buffer.byteLength(socket, 'utf8') + 1 <= 108, 'The canonical Windows socket path must fit SUN_LEN.');
const managed = join(root, 'packages/standalone/current/bin/codex.exe');
const pidFile = join(root, 'app-server-daemon/app-server.pid');
const env = {...process.env, CODEX_HOME: root, CODEX_BIN: executable};
for (const name of ['CODEX_THREAD_ID','ASM_CODEX_SOCKET','CODEX_APP_TOOLS_PIPE_PATH','CLAUDE_CODE_MESSAGING_SOCKET','CLAUDE_CODE_MESSAGING_TOKEN']) delete env[name];
const report = {testedAt: new Date().toISOString(), modelCalls: 0, isolatedProfile: true,
  fixture: 'Stock CLI executable copied into the expected managed path; this does not test the standalone installer.',
  checks: []};
let rpc;
async function run(args) {
  const {stdout} = await execute(executable, args, {env, windowsHide: true, timeout: 30000, maxBuffer: 100000});
  return stdout.trim();
}
async function daemon(verb) { return JSON.parse(await run(['app-server','daemon',verb])); }
async function absent(path) {
  try {await lstat(path); return false;} catch (error) {if(error.code === 'ENOENT')return true; throw error;}
}
try {
  report.version = await run(['--version']);
  const missing = await daemon('start').then(value => ({value}), error => ({error: error.stderr}));
  assert.match(missing.error ?? '', /managed|standalone/i);
  report.checks.push({name: 'missing-managed-install-is-rejected', passed: true, error: missing.error.trim()});
  await mkdir(join(managed, '..'), {recursive: true});
  await copyFile(executable, managed);
  const started = await daemon('start');
  assert.equal(started.status, 'started');
  const first = JSON.parse(await readFile(pidFile, 'utf8'));
  assert.equal(started.pid, first.pid);
  report.checks.push({name: 'start-detached', passed: true, status: started.status, pid: first.pid});

  const again = await daemon('start');
  assert.equal(again.status, 'alreadyRunning');
  assert.deepEqual(JSON.parse(await readFile(pidFile, 'utf8')), first);
  const version = await daemon('version');
  assert.equal(version.status, 'running');
  assert.equal(version.appServerVersion, version.cliVersion);
  rpc = await connectCodex({env});
  await rpc.initialize();
  assert.deepEqual((await rpc.call('thread/loaded/list')).data, []);
  await rpc.close(); rpc = undefined;
  report.checks.push({name: 'idempotent-start-and-initialize', passed: true, status: again.status,
    appServerVersion: version.appServerVersion, backend: version.backend});
  assert.ok(await absent(join(root, 'app-server-daemon/app-server-updater.pid')));
  assert.ok(await absent(join(root, 'app-server-daemon/settings.json')));
  report.checks.push({name: 'no-updater-or-persisted-remote-control-setting', passed: true});

  const restarted = await daemon('restart');
  assert.equal(restarted.status, 'restarted');
  const replacement = JSON.parse(await readFile(pidFile, 'utf8'));
  assert.notEqual(replacement.pid, first.pid);
  report.checks.push({name: 'restart-owned-idle-daemon', passed: true, oldPid: first.pid, pid: replacement.pid});
  assert.equal((await daemon('stop')).status, 'stopped');
  assert.equal((await daemon('stop')).status, 'notRunning');
  assert.ok(await absent(pidFile));
  report.checks.push({name: 'stop-and-repeated-stop', passed: true});
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.error = (error.stderr || error.message).trim();
  process.exitCode = 1;
} finally {
  await rpc?.close();
  try {
    await daemon('stop');
    assert.ok(await absent(pidFile), 'Managed test process still has a PID record; keeping the fixture.');
    const suffix = relative(resolve(tmpdir()), resolve(root));
    assert.ok(suffix.startsWith('asm-d-') && !suffix.includes(sep) && !isAbsolute(suffix));
    await rm(root, {recursive: true, force: true, maxRetries: 5, retryDelay: 200});
    report.cleanedUp = true;
  } catch (error) { report.cleanedUp = false; report.cleanupError = error.message; report.passed = false; process.exitCode = 1; }
  await mkdir('artifacts/native-delivery', {recursive: true});
  await writeFile('artifacts/native-delivery/daemon-lifecycle.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}

