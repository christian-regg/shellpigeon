import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, readFile, lstat, rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join, resolve, sep} from 'node:path';

const setup = resolve('plugins/codex/agent-session-messaging/setup-listener.ps1');
async function cleanup(root: string) {
  assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep + 'asm-listener-test-'));
  await rm(root, {recursive: true, force: true});
}
test('listener setup defaults to preview and does not create a missing profile or installation', {skip: process.platform !== 'win32'}, async () => {
  const root = await mkdtemp(join(tmpdir(), 'asm-listener-test-'));
  const profile = join(root, 'new-profile');
  try {
    const result = execFileSync('powershell.exe', ['-NoProfile', '-File', setup], {
      env: {...process.env, CODEX_HOME: profile}, encoding: 'utf8', windowsHide: true, stdio: ['ignore','pipe','pipe'],
    });
    const plan = JSON.parse(result);
    assert.equal(plan.mode, 'preview');
    assert.equal(plan.standaloneInstallationNeeded, true);
    assert.equal(plan.automaticUpdaterRequested, false);
    assert.equal(plan.windowsAutostartRequested, false);
    assert.equal(plan.existingNpmInstallWillBeKept, true);
    await assert.rejects(lstat(profile), {code: 'ENOENT'});
  } finally { await cleanup(root); }
});
test('listener setup refuses existing remote-control mode before installation or settings changes', {skip: process.platform !== 'win32'}, async () => {
  const root = await mkdtemp(join(tmpdir(), 'asm-listener-test-'));
  try {
    const directory = join(root, 'app-server-daemon');
    await mkdir(directory);
    const settings = '{"remoteControlEnabled":true}\n';
    await writeFile(join(directory, 'settings.json'), settings);
    assert.throws(() => execFileSync('powershell.exe', ['-NoProfile', '-File', setup, '-Apply'], {
      env: {...process.env, CODEX_HOME: root}, encoding: 'utf8', windowsHide: true, stdio: ['ignore','pipe','pipe'],
    }), (error: any) => /Remote control is already enabled/.test(error.stderr));
    assert.equal(await readFile(join(directory, 'settings.json'), 'utf8'), settings);
    await assert.rejects(lstat(join(root, 'packages')), {code: 'ENOENT'});
    await assert.rejects(lstat(join(directory, 'app-server.pid')), {code: 'ENOENT'});
  } finally { await cleanup(root); }
});

