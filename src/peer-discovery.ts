import { readFile, readdir, lstat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { connectCodex } from './native-codex.js';
import { localProcesses, type ProcessRecord } from './peer-process.js';
export { windowsProcesses, localProcesses, type ProcessRecord } from './peer-process.js';

export const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type CodexSource = 'cli' | 'vscode' | 'exec' | 'appServer';
export interface Peer {
  provider: 'claude' | 'codex'; id: string; address: string; name: string | null; cwd: string;
  evidence: 'live-process' | 'loaded-thread' | 'writer-lock';
  transport: 'claude-ipc' | 'codex-native' | 'codex-queue';
  codexSource?: CodexSource;
  pid?: number; processStart?: string; socket?: string; registry?: string;
}
export interface CodexEndpoint {
  socket: string; state: 'reachable' | 'missing' | 'unavailable'; userPeers: number;
}
export interface Discovery { peers: Peer[]; diagnostics: string[]; codexEndpoints: CodexEndpoint[] }
export const codexHome = (env = process.env) => env.CODEX_HOME ?? join(homedir(), '.codex');
export const claudeHome = (env = process.env) => env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude');
export function sameDirectory(a: string, b: string) {
  const normalize = (p: string) => {
    const path = resolve(p.replace(/^\\\\\?\\/, ''));
    return process.platform === 'win32' ? path.toLowerCase() : path;
  };
  return normalize(a) === normalize(b);
}
export async function smallJson(path: string, limit = 32_768): Promise<any> {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size > limit) throw new Error('Invalid metadata file: ' + path);
  return JSON.parse(await readFile(path, 'utf8'));
}
async function names(path: string) {
  try { return await readdir(path); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
}
export function claudeRecord(record: any, processes: ProcessRecord[], registry: string, platform: NodeJS.Platform = process.platform): Peer | null {
  if (!record || !uuid.test(record.sessionId ?? '') || !Number.isSafeInteger(record.pid) || record.peerProtocol !== 1 ||
      typeof record.cwd !== 'string' || typeof record.procStart !== 'string') return null;
  const socket = record.messagingSocketPath;
  if (typeof socket !== 'string' || (platform === 'win32'
    ? !/^\\\\\.\\pipe\\(?:LOCAL\\)?cc-msg-[0-9a-f]{32}$/i.test(socket)
    : platform !== 'linux' || !socket.startsWith('/') || !socket.endsWith('.sock') || socket.includes('\0'))) return null;
  const live = processes.find(p => p.pid === record.pid && p.started === record.procStart &&
    (platform !== 'linux' || (typeof record.pidDomain === 'string' && p.pidDomain === record.pidDomain)) &&
    (p.name.toLowerCase() === (platform === 'win32' ? 'claude.exe' : 'claude') ||
      (platform === 'linux' && p.name === 'claude.exe') || /[/\\]@anthropic-ai[/\\]claude-code[/\\]/.test(p.command ?? '')));
  if (!live) return null;
  return {provider: 'claude', id: record.sessionId, address: 'claude:' + record.sessionId,
    name: typeof record.name === 'string' ? record.name : null, cwd: record.cwd,
    evidence: 'live-process', transport: 'claude-ipc', pid: record.pid, processStart: record.procStart,
    socket, registry};
}
export async function verifyClaudeSocket(peer: Peer) {
  if (process.platform !== 'linux') return;
  const [socket, registry] = await Promise.all([lstat(peer.socket!), lstat(peer.registry!)]);
  if (!socket.isSocket() || socket.isSymbolicLink() || socket.uid !== process.getuid!() || registry.uid !== socket.uid) {
    throw new Error('Claude endpoint is not a Unix socket owned by the current user.');
  }
}
export async function discoverClaude(processes: ProcessRecord[], env = process.env): Promise<Peer[]> {
  const directory = join(claudeHome(env), 'sessions');
  const peers: Peer[] = [];
  for (const name of await names(directory)) {
    if (!/^\d+\.json$/.test(name)) continue;
    const registry = join(directory, name);
    try {
      const record = await smallJson(registry);
      if (name !== record.pid + '.json') continue;
      const peer = claudeRecord(record, processes, registry);
      if (peer) { await verifyClaudeSocket(peer); peers.push(peer); }
    } catch { /* A disappearing or invalid record is not a peer. */ }
  }
  return peers;
}
function localAbsoluteSocket(path: string) {
  return isAbsolute(path) && (process.platform !== 'win32' || !path.startsWith('\\\\'));
}
export function controlSockets(processes: ProcessRecord[], env = process.env): string[] {
  const found = new Set([join(codexHome(env), 'app-server-control', 'app-server-control.sock')]);
  if (env.ASM_CODEX_SOCKET) {
    if (!localAbsoluteSocket(env.ASM_CODEX_SOCKET)) throw new Error('ASM_CODEX_SOCKET must be an absolute local path.');
    found.add(env.ASM_CODEX_SOCKET);
  }
  for (const p of processes) {
    if (!['codex.exe', 'codex'].includes(p.name.toLowerCase())) continue;
    if (p.argv) {
      for (let i = 1; i < p.argv.length; i++) {
        const argument = p.argv[i]!;
        const value = ['--listen', '--remote'].includes(argument) ? p.argv[++i] : /^(?:--listen|--remote)=(.*)$/.exec(argument)?.[1];
        if (value?.startsWith('unix://') && localAbsoluteSocket(value.slice(7))) found.add(value.slice(7));
      }
      continue;
    }
    const regex = /(?:^|\s)--(?:listen|remote)(?:=|\s+)(?:"(unix:\/\/[^"\r\n]+)"|(unix:\/\/\S+))/g;
    for (const match of (p.command ?? '').matchAll(regex)) {
      const path = (match[1] ?? match[2]!).slice('unix://'.length);
      if (localAbsoluteSocket(path)) found.add(path);
    }
  }
  // Windows command lines and environment overrides may spell the same path differently.
  return [...found].filter((path, index, paths) => paths.findIndex(other => sameDirectory(other, path)) === index);
}
export function userThread(source: unknown): source is CodexSource {
  return typeof source === 'string' && ['cli', 'vscode', 'exec', 'appServer'].includes(source);
}
/** source describes the host, not whether a thread belongs to a human. */
export function isCodexUserThread(thread: {
  source?: unknown; threadSource?: unknown; parentThreadId?: unknown; canAcceptDirectInput?: unknown;
}) {
  return userThread(thread.source) && (thread.threadSource == null || thread.threadSource === 'user') &&
    thread.parentThreadId == null && thread.canAcceptDirectInput !== false;
}
export async function discoverCodexSocket(socket: string, env = process.env): Promise<Peer[]> {
  const rpc = await connectCodex({args: ['app-server', 'proxy', '--sock', socket], env, timeout: 2500});
  try {
    await rpc.initialize();
    const peers: Peer[] = [];
    let cursor: string | undefined;
    const seen = new Set<string>();
    do {
      const response = await rpc.call('thread/loaded/list', {limit: 100, ...(cursor ? {cursor} : {})});
      if (!Array.isArray(response.data)) throw new Error('Invalid loaded-thread response.');
      for (const id of response.data) {
        if (typeof id !== 'string' || !uuid.test(id)) continue;
        const {thread} = await rpc.call('thread/read', {threadId: id, includeTurns: false});
        if (!thread || thread.id !== id || !isCodexUserThread(thread) || typeof thread.cwd !== 'string') continue;
        peers.push({provider: 'codex', id, address: 'codex:' + id, name: thread.name ?? null,
          cwd: thread.cwd, evidence: 'loaded-thread', transport: 'codex-native', socket, codexSource: userThread(thread.source) ? thread.source : undefined});
      }
      cursor = response.nextCursor ?? undefined;
      if (cursor && seen.has(cursor)) throw new Error('Repeated loaded-thread cursor.');
      if (cursor) seen.add(cursor);
    } while (cursor);
    return peers;
  } finally { await rpc.close(); }
}
export async function discoverCodexLocks(env = process.env): Promise<Peer[]> {
  const root = codexHome(env);
  const ids = (await names(join(root, 'thread-writer-locks'))).filter(n => uuid.test(n.replace(/\.lock$/, '')) && n.endsWith('.lock')).map(n => n.slice(0, -5));
  if (!ids.length) return [];
  const stores = (await names(root)).filter(n => /^state_\d+\.sqlite$/.test(n)).sort((a, b) => Number(b.match(/\d+/)![0]) - Number(a.match(/\d+/)![0]));
  if (!stores.length) return [];
  const db = new DatabaseSync(join(root, stores[0]!), {readOnly: true});
  try {
    const columns = db.prepare('PRAGMA table_info(threads)').all().map(row => row.name);
    const query = db.prepare('SELECT id,' + (columns.includes('name') ? 'name' : 'NULL AS name') +
      ',cwd,source,archived,' + (columns.includes('thread_source') ? 'thread_source' : 'NULL') + ' AS threadSource FROM threads WHERE id=?');
    const peers: Peer[] = [];
    for (const id of ids) {
      const row = query.get(id);
      if (!row || row.archived || !isCodexUserThread(row) || typeof row.cwd !== 'string') continue;
      peers.push({provider: 'codex', id, address: 'codex:' + id, name: typeof row.name === 'string' ? row.name : null,
        cwd: row.cwd, evidence: 'writer-lock', transport: 'codex-queue', codexSource: userThread(row.source) ? row.source : undefined});
    }
    return peers;
  } finally { db.close(); }
}
export async function discoverPeers(options: {all?: boolean; cwd?: string; env?: NodeJS.ProcessEnv; provider?: 'claude' | 'codex'} = {}): Promise<Discovery> {
  const env = options.env ?? process.env;
  const diagnostics: string[] = [];
  const codexEndpoints: CodexEndpoint[] = [];
  let processes: ProcessRecord[] = [];
  try { processes = await localProcesses(); } catch (error) { diagnostics.push('Process discovery: ' + (error as Error).message); }
  const peers: Peer[] = [];
  if (options.provider !== 'codex') {
    if (!['win32', 'linux'].includes(process.platform)) diagnostics.push('Claude process verification supports Windows and Linux only.');
    else peers.push(...await discoverClaude(processes, env));
  }
  if (options.provider !== 'claude') {
    for (const socket of controlSockets(processes, env)) {
      try {
        const nativePeers = await discoverCodexSocket(socket, env);
        peers.push(...nativePeers);
        codexEndpoints.push({socket, state: 'reachable', userPeers: nativePeers.length});
      } catch {
        let state: CodexEndpoint['state'] = 'unavailable';
        try { await lstat(socket); } catch (error) {
          if (['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) state = 'missing';
        }
        codexEndpoints.push({socket, state, userPeers: 0});
        diagnostics.push('Codex native endpoint ' + state + ': ' + socket);
      }
    }
    try {
      for (const peer of await discoverCodexLocks(env)) {
        if (!peers.some(p => p.address === peer.address)) peers.push(peer);
      }
    } catch (error) { diagnostics.push('Codex queue discovery: ' + (error as Error).message); }
  }
  return {peers: peers.filter(p => options.all || sameDirectory(p.cwd, options.cwd ?? process.cwd())), diagnostics, codexEndpoints};
}
export function exactPeer(peers: Peer[], target: string): Peer {
  const addresses = peers.filter(p => p.address === target || p.id === target);
  const matches = addresses.length ? addresses : peers.filter(p => p.name === target);
  if (matches.length !== 1) throw new Error(matches.length ? 'Ambiguous target; use an exact unique address.' : 'No discovered peer matches the exact target.');
  return matches[0]!;
}
export function sourcePeer(peers: Peer[], env = process.env): Peer {
  if (env.CLAUDE_CODE_MESSAGING_SOCKET) {
    const socket = env.CLAUDE_CODE_MESSAGING_SOCKET.replace(/^uds:/, '');
    const matches = peers.filter(p => p.provider === 'claude' && p.socket === socket);
    if (matches.length !== 1) throw new Error('Cannot bind this Claude process to one live return address.');
    return matches[0]!;
  }
  if (env.CODEX_THREAD_ID && uuid.test(env.CODEX_THREAD_ID)) return exactPeer(peers.filter(p => p.provider === 'codex'), env.CODEX_THREAD_ID);
  throw new Error('No native sender identity. Run the helper from a Claude or Codex session tool.');
}
