// Use the installed AIX engine's verified source-packer API. CLI 0.10.1 itself
// generates a random VERSION on every pack; its artifact install path derives
// an ID from VERSION. Our installer supplies the stable application separately.
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,readdirSync,realpathSync,mkdirSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {createHash} from 'node:crypto';
const cli=realpathSync(execFileSync('which',['aix'],{encoding:'utf8'}).trim());
const require=createRequire(import.meta.url);
const engine=require(join(dirname(cli),'pkg/aix_web.js'));
const identity=JSON.parse(readFileSync('local/app-identity.json','utf8'));
if(typeof engine.AixSourcePackBuilderWasm!=='function')throw new Error('AIX source builder API changed; update pack adapter before shipping');
const builder=new engine.AixSourcePackBuilderWasm();
const inputs=[];
function walk(dir,relative=''){
 for(const entry of readdirSync(dir,{withFileTypes:true})){
  if(entry.name==='.aix'||entry.name.endsWith('.example.json')||entry.name.endsWith('.example.js'))continue;
  const path=join(dir,entry.name),name=relative+entry.name;
  if(entry.isDirectory())walk(path,name+'/');
  else if(entry.isFile()){const bytes=readFileSync(path);inputs.push([name,bytes]);builder.add_file(name,new Uint8Array(bytes));}
 }
}
walk('aiui');
// Native Ink caches source by VERSION. It must change with content, while the
// developer provider's explicit agent definition keeps application identity.
const digest=createHash('sha256').update(Buffer.concat(inputs.sort((a,b)=>a[0].localeCompare(b[0])).flatMap(([name,data])=>[Buffer.from(name),Buffer.from([0]),data]))).digest('hex');
const buildVersion=[digest.slice(0,8),digest.slice(8,12),digest.slice(12,16),digest.slice(16,20),digest.slice(20,32)].join('-');
const result=builder.pack_from_source_with_progress(buildVersion,'>=0.17.0',{level:2,json:true,png:true,jpeg:true},()=>{});
mkdirSync('artifacts',{recursive:true});writeFileSync('artifacts/mcdonalds-rokid.aix',result.data);
writeFileSync('local/package-build.json',JSON.stringify({agentId:identity.agentId,buildVersion,sourceDigest:digest,aixSha256:createHash('sha256').update(result.data).digest('hex'),installCommand:'npm run install:device',cliNote:'aix show/install of a package derives an ID from VERSION; install:device supplies the stable agent definition.'},null,2)+'\n');
console.log('Packaged '+buildVersion+' for stable agent '+identity.agentId);
