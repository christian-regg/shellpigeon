import { StateError } from './state-error.js';
import { BridgeError, PROTOCOL_VERSION, type CallerContext, type Method } from './protocol.js';

export class BrokerClient {
  private url: URL;
  constructor(url: string, private token: string, private context: CallerContext, private timeoutMs = 5000) {
    this.url = new URL(url);
    if (this.url.protocol !== 'http:' || this.url.hostname !== '127.0.0.1' ||
      this.url.username || this.url.password || this.url.pathname !== '/' || this.url.search || this.url.hash) {
      throw new Error('Prototype broker URL must be http://127.0.0.1:<port>.');
    }
  }

  private async request(path: string, body?: unknown): Promise<Record<string, unknown>> {
    const response = await fetch(new URL(path, this.url), {
      method: body ? 'POST' : 'GET',
      headers: {'Authorization': `Bearer ${this.token}`, 'Content-Type': 'application/json'},
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(this.timeoutMs),
      redirect: 'error',
    });
    const data = await response.json() as {error?: {code: string; message: string}} & Record<string, unknown>;
    if (!response.ok) throw new BridgeError(data.error?.code ?? 'HTTP_ERROR', data.error?.message ?? 'Broker request failed.', response.status);
    return data;
  }

  async health(acceptLegacy = false): Promise<Record<string, unknown>> {
    const data = await this.request('/health');
    if (data.protocolVersion !== PROTOCOL_VERSION && !(acceptLegacy && data.protocolVersion === 1)) {
      throw new StateError('PROTOCOL_MISMATCH', 'Incompatible broker protocol version.',
        'Update both plugins, stop the old broker with the bundled stop command and reopen the sessions.');
    }
    return data;
  }

  async shutdown(instanceId: string): Promise<void> {
    await this.request('/shutdown', {instanceId});
  }

  async maintenance(instanceId: string, dryRun = true): Promise<Record<string, unknown>> {
    return this.request('/maintenance', {instanceId, dryRun});
  }

  async call(method: Method, input: unknown): Promise<Record<string, unknown>> {
    const data = await this.request('/rpc', {method, input, context: this.context});
    return data.result as Record<string, unknown>;
  }
}
