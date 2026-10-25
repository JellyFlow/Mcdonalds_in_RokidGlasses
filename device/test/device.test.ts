import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DeviceStore} from '../storage/store.js';
import {Service} from '../../shared/contracts/service.js';
import {MockGateway} from '../../server/mock/index.js';
import {InkTransport,EventParser} from '../gateway/transport.js';
import {DeviceGateway} from '../gateway/index.js';
import {contracts} from '../validation/validators.js';
class MemoryStorage {
 data=new Map<string,any>();fail=false;drop=false;
 getStorageSync(k:string){return structuredClone(this.data.get(k));}
 setStorageSync(k:string,v:any){if(this.fail)throw new Error('disk full');if(!this.drop)this.data.set(k,structuredClone(v));}
}
function setup(storage=new MemoryStorage(),gateway=new MockGateway()){
 const db=new DeviceStore(storage);if(!db.token())db.configure('test-token');const service=new Service(db,gateway);let state=service.resume();
 return {storage,db,gateway,service,get state(){return state;},async send(e:any){state=await service.event(state.id,{...e,revision:state.revision});return state;}};
}
async function cart(t:ReturnType<typeof setup>,delivery=false){await t.send({type:'start'});await t.send({type:'fulfillment',value:delivery?'delivery':'pickup'});if(delivery)await t.send({type:'address',id:'home'});else await t.send({type:'search-stores',value:'上海市 人民广场'});await t.send({type:'store',id:'12345'});await t.send({type:'meal',id:'burger'});await t.send({type:'add'});}
async function review(t:ReturnType<typeof setup>,delivery=false){await cart(t,delivery);await t.send({type:'checkout'});await t.send({type:'skip-coupon'});await t.send({type:'tableware',value:false});await t.send({type:'now'});if(delivery)await t.send({type:'remark',value:'无接触配送'});else await t.send({type:'take-way',id:'take-away'});}
for(const delivery of [false,true])test('device persistent '+(delivery?'delivery':'pickup')+' confirmation submits exactly once',async()=>{
 const t=setup();await review(t,delivery);const actionId=t.state.actionId;
 await Promise.all([t.send({type:'confirm',actionId}),t.send({type:'confirm',actionId})]);
 assert.equal(t.state.screen,'payment');assert.equal(t.gateway.calls.filter(x=>x.name==='create-order').length,1);
 const restored=setup(t.storage,t.gateway);assert.equal(restored.state.screen,'payment');await restored.send({type:'confirm',actionId});assert.equal(t.gateway.calls.filter(x=>x.name==='create-order').length,1);
});
test('device storage failure and readback mismatch block upstream writes',async()=>{
 for(const kind of ['fail','drop'] as const){const t=setup();await review(t);t.storage[kind]=true;await assert.rejects(t.send({type:'confirm',actionId:t.state.actionId}));assert.equal(t.gateway.calls.filter(x=>x.name==='create-order').length,0);}
});
test('submitting journal recovers uncertain and blocks token replacement or clearing',async()=>{
 const t=setup();await review(t);t.db.begin(t.state.actionId!,t.db.get(t.state.id)!,'order');
 const restored=setup(t.storage,t.gateway);assert.equal(restored.state.screen,'uncertain');assert.throws(()=>restored.db.configure('another-token'));assert.throws(()=>restored.db.configure(''));
 await restored.send({type:'confirm',actionId:t.state.actionId});assert.equal(t.gateway.calls.filter(x=>x.name==='create-order').length,0);
});
test('missing or corrupt persisted journal fails closed',()=>{
 const storage=new MemoryStorage();new DeviceStore(storage);storage.data.delete('mcd.device.v1');assert.throws(()=>new DeviceStore(storage));
 storage.data.set('mcd.device.v1',{version:1,token:'',sessions:{},submissions:{x:{action_id:'x',session_id:'missing',status:'complete'}}});assert.throws(()=>new DeviceStore(storage));
});
test('token changes isolate accounts and do not retain old carts',async()=>{
 const storage=new MemoryStorage();new DeviceStore(storage).configure('first-token','first');const t=setup(storage);await cart(t);t.db.configure('second-token','second');assert.equal(t.db.latest(),undefined);assert.equal(t.db.account(),'second');t.db.configure('');assert.equal(t.db.token(),'');
});
test('timeout after order creation retains pending journal across restart; never retries',async()=>{
 const t=setup();await review(t);t.gateway.failAfterCreate=true;await t.send({type:'confirm',actionId:t.state.actionId});assert.equal(t.state.screen,'uncertain');
 const restored=setup(t.storage,t.gateway);await assert.rejects(restored.send({type:'start'}));assert.equal(restored.state.screen,'uncertain');assert.equal(t.gateway.calls.filter(x=>x.name==='create-order').length,1);
});
test('repricing requires renewed confirmation',async()=>{
 const t=setup();await review(t);const s=t.db.get(t.state.id)!;s.quoteAt=1;t.db.save(s);await t.send({type:'confirm',actionId:t.state.actionId});assert.equal(t.state.screen,'review');assert.equal(t.gateway.calls.filter(x=>x.name==='create-order').length,0);
});
test('address and claim writes run only after explicit device confirmation',async()=>{
 const t=setup();await t.send({type:'new-address'});for(const value of ['上海市','用户','13800138000','花园路','502'])await t.send({type:'input',value});assert.equal(t.state.screen,'address-confirm');assert.equal(t.gateway.calls.filter(x=>x.name==='delivery-create-address').length,0);await t.send({type:'confirm',actionId:t.state.actionId});assert.equal(t.gateway.calls.filter(x=>x.name==='delivery-create-address').length,1);
 await t.send({type:'available'});assert.equal(t.gateway.calls.filter(x=>x.name==='auto-bind-coupons').length,0);await t.send({type:'confirm',actionId:t.state.actionId});assert.equal(t.gateway.calls.filter(x=>x.name==='auto-bind-coupons').length,1);
});
test('SSE handles split UTF-8, multiline frames and JSON responses without duplicate messages',async()=>{
 const messages:any[]=[];const bytes=new TextEncoder().encode('data: {"jsonrpc":"2.0","id":1,"result":{"text":"中文"}}\r\n\r\n');const decoder=new TextDecoder(),parser=new EventParser(m=>messages.push(m));for(const byte of bytes)parser.push(decoder.decode(new Uint8Array([byte]),{stream:true}));parser.push(decoder.decode(),true);assert.equal(messages[0].result.text,'中文');assert.equal(messages.length,1);
 let headers:any;
 const api={request(o:any){headers=o.header;setTimeout(()=>o.success({statusCode:200,header:{'Content-Type':'application/json','Mcp-Session-Id':'session'},data:JSON.stringify({jsonrpc:'2.0',id:2,result:{}})}),0);return {abort(){}};}};
 const transport=new InkTransport(api,'test-token');transport.onmessage=m=>messages.push(m);await transport.start();await transport.send({jsonrpc:'2.0',id:2,method:'initialize'});transport.setProtocolVersion('2025-03-26');await transport.send({jsonrpc:'2.0',id:2,method:'tools/list'});assert.equal(headers['Mcp-Session-Id'],'session');assert.equal(headers['MCP-Protocol-Version'],'2025-03-26');await transport.close();
});
test('transport authorization, network failure and close are explicit errors',async()=>{
 for(const code of [401,429]){const transport=new InkTransport({request(o:any){setTimeout(()=>o.success({statusCode:code,header:{},data:''}),0);return {abort(){}};}},'test-token');await assert.rejects(transport.send({id:1,method:'tools/list'}),(e:any)=>e.status===code);}
 let aborted=false;const transport=new InkTransport({request(o:any){return {abort(){aborted=true;o.fail();}};}},'test-token');const pending=transport.send({id:1,method:'tools/list'});await transport.close();await assert.rejects(pending);assert.ok(aborted);
});
test('live gateway rejects changed tool contracts before issuing a call',async()=>{
 const api={request(o:any){const m=JSON.parse(o.data);setTimeout(()=>{if(m.id===undefined){o.success({statusCode:202,header:{},data:''});return;}const result=m.method==='initialize'?{protocolVersion:'2025-03-26',capabilities:{tools:{}},serverInfo:{name:'test',version:'1'}}:{tools:contracts.map(c=>({name:c.name,inputSchema:c.name==='now-time-info'?{type:'object',required:['changed']}:c.input,outputSchema:c.output}))};o.success({statusCode:200,header:{'content-type':'application/json'},data:JSON.stringify({jsonrpc:'2.0',id:m.id,result})});},0);return {abort(){}};}};
 const gateway=new DeviceGateway(api,'test-token');await gateway.tools();await assert.rejects(gateway.call('now-time-info'),/契约/);await gateway.close();
});

