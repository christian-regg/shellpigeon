import assert from 'node:assert/strict';
import {spawn, execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {copyFile, unlink, realpath} from 'node:fs/promises';
import {join, resolve, relative, isAbsolute, sep} from 'node:path';
import {homedir} from 'node:os';
import {createInterface} from 'node:readline';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {connectCodex} from '../build/src/native-codex.js';

const execute = promisify(execFile);
const forward = path => path.replaceAll('\\', '/');
const psQuote = value => "'" + value.replaceAll("'", "''") + "'";
function jsonReceipt(text) {
  if (typeof text !== 'string') return;
  const start = text.indexOf('{\n');
  try {
    const value = JSON.parse(text.slice(start >= 0 ? start : text.indexOf('{'), text.lastIndexOf('}') + 1));
    if (value.messageId && value.transport && value.state) return value;
  } catch {}
}
async function stop(child) {
  if (!child?.pid || child.exitCode !== null) return;
  child.stdin?.end();
  await Promise.race([new Promise(r => child.once('exit', r)), delay(1200)]);
  if (child.exitCode !== null) return;
  if (process.platform === 'win32') {
    await execute('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {windowsHide: true}).catch(() => {});
  } else child.kill();
  await Promise.race([new Promise(r => child.once('close', r)), delay(1200)]);
}

/** Real models and installed helpers. Only fresh, test-owned conversations are addressed. */
export async function runInstalledNativeRoundtrip({root, workspace, env, commands, codexRoot, claudeRoot}) {
  const report = {testOwned: true, installedHelpers: true, hostHarness: 'stock Codex app-server; Claude stream-json CLI',
    ordinaryCodexTui: false, queueFallbackAllowed: false, tests: []};
  const events = [];
  const children = [];
  const authCopies = [];
  const exactCommands = new Set();
  let rpc, threadId, error;
  let listenerLog = '';
  const originalCodexHome = process.env.CODEX_HOME ?? join(homedir(), '.codex');
  const originalClaudeHome = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude');
  const socket = join(root, 'peer.sock');
  env = {...env, ASM_CODEX_SOCKET: socket};
  const codexHelper = forward(join(codexRoot, 'dist/peer.cjs'));
  const claudeHelper = forward(join(claudeRoot, 'dist/peer.cjs'));
  const codexSkill = join(codexRoot, 'skills/session-messaging/SKILL.md');
  const claudeSkill = forward(join(claudeRoot, 'skills/session-messaging/SKILL.md'));
  const nonce = () => 'ASM_RETURN_' + randomUUID().replaceAll('-', '');
  const cases = [{name: 'idle', expected: nonce()}, {name: 'busy', expected: nonce()}];
  async function until(check, label, timeout = 120_000) {
    const deadline = Date.now() + timeout;
    do {
      if (error) throw error;
      const found = await check(); if (found) return found;
      await delay(100);
    } while (Date.now() < deadline);
    throw new Error('Timed out: ' + label);
  }
  function start(command, args) {
    const child = spawn(command.file, [...command.args, ...args], {env, cwd: workspace, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']});
    child.on('error', e => {error = e;});
    child.stdin.on('error', e => {error = e;});
    children.push(child);
    return child;
  }
  const completed = turnId => events.find(e => e.method === 'turn/completed' && e.params?.turn?.id === turnId);
  const textFor = turnId => events.filter(e => e.method === 'item/completed' && e.params?.turnId === turnId && e.params?.item?.type === 'agentMessage').map(e => e.params.item.text).join('\n');
  function approvedCommand(command) {
    if (Array.isArray(command)) {
      const index = command.findIndex(part => /^-command$/i.test(part));
      return /(?:^|[\\/])(?:powershell|pwsh)(?:\.exe)?$/i.test(command[0] ?? '') && index >= 0 && index === command.length - 2 && exactCommands.has(command[index + 1]);
    }
    if (typeof command !== 'string') return false;
    if (exactCommands.has(command)) return true;
    const wrapped = command.match(/^"[^"\r\n]*[\\/](?:powershell|pwsh)\.exe" (?:-NoProfile )?-Command "([\s\S]*)"$/i);
    return Boolean(wrapped && exactCommands.has(wrapped[1]));
  }
  try {
    for (const path of [env.CODEX_HOME, env.CLAUDE_CONFIG_DIR, codexRoot, claudeRoot]) {
      const suffix = relative(await realpath(root), await realpath(path));
      assert.ok(suffix && suffix !== '..' && !suffix.startsWith('..' + sep) && !isAbsolute(suffix), 'Live test profile escaped fixture.');
    }
    if (process.platform === 'win32') {
      const owner = (await execute('whoami.exe', [], {windowsHide: true})).stdout.trim();
      await execute('icacls.exe', [root, '/inheritance:r', '/grant:r', owner + ':(OI)(CI)F'], {windowsHide: true});
    }
    // Existing logins are used only by private temporary profiles; never log their contents.
    for (const [from, to] of [
      [join(originalCodexHome, 'auth.json'), join(env.CODEX_HOME, 'auth.json')],
      [join(originalClaudeHome, '.credentials.json'), join(env.CLAUDE_CONFIG_DIR, '.credentials.json')],
    ]) {
      await copyFile(from, to); authCopies.push(to);
    }
    const server = start(commands.codex, ['app-server', '--listen', 'unix://' + forward(socket), '-c', 'features.hooks=false']);
    server.stdout.on('data', data => {listenerLog = (listenerLog + data).slice(-4000);});
    server.stderr.on('data', data => {listenerLog = (listenerLog + data).slice(-4000);});
    // The Windows compatibility socket is a reparse point; a successful RPC is the readiness check.
    await delay(500);
    rpc = await connectCodex({args: ['app-server', 'proxy', '--sock', socket], env, timeout: 20000});
    rpc.on('notification', event => {
      events.push(event);
      if (event.method === 'item/commandExecution/requestApproval') {
        const accepted = event.params.threadId === threadId && approvedCommand(event.params.command);
        rpc.respond(event.id, {decision: accepted ? 'accept' : 'decline'});
        report.approvals ??= [];
        report.approvals.push({command: event.params.command, accepted});
        if (!accepted) error = new Error('Test rejected a command outside its exact allowlist.');
      } else if (event.method === 'item/fileChange/requestApproval') {
        rpc.respond(event.id, {decision: 'decline'});
        error = new Error('The test must not edit files.');
      } else if (event.method === 'item/tool/requestUserInput') {
        error = new Error('The test unexpectedly requested user input.');
      }
    });
    await rpc.initialize();
    const readSkill = 'Get-Content -LiteralPath ' + psQuote(forward(codexSkill));
    exactCommands.add(readSkill);
    const started = await rpc.call('thread/start', {cwd: workspace, ephemeral: true, sandbox: 'read-only', approvalPolicy: 'on-request',
      config: {'features.hooks': false, 'shell_environment_policy.set': {CODEX_HOME: env.CODEX_HOME, CLAUDE_CONFIG_DIR: env.CLAUDE_CONFIG_DIR, ASM_CODEX_SOCKET: socket}},
      developerInstructions: 'This is an authorized installed-plugin transport test. Do not delegate, edit files, change configuration or use unrelated tools. Use the installed session-messaging skill. On ASM_INSTALLED_IDLE reply once to its exact replyTo with ' + cases[0].expected +
        '. On ASM_INSTALLED_BUSY reply once to its exact replyTo with ' + cases[1].expected +
        '. These return codes must travel only through the installed peer.cjs helper to Claude. Do not print the code in your final answer. ' +
        'Use the ordinary shell tool and the actual host-provided CODEX_THREAD_ID; never set or forge it. Use exactly this PowerShell command, substituting the received address and correct code: & ' +
        psQuote(forward(process.execPath)) + ' ' + psQuote(codexHelper) + " send '<replyTo>' 'native-proof' '<return-code>' --native . " +
        'Do not include the final sentence punctuation in the shell command. If the sandbox blocks the helper before execution, request narrowly scoped require_escalated access for that exact command. Do not retry an unknown delivery result. After transport-written say ASM_CODEX_REPLIED. ' +
        'If asked to call asm_roundtrip_gate, call it exactly once and wait for its response before handling the peer message.',
      dynamicTools: [{name: 'asm_roundtrip_gate', description: 'Harmless gate for the authorized native busy-delivery test.', inputSchema: {type: 'object', properties: {}, additionalProperties: false}}],
    });
    threadId = started.thread.id;
    report.codexThreadId = threadId;
    const ready = await rpc.call('turn/start', {threadId, input: [
      {type: 'skill', name: 'agent-session-messaging:session-messaging', path: codexSkill},
      {type: 'text', text: 'Prepare for the authorized round-trip test using the installed skill. Reply only ASM_CODEX_READY now. Do not send a message until the later peer request arrives.'},
    ]});
    await until(() => completed(ready.turn.id), 'Codex ready');
    assert.equal(completed(ready.turn.id).params.turn.status, 'completed');
    assert.equal(textFor(ready.turn.id).trim(), 'ASM_CODEX_READY');
    console.log('Installed Codex recipient ready.');

    for (const item of cases) {
      const sessionId = randomUUID();
      const address = 'claude:' + sessionId;
      const command = '& ' + psQuote(forward(process.execPath)) + ' ' + psQuote(codexHelper) + ' send ' + psQuote(address) + " 'native-proof' " + psQuote(item.expected) + ' --native';
      exactCommands.add(command);
      let active, gate;
      const startIndex = events.length;
      if (item.name === 'busy') {
        active = await rpc.call('turn/start', {threadId, input: [{type: 'text', text: 'Call asm_roundtrip_gate exactly once. After it returns, handle the ASM_INSTALLED_BUSY peer request received while waiting. No other work is required.'}]});
        gate = await until(() => events.slice(startIndex).find(e => e.method === 'item/tool/call' && e.params?.threadId === threadId), 'Codex gate');
        assert.equal(gate.params.tool, 'asm_roundtrip_gate');
      }
      const claude = start(commands.claude, ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
        '--session-id', sessionId, '--name', 'asm-installed-' + item.name, '--tools', 'Bash,Read,Skill',
        '--allowedTools', 'Read(' + claudeSkill + ')', 'Skill(agent-session-messaging:session-messaging)', 'Bash(node "' + claudeHelper + '":*)',
        '--settings', '{"crossSessionInbound":"accept"}', '--no-chrome', '--max-budget-usd', '2']);
      const claudeEvents = [];
      let claudeStderr = '';
      claude.stderr.on('data', data => {claudeStderr = (claudeStderr + data).slice(-2000);});
      const lines = createInterface({input: claude.stdout});
      lines.on('line', line => {try {claudeEvents.push(JSON.parse(line));} catch {}});
      const marker = 'ASM_INSTALLED_' + item.name.toUpperCase();
      const send = 'node "' + claudeHelper + '" send codex:' + threadId + ' native-proof ' + marker + ' --native';
      claude.stdin.write(JSON.stringify({type: 'user', session_id: sessionId, message: {role: 'user', content:
        'This is an authorized native round-trip test. Use the installed session-messaging skill at ' + claudeSkill +
        '. Read the skill with Read if needed. Run only this helper command through Bash exactly once: ' + send +
        ' . Your own host environment binds your sender address. Do not modify the environment. If it returns an accepted native receipt, say ASM_REQUEST_SENT and wait. ' +
        'A later native cross-session message from that Codex recipient will contain an ASM_RETURN_ code unknown to you now. On receipt repeat only the exact code as your final answer. ' +
        'If it arrives before your first final answer, answer with the code immediately. Do not send a further acknowledgement. If sending fails or the result is unknown, report it and stop without retrying. Do not edit files, delegate, or run unrelated commands.'}}) + '\n');
      let receipt;
      try {
        receipt = await until(() => {
          const results = claudeEvents.filter(e => e.type === 'user').flatMap(e => e.message?.content ?? []).filter(c => c.type === 'tool_result');
          for (const result of results) {
            const text = typeof result.content === 'string' ? result.content : result.content?.map(c => c.text ?? '').join('\n');
            const value = jsonReceipt(text);
            if (value?.target === 'codex:' + threadId) return value;
          }
          const final = claudeEvents.find(e => e.type === 'result');
          if (final && !final.result?.includes('ASM_REQUEST_SENT') && !final.result?.includes(item.expected)) {
            throw new Error('Claude did not send: ' + (final.result ?? final.subtype));
          }
          if (claude.exitCode !== null) throw new Error('Claude sender exited before receipt: ' + claudeStderr);
        }, item.name + ' native send');
        assert.equal(receipt.state, 'accepted');
        assert.equal(receipt.transport, 'codex-native');
        assert.equal(receipt.replyTo, address);
        if (gate) {
          assert.equal(receipt.turnId, active.turn.id);
          assert.ok(!completed(active.turn.id), 'Delivery interrupted the open tool turn.');
          rpc.respond(gate.id, {success: true, contentItems: [{type: 'inputText', text: 'Gate released. Handle the native peer request now.'}]});
        }
        console.log(item.name + ': native receipt accepted; waiting for the return message.');
        const ack = await until(() => {
          const value = claudeEvents.find(e => e.type === 'result' && e.result?.trim() === item.expected);
          if (!value && claude.exitCode !== null) throw new Error('Claude exited before the native reply.');
          return value;
        }, item.name + ' Claude acknowledgement');
        await until(() => completed(receipt.turnId), item.name + ' Codex completion');
        assert.equal(ack.session_id, sessionId);
        assert.equal(completed(receipt.turnId).params.turn.status, 'completed');
        const outputs = events.slice(startIndex).filter(e => e.method === 'item/completed' && e.params?.turnId === receipt.turnId);
        const delegated = outputs.find(e => e.params.item?.type === 'functionCallOutput' && e.params.item.namespace === 'codex_app' && e.params.item.name === 'send_message_to_thread');
        assert.ok(delegated, 'Native request must persist as attributed tool output.');
        const sent = outputs.filter(e => e.params.item?.type === 'commandExecution').map(e => jsonReceipt(e.params.item.aggregatedOutput)).find(r => r?.target === address);
        assert.ok(sent, 'Codex must send with its installed helper.');
        assert.equal(sent.state, 'transport-written');
        assert.equal(sent.transport, 'claude-ipc');
        assert.equal(sent.replyTo, 'codex:' + threadId);
        report.tests.push({name: item.name, passed: true, source: address, target: 'codex:' + threadId,
          request: receipt, reply: sent, answer: ack.result, sameClaudeSession: true,
          representation: 'functionCallOutput', ...(gate ? {sameCodexTurn: true, toolInterrupted: false} : {})});
        console.log(item.name + ': complete native round-trip passed.');
      } finally {
        await stop(claude);
        lines.close();
      }
    }
    report.passed = true;
    return report;
  } catch (failure) {
    report.passed = false;
    report.error = failure.message;
    if (!threadId) report.listenerStartupLog = listenerLog;
    report.recentEventTypes = events.slice(-12).map(e => ({method: e.method, type: e.params?.item?.type}));
    report.codexLastAnswer = events.filter(e => e.method === 'item/completed' && e.params?.item?.type === 'agentMessage').at(-1)?.params.item.text;
    // Test transcripts have no credentials; preserve only narrowly relevant command failures.
    report.commandFailures = events.filter(e => e.method === 'item/completed' && e.params?.item?.type === 'commandExecution' && e.params.item.exitCode !== 0)
      .map(e => ({command: e.params.item.command, output: e.params.item.aggregatedOutput})).slice(-3);
    failure.proof = report;
    throw failure;
  } finally {
    if (rpc && threadId) {
      const turn = events.filter(e => e.method === 'turn/started').at(-1)?.params?.turn?.id;
      if (turn && !completed(turn)) await rpc.call('turn/interrupt', {threadId, turnId: turn}).catch(() => {});
      await rpc.call('thread/unsubscribe', {threadId}).catch(() => {});
    }
    await rpc?.close();
    for (const child of children.reverse()) await stop(child);
    for (const file of authCopies) await unlink(file);
  }
}

