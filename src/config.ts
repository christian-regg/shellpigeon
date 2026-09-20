import { mkdir, readFile, realpath, stat } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { atomicWrite } from './atomic-file.js';
import { PROTOCOL_VERSION } from './protocol.js';
import { StateError, stateFileError } from './state-error.js';

export function dataDirectory(): string {
  const base = process.env.LOCALAPPDATA ?? (process.platform === 'win32'
    ? join(homedir(), 'AppData', 'Local') : join(homedir(), '.local', 'share'));
  return resolve(process.env.BRIDGE_DATA_DIR ?? join(base, 'AgentSessionMessaging'));
}

export async function workspaceDirectory(): Promise<string> {
  const path = await realpath(resolve(process.env.BRIDGE_WORKSPACE ?? process.cwd()));
  if (!(await stat(path)).isDirectory()) throw new Error('BRIDGE_WORKSPACE must be a directory.');
  return process.platform === 'win32' ? path.toLowerCase() : path;
}

export async function readToken(directory: string): Promise<string> {
  const path = join(directory, 'token');
  let value: string;
  try { value = (await readFile(path, 'utf8')).trim(); }
  catch (error) { return stateFileError(error, path, 'TOKEN_MISSING'); }
  if (!/^[a-f0-9]{64}$/.test(value)) {
    throw new StateError('TOKEN_INVALID', 'The broker token file is incomplete or invalid.',
      'Restore the original token from a trusted backup. Do not generate a replacement for an existing database.');
  }
  return value;
}

export async function initializeData(directory: string): Promise<string> {
  try { await mkdir(directory, {recursive: true, mode: 0o700}); }
  catch (error) { return stateFileError(error, directory, 'DATA_DIRECTORY_MISSING'); }
  try { return await readToken(directory); }
  catch (error) { if (!(error instanceof StateError) || error.code !== 'TOKEN_MISSING') throw error; }
  // Locks and staged temporary files can exist during a fresh installation. A database
  // or published descriptor proves that this is not a new installation.
  for (const name of ['mail.sqlite', 'mail.sqlite-wal', 'broker.json']) {
    try {
      await stat(join(directory, name));
      throw new StateError('TOKEN_MISSING', 'An existing installation has lost its broker token.',
        'Restore the original token. Startup will not rekey or delete existing mail.');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        if (error instanceof StateError) throw error;
        return stateFileError(error, join(directory, name), 'STATE_MISSING');
      }
    }
  }
  try { await atomicWrite(join(directory, 'token'), randomBytes(32).toString('hex'), true); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') return stateFileError(error, join(directory, 'token'), 'TOKEN_MISSING'); }
  return readToken(directory);
}

export const descriptorSchema = z.object({url: z.string(), protocolVersion: z.number().int().positive()});
export function validBrokerUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' && url.hostname === '127.0.0.1' && url.port !== '' &&
      !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash;
  } catch { return false; }
}
export async function readDescriptor(directory: string) {
  const path = join(directory, 'broker.json');
  let text: string;
  try { text = await readFile(path, 'utf8'); }
  catch (error) { return stateFileError(error, path, 'DESCRIPTOR_MISSING'); }
  let result;
  try { result = descriptorSchema.parse(JSON.parse(text)); }
  catch { throw new StateError('DESCRIPTOR_INVALID', 'broker.json is invalid.',
    'Inspect the descriptor and broker owner. Repair the descriptor only after confirming the broker is stopped; retain token and database.'); }
  if (!validBrokerUrl(result.url)) throw new StateError('DESCRIPTOR_INVALID', 'broker.json does not contain a supported loopback URL.',
    'Use the descriptor written by the local broker; do not redirect it to a remote server.');
  // A stale v1 descriptor is readable so that a stopped v0.2 broker can be upgraded.
  // A live v1 broker is rejected by the health protocol check.
  if (result.protocolVersion !== PROTOCOL_VERSION && result.protocolVersion !== 1) {
    throw new StateError('PROTOCOL_MISMATCH', 'The descriptor belongs to an unsupported broker protocol.',
      'Update both plugins to a compatible version. Do not delete or rewrite the descriptor to bypass this check.');
  }
  return result;
}
export async function writeDescriptor(directory: string, url: string): Promise<void> {
  if (!validBrokerUrl(url)) throw new StateError('DESCRIPTOR_INVALID', 'Refusing to publish an invalid broker URL.', 'Use a local loopback listener.');
  try { await atomicWrite(join(directory, 'broker.json'), JSON.stringify({url, protocolVersion: PROTOCOL_VERSION})); }
  catch (error) { stateFileError(error, join(directory, 'broker.json'), 'DESCRIPTOR_MISSING'); }
}
export async function loadBroker(directory: string): Promise<{url: string; token: string}> {
  const descriptor = await readDescriptor(directory);
  return {url: descriptor.url, token: await readToken(directory)};
}
