import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, cp, readFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';

test('Codex package setup resolves its own installed path and runtime from an unrelated working directory', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'asm-setup-ü spaced-'));
  try {
    const target = join(directory, 'agent-session-messaging');
    await cp(resolve('plugins/codex/agent-session-messaging'), target, {recursive: true});
    execFileSync(process.execPath, [join(target, 'setup.cjs')], {cwd: tmpdir(), stdio: 'pipe'});
    const config = JSON.parse(await readFile(join(target, '.mcp.json'), 'utf8')).mcpServers['session-messaging'];
    assert.equal(config.command, process.execPath);
    assert.deepEqual(config.args, [join(target, 'dist/mcp.cjs'), '--provider', 'codex']);
    assert.ok(config.env_vars.includes('LOCALAPPDATA'));
    assert.ok(config.env_vars.includes('BRIDGE_WORKSPACE'));
    assert.equal(config.cwd, undefined, 'The adapter must retain the host project working directory.');
    assert.ok(!JSON.stringify(config).includes(resolve('plugins/codex')));
  } finally {
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep + 'asm-setup-'));
    await rm(directory, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
  }
});
