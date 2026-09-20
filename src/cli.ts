import { parseArgs } from 'node:util';
import { join, resolve } from 'node:path';
import { startBroker } from './broker.js';
import { BrokerClient } from './client.js';
import { acquireBrokerOwner } from './broker-owner.js';
import { dataDirectory, initializeData, loadBroker, readDescriptor, writeDescriptor } from './config.js';
import { diagnose } from './diagnostics.js';
import { readRetention } from './retention.js';
import { RotatingLog } from './rotating-log.js';
import { errorDetails, StateError } from './state-error.js';

async function main(): Promise<void> {
  const {values, positionals} = parseArgs({allowPositionals: true, options: {
    'data-dir': {type: 'string'}, port: {type: 'string'}, 'idle-timeout-ms': {type: 'string'},
    apply: {type: 'boolean'}, background: {type: 'boolean'},
  }});
  const directory = values['data-dir'] ? resolve(values['data-dir']) : dataDirectory();
  if (positionals[0] === 'doctor') {
    const report = await diagnose(directory);
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.status === 'attention' ? 1 : 0;
    return;
  }
  if (positionals[0] === 'stop' || positionals[0] === 'prune') {
    const config = await loadBroker(directory);
    const client = new BrokerClient(config.url, config.token, {provider: 'test', workspace: directory});
    const health = await client.health(positionals[0] === 'stop');
    if (typeof health.instanceId !== 'string') throw new StateError('LEGACY_BROKER', 'This older broker has no instance ID.', 'Stop it in its original terminal.');
    if (positionals[0] === 'stop') {
      await client.shutdown(health.instanceId);
      console.log('Broker shutdown requested. Open sessions may restart it on their next call.');
    } else {
      console.log(JSON.stringify(await client.maintenance(health.instanceId, !values.apply), null, 2));
    }
    return;
  }
  if (positionals[0] !== 'broker') throw new StateError('INVALID_ARGUMENTS', 'Unknown or missing command.', 'Usage: broker|doctor|stop|prune [--apply] [--data-dir PATH] [--port PORT] [--idle-timeout-ms MS]');
  const port = Number(values.port ?? '43127');
  const idleTimeoutMs = Number(values['idle-timeout-ms'] ?? '0');
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new StateError('INVALID_ARGUMENTS', 'Invalid port.', 'Use an integer port between 0 and 65535.');
  if (!Number.isInteger(idleTimeoutMs) || idleTimeoutMs < 0 || (idleTimeoutMs > 0 && idleTimeoutMs < 1000)) throw new StateError('INVALID_ARGUMENTS', 'Invalid idle timeout.', 'Use 0 or an integer >=1000 milliseconds.');
  // Validate policy before acquiring/writing ownership state.
  const retention = await readRetention(directory);
  try { await readDescriptor(directory); }
  catch (error) { if (!(error instanceof StateError) || error.code !== 'DESCRIPTOR_MISSING') throw error; }
  const owner = await acquireBrokerOwner(directory);
  let broker: Awaited<ReturnType<typeof startBroker>> | undefined;
  let log: RotatingLog | undefined;
  let logFailure = false;
  // Log failure must not crash message processing or prevent owner release.
  const record = (level: 'info' | 'error', event: string, detail = '') => {
    try { log?.write(level, event, detail); } catch { logFailure = true; }
  };
  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    try { await broker?.close(); record('info', 'stopped'); }
    finally { await owner.release(); }
  };
  const requestShutdown = () => { void shutdown().catch(() => { process.exitCode = 1; }); };
  try {
    try { log = new RotatingLog(directory); }
    catch { throw new StateError('LOG_IO_ERROR', 'Cannot initialize broker logs.', 'Check log file permissions and available disk space.'); }
    const token = await initializeData(directory);
    broker = await startBroker({
      dbPath: join(directory, 'mail.sqlite'), token, port, instanceId: owner.instanceId,
      idleTimeoutMs, onShutdown: requestShutdown, retention, log: record, runtimeIssues: () => logFailure ? ['LOG_IO_ERROR'] : [],
    });
    await writeDescriptor(directory, broker.url);
    record('info', 'ready', owner.instanceId);
  } catch (error) {
    record('error', 'startup_failed', errorDetails(error).code);
    await shutdown();
    throw error;
  }
  if (!values.background) console.log(JSON.stringify({broker: broker.url, instanceId: owner.instanceId, dataDirectory: directory, delivery: 'pull-only', idleTimeoutMs}));
  process.once('SIGINT', requestShutdown);
  process.once('SIGTERM', requestShutdown);
}
main().catch(error => { console.error(JSON.stringify({error: errorDetails(error)})); process.exitCode = 1; });
