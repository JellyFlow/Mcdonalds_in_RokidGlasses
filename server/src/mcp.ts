import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createRequire } from 'node:module';
import type { Gateway, Obj } from './types.js';
import { UserError } from './types.js';
const require = createRequire(import.meta.url);
const Ajv = require('ajv');
export {ALLOWED,WRITES,unwrap} from '../../shared/mcp-result.js';
import {ALLOWED,WRITES,unwrap} from '../../shared/mcp-result.js';
export class McpGateway implements Gateway {
 mode='live' as const;
 private client?:Client; private connecting?:Promise<void>; private catalog:Obj[]=[];
 private validators=new Map<string, any>(); private nextRead=0;
 constructor(private token:string){}
 private async connect(){
  if(this.client)return;
  if(!this.connecting)this.connecting=(async()=>{
   if(!this.token)throw new UserError('请在服务端 .env 配置 MCP Token。',503);
   const client=new Client({name:'mcdonalds-rokid-glasses',version:'1.0.0'});
   try {
    await client.connect(new StreamableHTTPClientTransport(new URL('https://mcp.mcd.cn'),{requestInit:{headers:{Authorization:`Bearer ${this.token}`}}}));
    let cursor:string|undefined; const catalog:Obj[]=[];
    do {const page=await client.listTools({cursor});catalog.push(...page.tools);cursor=page.nextCursor;}while(cursor);
    const ajv=new Ajv({strict:false,allErrors:true});
    for(const tool of catalog)if(ALLOWED.has(tool.name))this.validators.set(tool.name,ajv.compile(tool.inputSchema));
    this.catalog=catalog;this.client=client;
   }catch(e){await client.close().catch(()=>{});throw e;}
  })().finally(()=>{this.connecting=undefined;});
  await this.connecting;
 }
 async tools(){await this.connect();return this.catalog;}
 async supportsInput(name:string,args:Obj){await this.connect();return ALLOWED.has(name)&&!!this.validators.get(name)?.(args);}
 async call(name:string,args:Obj={}){
  if(!ALLOWED.has(name))throw new UserError('该功能不在首版范围内。');
  await this.connect();
  const validate=this.validators.get(name);
  if(!validate || !validate(args))throw new UserError('工具参数不符合当前 MCP 契约，请重新选择。');
  const wait=this.nextRead-Date.now(); if(wait>0)await new Promise(r=>setTimeout(r,wait));
  this.nextRead=Date.now()+120;
  for(let attempt=0;attempt<3;attempt++){
   try{return unwrap(await this.client!.callTool({name,arguments:args},undefined,{timeout:30000}));}
   catch(e:any){
    const status=e?.code===401||e?.status===401||/\b401\b/.test(String(e?.message))?401:e?.status===429||/\b429\b/.test(String(e?.message))?429:0;
    if(status===429&&!WRITES.has(name)&&attempt<2){await new Promise(r=>setTimeout(r,1000*2**attempt));continue;}
    if(e instanceof UserError)throw e;
    throw new UserError(status===401?'服务授权已失效，请检查服务端 Token。':status===429?'请求较多，请稍后重试。':'麦当劳服务连接失败或超时，请稍后重试。',status||502);
   }
  }
 }
 async close(){await this.client?.close();this.client=undefined;}
}
