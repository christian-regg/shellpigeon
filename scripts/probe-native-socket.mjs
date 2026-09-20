import { spawn, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { resolveHostCommand } from '../build/src/host-command.js';
import { connectCodex } from '../build/src/native-codex.js';
const directory = resolve('artifacts/native-delivery');
await mkdir(directory, {recursive: true});
const privateDirectory = resolve(directory, 'private-' + randomUUID().slice(0, 8));
await mkdir(privateDirectory, {mode: 0o700});
if (process.platform === 'win32') {
  const owner = execFileSync('whoami.exe', [], {encoding: 'utf8', windowsHide: true}).trim();
  execFileSync('icacls.exe', [privateDirectory, '/inheritance:r', '/grant:r', owner + ':(OI)(CI)F'], {windowsHide: true, stdio: 'pipe'});
}
const socket = resolve(privateDirectory, 'control.sock');
const command = await resolveHostCommand('codex');
const server = spawn(command.file, [...command.args, 'app-server', '--listen', 'unix://' + socket.replaceAll('\\', '/'),
  '-c', 'features.hooks=false'], {windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']});
let stderr = '';
server.stderr.on('data', data => { stderr = (stderr + data).slice(-4000); });
server.stdout.resume();
let error;
server.on('error', value => { error = value; });
const report = {testedAt: new Date().toISOString(), modelCalls: 0, testOwned: true, defaultEndpoint: false};
let rpc;
try {
  const deadline = Date.now() + 10_000;
  while (!stderr.includes('listening') && server.exitCode === null && !error && Date.now() < deadline) await delay(100);
  if (error) throw error;
  if (server.exitCode !== null) throw new Error('Test listener exited: ' + stderr);
  rpc = await connectCodex({args: ['app-server', 'proxy', '--sock', socket], timeout: 8000});
  report.server = await rpc.initialize();
  report.loaded = await rpc.call('thread/loaded/list');
  report.passed = true;
  if (process.argv.includes('--delivery')) {
    delete report.modelCalls;
    report.startsModelTurns = true;
    const proof = spawn(process.execPath, ['scripts/probe-native-codex.mjs', '--socket', socket], {windowsHide: true, stdio: 'inherit'});
    const code = await new Promise((resolve, reject) => { proof.once('exit', resolve); proof.once('error', reject); });
    report.deliveryPassed = code === 0;
    report.passed = report.deliveryPassed;
  }
} catch (error) { report.passed = false; report.error = error.message; }
finally {
  await rpc?.close();
  server.stdin.end();
  if (server.exitCode === null) server.kill();
  report.listenerLog = stderr.replaceAll(socket, '<test-socket>');
  await writeFile(resolve(directory, 'explicit-socket.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  if (!report.passed) process.exitCode = 1;
}
