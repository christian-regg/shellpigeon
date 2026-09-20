import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, sep } from 'node:path';
import { createInterface } from 'node:readline';
import { setTimeout as delay } from 'node:timers/promises';
import { startBroker } from '../build/src/broker.js';
import { initializeData, writeDescriptor } from '../build/src/config.js';
import { resolveHostCommand } from '../build/src/host-command.js';

const codexCommand = await resolveHostCommand('codex');
const claudeCommand = await resolveHostCommand('claude');

const directory = await mkdtemp(join(tmpdir(), 'asm-host-probe-'));
const token = await initializeData(directory);
const broker = await startBroker({dbPath: join(directory, 'mail.sqlite'), token});
await writeDescriptor(directory, broker.url);
const codexHome = join(directory, 'codex-home');
const claudeConfig = join(directory, 'claude-config');
await mkdir(codexHome);
await mkdir(claudeConfig);
const report = {testedAt: new Date().toISOString(), modelCalls: 0, nativeWakeTested: false, checks: {}};
let child;
let lines;
try {
  report.checks.versions = {
    codex: execFileSync(codexCommand.file, [...codexCommand.args, '--version'], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim(),
    claude: execFileSync(claudeCommand.file, [...claudeCommand.args, '--version'], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim(),
    node: process.version,
  };
  const env = {...process.env, BRIDGE_DATA_DIR: directory, BRIDGE_WORKSPACE: process.cwd()};
  const claudeMcp = join(directory, 'claude-mcp.json');
  await writeFile(claudeMcp, JSON.stringify({mcpServers: {'session-messaging': {
    command: process.execPath,
    args: [resolve('plugins/claude/agent-session-messaging/dist/mcp.cjs'), '--provider', 'claude-code'],
    env: {BRIDGE_DATA_DIR: directory, BRIDGE_WORKSPACE: process.cwd()},
  }}}));
  // The config directories apply only to these child processes; user configuration is untouched.
  const isolatedClaudeEnv = {...env, CLAUDE_CONFIG_DIR: claudeConfig};
  execFileSync(claudeCommand.file, [...claudeCommand.args, 'mcp', 'add-json', '--scope', 'user', 'session-messaging', JSON.stringify({
    command: process.execPath,
    args: [resolve('plugins/claude/agent-session-messaging/dist/mcp.cjs'), '--provider', 'claude-code'],
    env: {BRIDGE_DATA_DIR: directory, BRIDGE_WORKSPACE: process.cwd()},
  })], {encoding: 'utf8', timeout: 30_000, env: isolatedClaudeEnv, stdio: ['ignore', 'pipe', 'pipe']});
  const claudeOutput = execFileSync(claudeCommand.file, [...claudeCommand.args, 'mcp', 'list'], {
    encoding: 'utf8', timeout: 30_000, env: isolatedClaudeEnv, stdio: ['ignore', 'pipe', 'pipe'],
  });
  report.checks.claudeMcp = {connected: /session-messaging.*Connected/i.test(claudeOutput), output: claudeOutput.trim()};
  assert.ok(report.checks.claudeMcp.connected, 'Claude did not report the MCP server connected.');
  child = spawn(codexCommand.file, [...codexCommand.args, 'app-server', '--listen', 'stdio://'], {
    env: {...env, CODEX_HOME: codexHome}, cwd: process.cwd(), windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-4000); });
  const pending = new Map();
  let nextId = 1;
  lines = createInterface({input: child.stdout});
  lines.on('line', line => {
    let message;
    try { message = JSON.parse(line); } catch { return; }
    if (!pending.has(message.id)) return;
    const entry = pending.get(message.id);
    pending.delete(message.id);
    clearTimeout(entry.timer);
    if (message.error) entry.reject(new Error(JSON.stringify(message.error)));
    else entry.resolve(message.result);
  });
  const abort = error => {
    for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(error); }
    pending.clear();
  };
  child.on('error', abort);
  child.on('exit', code => abort(new Error('App Server exited ' + code + ': ' + stderr)));
  function rpc(method, params) {
    return new Promise((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('Timeout: ' + method)); }, 30_000);
      pending.set(id, {resolve, reject, timer});
      child.stdin.write(JSON.stringify({id, method, params}) + '\n');
    });
  }
  await rpc('initialize', {clientInfo: {name: 'session-messaging-probe', version: '0.1.0'}, capabilities: {experimentalApi: true}});
  child.stdin.write(JSON.stringify({method: 'initialized'}) + '\n');
  const thread = await rpc('thread/start', {
    cwd: process.cwd(), ephemeral: true,
    config: {
      'features.hooks': false,
      'mcp_servers.session_messaging': {
        command: process.execPath,
        args: [resolve('plugins/codex/agent-session-messaging/dist/mcp.cjs'), '--provider', 'codex'],
        env: {BRIDGE_DATA_DIR: directory, BRIDGE_WORKSPACE: process.cwd()},
      },
    },
  });
  let inventory;
  for (let attempt = 0; attempt < 6; attempt++) {
    inventory = await rpc('mcpServerStatus/list', {threadId: thread.thread.id, limit: 100});
    const ours = inventory.data?.find(server => server.name === 'session_messaging');
    const names = Array.isArray(ours?.tools) ? ours.tools.map(tool => tool.name) : Object.keys(ours?.tools ?? {});
    if (names.length) { report.checks.codexMcp = {toolCount: names.length, toolNames: names}; break; }
    await delay(500);
  }
  assert.equal(report.checks.codexMcp?.toolCount, 7, 'Codex did not discover seven tools: ' + JSON.stringify(inventory));
  await rpc('thread/unsubscribe', {threadId: thread.thread.id});
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.error = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  lines?.close();
  if (child) {
    // End the entire test-owned process tree on Windows before the parent exits.
    if (process.platform === 'win32' && child.exitCode === null && child.pid) {
      execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {stdio: 'ignore', windowsHide: true});
    } else {
      child.stdin.end();
      await Promise.race([new Promise(resolve => child.once('exit', resolve)), delay(1500)]);
      if (child.exitCode === null) child.kill();
    }
    await Promise.race([new Promise(resolve => child.once('exit', resolve)), delay(500)]);
  }
  await broker.close();
  await mkdir('artifacts', {recursive: true});
  await writeFile('artifacts/host-probe.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep + 'asm-host-probe-'));
  await rm(directory, {recursive: true, force: true, maxRetries: 10, retryDelay: 200});
}
