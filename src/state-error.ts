import { BridgeError } from './protocol.js';

export class StateError extends BridgeError {
  constructor(code: string, message: string, public remedy: string, status = 503) {
    super(code, message, status);
    this.name = 'StateError';
  }
}
export function stateFileError(error: unknown, path: string, missingCode: string): never {
  const code = (error as NodeJS.ErrnoException).code;
  if (code === 'ENOENT') throw new StateError(missingCode, 'Required file is missing: ' + path,
    'For existing installations restore the original file; do not reset the data directory.');
  if (code === 'EACCES' || code === 'EPERM') throw new StateError('STATE_ACCESS_DENIED', 'Cannot access: ' + path,
    'Check directory permissions for the current user.');
  throw new StateError('STATE_IO_ERROR', 'Cannot read or write: ' + path,
    'Check the path, available disk space and filesystem health.');
}
export function errorDetails(error: unknown) {
  if (error instanceof StateError) return {code: error.code, message: error.message, remedy: error.remedy};
  if (error instanceof BridgeError) return {code: error.code, message: error.message};
  return {code: 'INTERNAL', message: 'Unexpected local error. Check broker.log.'};
}
