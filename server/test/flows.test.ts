import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../src/db.js';
import {Service} from '../src/service.js';
import {MockGateway} from '../src/mock.js';
import {context,lineItem,initialDetail,yuan,modification} from '../src/domain.js';
import {httpServer} from '../src/http.js';
import type {Event,Obj,View} from '../src/types.js';
function setup(path=':memory:'){
 const db=new Store(path),gateway=new MockGateway(),service=new Service(db,gateway);let state=service.create();
 const send=async(e:Event)=>{state=await service.event(state.id,{...e,revision:state.revision});return state;};
 return {db,gateway,service,send,get state(){return state;}};
}
async function cart(t:ReturnType<typeof setup>,delivery=false){
 await t.send({type:'start'});await t.send({type:'fulfillment',value:delivery?'delivery':'pickup'});
 if(delivery)await t.send({type:'address',id:'home'});else await t.send({type:'search-stores',value:'上海市 人民广场'});
 await t.send({type:'store',id:'12345'});await t.send({type:'meal',id:'burger'});await t.send({type:'add'});
 assert.equal(t.state.screen,'cart');
}
async function review(t:ReturnType<typeof setup>,delivery=false){
 await cart(t,delivery);await t.send({type:'checkout'});await t.send({type:'skip-coupon'});if(delivery)await t.send({type:'remark',value:'无接触配送'});
 assert.equal(t.state.screen,'review');if(!delivery)await t.send({type:'take-way',id:'take-away'});
}
test('pickup: real contract mapping, fresh quote, explicit confirmation and payment remain distinct',async()=>{
 const t=setup();try{await review(t);assert.equal(t.gateway.calls.filter(x=>x.name==='create-order').length,0);
 await t.send({type:'confirm',actionId:t.state.actionId});assert.equal(t.state.screen,'payment');
 const create=t.gateway.calls.find(x=>x.name==='create-order')!;
 assert.equal(create.args.orderType,1);assert.equal(create.args.takeWayCode,'take-away');assert.equal(create.args.beCode,undefined);assert.ok(create.args.items[0].roundList);assert.equal(t.gateway.calls.filter(x=>x.name==='calculate-price').length,2);
 await t.send({type:'query-order',id:'MOCK-1'});assert.equal(t.state.title,'订单待支付');
 }finally{t.db.close();}
});
test('delivery: existing address, beCode and remark map into order; no pickup field',async()=>{
 const t=setup();try{await review(t,true);await t.send({type:'confirm',actionId:t.state.actionId});const args=t.gateway.calls.find(x=>x.name==='create-order')!.args;assert.equal(args.addressId,'home');assert.equal(args.beCode,'56789');assert.equal(args.takeWayCode,undefined);assert.equal(args.remark,'无接触配送');}finally{t.db.close();}
});
test('address wizard validates phone, permits editing, and writes only on confirmation',async()=>{
 const t=setup();try{await t.send({type:'new-address'});for(const v of ['上海市','陈先生'])await t.send({type:'address-field',value:v});
 await t.send({type:'address-field',value:'123'});assert.equal(t.db.get(t.state.id)!.addressStep,2);assert.match(t.state.caption!,/11/);
 for(const v of ['13800138000','南京西路88号','501室'])await t.send({type:'address-field',value:v});
 assert.equal(t.state.screen,'address-confirm');assert.equal(t.gateway.calls.length,0);
 await t.send({type:'back'});assert.equal(t.state.input!.value,'501室');await t.send({type:'address-field',value:'501室'});assert.equal(t.state.screen,'address-confirm');
 await t.send({type:'edit-address'});assert.equal(t.state.input!.value,'上海市');
 for(const v of ['上海市','陈先生','13800138000','南京西路88号','501室'])await t.send({type:'address-field',value:v});
 await t.send({type:'confirm',actionId:t.state.actionId});assert.equal(t.gateway.calls.filter(x=>x.name==='delivery-create-address').length,1);
 await t.send({type:'back'});assert.equal(t.state.screen,'home');assert.ok(!t.state.summary.includes('undefined'));
 }finally{t.db.close();}
});
test('coupon selection requires product match; claim requires confirmation',async()=>{
 const t=setup();try{await cart(t);await t.send({type:'checkout'});await t.send({type:'coupon',id:'coupon1'});await t.send({type:'use-coupon'});await t.send({type:'tableware',value:true});await t.send({type:'now'});assert.equal(t.state.total,'¥27.00');
 assert.equal(t.gateway.calls.find(x=>x.name==='calculate-price')!.args.items[0].couponCode,'C1');
 await t.send({type:'home'});await t.send({type:'available'});assert.equal(t.gateway.calls.filter(x=>x.name==='auto-bind-coupons').length,0);await t.send({type:'confirm',actionId:t.state.actionId});assert.equal(t.gateway.calls.filter(x=>x.name==='auto-bind-coupons').length,1);
 }finally{t.db.close();}
});
test('double confirm and concurrent retry produce exactly one upstream create',async()=>{
 const t=setup();try{await review(t);const e={type:'confirm',actionId:t.state.actionId,revision:t.state.revision};await Promise.all([t.service.event(t.state.id,e),t.service.event(t.state.id,e)]);assert.equal(t.gateway.calls.filter(x=>x.name==='create-order').length,1);}finally{t.db.close();}
});
test('a changed or expired quote forces renewed confirmation without create',async()=>{
 const t=setup();try{await review(t);let s=t.db.get(t.state.id)!;s.quoteAt=Date.now()-130000;t.db.save(s);await t.send({type:'confirm',actionId:t.state.actionId});assert.equal(t.state.screen,'review');assert.equal(t.gateway.calls.filter(x=>x.name==='create-order').length,0);
 const old=t.state.actionId;const orig=t.gateway.call.bind(t.gateway);t.gateway.call=async(name,args)=>{const r=await orig(name,args);if(name==='calculate-price')r.price+=100;return r;};await t.send({type:'confirm',actionId:old});assert.notEqual(t.state.actionId,old);assert.equal(t.gateway.calls.filter(x=>x.name==='create-order').length,0);
 }finally{t.db.close();}
});
test('lost create response remains uncertain across restart and cannot be resent',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'mcd-test-'));const path=join(dir,'app.sqlite');const t=setup(path);
 try{await review(t);t.gateway.failAfterCreate=true;const actionId=t.state.actionId;await t.send({type:'confirm',actionId});assert.equal(t.state.screen,'uncertain');assert.equal(t.gateway.orders.length,1);
 const id=t.state.id;t.db.close();const db=new Store(path);try{const service=new Service(db,t.gateway);const state=service.state(id);assert.equal(state.screen,'uncertain');await service.event(id,{type:'confirm',actionId,revision:state.revision});assert.equal(t.gateway.calls.filter(x=>x.name==='create-order').length,1);await assert.rejects(service.event(id,{type:'start',revision:db.get(id)!.revision}),/待核实/);}finally{db.close();}
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('crash in submitting state is uncertain after restart',()=>{const dir=mkdtempSync(join(tmpdir(),'mcd-crash-'));try{let db=new Store(join(dir,'app.sqlite'));const service=new Service(db,new MockGateway());const v=service.create();const s=db.get(v.id)!;db.begin('lost-write',s,'order');db.close();db=new Store(join(dir,'app.sqlite'));assert.equal(db.submission('lost-write')!.status,'uncertain');db.close();}finally{rmSync(dir,{recursive:true,force:true});}});
test('network failures retain cart; arbitrary codes and unsupported operations never call upstream',async()=>{
 const t=setup();try{await cart(t);t.gateway.failure='calculate-price';await t.send({type:'quote'});assert.equal(t.db.get(t.state.id)!.cart.length,1);assert.match(t.state.caption!,/网络/);
 const n=t.gateway.calls.length;await t.send({type:'meal',id:'invented'});await t.send({type:'draw-lottery'});assert.equal(t.gateway.calls.length,n);
 }finally{t.db.close();}
});
test('amounts and actual live combo/choice modification shape serialize without guessing',()=>{
 assert.equal(yuan('29.90'),2990);assert.equal(yuan('0.1'),10);assert.throws(()=>yuan('invalid'));
 const real=JSON.parse(readFileSync('server/test/fixtures/live-meal.json','utf8'));const d=initialDetail(real,{code:real.code,name:real.name});const item=lineItem(d);assert.ok(item.roundList.length);assert.ok(item.roundList.every((r:Obj)=>typeof r.round==='string'));
 const drink=d.rounds.find((r:Obj)=>r.choices?.some((c:Obj)=>/可乐/.test(c.name)));const c=drink?.choices.find((c:Obj)=>c.quantity>0);if(c?.modification){const group=c.modification.items[0];for(const v of group.values)v.selectedQuantity=0;const selected=group.values.find((x:Obj)=>x.name==='去冰');selected.selectedQuantity=1;const m=modification(c.modification)!;assert.equal(m.values[0].key,selected.selectedKey);}
});
test('HTTP authentication, origin restriction, optimistic concurrency and no raw tool endpoint',async()=>{
 const t=setup();const key='test-key-at-least-20-characters';const server=httpServer(t.service,key);await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const addr=server.address() as any;const base=`http://127.0.0.1:${addr.port}`;
 try{assert.equal((await fetch(base+'/sessions',{method:'POST'})).status,401);assert.equal((await fetch(base+'/sessions',{method:'POST',headers:{Origin:'https://untrusted.example',Authorization:'Bearer '+key}})).status,403);assert.equal((await fetch(base+'/tools/call',{method:'POST',headers:{Authorization:'Bearer '+key}})).status,404);
 const result=await fetch(base+'/sessions/'+t.state.id+'/events',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({type:'start',revision:999})});assert.equal(result.status,409);
 }finally{await new Promise<void>(r=>server.close(()=>r()));t.db.close();}
});
test('reservation survives menu reload, customization and final pricing',async()=>{
 const t=setup();try{
 await cart(t);await t.send({type:'reservation'});await t.send({type:'schedule',value:'2030-10-18 12:00'});assert.equal(t.state.screen,'menu');assert.equal(t.db.get(t.state.id)!.cart.length,0);
 await t.send({type:'meal',id:'burger'});await t.send({type:'customize'});await t.send({type:'choose-round',id:'0:1'});await t.send({type:'back'});await t.send({type:'quantity',value:2});await t.send({type:'add'});
 await t.send({type:'checkout'});await t.send({type:'skip-coupon'});await t.send({type:'tableware',value:false});await t.send({type:'now'});
 assert.equal(t.state.screen,'review');const args=t.gateway.calls.filter(x=>x.name==='calculate-price').at(-1)!.args;assert.equal(args.reservationDate,'2030-10-18 12:00');assert.equal(args.items[0].quantity,2);assert.equal(args.items[0].roundList[0].comboItemList[0].code,'zero');
 await t.send({type:'immediate'});assert.equal(t.state.screen,'menu');assert.equal(t.db.get(t.state.id)!.reservationDate,undefined);assert.equal(t.db.get(t.state.id)!.cart.length,0);
 }finally{t.db.close();}
});
test('published coupon products are selectable and bind exact matching product codes',async()=>{
 const t=setup();try{await cart(t);const orig=t.gateway.call.bind(t.gateway);t.gateway.call=async(name,args)=>name==='query-store-coupons'?[{couponId:'coupon2',couponCode:'C2',title:'真实结构券',products:[{productCode:'bigmac',productName:'巨无霸'}]}]:orig(name,args);
 await t.send({type:'meal',id:'bigmac'});await t.send({type:'add'});await t.send({type:'checkout'});await t.send({type:'coupon',id:'coupon2'});assert.equal(t.state.rows[0].event.type,'coupon-product');await t.send({type:'coupon-product',id:'bigmac'});await t.send({type:'add'});await t.send({type:'checkout'});await t.send({type:'coupon',id:'coupon2'});await t.send({type:'use-coupon'});await t.send({type:'tableware',value:false});await t.send({type:'now'});
 assert.equal(t.state.screen,'review');assert.equal(t.gateway.calls.filter(x=>x.name==='calculate-price').at(-1)!.args.items[1].couponCode,'C2');
 }finally{t.db.close();}
});
test('successful submission and payment state persist atomically across restart',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'mcd-success-'));const path=join(dir,'app.sqlite');const t=setup(path);try{await review(t);const id=t.state.id,actionId=t.state.actionId!;await t.send({type:'confirm',actionId});t.db.close();const db=new Store(path);try{const service=new Service(db,t.gateway);const v=service.state(id);assert.equal(v.screen,'payment');assert.equal(db.get(id)!.cart.length,0);assert.equal(db.submission(actionId)!.status,'complete');await service.event(id,{type:'confirm',actionId,revision:v.revision});assert.equal(t.gateway.calls.filter(x=>x.name==='create-order').length,1);}finally{db.close();}}finally{rmSync(dir,{recursive:true,force:true});}
});
test('reconnection restores the last cart; unresolved writes block new and older sessions',async()=>{
 const t=setup();try{await cart(t);assert.equal(t.service.resume().id,t.state.id);assert.equal(t.db.get(t.service.resume().id)!.cart.length,1);const old=t.service.create();await review(t);t.gateway.failAfterCreate=true;await t.send({type:'confirm',actionId:t.state.actionId});assert.equal(t.service.create().id,t.state.id);assert.equal(t.service.resume().screen,'uncertain');await assert.rejects(t.service.event(old.id,{type:'start',revision:old.revision}),/待核实/);}finally{t.db.close();}
});
test('uncertain address and coupon actions reconcile through their own read APIs without resubmission',async()=>{
 for(const kind of ['address','claim']){const t=setup();try{
  if(kind==='claim')await t.send({type:'available'});else{await t.send({type:'new-address'});for(const value of ['上海市','陈先生','13800138000','南京西路88号','501室'])await t.send({type:'address-field',value});}
  const write=kind==='claim'?'auto-bind-coupons':'delivery-create-address';t.gateway.failure=write;await t.send({type:'confirm',actionId:t.state.actionId});assert.equal(t.state.screen,'uncertain');await t.send({type:'reconcile'});
  assert.equal(t.gateway.calls.at(-1)!.name,kind==='claim'?'query-my-coupons':'delivery-query-addresses');assert.equal(t.gateway.calls.filter(x=>x.name===write).length,1);assert.equal(t.gateway.calls.filter(x=>x.name==='order-list').length,0);
 }finally{t.db.close();}}
});

