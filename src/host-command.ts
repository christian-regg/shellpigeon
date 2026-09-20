import { constants } from 'node:fs';
import { access, readFile, stat } from 'node:fs/promises';
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';

export type Host = 'claude' | 'codex';
export interface HostCommand { file: string; args: string[] }

const npmEntries: Record<Host, string> = {
  codex: '@openai/codex/bin/codex.js',
  claude: '@anthropic-ai/claude-code/cli.js',
};

async function isFile(path: string): Promise<boolean> {
  try { return (await stat(path)).isFile(); }
  catch (error) {
    if (['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) return false;
    throw error;
  }
}

/** Resolve native CLIs and standard npm shims without routing arguments through a shell. */
export async function resolveHostCommand(host: Host, options: {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  cwd?: string;
} = {}): Promise<HostCommand> {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const cwd = options.cwd ?? process.cwd();
  const windows = platform === 'win32';
  const getEnv = (name: string) => env[Object.keys(env).find(key =>
    windows ? key.toUpperCase() === name : key === name) ?? name];
  const variable = host === 'codex' ? 'CODEX_BIN' : 'CLAUDE_BIN';
  const override = getEnv(variable);
  const command = override ?? host;
  if (!command.trim()) throw new Error(variable + ' must name an executable or JavaScript entry point.');
  const names = windows && !extname(command)
    ? [command + '.exe', command + '.cmd', command + '.ps1'] : [command];
  const explicitPath = isAbsolute(command) || /[\\/]/.test(command);
  const directories = explicitPath ? [cwd] : (getEnv('PATH') ?? '')
    .split(windows ? ';' : ':').filter(Boolean).map(path => path.replace(/^"(.*)"$/, '$1'));

  for (const directory of directories) {
    for (const name of names) {
      const file = resolve(cwd, directory, name);
      if (!await isFile(file)) continue;
      const extension = extname(file).toLowerCase();
      if (['.js', '.mjs', '.cjs'].includes(extension)) {
        return {file: process.execPath, args: [file]};
      }
      if (windows && ['.cmd', '.ps1', '.bat'].includes(extension)) {
        const wrapper = (await readFile(file, 'utf8')).replaceAll('\\', '/');
        // npm global shims sit beside node_modules; local shims live in node_modules/.bin.
        for (const entry of [
          join(dirname(file), 'node_modules', npmEntries[host]),
          resolve(dirname(file), '..', npmEntries[host]),
        ]) {
          const target = relative(dirname(file), entry).replaceAll('\\', '/');
          if (wrapper.includes('/' + target + '"') && await isFile(entry)) {
            const adjacentNode = join(dirname(file), 'node.exe');
            return {file: await isFile(adjacentNode) ? adjacentNode : process.execPath, args: [entry]};
          }
        }
        throw new Error('Unsupported launcher: ' + file + '. Set ' + variable +
          ' to the native executable or JavaScript entry point.');
      }
      if (!windows) {
        try { await access(file, constants.X_OK); }
        catch (error) { if ((error as NodeJS.ErrnoException).code === 'EACCES') continue; throw error; }
      }
      return {file, args: []};
    }
  }
  throw new Error('Could not find ' + command + (override === undefined ? ' on PATH' : ' from ' + variable) +
    '. Set ' + variable + ' to the installed CLI executable, npm shim, or JavaScript entry point.');
}
