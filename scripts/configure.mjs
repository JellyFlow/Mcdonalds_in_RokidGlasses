import {readFileSync,writeFileSync,mkdirSync,existsSync,chmodSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import dotenv from 'dotenv';
const placeholder=v=>!v||/\$\{|YOUR_|REPLACE_/i.test(v);
export function configure(root,env,{mock=false}={}){
 const token=mock?'mock-test-token':env.MCD_MCP_TOKEN;
 if(placeholder(token))throw new Error('Set MCD_MCP_TOKEN to your own token; no value is logged.');
 if(!mock&&env.AMAP_WEB_KEY&&placeholder(env.AMAP_WEB_KEY))throw new Error('AMAP_WEB_KEY must be your key or omitted.');
 const dir=join(root,'local');mkdirSync(dir,{recursive:true});
 const identityPath=join(dir,'app-identity.json');
 let identity=existsSync(identityPath)?JSON.parse(readFileSync(identityPath,'utf8')):null;
 if(!identity){const version=randomUUID();identity={version,agentId:'develop.rokid.agent.'+version};}
 writeFileSync(identityPath,JSON.stringify(identity,null,2)+'\n',{mode:0o600});chmodSync(identityPath,0o600);
 const agent=JSON.parse(readFileSync(join(root,'aiui/agent.example.json'),'utf8'));agent.agentId=identity.agentId;
 writeFileSync(join(root,'aiui/agent.json'),JSON.stringify(agent,null,2)+'\n',{mode:0o600});
 const file=join(root,'aiui/lib/credentials.js');
 writeFileSync(file,'export const MCP_TOKEN = '+JSON.stringify(token)+';\nexport const AMAP_WEB_KEY = '+JSON.stringify(mock?'fixture-amap-key':env.AMAP_WEB_KEY||'')+';\n',{mode:0o600});chmodSync(file,0o600);
 return {mock,agentId:identity.agentId};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 dotenv.config({path:'.env.local',quiet:true});
 try{configure(process.cwd(),process.env,{mock:process.argv.includes('--mock')});console.log('Local configuration generated. Values are not printed; generated files must stay private.');}
 catch(e){console.error(e.message);process.exitCode=1;}
}