test('checkout only offers coupons whose published product codes bind to current cart',async()=>{
 const t=setup();try{await cart(t);const orig=t.gateway.call.bind(t.gateway);
 t.gateway.call=async(name,args)=>name==='query-store-coupons'?{coupons:[
 {couponId:'wrong',couponCode:'X',title:'板烧套餐优惠券',products:[{productCode:'other'}]},
 {couponId:'unknown',couponCode:'X',title:'通用券'},
 {couponId:'missing-code',products:[{productCode:'burger'}]},
 {couponId:'valid',couponCode:'V',title:'匹配券',products:[{productCode:'burger'}]}
 ]}:orig(name,args);
 await t.send({type:'checkout'});assert.equal(t.state.screen,'coupon-select');assert.deepEqual(t.db.get(t.state.id)!.coupons.map(x=>x.couponId),['valid']);
 assert.equal(t.gateway.calls.filter(x=>x.name==='create-order').length,0);
 }finally{t.db.close();}
});
test('checkout with no matching coupons skips selection, clears old coupon and returns to cart',async()=>{
 for(const coupons of [[],[{couponId:'wrong',couponCode:'X',products:[{productCode:'other'}]}]]){
 const t=setup();try{await cart(t);const s=t.db.get(t.state.id)!;s.coupon={couponId:'old',couponCode:'OLD',productCode:'burger'};t.db.save(s);
 const orig=t.gateway.call.bind(t.gateway);t.gateway.call=async(name,args)=>name==='query-store-coupons'?{coupons}:orig(name,args);
 await t.send({type:'checkout'});assert.equal(t.state.screen,'review');assert.equal(t.db.get(t.state.id)!.coupon,undefined);
 await t.send({type:'back'});assert.equal(t.state.screen,'cart');
 }finally{t.db.close();}}
});