test('storage readback accepts JSON object key reordering',async()=>{
 class ReorderedStorage extends MemoryStorage {
  getStorageSync(k:string){const sort=(v:any):any=>Array.isArray(v)?v.map(sort):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(key=>[key,sort(v[key])])):v;return sort(super.getStorageSync(k));}
 }
 const t=setup(new ReorderedStorage());await review(t);await t.send({type:'confirm',actionId:t.state.actionId});assert.equal(t.state.screen,'payment');assert.equal(setup(t.storage,t.gateway).state.screen,'payment');
});

test('recovered quote accepts equivalent takeWay fields in different JSON key order',async()=>{
 const t=setup();await review(t);const s=t.db.get(t.state.id)!;
 s.price!.takeWayList=s.price!.takeWayList.map((x:any)=>Object.fromEntries(Object.entries(x).reverse()));t.db.save(s);
 const restored=setup(t.storage,t.gateway);await restored.send({type:'confirm',actionId:restored.state.actionId});assert.equal(restored.state.screen,'payment');assert.equal(t.gateway.calls.filter(x=>x.name==='create-order').length,1);
});

test('recovery queries the known journal order ID without resubmitting',async()=>{
 const t=setup();await review(t);const id=t.state.actionId!;t.db.begin(id,t.db.get(t.state.id)!,'order');t.db.finish(id,'uncertain','known-order');
 const restored=setup(t.storage,t.gateway);await restored.send({type:'reconcile'});assert.ok(t.gateway.calls.some(x=>x.name==='query-order'&&x.args.orderId==='known-order'));assert.equal(t.gateway.calls.filter(x=>x.name==='create-order').length,0);assert.ok(restored.db.pending());
});

