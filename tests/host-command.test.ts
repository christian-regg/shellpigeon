import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, rm, realpath, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { resolveHostCommand } from '../src/host-command.js';
import { initializeData, writeDescriptor } from '../src/config.js';
import { startBroker } from '../src/broker.js';

const execute = promisify(execFile);
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'asm-launch-test-ü & spaced-'));
  const npm = join(directory, 'npm');
  const native = join(directory, 'native');
  await mkdir(native);
  const entry = join(npm, 'node_modules/@openai/codex/bin/codex.js');
  await mkdir(join(entry, '..'), {recursive: true});
  await writeFile(entry, 'console.log(JSON.stringify({args: process.argv.slice(2), cwd: process.cwd(), workspace: process.env.BRIDGE_WORKSPACE}));\n');
  await writeFile(join(npm, 'codex.cmd'), '@echo off\r\nnode "%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js" %*\r\n');
  await writeFile(join(npm, 'codex.ps1'), '& node "$basedir/node_modules/@openai/codex/bin/codex.js" $args\n');
  await writeFile(join(native, 'codex.exe'), '');
  return {directory, npm, native, entry};
}
async function cleanup(directory: string) {
  assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep + 'asm-launch-test-'));
  await rm(directory, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
}

test('Windows resolver supports npm-only PATH and preserves literal argv through the npm entry point', async () => {
  const f = await fixture();
  try {
    const command = await resolveHostCommand('codex', {platform: 'win32', env: {Path: f.npm}});
    assert.equal(command.file, process.execPath);
    const args = ['-c', 'mcp_servers.x={command="C:\\ü path\\node.exe",args=["a&b","%TEMP%","$(literal)"]}'];
    const {stdout} = await execute(command.file, [...command.args, ...args]);
    assert.deepEqual(JSON.parse(stdout).args, args);
    const firstOnPath = await resolveHostCommand('codex', {
      platform: 'win32', env: {PATH: f.npm + ';' + f.native},
    });
    assert.deepEqual(firstOnPath, command);
    const nativeFirst = await resolveHostCommand('codex', {
      platform: 'win32', env: {PATH: f.native + ';' + f.npm},
    });
    assert.equal(nativeFirst.file, join(f.native, 'codex.exe'));
    const ps1 = await resolveHostCommand('codex', {
      platform: 'win32', env: {CODEX_BIN: join(f.npm, 'codex.ps1')},
    });
    assert.deepEqual(ps1, command);
  } finally { await cleanup(f.directory); }
});

test('explicit host overrides are honored and missing or unsupported launchers give actionable errors', async () => {
  const f = await fixture();
  try {
    const native = await resolveHostCommand('codex', {
      platform: 'win32', env: {CODEX_BIN: join(f.native, 'codex.exe'), PATH: f.npm},
    });
    assert.equal(native.file, join(f.native, 'codex.exe'));
    const js = await resolveHostCommand('claude', {env: {CLAUDE_BIN: f.entry}});
    assert.deepEqual(js, {file: process.execPath, args: [f.entry]});
    await assert.rejects(resolveHostCommand('codex', {platform: 'win32', env: {PATH: ''}}), /Could not find codex on PATH.*CODEX_BIN/);
    await assert.rejects(resolveHostCommand('codex', {
      platform: 'win32', env: {CODEX_BIN: join(f.directory, 'missing.exe'), PATH: f.npm},
    }), /from CODEX_BIN/);
    const custom = join(f.directory, 'custom.cmd');
    await writeFile(custom, '@echo custom wrapper');
    await assert.rejects(resolveHostCommand('codex', {
      platform: 'win32', env: {CODEX_BIN: custom},
    }), /Unsupported launcher.*CODEX_BIN/);
  } finally { await cleanup(f.directory); }
});

test('actual session launcher finds a Windows npm shim and passes MCP configuration intact', {
  skip: process.platform !== 'win32', timeout: 15_000,
}, async () => {
  const f = await fixture();
  const token = await initializeData(f.directory);
  const broker = await startBroker({dbPath: join(f.directory, 'mail.sqlite'), token});
  try {
    await writeDescriptor(f.directory, broker.url);
    // Remove the desktop app's PATH additions and inherited overrides.
    const env = Object.fromEntries(Object.entries(process.env).filter(([name]) =>
      !['PATH', 'CODEX_BIN', 'BRIDGE_DATA_DIR', 'BRIDGE_WORKSPACE'].includes(name.toUpperCase())));
    const workspace = join(f.directory, 'workspace');
    const alias = join(f.directory, 'workspace-alias');
    await mkdir(workspace);
    await symlink(workspace, alias, 'junction');
    // Windows CI can return an 8.3 TEMP path; the launcher resolves real paths.
    // A junction exercises that distinction even without an abbreviated TEMP.
    for (const inputWorkspace of [f.directory, alias]) {
      const expectedWorkspace = (await realpath(inputWorkspace)).toLowerCase();
      Object.assign(env, {PATH: f.npm, BRIDGE_DATA_DIR: f.directory, BRIDGE_WORKSPACE: inputWorkspace});
      const {stdout} = await execute(process.execPath, [resolve('scripts/launch-session.mjs'), 'codex', '--version'], {
        env, timeout: 10_000,
      });
      const result = JSON.parse(stdout);
      assert.equal(result.args.length, 3);
      assert.equal(result.args[0], '-c');
      assert.match(result.args[1], /^mcp_servers\.session_messaging=\{/);
      assert.ok(result.args[1].includes('"--provider","codex"'));
      assert.ok(result.args[1].includes('BRIDGE_WORKSPACE=' + JSON.stringify(expectedWorkspace)));
      assert.equal(result.args[2], '--version');
      assert.equal(result.workspace, expectedWorkspace);
      assert.equal(result.cwd.toLowerCase(), result.workspace);
    }
  } finally {
    await broker.close();
    await cleanup(f.directory);
  }
});
