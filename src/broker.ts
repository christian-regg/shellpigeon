import { createServer, type IncomingMessage } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { once } from 'node:events';
import { ZodError, z } from 'zod';
import { BridgeError, PROTOCOL_VERSION, VERSION, contextSchema } from './protocol.js';
import { DEFAULT_RETENTION, DATABASE_VERSION, type RetentionPolicy } from './retention.js';
import { Store } from './store.js';

const requestSchema = z.object({method: z.string(), input: z.unknown(), context: contextSchema}).strict();
async function readBody(request: IncomingMessage): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 65536) throw new BridgeError('BODY_TOO_LARGE', 'Request exceeds 64 KiB.', 413);
    chunks.push(Buffer.from(chunk));
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new BridgeError('INVALID_JSON', 'Expected a JSON request.'); }
}

export async function startBroker(options: {dbPath: string; token: string; port?: number; instanceId?: string; idleTimeoutMs?: number; onShutdown?: () => void; retention?: RetentionPolicy; maintenanceIntervalMs?: number; runtimeIssues?: () => string[]; log?: (level: 'info' | 'error', event: string, detail?: string) => void}) {
  if (!/^[a-f0-9]{64}$/.test(options.token)) throw new Error('Broker token must be 32 random bytes encoded as hex.');
  const retention = options.retention ?? DEFAULT_RETENTION;
  const store = new Store(options.dbPath, Date.now, retention);
  const expected = Buffer.from(`Bearer ${options.token}`);
  let lastRequest = Date.now();
  let shuttingDown = false;
  const requestShutdown = () => {
    if (shuttingDown || !options.onShutdown) return;
    shuttingDown = true;
    setImmediate(options.onShutdown);
  };
  const server = createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    const respond = (status: number, data: unknown) => { res.writeHead(status); res.end(JSON.stringify(data)); };
    try {
      if (req.headers.origin) throw new BridgeError('ORIGIN_REJECTED', 'Browser origins are not accepted.', 403);
      const host = req.headers.host?.split(':')[0];
      if (host !== '127.0.0.1' && host !== 'localhost') throw new BridgeError('HOST_REJECTED', 'Use a loopback host.', 403);
      const actual = Buffer.from(req.headers.authorization ?? '');
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
        throw new BridgeError('UNAUTHORIZED', 'Broker authentication required.', 401);
      }
      if (shuttingDown) throw new BridgeError('SHUTTING_DOWN', 'Broker is shutting down.', 503);
      lastRequest = Date.now();
      if (req.method === 'GET' && req.url === '/health') {
        respond(200, {version: VERSION, protocolVersion: PROTOCOL_VERSION, delivery: 'pull-only', instanceId: options.instanceId, idleTimeoutMs: options.idleTimeoutMs ?? 0, schemaVersion: DATABASE_VERSION, retention, runtimeIssues: options.runtimeIssues?.() ?? []});
      } else if (req.method === 'POST' && req.url === '/shutdown' && options.onShutdown) {
        const input = z.object({instanceId: z.string().uuid()}).strict().parse(await readBody(req));
        if (input.instanceId !== options.instanceId) throw new BridgeError('WRONG_INSTANCE', 'Broker instance changed.', 409);
        respond(200, {stopping: true});
        requestShutdown();
      } else if (req.method === 'POST' && req.url === '/maintenance' && options.instanceId) {
        const input = z.object({instanceId: z.string().uuid(), dryRun: z.boolean()}).strict().parse(await readBody(req));
        if (input.instanceId !== options.instanceId) throw new BridgeError('WRONG_INSTANCE', 'Broker instance changed.', 409);
        const result = store.maintenance(input.dryRun);
        if (!input.dryRun) options.log?.('info', 'maintenance', JSON.stringify(result.applied));
        respond(200, result);
      } else if (req.method === 'POST' && req.url === '/rpc') {
        if (!req.headers['content-type']?.startsWith('application/json')) {
          throw new BridgeError('CONTENT_TYPE', 'Use application/json.', 415);
        }
        const {method, input, context} = requestSchema.parse(await readBody(req));
        respond(200, {result: store.call(method, input, context)});
      } else respond(404, {error: {code: 'NOT_FOUND', message: 'Unknown endpoint.'}});
    } catch (error) {
      if (error instanceof BridgeError) respond(error.status, {error: {code: error.code, message: error.message}});
      else if (error instanceof ZodError) respond(400, {error: {code: 'INVALID_INPUT', message: 'Invalid request arguments.'}});
      else {
        // Never log request bodies or authentication material.
        options.log?.('error', 'request_failed', error instanceof Error ? error.name : 'unknown');
        respond(500, {error: {code: 'INTERNAL', message: 'Internal broker error.'}});
      }
    }
  });
  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  try {
    server.listen(options.port ?? 0, '127.0.0.1');
    await once(server, 'listening');
  } catch (error) { store.close(); throw error; }
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No broker address.');
  const idleTimer = options.idleTimeoutMs && options.onShutdown ? setInterval(() => {
    if (Date.now() - lastRequest >= options.idleTimeoutMs!) requestShutdown();
  }, Math.min(options.idleTimeoutMs, 1000)) : undefined;
  idleTimer?.unref();
  const maintenanceTimer = retention.mode === 'automatic' ? setInterval(() => {
    try {
      const result = store.maintenance(false);
      if (result.applied.redacted || result.applied.deleted) options.log?.('info', 'maintenance', JSON.stringify(result.applied));
    } catch { options.log?.('error', 'maintenance_failed'); }
  }, options.maintenanceIntervalMs ?? 60_000) : undefined;
  maintenanceTimer?.unref();
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: async () => {
      clearInterval(idleTimer);
      clearInterval(maintenanceTimer);
      await new Promise<void>((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
        server.closeIdleConnections();
      });
      store.close();
    },
  };
}
