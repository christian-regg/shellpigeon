import { readFile, stat } from 'node:fs/promises';
import { atomicWrite } from './atomic-file.js';
import { dirname, join, resolve } from 'node:path';

/** One-time local installation step for Codex versions without MCP path interpolation. */
async function main() {
  const root = dirname(resolve(process.argv[1]!));
  const manifest = JSON.parse(await readFile(join(root, '.codex-plugin/plugin.json'), 'utf8'));
  if (manifest.name !== 'agent-session-messaging') throw new Error('Run the setup.cjs contained in the Codex plugin package.');
  const entry = join(root, 'dist/mcp.cjs');
  await stat(entry);
  await stat(join(root, 'dist/broker.cjs'));
  await atomicWrite(join(root, '.mcp.json'), JSON.stringify({
    mcpServers: {
      'session-messaging': {
        command: process.execPath,
        args: [entry, '--provider', 'codex'],
        env_vars: ['LOCALAPPDATA', 'USERPROFILE', 'HOME', 'BRIDGE_DATA_DIR', 'BRIDGE_WORKSPACE', 'BRIDGE_AUTOSTART'],
      },
    },
  }, null, 2) + '\n');
  console.log('Configured local Codex plugin at ' + root + '. Keep this directory; rerun setup if it moves.');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
