import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { BrokerClient } from './client.js';
import { loadBroker } from './config.js';
import { BridgeError } from './protocol.js';
import { StateError, stateFileError } from './state-error.js';

const pending = new Map<string, Promise<{url: string; token: string}>>();
export interface AutostartOptions { brokerScript: string; timeoutMs?: number; idleTimeoutMs?: number }

/** Discovery and startup only: never retries non-idempotent application requests. */
export function ensureBroker(directory: string, options: AutostartOptions): Promise<{url: string; token: string}> {
  const key = resolve(directory);
  const existing = pending.get(key);
  if (existing) return existing;
  const starting = start(key, options).finally(() => { pending.delete(key); });
  pending.set(key, starting);
  return starting;
}

async function discover(directory: string) {
  let config;
  try { config = await loadBroker(directory); }
  catch (error) {
    if (error instanceof StateError && error.code === 'DESCRIPTOR_MISSING') return undefined;
    throw error;
  }
  try {
    await new BrokerClient(config.url, config.token, {provider: 'test', workspace: directory}, 700).health();
    return config;
  } catch (error) {
    if (error instanceof BridgeError && error.code === 'SHUTTING_DOWN') return undefined;
    if (error instanceof BridgeError) throw error;
    if (!(error instanceof TypeError) && !(error instanceof DOMException)) throw error;
    return undefined;
  }
}

async function spawnBroker(directory: string, options: AutostartOptions) {
  const child = spawn(process.execPath, [
    resolve(options.brokerScript), 'broker', '--data-dir', directory, '--port', '0',
    '--idle-timeout-ms', String(options.idleTimeoutMs ?? 300_000), '--background',
  ], {cwd: directory, detached: true, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe']});
  let stderr = '';
  let closed = false;
  child.stderr!.setEncoding('utf8');
  child.stderr!.on('data', chunk => { stderr = (stderr + chunk).slice(-8192); });
  child.once('close', () => { closed = true; });
  await new Promise<void>((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', () => reject(new StateError('BROKER_SPAWN_FAILED',
      'Could not start the bundled broker.', 'Check Node.js and the installed broker.cjs path.')));
  });
  child.unref();
  return {
    child, closed: () => closed,
    dispose: () => child.stderr!.destroy(),
    failure: () => {
      for (const line of stderr.split(/\r?\n/).reverse()) {
        try {
          const value = JSON.parse(line).error;
          if (typeof value?.code === 'string' && typeof value.message === 'string') {
            return new StateError(value.code, value.message, value.remedy ?? 'Run the bundled doctor command.');
          }
        } catch { /* Node warnings are not startup reports. */ }
      }
      return new StateError('BROKER_START_FAILED', 'Broker exited before becoming ready.',
        'Run the bundled broker command in a terminal and check Node.js >=22.16 and broker.log.');
    },
  };
}

async function start(directory: string, options: AutostartOptions) {
  const running = await discover(directory);
  if (running) return running;
  try { await mkdir(directory, {recursive: true, mode: 0o700}); }
  catch (error) { stateFileError(error, directory, 'DATA_DIRECTORY_MISSING'); }
  let attempt = await spawnBroker(directory, options);
  let attempts = 1;
  let lastSpawn = Date.now();
  const deadline = Date.now() + (options.timeoutMs ?? 15_000);
  try {
    while (Date.now() < deadline) {
      const config = await discover(directory);
      if (config) return config;
      if (attempt.closed()) {
        const error = attempt.failure();
        if (error.code !== 'BROKER_BUSY') throw error;
        if (attempts < 3 && Date.now() - lastSpawn >= 500) {
          attempt.dispose();
          attempt = await spawnBroker(directory, options);
          attempts++;
          lastSpawn = Date.now();
        }
      }
      await delay(100);
    }
    throw new StateError('BROKER_START_TIMEOUT', 'Broker startup timed out.',
      'Run doctor to inspect the owner and broker.log. Do not remove a live broker lock.');
  } finally { attempt.dispose(); }
}
