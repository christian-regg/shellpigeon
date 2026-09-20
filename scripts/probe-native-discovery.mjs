import { mkdir, writeFile } from 'node:fs/promises';
import { connectCodex } from '../build/src/native-codex.js';
const report = {testedAt: new Date().toISOString(), modelCalls: 0, transport: 'stock app-server proxy'};
const rpc = await connectCodex({timeout: 8000});
try {
  report.server = await rpc.initialize();
  report.loaded = await rpc.call('thread/loaded/list');
  report.reachable = true;
} catch (error) {
  report.reachable = false;
  report.error = error.message;
} finally {
  await rpc.close();
  await mkdir('artifacts/native-delivery', {recursive: true});
  await writeFile('artifacts/native-delivery/discovery.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}
