import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { dataDirectory, workspaceDirectory } from '../build/src/config.js';
import { BrokerClient } from '../build/src/client.js';
import { ensureBroker } from '../build/src/autostart.js';
import { resolveHostCommand } from '../build/src/host-command.js';

async function main() {
  const host = process.argv[2];
  if (host !== 'claude' && host !== 'codex') throw new Error('Usage: node scripts/launch-session.mjs claude|codex [host arguments]');
  const command = await resolveHostCommand(host);
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const directory = dataDirectory();
  const workspace = await workspaceDirectory();
  const {url, token} = await ensureBroker(directory, {brokerScript: resolve(root, 'plugins', host, 'agent-session-messaging/dist/broker.cjs')});
  await new BrokerClient(url, token, {provider: host === 'claude' ? 'claude-code' : 'codex', workspace}).health();
  const env = {...process.env, BRIDGE_DATA_DIR: directory, BRIDGE_WORKSPACE: workspace};
  let args;
  if (host === 'claude') {
    args = ['--plugin-dir', resolve(root, 'plugins/claude/agent-session-messaging')];
  } else {
    // Values are TOML string literals in argv, never shell commands.
    const config = 'mcp_servers.session_messaging={command=' + JSON.stringify(process.execPath) +
      ',args=[' + JSON.stringify(resolve(root, 'plugins/codex/agent-session-messaging/dist/mcp.cjs')) +
      ',"--provider","codex"],env={BRIDGE_DATA_DIR=' + JSON.stringify(directory) +
      ',BRIDGE_WORKSPACE=' + JSON.stringify(workspace) + '}}';
    args = ['-c', config];
  }
  const child = spawn(command.file, [...command.args, ...args, ...process.argv.slice(3)], {
    cwd: workspace, env, stdio: 'inherit', windowsHide: true,
  });
  child.once('error', error => { console.error('Could not start ' + command.file + ': ' + error.message); process.exitCode = 1; });
  child.once('exit', code => { process.exitCode = code ?? 1; });
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
