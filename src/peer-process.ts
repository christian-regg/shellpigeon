import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, readdir, readlink, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';

export interface ProcessRecord {
  pid: number; ppid: number; name: string; command: string; started: string;
  argv?: string[]; cwd?: string; pidDomain?: string;
}
const execute = promisify(execFile);

export async function windowsProcesses(): Promise<ProcessRecord[]> {
  const script = "Get-CimInstance Win32_Process | Where-Object { $_.Name -in @('claude.exe','codex.exe','node.exe') } | ForEach-Object { try { $peerStarted=(Get-Process -Id $_.ProcessId -ErrorAction Stop).StartTime.ToUniversalTime().ToFileTimeUtc().ToString(); [pscustomobject]@{pid=[int]$_.ProcessId;ppid=[int]$_.ParentProcessId;name=$_.Name;command=$_.CommandLine;started=$peerStarted} } catch {} } | ConvertTo-Json -Compress";
  const {stdout} = await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {windowsHide: true, timeout: 10_000, maxBuffer: 4 * 1024 * 1024});
  const value = stdout.trim() ? JSON.parse(stdout) : [];
  return Array.isArray(value) ? value : [value];
}

/** Field 22 is the Linux start-time identity used by Claude, not wall-clock time. */
export function linuxProcessStat(text: string) {
  const match = /^(\d+) \((.*)\) ([\s\S]*)$/.exec(text.trim());
  if (!match) return null;
  const fields = match[3]!.split(/\s+/);
  if (['Z', 'X'].includes(fields[0]!) || !/^\d+$/.test(fields[1] ?? '') || !/^\d+$/.test(fields[19] ?? '')) return null;
  return {pid: Number(match[1]), name: match[2]!, ppid: Number(fields[1]), started: fields[19]!};
}

export async function linuxProcesses(procRoot = '/proc', machineIdFile = '/etc/machine-id'): Promise<ProcessRecord[]> {
  const uid = process.getuid?.();
  if (uid === undefined) throw new Error('Linux process discovery requires a user ID.');
  const [machineId, namespace, entries] = await Promise.all([
    readFile(machineIdFile, 'utf8'), readlink(join(procRoot, 'self/ns/pid')), readdir(procRoot),
  ]);
  const pidDomain = 'linux:' + machineId.trim() + ':' + namespace;
  const peers: ProcessRecord[] = [];
  const pids = entries.filter(name => /^\d+$/.test(name));
  // Bound file-descriptor use even on machines with many processes.
  for (let offset = 0; offset < pids.length; offset += 16) {
    await Promise.all(pids.slice(offset, offset + 16).map(async pid => {
      const root = join(procRoot, pid);
      try {
        if ((await stat(root)).uid !== uid) return;
        const before = linuxProcessStat(await readFile(join(root, 'stat'), 'utf8'));
        if (!before || before.pid !== Number(pid)) return;
        const [command, domain, cwd] = await Promise.all([
          readFile(join(root, 'cmdline'), 'utf8'), readlink(join(root, 'ns/pid')), readlink(join(root, 'cwd')),
        ]);
        if (domain !== namespace) return;
        const argv = command.split('\0').filter(Boolean);
        if (!argv.length) return;
        const executable = basename(argv[0]!);
        if (!['claude', 'claude.exe', 'codex', 'node', 'nodejs', 'bun'].includes(executable) &&
            !['claude', 'claude.exe', 'codex'].includes(before.name)) return;
        const after = linuxProcessStat(await readFile(join(root, 'stat'), 'utf8'));
        if (!after || before.started !== after.started) return;
        peers.push({...before, command: argv.join(' '), argv, cwd, pidDomain});
      } catch { /* Exited, inaccessible or foreign processes cannot establish a peer. */ }
    }));
  }
  return peers;
}

export async function localProcesses(): Promise<ProcessRecord[]> {
  if (process.platform === 'win32') return windowsProcesses();
  if (process.platform === 'linux') return linuxProcesses();
  throw new Error('Session discovery supports Windows and Linux only.');
}
