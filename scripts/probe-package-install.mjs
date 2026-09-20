import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify, parseArgs} from 'node:util';
import {mkdtemp, mkdir, readFile, writeFile, realpath, rm, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve, dirname, relative, isAbsolute, sep} from 'node:path';
import {createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {connectCodex} from '../build/src/native-codex.js';
import {resolveHostCommand} from '../build/src/host-command.js';

// Install into fresh child-process profiles. Never install into the user's profiles.
const runFile = promisify(execFile);
const {values} = parseArgs({options: {python: {type: 'string'}, 'plugin-creator': {type: 'string'}, 'native-roundtrip': {type: 'boolean'}}});
const metadata = JSON.parse(await readFile('package.json', 'utf8'));
const release = resolve('artifacts/release', metadata.version);
const archive = resolve('artifacts/release', metadata.artifactName+'-'+metadata.version+(process.platform==='win32' ? '-windows.zip' : '-linux.tar.gz'));
const tar = process.platform === 'win32' ? 'tar.exe' : 'tar';
for (const path of ['codex-marketplace/plugins/agent-session-messaging/dist/peer.cjs', 'claude-marketplace/plugins/agent-session-messaging/dist/peer.cjs']) await stat(join(release, path));
const commands = {codex: await resolveHostCommand('codex'), claude: await resolveHostCommand('claude')};
const root = await mkdtemp(join(tmpdir(), 'asm-package-ü spaced-'));
const workspace = join(root, 'workspace');
const codexHome = join(root, 'codex-home');
const claudeHome = join(root, 'claude-config');
const distribution = join(root, 'distribution');
const marketRoot = join(distribution, 'codex-marketplace');
const sourceRoot = join(marketRoot, 'plugins/agent-session-messaging');
const codexMarket = 'agent-session-messaging';
const claudeMarket = 'agent-session-messaging';
const report = {testedAt: new Date().toISOString(), version: metadata.version, modelCalls: 0,
  isolatedProfiles: true, injectedMcpConfig: false, nativeDeliveryTested: false, checks: {}};
let rpc, installedCodexRoot, installedClaudeRoot;
for (const dir of [workspace, codexHome, claudeHome]) await mkdir(dir, {recursive: true});
const env = {...process.env, CODEX_HOME: codexHome, CLAUDE_CONFIG_DIR: claudeHome,
  BRIDGE_DATA_DIR: join(root, 'broker-data'), BRIDGE_WORKSPACE: workspace, BRIDGE_AUTOSTART: '0'};
for (const name of ['CODEX_THREAD_ID', 'CLAUDE_CODE_MESSAGING_SOCKET', 'ASM_CODEX_SOCKET', 'CODEX_APP_TOOLS_PIPE_PATH']) delete env[name];
async function run(file, args, extra = {}) {
  const result = await runFile(file, args, {cwd: workspace, env, windowsHide: true, timeout: 45_000, maxBuffer: 1024 * 1024, ...extra});
  return result.stdout.trim();
}
async function cli(host, args) { const c = commands[host]; return run(c.file, [...c.args, ...args]); }
function assertWithin(child, parent) {
  const suffix = relative(resolve(parent), resolve(child));
  assert.ok(suffix && suffix !== '..' && !suffix.startsWith('..' + sep) && !isAbsolute(suffix), 'Test path escaped its isolated root.');
}
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
async function bundleCheck(host, installed) {
  assertWithin(await realpath(installed), await realpath(root));
  const source = host === 'codex' ? join(release, 'codex-marketplace/plugins/agent-session-messaging') : join(release, 'claude-marketplace/plugins/agent-session-messaging');
  for (const file of ['dist/peer.cjs', 'dist/mcp.cjs', 'dist/broker.cjs', 'skills/session-messaging/SKILL.md', 'skills/session-messaging/references/durable-mailboxes.md', 'skills/session-messaging/references/codex-listener.md']) {
    assert.equal(digest(await readFile(join(installed, file))), digest(await readFile(join(source, file))), 'Installed file differs: ' + file);
  }
  // This is the same relative path the installed skill tells the host to resolve.
  const skillDir = join(installed, 'skills/session-messaging');
  const helper = resolve(skillDir, '../../dist/peer.cjs');
  assert.match(await readFile(join(skillDir, 'SKILL.md'), 'utf8'), /\.\.\/\.\.\/dist\/peer\.cjs/);
  assert.match(await run(process.execPath, [helper, '--help']), /peer\.cjs doctor/);
  if (host === 'codex' && process.platform === 'win32') {
    assert.equal(digest(await readFile(join(installed, 'setup-listener.ps1'))), digest(await readFile(join(source, 'setup-listener.ps1'))));
    const setup = JSON.parse(await run('powershell.exe', ['-NoProfile', '-File', join(installed, 'setup-listener.ps1')]));
    assert.equal(setup.mode, 'preview');
    assert.equal(setup.automaticUpdaterRequested, false);
  }
  const diagnosis = JSON.parse(await run(process.execPath, [helper, 'doctor']));
  assert.ok(Array.isArray(diagnosis.codexEndpoints));
  // Discovery may observe real explicit sockets, but it never starts/resumes/sends a turn.
  return {version: metadata.version, installedFilesMatch: true, skillRelativeHelper: true, helperDoctor: true};
}
async function eventually(fn, label) {
  const deadline = Date.now() + 20_000;
  do { const value = await fn(); if (value) return value; await delay(300); } while (Date.now() < deadline);
  throw new Error('Timed out: ' + label);
}
try {
  report.hosts = {codex: await cli('codex', ['--version']), claude: await cli('claude', ['--version']), node: process.version};
  console.log('Extracting release archive and installing into isolated profiles.');
  await mkdir(distribution);
  await run(tar, ['-x','-f',archive,'-C',distribution]);
  // Synthetic older release version exercises host update caches without a model turn.
  const prior=JSON.parse(await readFile(join(distribution,'release.json'),'utf8'));
  prior.version='0.4.0-preview.0';
  for (const file of ['codex-marketplace/plugins/agent-session-messaging/.codex-plugin/plugin.json','claude-marketplace/plugins/agent-session-messaging/.claude-plugin/plugin.json']) {
    const value=JSON.parse(await readFile(join(distribution,file),'utf8'));value.version=prior.version;
    const bytes=JSON.stringify(value,null,2)+'\n';await writeFile(join(distribution,file),bytes);prior.files[file]=digest(bytes);
  }
  await writeFile(join(distribution,'release.json'),JSON.stringify(prior,null,2)+'\n');
  const installer=join(distribution,'install.cjs');
  const preflight=JSON.parse(await run(process.execPath,[installer,'--check']));
  assert.equal(preflight.mode,'check');
  assert.ok(preflight.plans.every(p=>!p.installed));
  const first=JSON.parse(await run(process.execPath,[installer]));
  assert.deepEqual(first.completed,['codex','claude']);
  const repeated=JSON.parse(await run(process.execPath,[installer]));
  assert.deepEqual(repeated.completed,['codex','claude']);
  await run(tar, ['-x','-f',archive,'-C',distribution]);
  const updated=JSON.parse(await run(process.execPath,[installer]));
  assert.equal(updated.version,metadata.version);
  report.checks.installer={archiveExtracted:true,preflight:true,firstInstall:true,repeatedInstall:true,upgradeFromSyntheticPriorVersion:true};
  const installed = JSON.parse(await cli('codex', ['plugin', 'list', '--marketplace', codexMarket, '--json']));
  const codexPlugin = installed.installed.find(p => p.pluginId === 'agent-session-messaging@' + codexMarket);
  assert.ok(codexPlugin?.enabled);
  assert.equal(codexPlugin.version, metadata.version);

  const claudePlugin = JSON.parse(await cli('claude', ['plugin', 'list', '--json'])).find(p => p.id === 'agent-session-messaging@' + claudeMarket);
  assert.ok(claudePlugin?.enabled);
  assert.equal(claudePlugin.version, metadata.version);
  installedClaudeRoot = claudePlugin.installPath;
  report.checks.claude = await bundleCheck('claude', installedClaudeRoot);
  const status = await cli('claude', ['mcp', 'list']);
  const ours = status.split(/\r?\n/).find(line => line.includes('plugin:agent-session-messaging:session-messaging:'));
  assert.match(ours ?? '', /Connected/);
  report.checks.claude.mcpConnected = true;
  console.log('Claude installation and bundled helper passed. Checking Codex host loading.');

  rpc = await connectCodex({args: ['app-server', '--listen', 'stdio://'], env});
  await rpc.initialize();
  const started = await rpc.call('thread/start', {cwd: workspace, ephemeral: true, config: {'features.hooks': false}});
  const threadId = started.thread.id;
  const skills = await rpc.call('skills/list', {cwds: [workspace], forceReload: true});
  const skill = skills.data?.flatMap(item => item.skills ?? []).find(s => s.name === 'agent-session-messaging:session-messaging' && s.pluginId === 'agent-session-messaging@' + codexMarket);
  if (!skill?.enabled) report.skillDiagnostics = skills.data?.map(item => ({cwd: item.cwd, errors: item.errors, skills: item.skills?.filter(s => s.name.includes('messaging'))}));
  assert.ok(skill?.enabled, 'Codex did not load the installed preview skill.');
  const installedRoot = resolve(dirname(skill.path), '../..');
  installedCodexRoot = installedRoot;
  report.checks.codex = await bundleCheck('codex', installedRoot);
  report.checks.codex.skillLoadedByHost = true;
  const tools = await eventually(async () => {
    const inventory = await rpc.call('mcpServerStatus/list', {threadId, limit: 100});
    const server = inventory.data?.find(s => s.name === 'session-messaging' || s.name.includes('agent-session-messaging'));
    if (server?.runtimeStatus === 'failed') throw new Error('Installed Codex MCP failed.');
    const names = Array.isArray(server?.tools) ? server.tools.map(t => t.name) : Object.keys(server?.tools ?? {});
    return names.length ? names.sort() : null;
  }, 'Codex MCP tools');
  assert.deepEqual(tools, ['session_register','sessions_list','message_send','inbox_read','message_reply','message_ack','message_status'].sort());
  report.checks.codex.toolNames = tools;
  await rpc.call('thread/unsubscribe', {threadId});
  if (values['native-roundtrip']) {
    await rpc.close(); rpc = undefined;
    const {runInstalledNativeRoundtrip} = await import('./probe-installed-native-roundtrip.mjs');
    delete report.modelCalls; report.startsModelTurns = true; report.nativeDeliveryTested = true;
    report.native = await runInstalledNativeRoundtrip({root, workspace, env, commands, codexRoot: installedCodexRoot, claudeRoot: installedClaudeRoot});
  }
  await rpc?.close(); rpc=undefined;
  // Repair generated local paths without touching durable user data.
  await writeFile(join(sourceRoot,'.mcp.json'),'{}');
  await run(process.execPath,[join(distribution,'install.cjs'),'--host','codex']);
  const repaired=JSON.parse(await readFile(join(sourceRoot,'.mcp.json'),'utf8'));
  assert.equal(repaired.mcpServers['session-messaging'].command,process.execPath);
  await mkdir(join(root,'broker-data'),{recursive:true});
  await writeFile(join(root,'broker-data','preserve.txt'),'private data sentinel');
  const removed=JSON.parse(await run(process.execPath,[join(distribution,'install.cjs'),'--uninstall']));
  assert.deepEqual(removed.completed,['codex','claude']);
  assert.equal(await readFile(join(root,'broker-data','preserve.txt'),'utf8'),'private data sentinel');
  const after=JSON.parse(await run(process.execPath,[join(distribution,'install.cjs'),'--check']));
  assert.ok(after.plans.every(p=>!p.installed));
  Object.assign(report.checks.installer,{repair:true,uninstall:true,privateDataPreserved:true});
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.error = error.message;
  if (error.proof) report.native = error.proof;
  process.exitCode = 1;
} finally {
  await rpc?.close();
  // No mailbox tool was invoked; no broker should have been started even transiently.
  try { await stat(join(root, 'broker-data/broker.lock')); report.unexpectedBroker = true; report.passed = false; process.exitCode = 1; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  assertWithin(root, tmpdir());
  assert.ok(root.startsWith(join(tmpdir(), 'asm-package-ü spaced-')));
  try {
    await rm(root, {recursive: true, force: true, maxRetries: 10, retryDelay: 200});
    report.cleanedUp = true;
  } catch (error) { report.cleanedUp = false; report.cleanupError = error.message; process.exitCode = 1; report.passed = false; }
  await mkdir('artifacts/native-delivery', {recursive: true});
  await writeFile(values['native-roundtrip'] ? 'artifacts/native-delivery/installed-roundtrip.json' : 'artifacts/package-install-probe.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}
