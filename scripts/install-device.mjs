// Upload the exact release artifact with a stable definition, using the same
// documented developer provider protocol as aix-cli 0.10.1. Never clears data.
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdtempSync,rmSync,mkdirSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
const identity=JSON.parse(readFileSync('local/app-identity.json','utf8'));
const definition=JSON.parse(readFileSync('aiui/agent.json','utf8'));
if(definition.agentId!==identity.agentId)throw new Error('Agent identity mismatch');
const metadata='aiui/.aix/agent-id';
if(existsSync(metadata)&&readFileSync(metadata,'utf8').trim()!==identity.version)throw new Error('Source launch identity mismatch; refusing to replace existing metadata');
mkdirSync('aiui/.aix',{recursive:true});writeFileSync(metadata,identity.version+'\n');
const online=execFileSync('adb',['devices'],{encoding:'utf8'}).split('\n').filter(x=>/\tdevice$/.test(x)).map(x=>x.split('\t')[0]);
const serial=process.argv[2]||(online.length===1?online[0]:null);
if(!serial||!online.includes(serial))throw new Error('Specify one authorized ADB serial');
const adb=(...args)=>execFileSync('adb',['-s',serial,...args],{encoding:'utf8'});
function call(method,arg){
 const text=adb('shell','content','call','--uri','content://com.rokid.aiui.develop','--method',method,...(arg?['--arg',arg]:[]));
 const match=/result_data\s*=\s*/.exec(text);
 const start=match?text.indexOf('{',match.index+match[0].length):-1;
 if(start<0)throw new Error('Missing provider result');
 let level=0,quoted=false,escaped=false;
 for(let i=start;i<text.length;i++){
  const c=text[i];if(quoted){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quoted=false;}
  else if(c==='"')quoted=true;else if(c==='{')level++;else if(c==='}'&&!--level){const result=JSON.parse(text.slice(start,i+1));if(result.errorCode)throw new Error('Provider '+method+': '+result.errorCode);return result;}
 }
 throw new Error('Incomplete provider result');
}
const temporary=mkdtempSync(join(tmpdir(),'mcd-exact-install-'));
try{
 const ready=call('prepare');if(ready.ready!==true)throw new Error('Developer provider not ready');
 const inbox=ready.inboxPath;if(typeof inbox!=='string'||!/^\/sdcard\/aiui\/package\/\.staging\/[\w/-]+$/.test(inbox))throw new Error('Unexpected staging path');
 writeFileSync(join(temporary,'agent.json'),JSON.stringify(definition));
 writeFileSync(join(temporary,'package.aix'),readFileSync('artifacts/mcdonalds-rokid.aix'));
 adb('shell','rm','-f',inbox+'/package.aix',inbox+'/agent.json');
 adb('push',join(temporary,'package.aix'),join(temporary,'agent.json'),inbox);
 const applied=call('apply');if(applied.agentId!==identity.agentId||!['CREATED','UPDATED','UNCHANGED','REPAIRED'].includes(applied.outcome)||!applied.operationId)throw new Error('Unexpected application identity or outcome');
 const status=call('status',applied.operationId);if(/^FAILED/.test(status.publishState||''))throw new Error('Device upload failed');
 const sha256=createHash('sha256').update(readFileSync('artifacts/mcdonalds-rokid.aix')).digest('hex');
 const installed=adb('shell','sha256sum','/sdcard/aiui/package/'+identity.agentId+'.aix').split(/\s/)[0];
 if(installed!==sha256)throw new Error('Installed artifact checksum differs');
 mkdirSync('local',{recursive:true});writeFileSync('local/device-install.json',JSON.stringify({at:new Date().toISOString(),serial,agentId:identity.agentId,nativeVersion:definition.nativeVersion,sha256,outcome:applied.outcome,publishState:status.publishState,dataCleared:false},null,2)+'\n');
 console.log('Installed exact artifact; stable agent '+identity.agentId+'; SHA-256 verified.');
}finally{rmSync(temporary,{recursive:true,force:true});}
