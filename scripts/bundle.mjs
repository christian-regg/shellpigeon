import {build} from 'esbuild';
import {mkdir, copyFile, cp, writeFile} from 'node:fs/promises';
import {resolve, join} from 'node:path';
const inputs = new Set();
for (const host of ['claude', 'codex']) {
  const root = resolve('plugins', host, 'agent-session-messaging');
  await mkdir(join(root, 'skills/session-messaging'), {recursive:true});
  await cp('plugin-assets/session-messaging', join(root, 'skills/session-messaging'), {recursive:true, force:true});
  if (host === 'codex') {
    await copyFile('scripts/setup-codex-listener.ps1', join(root,'setup-listener.ps1'));
    await build({entryPoints:['src/setup-codex.ts'], outfile:join(root,'setup.cjs'), platform:'node', target:'node22', format:'cjs', bundle:true});
  }
  const result = await build({entryPoints:{mcp:'src/mcp.ts',broker:'src/cli.ts',peer:'src/peer-cli.ts'},outdir:join(root,'dist'),outExtension:{'.js':'.cjs'},platform:'node',target:'node22',format:'cjs',bundle:true,sourcemap:false,legalComments:'linked',metafile:true});
  for (const input of Object.keys(result.metafile.inputs)) if (input.includes('node_modules/')) inputs.add(input);
}
await build({entryPoints:['src/install-release.ts'],outfile:'build/install.cjs',platform:'node',target:'node22',format:'cjs',bundle:true});
await mkdir('artifacts',{recursive:true});
await writeFile('artifacts/bundle-inputs.json',JSON.stringify([...inputs].sort(),null,2)+'\n');
console.log('Built both self-contained plugin bundles and the release installer.');
