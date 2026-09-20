import {execFileSync} from 'node:child_process';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
const git=(...args)=>execFileSync('git',args,{encoding:'utf8',maxBuffer:20*1024*1024});
const rules=[['private-key',/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],['github-token',/\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/],['openai-token',/\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{32,}\b/],['aws-key',/\bAKIA[A-Z0-9]{16}\b/]];
const report={at:new Date().toISOString(),scope:'Working tree intended for Git plus all reachable commit blobs; patterns only, not proof of absence',findings:[],personalPathFiles:[],historyPersonalPathFiles:[],workingFiles:0,historyBlobs:0};
const paths=git('ls-files','--cached','--others','--exclude-standard','-z').split('\0').filter(Boolean);
const personal=/[A-Z]:[\\/]Users[\\/](?!Public\b|Default\b|<)[^\\/\s]+/i;
for(const path of paths){const bytes=await readFile(path);const text=bytes.toString('utf8');report.workingFiles++;for(const [rule,re]of rules)if(re.test(text))report.findings.push({where:'working',path,rule});if(personal.test(text))report.personalPathFiles.push(path);}
const objects=git('rev-list','--objects','--all').trim().split('\n');
for(const line of objects){const [id,...parts]=line.split(' ');if(git('cat-file','-t',id).trim()!=='blob')continue;report.historyBlobs++;const text=git('cat-file','blob',id);const path=parts.join(' ');for(const [rule,re]of rules)if(re.test(text))report.findings.push({where:'history',path,object:id,rule});if(personal.test(text))report.historyPersonalPathFiles.push({path,object:id});}
await mkdir('artifacts',{recursive:true});await writeFile('artifacts/publication-audit.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));if(report.findings.length)process.exitCode=1;
