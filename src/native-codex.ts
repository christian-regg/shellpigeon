import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface, type Interface } from 'node:readline';
import { EventEmitter } from 'node:events';
import { Duplex } from 'node:stream';
import { connect } from 'node:net';
import { join } from 'node:path';
import { homedir } from 'node:os';
import WebSocket from 'ws';
import { resolveHostCommand } from './host-command.js';

/** Local app-server transport; independent of the broker. Never retries a request. */
export class CodexRpc extends EventEmitter {
  private nextId = 1;
  private closed = false;
  private pending = new Map<number, {resolve: (value: any) => void; reject: (error: Error) => void; timer: NodeJS.Timeout}>();
  private stderr = '';
  private lines?: Interface;
  private socket?: WebSocket;
  private ready: Promise<void>;
  private child?: ChildProcessWithoutNullStreams;
  constructor(transport: ChildProcessWithoutNullStreams | {socketPath: string}, private timeout = 15_000, framing: 'jsonl' | 'websocket' = 'jsonl') {
    super();
    const child = 'socketPath' in transport ? undefined : transport;
    this.child = child;
    child?.stderr.on('data', data => { this.stderr = (this.stderr + data).slice(-2000); });
    child?.on('error', error => this.abort(error));
    child?.on('exit', code => this.abort(new Error('Codex transport exited (' + code + '): ' + this.stderr)));
    child?.stdin.on('error', error => this.abort(error));
    if ('socketPath' in transport || framing === 'websocket') {
      // The stock proxy tunnels raw bytes. The control socket expects a WebSocket handshake.
      const stream = 'socketPath' in transport ? connect({path: transport.socketPath})
        : Duplex.from({readable: child!.stdout, writable: child!.stdin});
      stream.on('error', error => this.abort(error));
      this.socket = new WebSocket('ws://localhost/', {
        createConnection: () => stream, handshakeTimeout: timeout, perMessageDeflate: false, maxPayload: 16 * 1024 * 1024,
      });
      this.ready = new Promise((resolve, reject) => {
        this.socket!.once('open', resolve);
        this.socket!.once('error', reject);
      });
      this.ready.catch(() => {}); // initialize/call still receives the original rejection.
      this.socket.on('message', data => this.receive(data.toString()));
      this.socket.on('error', error => this.abort(error));
      this.socket.on('close', () => this.abort(new Error('Codex WebSocket closed.')));
    } else {
      this.ready = Promise.resolve();
      this.lines = createInterface({input: child!.stdout});
      this.lines.on('line', line => this.receive(line));
    }
  }
  private receive(line: string) {
    let message;
    try { message = JSON.parse(line); } catch { return; }
    if (!message || typeof message !== 'object') return;
    // Server-initiated tool calls have independent IDs that can equal our request IDs.
    if (message.method) { this.emit('notification', message); return; }
    if (typeof message.id === 'number' && this.pending.has(message.id)) {
      const entry = this.pending.get(message.id)!;
      this.pending.delete(message.id);
      clearTimeout(entry.timer);
      if (message.error) entry.reject(new Error(JSON.stringify(message.error)));
      else entry.resolve(message.result);
    }
  }
  private write(message: unknown) {
    const data = JSON.stringify(message);
    if (this.socket) this.socket.send(data);
    else this.child!.stdin.write(data + '\n');
  }
  private abort(error: Error) {
    this.closed = true;
    for (const entry of this.pending.values()) { clearTimeout(entry.timer); entry.reject(error); }
    this.pending.clear();
  }
  async initialize() {
    const result = await this.call('initialize', {
      clientInfo: {name: 'agent-session-messaging', version: '0.5.0-preview.1'}, capabilities: {experimentalApi: true},
    });
    this.write({method: 'initialized'});
    return result;
  }
  async call(method: string, params: unknown = {}): Promise<any> {
    await this.ready;
    if (this.closed) throw new Error('Codex transport closed.');
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('Timeout: ' + method + '; delivery outcome may be unknown. Do not retry a send automatically.'));
      }, this.timeout);
      this.pending.set(id, {resolve, reject, timer});
      try { this.write({id, method, params}); }
      catch (error) {
        this.pending.delete(id); clearTimeout(timer); reject(error);
      }
    });
  }
  respond(id: string | number, result: unknown) {
    if (this.closed) throw new Error('Codex transport closed.');
    this.write({id, result});
  }
  async close() {
    this.abort(new Error('Codex transport closed.'));
    this.lines?.close();
    if (this.socket) this.socket.terminate();
    if (!this.child) return;
    this.child.stdin.end();
    if (this.child.exitCode !== null) return;
    await new Promise<void>(resolve => {
      const timer = setTimeout(() => { this.child!.kill(); resolve(); }, 1000);
      this.child!.once('exit', () => { clearTimeout(timer); resolve(); });
    });
  }
}

export async function connectCodex(options: {args?: string[]; env?: NodeJS.ProcessEnv; timeout?: number} = {}) {
  const args = options.args ?? ['app-server', 'proxy'];
  if (process.platform === 'linux' && args[0] === 'app-server' && args[1] === 'proxy') {
    const index = args.indexOf('--sock');
    const path = index >= 0 ? args[index + 1] : join(options.env?.CODEX_HOME ?? process.env.CODEX_HOME ?? join(homedir(), '.codex'), 'app-server-control', 'app-server-control.sock');
    if (!path?.startsWith('/') || path.includes('\0')) throw new Error('Codex requires an absolute local Unix socket path.');
    return new CodexRpc({socketPath: path}, options.timeout);
  }
  const command = await resolveHostCommand('codex', {env: options.env});
  return new CodexRpc(spawn(command.file, [...command.args, ...args], {
    cwd: process.cwd(), env: options.env ?? process.env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
  }), options.timeout, args.includes('proxy') ? 'websocket' : 'jsonl');
}

const xml = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
export function delegatedTurn(threadId: string, sourceThreadId: string, message: string) {
  if (![threadId, sourceThreadId, message].every(value => typeof value === 'string' && value.trim())) {
    throw new Error('Target, source and message must not be empty.');
  }
  return {threadId, input: [], toolOutput: {
    name: 'send_message_to_thread', namespace: 'codex_app',
    output: '<codex_delegation>\n  <source_thread_id>' + xml(sourceThreadId) +
      '</source_thread_id>\n  <input>' + xml(message) + '</input>\n</codex_delegation>',
  }};
}