test('coordinate capability probe respects the published schema and sends no tool call',async()=>{
 let toolCalls=0;
 const api={request(o:any){const m=JSON.parse(o.data);setTimeout(()=>{
  if(m.id===undefined){o.success({statusCode:202,header:{},data:''});return;}
  if(m.method==='tools/call')toolCalls++;
  const result=m.method==='initialize'?{protocolVersion:'2025-03-26',capabilities:{tools:{}},serverInfo:{name:'test',version:'1'}}:{tools:contracts.map(c=>({name:c.name,inputSchema:c.input,outputSchema:c.output}))};
  o.success({statusCode:200,header:{'content-type':'application/json'},data:JSON.stringify({jsonrpc:'2.0',id:m.id,result})});
 },0);return {abort(){}};}};
 const gateway=new DeviceGateway(api,'test-token');
 try{
  assert.equal(await gateway.supportsInput('query-nearby-stores',{searchType:3,beType:1,longitude:121,latitude:31}),false);
  assert.equal(await gateway.supportsInput('query-nearby-stores',{searchType:2,beType:1,city:'上海市',keyword:'人民广场'}),true);
  assert.equal(toolCalls,0);
 }finally{await gateway.close();}
});

test('cancellation pending survives device storage restart and only reconciles the bound order',async()=>{
 const t=setup();await review(t);await t.send({type:'confirm',actionId:t.state.actionId});await t.send({type:'begin-cancel'});await t.send({type:'cancel-reason',value:'1'});t.gateway.failure='cancel-order';const id=t.state.actionId;await t.send({type:'confirm',actionId:id});assert.equal(t.state.screen,'uncertain');
 const restored=setup(t.storage,t.gateway);assert.equal(restored.state.screen,'uncertain');assert.equal(restored.db.unresolved(restored.state.id)!.kind,'cancel');await restored.send({type:'reconcile'});assert.equal(t.gateway.calls.filter(x=>x.name==='cancel-order').length,1);t.gateway.orders[0].orderStatus='已取消';await restored.send({type:'reconcile'});assert.equal(restored.state.title,'已取消');assert.equal(restored.db.unresolved(restored.state.id),undefined);await restored.send({type:'confirm',actionId:id});assert.equal(t.gateway.calls.filter(x=>x.name==='cancel-order').length,1);
});
