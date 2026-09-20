import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { connect } from 'node:net';
import { createInterface } from 'node:readline';
import { readFile, readdir, lstat, mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { resolveHostCommand } from '../build/src/host-command.js';

const sessionId = randomUUID();
const nonce = 'ASM_ACK_' + randomUUID().replaceAll('-', '');
const report = {testedAt: new Date().toISOString(), host: 'claude', sessionId, nonce, testOwned: true,
  configuration: 'stream-json -p; no tools; per-process inbound accept; no persistent settings changed'};
const command = await resolveHostCommand('claude');
const child = spawn(command.file, [...command.args, '-p', '--input-format', 'stream-json',
  '--output-format', 'stream-json', '--verbose', '--session-id', sessionId,
  '--name', 'asm-native-delivery-probe', '--tools', '', '--strict-mcp-config',
  '--mcp-config', '{"mcpServers":{}}', '--settings', '{"crossSessionInbound":"accept"}',
  '--no-chrome', '--disable-slash-commands', '--max-budget-usd', '1'], {
  windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
});
const events = [];
let stderr = '';
child.stderr.on('data', data => { stderr = (stderr + data).slice(-2000); });
const lines = createInterface({input: child.stdout});
lines.on('line', line => {
  try {
    const event = JSON.parse(line);
    events.push(event);
    if (event.type === 'result') console.log(JSON.stringify({stage: 'model-result', subtype: event.subtype, result: event.result}));
  } catch {}
});
let childError;
child.on('error', error => { childError = error; });
child.stdin.on('error', error => { childError = error; });
async function until(check, timeout = 60_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (childError) throw childError;
    const value = await check();
    if (value) return value;
    if (child.exitCode !== null) throw new Error('Claude exited ' + child.exitCode + ': ' + stderr);
    await delay(100);
  }
  throw new Error('Probe deadline exceeded.');
}
try {
  child.stdin.write(JSON.stringify({type: 'user', session_id: sessionId, message: {role: 'user',
    content: 'This is an authorized native delivery test. Do not use tools or delegate. Reply only ASM_NATIVE_READY now. For a later cross-session message marked ASM_NATIVE_PROBE, repeat its ASM_ACK code exactly in your final response.'}}) + '\n');
  await until(() => events.find(event => event.type === 'result' && event.result?.trim() === 'ASM_NATIVE_READY'));
  report.ready = true;
  console.log(JSON.stringify({stage: 'ready', sessionId, pid: child.pid}));
  const directory = join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'), 'sessions');
  const record = await until(async () => {
    try {
      const metadata = JSON.parse(await readFile(join(directory, child.pid + '.json'), 'utf8'));
      return metadata.sessionId === sessionId && metadata.messagingSocketPath ? metadata : null;
    } catch { return null; }
  }, 10_000);
  if (record.pid !== child.pid || record.sessionId !== sessionId) throw new Error('Receiver identity mismatch.');
  report.receiver = {pid: record.pid, sessionId: record.sessionId, kind: record.kind, version: record.version, status: record.status};
  const keys = (await readdir(directory)).filter(name => new RegExp('^' + child.pid + '\\.[0-9a-f]{64}\\.key$').test(name));
  if (keys.length !== 1) throw new Error('Expected exactly one test-owned peer key.');
  const keyPath = join(directory, keys[0]);
  const info = await lstat(keyPath);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 4096) throw new Error('Unexpected peer key file.');
  const key = JSON.parse(await readFile(keyPath, 'utf8'));
  if (!/^[0-9a-f]{32}$/.test(key.peerToken)) throw new Error('Invalid peer key.');
  const message = {type: 'user', uuid: randomUUID(), priority: 'immediate',
    message: {role: 'user', content: '<cross-session-message from="asm-native-probe" from_name="ASM native probe">\nASM_NATIVE_PROBE: reply only ' + nonce + '\n</cross-session-message>'}};
  report.sentAt = new Date().toISOString();
  await new Promise((resolve, reject) => {
    const socket = connect(record.messagingSocketPath);
    socket.setTimeout(5000, () => socket.destroy(new Error('IPC write timeout; do not retry.')));
    socket.on('error', reject);
    socket.once('connect', () => socket.end(JSON.stringify({type: 'auth', token: key.peerToken}) + '\n' + JSON.stringify(message) + '\n', resolve));
  });
  report.transportWritten = true;
  console.log(JSON.stringify({stage: 'ipc-written', nonce}));
  const ack = await until(() => events.find(event => event.type === 'result' && event.result?.trim() === nonce));
  report.ack = {sessionId: ack.session_id, text: ack.result, at: new Date().toISOString()};
  report.passed = ack.session_id === sessionId;
  report.results = events.filter(event => event.type === 'result').map(event => ({subtype: event.subtype, result: event.result, sessionId: event.session_id}));
} catch (error) {
  report.passed = false;
  report.error = error.message;
  process.exitCode = 1;
} finally {
  child.stdin.end();
  if (child.exitCode === null) {
    await Promise.race([new Promise(resolve => child.once('exit', resolve)), delay(1500)]);
    if (child.exitCode === null) child.kill();
  }
  lines.close();
  report.modelResultCount = events.filter(event => event.type === 'result').length;
  await mkdir('artifacts/native-delivery', {recursive: true});
  await writeFile('artifacts/native-delivery/claude.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}
