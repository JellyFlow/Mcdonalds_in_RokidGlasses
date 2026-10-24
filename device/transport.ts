// Streamable HTTP POST transport for the official MCP Client, backed by AIUI RequestTask.
// No background GET stream, automatic reconnect or write replay is used.
export class EventParser {
 private buffer='';
 constructor(private emit:(message:any)=>void){}
 push(text:string,final=false){this.buffer+=text;let match;while((match=/\r?\n\r?\n/.exec(this.buffer))){const block=this.buffer.slice(0,match.index);this.buffer=this.buffer.slice(match.index+match[0].length);this.block(block);}if(final&&this.buffer.trim()){this.block(this.buffer);this.buffer='';}}
 private block(block:string){const text=block.split(/\r?\n/).filter(l=>l.startsWith('data:')).map(l=>l.slice(5).replace(/^ /,'')).join('\n');if(text&&text!=='[DONE]')this.emit(JSON.parse(text));}
}
export interface RequestApi { request(options:any):any }
export class InkTransport {
 onmessage?: (message:any)=>void;onerror?:(error:Error)=>void;onclose?:()=>void;
 sessionId?:string;private protocol?:string;private tasks=new Map<any,any>();private closed=false;
 constructor(private api:RequestApi,private token:string){}
 async start(){this.closed=false;}
 setProtocolVersion(version:string){this.protocol=version;}
 async close(){this.closed=true;for(const task of this.tasks.values())task.abort();this.tasks.clear();this.onclose?.();}
 async send(message:any){
  if(this.closed)throw new Error('连接已关闭。');
  if(message.method==='notifications/cancelled'){this.tasks.get(message.params?.requestId)?.abort();return;}
  const headers:Record<string,string>={Authorization:'Bearer '+this.token,'Content-Type':'application/json',Accept:'application/json, text/event-stream'};
  if(this.sessionId)headers['Mcp-Session-Id']=this.sessionId;if(this.protocol)headers['MCP-Protocol-Version']=this.protocol;
  await new Promise<void>((resolve,reject)=>{
   let contentType='',received=false,responseId=false,done=false;const decoder=new TextDecoder();
   const deliver=(value:any)=>{if(this.closed)return;for(const item of Array.isArray(value)?value:[value]){if(item.id===message.id&&('result' in item||'error' in item))responseId=true;this.onmessage?.(item);}};
   const parser=new EventParser(deliver);
   const readHeaders=(values:any)=>{for(const [name,value] of Object.entries(values??{})){const key=name.toLowerCase();if(key==='content-type')contentType=String(value);if(key==='mcp-session-id')this.sessionId=String(value);}};
   const finish=(error?:Error)=>{if(done)return;done=true;this.tasks.delete(message.id??message);if(error){this.onerror?.(error);reject(error);}else resolve();};
   const task=this.api.request({url:'https://mcp.mcd.cn',method:'POST',header:headers,data:JSON.stringify(message),responseType:'text',dataType:'text',timeout:30000,
    success:(res:any)=>{try{
     readHeaders(res.header);
     if(res.statusCode<200||res.statusCode>=300){const e:any=new Error(res.statusCode===401?'麦当劳授权已失效，请替换 Token。':res.statusCode===429?'请求较多，请稍后重试。':'MCP 请求失败。');e.status=res.statusCode;throw e;}
     if(contentType.includes('text/event-stream')){if(received)parser.push(decoder.decode(),true);else parser.push(typeof res.data==='string'?res.data:decoder.decode(res.data),true);}
     else if(res.statusCode!==202&&res.statusCode!==204)deliver(typeof res.data==='string'?JSON.parse(res.data):res.data);
     if(message.id!==undefined&&!responseId)throw new Error('MCP 未返回匹配响应，请核实操作结果。');finish();
    }catch(e){finish(e as Error);}},
    fail:()=>finish(new Error('麦当劳连接中断或超时；已发送的操作须核实结果。'))});
   this.tasks.set(message.id??message,task);
   task.onHeadersReceived?.((headers:any)=>readHeaders(headers.header??headers));
   task.onChunkReceived?.((chunk:ArrayBuffer)=>{if(done||this.closed||!contentType.includes('text/event-stream'))return;try{received=true;parser.push(decoder.decode(chunk,{stream:true}));}catch(e){finish(e as Error);task.abort();}});
  });
 }
}
