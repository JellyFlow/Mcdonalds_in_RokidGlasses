// Test-only bridge. Never included in the device bundle or AIX.
export function nodeRequest(options:any){
 const controller=new AbortController(),headerListeners:Function[]=[],chunkListeners:Function[]=[];
 const timeout=setTimeout(()=>controller.abort(),options.timeout??30000);
 queueMicrotask(async()=>{try{
  const response=await fetch(options.url,{method:options.method,headers:options.header,body:options.data,signal:controller.signal,redirect:'error'});
  const header=Object.fromEntries(response.headers);for(const fn of headerListeners)fn(header);
  const reader=response.body?.getReader(),decoder=new TextDecoder();let text='';
  if(reader)while(true){const {done,value}=await reader.read();if(done)break;text+=decoder.decode(value,{stream:true});for(const fn of chunkListeners)fn(value.buffer.slice(value.byteOffset,value.byteOffset+value.byteLength));}
  text+=decoder.decode();options.success({statusCode:response.status,header,data:text});
 }catch{options.fail({errMsg:'request failed'});}finally{clearTimeout(timeout);}});
 return {abort(){controller.abort();},onHeadersReceived(fn:Function){headerListeners.push(fn);},onChunkReceived(fn:Function){chunkListeners.push(fn);}};
}
