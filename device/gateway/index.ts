import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {ALLOWED,WRITES,unwrap} from '../../shared/contracts/mcp-result.js';
import {UserError,type Gateway,type Obj} from '../../shared/domain/types.js';
import {InkTransport,type RequestApi} from './transport.js';
import {contracts,validators,canonical} from '../validation/validators.js';
export class DeviceGateway implements Gateway {
 mode='live' as const;private client?:Client;private transport?:InkTransport;private connecting?:Promise<void>;private catalog:Obj[]=[];private nextRead=0;private epoch=0;
 private enabled=new Set<string>();
 constructor(private api:RequestApi,private token:string){}
 private async connect(){
  if(this.client)return;if(this.connecting)return this.connecting;
  const epoch=this.epoch;
  this.connecting=(async()=>{
   if(!this.token)throw new UserError('请先配置麦当劳 Token。');
   const transport=new InkTransport(this.api,this.token);this.transport=transport;
   const client=new Client({name:'mcdonalds-rokid-on-device',version:'1.1.0'},{jsonSchemaValidator:{getValidator:(schema:any)=>{
    const key=canonical(schema),entry=contracts.find(c=>c.output&&canonical(c.output)===key);const fn=entry?(validators as Record<string,(data:any)=>boolean>)[entry.outputValidator!]:undefined;
    return (data:any):any=>fn&&fn(data)?{valid:true,data}:{valid:false,data:undefined,errorMessage:'返回契约已变化或数据不符合契约，请更新应用。'};
   }}});
   try{
    await client.connect(transport as any);let cursor:string|undefined;const catalog:Obj[]=[];
    do{const page=await client.listTools({cursor});catalog.push(...page.tools);cursor=page.nextCursor;}while(cursor);
    if(epoch!==this.epoch)throw new Error('连接已取消。');
    this.enabled.clear();for(const tool of catalog){const local=contracts.find(c=>c.name===tool.name);if(local&&canonical(tool.inputSchema)===canonical(local.input)&&canonical(tool.outputSchema??null)===canonical(local.output??null))this.enabled.add(tool.name);}
    this.catalog=catalog;this.client=client;
   }catch(e){await client.close().catch(()=>{});if(epoch===this.epoch)this.transport=undefined;throw e;}
  })().finally(()=>{if(epoch===this.epoch)this.connecting=undefined;});
  return this.connecting;
 }
 async tools(){await this.connect();return this.catalog;}
 async supportsInput(name:string,args:Obj){
  await this.connect();
  const contract=contracts.find(c=>c.name===name);
  return !!contract&&this.enabled.has(name)&&ALLOWED.has(name)&&!!(validators as Record<string,(data:any)=>boolean>)[contract.inputValidator](args);
 }
 async call(name:string,args:Obj={}){
  if(!ALLOWED.has(name))throw new UserError('该功能不在首版范围内。');await this.connect();
  const contract=contracts.find(c=>c.name===name);
  if(!contract||!this.enabled.has(name))throw new UserError('该功能的 MCP 契约已变化或不可用，请更新应用。');
  if(!(validators as Record<string,(data:any)=>boolean>)[contract.inputValidator](args))throw new UserError('工具参数不符合 MCP 契约，请重新选择。');
  const epoch=this.epoch,wait=this.nextRead-Date.now();if(wait>0)await new Promise(r=>setTimeout(r,wait));this.nextRead=Date.now()+120;
  for(let attempt=0;attempt<3;attempt++){
   if(epoch!==this.epoch||!this.client)throw new UserError('连接已取消，请重新打开页面。');
   try{return unwrap(await this.client.callTool({name,arguments:args},undefined,{timeout:30000}));}
   catch(e:any){const status=e.status??e.code;if(status===429&&!WRITES.has(name)&&attempt<2){await new Promise(r=>setTimeout(r,1000*2**attempt));continue;}if(e instanceof UserError)throw e;throw new UserError(status===401?'麦当劳授权已失效，请替换 Token。':status===429?'请求较多，请稍后重试。':'MCP 请求失败或结果不完整，请检查网络或更新应用。',status===401?401:502);}
  }
 }
 async close(){this.epoch++;this.connecting=undefined;const client=this.client;const transport=this.transport;this.client=undefined;this.transport=undefined;await client?.close();await transport?.close();}
}
