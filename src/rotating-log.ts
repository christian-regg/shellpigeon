import { appendFileSync, existsSync, renameSync, statSync, unlinkSync, openSync, readSync, closeSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Only the broker owner writes. Close every handle so rotation also works on Windows. */
export class RotatingLog {
  readonly path: string;
  constructor(directory: string, private maxBytes = 1_048_576, private archives = 3) {
    if (maxBytes < 512 || archives < 1) throw new Error('Invalid log limits.');
    this.path = join(directory, 'broker.log');
    // Bound oversized logs left by older releases without reading the full file.
    for (let i = 0; i <= archives; i++) {
      const path = this.path + (i ? '.' + i : '');
      if (!existsSync(path) || statSync(path).size <= maxBytes) continue;
      const size = statSync(path).size;
      const tail = Buffer.alloc(maxBytes);
      const fd = openSync(path, 'r');
      let length: number;
      try { length = readSync(fd, tail, 0, tail.length, size - maxBytes); }
      finally { closeSync(fd); }
      const newline = tail.subarray(0, length).indexOf(10);
      writeFileSync(path, newline >= 0 ? tail.subarray(newline + 1, length) : Buffer.alloc(0), {mode: 0o600});
    }
  }
  write(level: 'info' | 'error', event: string, detail = ''): void {
    // Budget for JSON escapes and UTF-8, including surrogate pairs.
    const budget = Math.floor((this.maxBytes - 200) / 8);
    const line = JSON.stringify({time: new Date().toISOString(), level,
      event: event.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 48), detail: detail.slice(0, budget)}) + '\n';
    if (existsSync(this.path) && statSync(this.path).size + Buffer.byteLength(line) > this.maxBytes) {
      const last = this.path + '.' + this.archives;
      if (existsSync(last)) unlinkSync(last);
      for (let i = this.archives - 1; i >= 1; i--) {
        if (existsSync(this.path + '.' + i)) renameSync(this.path + '.' + i, this.path + '.' + (i + 1));
      }
      renameSync(this.path, this.path + '.1');
    }
    appendFileSync(this.path, line, {mode: 0o600});
  }
}
