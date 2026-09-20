import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { StateError, stateFileError } from './state-error.js';

export const DAY_MS = 86_400_000;
export const DATABASE_VERSION = 2;
export const retentionSchema = z.object({
  mode: z.enum(['automatic', 'manual']).default('automatic'),
  contentDays: z.number().int().min(2).max(3650).default(7),
  dedupDays: z.number().int().min(2).max(3650).default(30),
}).strict().refine(policy => policy.dedupDays >= policy.contentDays, 'dedupDays must be at least contentDays');
export type RetentionPolicy = z.infer<typeof retentionSchema>;
export const DEFAULT_RETENTION: RetentionPolicy = retentionSchema.parse({});
export async function readRetention(directory: string): Promise<RetentionPolicy> {
  const path = join(directory, 'retention.json');
  let text: string;
  try { text = await readFile(path, 'utf8'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {...DEFAULT_RETENTION};
    return stateFileError(error, path, 'RETENTION_MISSING');
  }
  try { return retentionSchema.parse(JSON.parse(text)); }
  catch { throw new StateError('RETENTION_INVALID', 'retention.json has an invalid retention policy.',
    'Use mode automatic/manual and integer contentDays/dedupDays (2–3650), with dedupDays >= contentDays.'); }
}
