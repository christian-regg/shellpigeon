import {readFile, realpath, lstat} from 'node:fs/promises';
import {resolve, join, relative, isAbsolute, sep} from 'node:path';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {resolveHostCommand} from './host-command.js';

const execute = promisify(execFile);
export const distributionMarketplace = 'agent-session-messaging';
const plugin = 'agent-session-messaging';
type Host = 'claude' | 'codex';
export interface Release {name: string; version: string; files: Record<string, string>}
export function releasePath(root: string, path: string) {
  if (!path || path.includes('\\') || path.includes(':') || path.split('/').some(p => !p || p === '.' || p === '..')) throw new Error('Invalid release path.');
  const full = resolve(root, path);
  const suffix = relative(resolve(root), full);
  if (!suffix || suffix.startsWith('..' + sep) || isAbsolute(suffix)) throw new Error('Release path escaped its root.');
  return full;
}
export async function verifyRelease(root: string): Promise<Release> {
  const release: Release = JSON.parse(await readFile(join(root, 'release.json'), 'utf8'));
  if (release.name !== plugin || !/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(release.version) || !release.files || typeof release.files !== 'object') throw new Error('Invalid release metadata.');
  for (const file of ['install.cjs','INSTALL.md','codex-marketplace/.agents/plugins/marketplace.json','claude-marketplace/.claude-plugin/marketplace.json',
    'codex-marketplace/plugins/agent-session-messaging/setup.cjs','codex-marketplace/plugins/agent-session-messaging/dist/peer.cjs',
    'claude-marketplace/plugins/agent-session-messaging/dist/peer.cjs']) {
    if (!release.files[file]) throw new Error('Incomplete release: ' + file);
  }
  const canonical = await realpath(root);
  for (const [path, expected] of Object.entries(release.files)) {
    const full = releasePath(root, path);
    const info = await lstat(full);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error('Not a regular release file: ' + path);
    const actualPath = await realpath(full);
    const suffix = relative(canonical, actualPath);
    if (suffix.startsWith('..' + sep) || isAbsolute(suffix)) throw new Error('Release file is outside package: ' + path);
    // setup.cjs rewrites this generated local configuration. It is always regenerated before installation.
    if (path === 'codex-marketplace/plugins/agent-session-messaging/.mcp.json') continue;
    if (!/^[a-f0-9]{64}$/.test(expected) || createHash('sha256').update(await readFile(full)).digest('hex') !== expected) throw new Error('Release checksum mismatch: ' + path);
  }
  return release;
}
export function selectHosts(host: string): Host[] {
  if (!['both','claude','codex'].includes(host)) throw new Error('Use --host both, claude or codex.');
  return host === 'both' ? ['codex','claude'] : [host as Host];
}
function samePath(a: string, b: string) {
  const normalize = (value: string) => process.platform === 'win32' ? resolve(value).replace(/^\\\\\?\\/, '').toLowerCase() : resolve(value);
  return normalize(a) === normalize(b);
}
export function checkInventory(host: Host, root: string, marketplaces: any[], installed: any[]) {
  const id = plugin + '@' + distributionMarketplace;
  const market = marketplaces.find(p => p.name === distributionMarketplace);
  if (market && !samePath(market.root ?? market.path ?? '', root)) throw new Error(host + ': marketplace name is already bound to a different directory. Keep the original installation directory or explicitly remove that marketplace first.');
  const foreign = installed.find(p => (p.name === plugin || (p.id ?? p.pluginId ?? '').startsWith(plugin + '@')) && (p.pluginId ?? p.id) !== id);
  if (foreign) throw new Error(host + ': this plugin is already installed from another marketplace. Explicitly migrate that installation first; no duplicate was installed.');
  const current = installed.find(p => (p.pluginId ?? p.id) === id);
  return {market, current};
}
export async function installRelease(root: string, options: {host: string; check?: boolean; uninstall?: boolean}) {
  if (!['win32', 'linux'].includes(process.platform)) throw new Error('This preview supports Windows and Linux only.');
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major! < 22 || (major === 22 && minor! < 16)) throw new Error('Node.js 22.16 or newer is required.');
  if (options.check && options.uninstall) throw new Error('Choose --check or --uninstall.');
  const hosts = selectHosts(options.host);
  const release = await verifyRelease(root);
  const commands = new Map<Host, Awaited<ReturnType<typeof resolveHostCommand>>>();
  const plans = [];
  async function run(file: string, args: string[]) {return (await execute(file, args, {windowsHide: true, timeout: 60_000, maxBuffer: 2_000_000})).stdout.trim();}
  async function cli(host: Host, args: string[]) {const command = commands.get(host)!;return run(command.file, [...command.args, ...args]);}
  // Complete both preflights before any installation or configuration writes.
  for (const host of hosts) {
    commands.set(host, await resolveHostCommand(host));
    const version = await cli(host, ['--version']);
    const match = version.match(/\b(\d+)\.(\d+)\.(\d+)\b/);
    const minimum = host === 'codex' ? [0,154,0] : [2,1,278];
    const actual = match?.slice(1).map(Number);
    const older = !actual || actual.reduce((r, n, i) => r || Math.sign(n - minimum[i]!), 0) < 0;
    if (older) throw new Error(host + ': this preview requires at least ' + minimum.join('.') + '; found ' + version);
    const marketList = JSON.parse(await cli(host, ['plugin','marketplace','list','--json']));
    const pluginList = JSON.parse(await cli(host, ['plugin','list','--json']));
    const marketplaceRoot = join(root, host + '-marketplace');
    const state = checkInventory(host, marketplaceRoot, host === 'codex' ? marketList.marketplaces : marketList, host === 'codex' ? pluginList.installed : pluginList);
    plans.push({host, version, marketplaceRoot, registered: Boolean(state.market), installed: Boolean(state.current), previousVersion: state.current?.version ?? null});
  }
  if (options.check) return {mode:'check', version:release.version, plans};
  const completed: string[] = [];
  try {
    for (const plan of plans) {
      const {host} = plan;
      const id = plugin + '@' + distributionMarketplace;
      if (options.uninstall) {
        if (plan.installed) await cli(host, host === 'codex' ? ['plugin','remove',id,'--json'] : ['plugin','uninstall',id,'--scope','user','--keep-data','--json']);
        completed.push(host);
        continue;
      }
      if (host === 'codex') await run(process.execPath, [join(plan.marketplaceRoot,'plugins',plugin,'setup.cjs')]);
      if (!plan.registered) await cli(host, ['plugin','marketplace','add',plan.marketplaceRoot,...(host === 'codex' ? ['--json'] : ['--scope','user'])]);
      await cli(host, host === 'codex' ? ['plugin','add',id,'--json'] : ['plugin',plan.installed ? 'update' : 'install',id,'--scope','user','--json']);
      const inventory = JSON.parse(await cli(host, ['plugin','list','--json']));
      const installed = (host === 'codex' ? inventory.installed : inventory).find((p: any) => (p.pluginId ?? p.id) === id);
      if (!installed?.enabled || installed.version !== release.version) throw new Error(host + ': installation did not report the expected enabled version.');
      completed.push(host);
    }
  } catch (error) {
    throw new Error('Completed hosts: ' + (completed.join(', ') || 'none') + '. ' + (error as Error).message + ' Rerun the same command after fixing the cause.');
  }
  return {mode:options.uninstall ? 'uninstalled' : 'installed', version:release.version, completed,
    next:options.uninstall ? 'Plugin data and marketplace files were retained.' : 'Restart the selected CLIs to load the new plugin. Keep this directory in place.'};
}