test('checkout defaults skip intermediate screens, preserve reservation and resolve published title',async()=>{
 const t=setup();try{await cart(t);const orig=t.gateway.call.bind(t.gateway);t.gateway.call=async(name,args)=>{if(name==='query-store-coupons')return [];const result=await orig(name,args);if(name==='calculate-price')result.takeWayList=[{code:'eat-in',title:'堂食'},{code:'opaque-pack',title:'打包带走'}];return result;};
 const s=t.db.get(t.state.id)!;s.needTableware=true;s.reservationDate='2030-10-18 12:00';t.db.save(s);
 await t.send({type:'checkout'});assert.equal(t.state.screen,'review');assert.equal(t.db.get(t.state.id)!.needTableware,false);assert.equal(t.db.get(t.state.id)!.takeWayCode,'opaque-pack');assert.equal(t.db.get(t.state.id)!.reservationDate,'2030-10-18 12:00');assert.equal(t.state.rows.length,0);assert.ok(t.state.presentation!.receipt.some((r:Obj)=>r.title.includes('打包带走')));
 const old=t.state.actionId;await t.send({type:'review-tableware',value:true});assert.notEqual(t.state.actionId,old);assert.equal(t.db.get(t.state.id)!.needTableware,true);await t.send({type:'confirm',actionId:old});assert.equal(t.gateway.calls.filter(x=>x.name==='create-order').length,0);
 }finally{t.db.close();}
});
test('missing packing never defaults to dine-in; failed repricing removes confirmation',async()=>{
 const t=setup();try{await cart(t);const orig=t.gateway.call.bind(t.gateway);t.gateway.call=async(name,args)=>{if(name==='query-store-coupons')return [];const result=await orig(name,args);if(name==='calculate-price')result.takeWayList=[{code:'eat-in',title:'堂食'}];return result;};
 await t.send({type:'checkout'});assert.equal(t.state.screen,'review');assert.equal(t.db.get(t.state.id)!.takeWayCode,undefined);assert.equal(t.state.rows[0].title,'堂食');await t.send({type:'confirm',actionId:t.state.actionId});assert.equal(t.gateway.calls.filter(x=>x.name==='create-order').length,0);
 await t.send({type:'take-way',id:'eat-in'});t.gateway.failure='calculate-price';await t.send({type:'review-tableware',value:true});assert.equal(t.state.actionId,undefined);
 }finally{t.db.close();}
});

