import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {randomUUID} from 'node:crypto';
import {writeFile, mkdir} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {resolveHostCommand} from '../build/src/host-command.js';
import {discoverPeers} from '../build/src/peer-discovery.js';

const [target, expected] = process.argv.slice(2);
if (!/^codex:[0-9a-f-]{36}$/.test(target ?? '') || !/^ASM_RETURN_[0-9a-f]{32}$/.test(expected ?? '')) throw new Error('Usage: probe-peer-roundtrip.mjs codex:<test-thread-id> ASM_RETURN_<nonce-known-only-to-recipient>');
const id = randomUUID();
const helper = process.cwd().replaceAll('\\', '/') + '/plugins/claude/agent-session-messaging/dist/peer.cjs';
const command = await resolveHostCommand('claude');
const env = {...process.env}; delete env.CODEX_THREAD_ID; delete env.CLAUDE_CODE_MESSAGING_SOCKET; delete env.CLAUDE_CODE_MESSAGING_TOKEN;
const child = spawn(command.file, [...command.args, '-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
  '--session-id', id, '--name', 'asm-roundtrip-test', '--tools', 'Bash', '--allowedTools', 'Bash(node ' + helper + ':*)',
  '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--settings', '{"crossSessionInbound":"accept"}',
  '--no-chrome', '--disable-slash-commands', '--max-budget-usd', '2'], {env, windowsHide:true, stdio:['pipe','pipe','pipe']});
const events = []; let error; let stderr = '';
child.on('error', e=>{error=e;}); child.stdin.on('error', e=>{error=e;});
child.stderr.on('data', data=>{stderr=(stderr+data).slice(-2000);});
const lines = createInterface({input:child.stdout});
lines.on('line', line=>{try {const event=JSON.parse(line); events.push(event); if(event.type==='result') console.log(JSON.stringify({stage:'claude-result',result:event.result}));}catch{}});
async function until(check, ms=120000) {
 const end=Date.now()+ms;
 while(Date.now()<end) {if(error)throw error; const value=await check(); if(value)return value; if(child.exitCode!==null)throw new Error('Claude exited: '+stderr); await delay(100);}
 throw new Error('Round-trip deadline exceeded.');
}
const report={testedAt:new Date().toISOString(),claude:id,codex:target,expected,testOwned:true};
try {
 child.stdin.write(JSON.stringify({type:'user',session_id:id,message:{role:'user',content:
  'This is an authorized local round-trip test. You may run only this helper command through Bash: node '+helper+' send '+target+' proof ASM_ROUNDTRIP_REQUEST . Run it once now. Your own session environment provides the return address. If it reports a confirmed queue or native receipt, reply ASM_REQUEST_SENT and wait. If it fails, report the error and stop; do not retry. A later cross-session reply will contain an ASM_RETURN_ code unknown to you now. On receiving that reply, repeat only that exact code in your final response. Do not answer or acknowledge it by sending another message. Do not edit files, delegate or run unrelated commands.'}})+'\n');
 await until(()=>{const first=events.find(e=>e.type==='result'); if(first && !first.result?.trim().startsWith('ASM_REQUEST_SENT')) throw new Error('Sender did not confirm its request: '+first.result); return first;});
 report.requestSent=true; console.log(JSON.stringify({stage:'request-sent',claude:id}));
 const discovery=await discoverPeers({all:true});
 report.discovered=discovery.peers.filter(p=>p.id===id||p.address===target).map(({registry,processStart,...p})=>p);
 const ack=await until(()=>events.find(e=>e.type==='result' && e.result?.trim()===expected));
 report.ack={sessionId:ack.session_id,text:ack.result,at:new Date().toISOString()};
 report.passed=ack.session_id===id;
} catch(e){report.passed=false;report.error=e.message;process.exitCode=1;}
finally {
 child.stdin.end(); if(child.exitCode===null){await Promise.race([new Promise(r=>child.once('exit',r)),delay(1500)]); if(child.exitCode===null)child.kill();}
 lines.close(); report.results=events.filter(e=>e.type==='result').map(e=>({subtype:e.subtype,result:e.result,sessionId:e.session_id}));
 report.toolResults=events.filter(e=>e.type==='user').flatMap(e=>e.message?.content??[]).filter(c=>c.type==='tool_result').map(c=>({isError:c.is_error,content:c.content}));
 await mkdir('artifacts/native-delivery',{recursive:true}); await writeFile('artifacts/native-delivery/roundtrip.json',JSON.stringify(report,null,2)+'\n'); console.log(JSON.stringify(report,null,2));
}
