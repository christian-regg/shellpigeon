import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {resolveHostCommand} from '../build/src/host-command.js';
import {connectCodex} from '../build/src/native-codex.js';

const execute = promisify(execFile);
const metadata = JSON.parse(await readFile('package.json', 'utf8'));
const release = resolve('artifacts/release', metadata.version);
const env = {...process.env, BRIDGE_AUTOSTART: '0'};
const report = {testedAt: new Date().toISOString(), modelCalls: 0, messagesSent: 0, injectedMcpConfig: false, expectedVersion: metadata.version};
let rpc;
async function run(file, args) {
  return (await execute(file, args, {encoding: 'utf8', env, windowsHide: true, timeout: 45_000, maxBuffer: 2_000_000})).stdout.trim();
}
async function cli(host, args) {
  const command = await resolveHostCommand(host, {env});
  return run(command.file, [...command.args, ...args]);
}
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
async function checkBundle(host, root) {
  const source = host === 'codex' ? join(release, 'codex-marketplace/plugins/agent-session-messaging') : join(release, 'claude-marketplace/plugins/agent-session-messaging');
  for (const file of ['dist/peer.cjs', 'dist/mcp.cjs', 'dist/broker.cjs', 'skills/session-messaging/SKILL.md', 'skills/session-messaging/references/durable-mailboxes.md', 'skills/session-messaging/references/codex-listener.md']) {
    assert.equal(digest(await readFile(join(root, file))), digest(await readFile(join(source, file))), 'Installed file differs: ' + file);
  }
  const skillDirectory = join(root, 'skills/session-messaging');
  const helper = resolve(skillDirectory, '../../dist/peer.cjs');
  assert.match(await readFile(join(skillDirectory, 'SKILL.md'), 'utf8'), /\.\.\/\.\.\/dist\/peer\.cjs/);
  assert.match(await run(process.execPath, [helper, '--help']), /peer\.cjs list/);
  return {root, filesMatchRelease: true, skillRelativeHelper: true};
}

try {
  report.hosts = {codex: await cli('codex', ['--version']), claude: await cli('claude', ['--version']), node: process.version};
  const inventory = JSON.parse(await cli('codex', ['plugin', 'list', '--marketplace', 'personal', '--json']));
  const codex = inventory.installed.find(p => p.pluginId === 'agent-session-messaging@personal');
  assert.ok(codex?.enabled, 'Codex plugin is not enabled');
  assert.equal(codex.version.split('+')[0], metadata.version);
  const claude = JSON.parse(await cli('claude', ['plugin', 'list', '--json'])).find(p => p.id === 'agent-session-messaging@agent-session-messaging-local');
  assert.ok(claude?.enabled, 'Claude plugin is not enabled');
  assert.equal(claude.version, metadata.version);
  report.claude = {id: claude.id, version: claude.version, enabled: true, ...await checkBundle('claude', claude.installPath)};
  assert.match(await cli('claude', ['mcp', 'get', 'plugin:agent-session-messaging:session-messaging']), /Connected/);
  report.claude.mcpConnected = true;
  console.log('Claude installed bundle and targeted MCP connection passed.');

  rpc = await connectCodex({args: ['app-server', '--listen', 'stdio://'], env, timeout: 30_000});
  await rpc.initialize();
  const skills = await rpc.call('skills/list', {cwds: [process.cwd()], forceReload: true});
  const skill = skills.data?.flatMap(item => item.skills ?? []).find(s => s.name === 'agent-session-messaging:session-messaging' && s.pluginId === codex.pluginId);
  assert.ok(skill?.enabled, 'Codex did not load the installed skill');
  const root = resolve(dirname(skill.path), '../..');
  const manifest = JSON.parse(await readFile(join(root, '.codex-plugin/plugin.json'), 'utf8'));
  assert.equal(manifest.version, codex.version, 'Codex loaded an old cache');
  report.codex = {id: codex.pluginId, version: codex.version, enabled: true, ...await checkBundle('codex', root), skillLoadedByHost: true};
  const started = await rpc.call('thread/start', {cwd: process.cwd(), ephemeral: true, config: {'features.hooks': false}});
  const threadId = started.thread.id;
  let names = [];
  for (let attempt = 0; attempt < 40; attempt++) {
    const status = await rpc.call('mcpServerStatus/list', {threadId, limit: 100});
    const server = status.data?.find(s => s.name === 'session-messaging' || s.name.includes('agent-session-messaging'));
    assert.notEqual(server?.runtimeStatus, 'failed', 'Installed Codex MCP failed');
    names = Array.isArray(server?.tools) ? server.tools.map(t => t.name) : Object.keys(server?.tools ?? {});
    if (names.length) break;
    await delay(500);
  }
  assert.deepEqual(names.sort(), ['session_register', 'sessions_list', 'message_send', 'inbox_read', 'message_reply', 'message_ack', 'message_status'].sort());
  report.codex.toolNames = names;
  await rpc.call('thread/unsubscribe', {threadId});
  await rpc.close(); rpc = undefined;
  console.log('Codex loaded the updated skill and all seven mailbox tools. Checking read-only discovery.');

  const listed = JSON.parse(await run(process.execPath, [join(root, 'dist/peer.cjs'), 'list', '--all']));
  assert.ok(Array.isArray(listed.peers));
  report.discovery = {passed: true, total: listed.peers.length, byTransport: {}};
  for (const peer of listed.peers) report.discovery.byTransport[peer.transport] = (report.discovery.byTransport[peer.transport] ?? 0) + 1;
  report.passed = true;
} catch (error) {
  report.passed = false; report.error = error.message; process.exitCode = 1;
} finally {
  await rpc?.close();
  await mkdir('artifacts', {recursive: true});
  await writeFile('artifacts/installed-host-probe.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}