test('legacy checkout defaults and delivery keep remark without intermediate steps',async()=>{
 const t=setup();try{await cart(t,true);const s=t.db.get(t.state.id)!;s.screen='time';s.needTableware=true;t.db.save(s);await t.send({type:'checkout-defaults'});assert.equal(t.state.screen,'remark');assert.equal(t.db.get(t.state.id)!.needTableware,false);assert.equal(t.gateway.calls.filter(x=>x.name==='calculate-price').length,0);await t.send({type:'remark',value:''});assert.equal(t.state.screen,'review');assert.equal(t.gateway.calls.filter(x=>x.name==='create-order').length,0);
 }finally{t.db.close();}
});

async function pendingOrder(t:ReturnType<typeof setup>){await review(t);await t.send({type:'confirm',actionId:t.state.actionId});assert.equal(t.state.screen,'payment');}
test('cancel requires a published reason and confirmation, binds exact order and is idempotent',async()=>{
 for(const reason of ['1','2','3','4','5','-1']){const t=setup();try{await pendingOrder(t);await t.send({type:'begin-cancel'});assert.equal(t.state.screen,'cancel-reasons');await t.send({type:'cancel-reason',value:'constructor'});assert.equal(t.state.screen,'cancel-reasons');await t.send({type:'cancel-reason',value:reason});assert.equal(t.state.screen,'cancel-confirm');assert.equal(t.gateway.calls.filter(x=>x.name==='cancel-order').length,0);
 const actionId=t.state.actionId;await Promise.all([t.send({type:'confirm',actionId}),t.send({type:'confirm',actionId})]);assert.equal(t.state.title,'已取消');assert.equal(t.state.screen,'order-status');assert.equal(t.db.unresolved(t.state.id),undefined);const writes=t.gateway.calls.filter(x=>x.name==='cancel-order');assert.equal(writes.length,1);assert.deepEqual(writes[0].args,{orderId:'MOCK-1',cancelReasonCode:reason});
 }finally{t.db.close();}}
});
test('cancel is unavailable without supported input and refreshed payment status prevents stale cancellation',async()=>{
 const t=setup();try{await pendingOrder(t);t.gateway.supportsInput=async()=>false;await t.send({type:'begin-cancel'});assert.equal(t.state.screen,'payment');assert.match(t.state.caption!,/手机/);t.gateway.supportsInput=async()=>true;await t.send({type:'begin-cancel'});await t.send({type:'cancel-reason',value:'1'});t.gateway.orders[0].orderStatus='已支付';await t.send({type:'confirm',actionId:t.state.actionId});assert.equal(t.state.screen,'order-status');assert.equal(t.state.actionId,undefined);assert.equal(t.gateway.calls.filter(x=>x.name==='cancel-order').length,0);
 }finally{t.db.close();}
});
test('cancel rejected, ambiguous or lost response never falsely claims success or retries',async()=>{
 for(const outcome of ['rejected','lost','inconsistent','lost-after-cancel']){const t=setup();try{await pendingOrder(t);await t.send({type:'begin-cancel'});await t.send({type:'cancel-reason',value:'2'});const orig=t.gateway.call.bind(t.gateway);let calls=0;t.gateway.call=async(name,args)=>{if(name==='cancel-order'){calls++;if(outcome==='lost-after-cancel'){await orig(name,args);throw new Error('lost');}if(outcome==='lost')throw new Error('lost');return {orderId:args?.orderId,cancelResult:outcome!=='rejected'};}return orig(name,args);};
 const action=t.state.actionId;await t.send({type:'confirm',actionId:action});
 if(outcome==='rejected'){assert.equal(t.state.screen,'payment');assert.equal(t.db.unresolved(t.state.id),undefined);assert.match(t.state.caption!,/未同意/);}
 else if(outcome==='lost-after-cancel'){assert.equal(t.state.title,'已取消');assert.equal(t.db.unresolved(t.state.id),undefined);}
 else{assert.equal(t.state.screen,'uncertain');assert.equal(t.db.unresolved(t.state.id)!.kind,'cancel');assert.equal(t.db.unresolved(t.state.id)!.order_id,'MOCK-1');await t.send({type:'reconcile'});await t.send({type:'confirm',actionId:action});assert.equal(t.state.screen,'uncertain');}
 assert.equal(calls,1);
 }finally{t.db.close();}}
});
