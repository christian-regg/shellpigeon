import {readFile,readdir,writeFile,mkdir} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
export async function writeNotices(destination) {
 const inputs=JSON.parse(await readFile('artifacts/bundle-inputs.json','utf8'));
 const packages=new Map();
 for(const input of inputs){
  let directory=dirname(resolve(input));
  while(directory.includes('node_modules')){
   try{const pkg=JSON.parse(await readFile(join(directory,'package.json'),'utf8'));if(pkg.name&&pkg.version){packages.set(pkg.name+'@'+pkg.version,{...pkg,directory});break;}}catch(error){if(error.code!=='ENOENT')throw error;}
   directory=dirname(directory);
  }
 }
 const records=[];let text='# Bundled third-party notices\n\nGenerated from the actual esbuild input graph. Node.js, Codex and Claude Code are installed separately and are not redistributed.\n';
 for(const [id,pkg]of [...packages].sort(([a],[b])=>a.localeCompare(b))){
  const names=(await readdir(pkg.directory)).filter(n=>/^(?:licen[cs]e|copying|notice)(?:[._-].*)?$/i.test(n));
  if(!names.length)throw new Error('Missing bundled license text: '+id);
  const files=[];
  for(const name of names){try{files.push({name,text:await readFile(join(pkg.directory,name),'utf8')});}catch(error){if(error.code!=='EISDIR')throw error;}}
  if(!files.length)throw new Error('Missing readable license text: '+id);
  records.push({name:pkg.name,version:pkg.version,license:pkg.license??null,files:files.map(f=>f.name)});
  text+='\n## '+id+'\n\nDeclared license: '+(pkg.license??'see text')+'\n';
  for(const file of files)text+='\n### '+file.name+'\n\n'+file.text.trim()+'\n';
 }
 await mkdir(destination,{recursive:true});
 await writeFile(join(destination,'THIRD-PARTY-NOTICES.txt'),text);
 await writeFile(join(destination,'BUNDLED-DEPENDENCIES.json'),JSON.stringify(records,null,2)+'\n');
 return records;
}
