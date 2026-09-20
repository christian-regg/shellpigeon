import {parseArgs} from 'node:util';
import {dirname, resolve} from 'node:path';
import {installRelease} from './distribution.js';
async function main() {
  const {values} = parseArgs({options:{host:{type:'string',default:'both'},check:{type:'boolean'},uninstall:{type:'boolean'},help:{type:'boolean'}}});
  if (values.help) {console.log('ShellPigeon installer\n\nnode install.cjs [--host both|codex|claude] [--check|--uninstall]\nRun from an extracted release kept in a permanent directory. --check only verifies files and host prerequisites.');return;}
  console.log(JSON.stringify(await installRelease(dirname(resolve(process.argv[1]!)),{host:values.host,check:values.check,uninstall:values.uninstall}),null,2));
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
