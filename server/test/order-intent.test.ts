import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseOrderIntent,exactRequestedMeals} from '../../shared/order-intent.js';
import {Service} from '../../shared/service.js';
import {DeviceStore} from '../../device/storage.js';
import {MockGateway} from '../src/mock.js';
import type {Event} from '../../shared/types.js';
function setup(){const data=new Map<string,any>(),storage={getStorageSync:(k:string)=>data.get(k),setStorageSync:(k:string,v:any)=>data.set(k,structuredClone(v))};const db=new DeviceStore(storage),gateway=new MockGateway(),service=new Service(db,gateway);let state=service.create();return {db,gateway,service,storage,get state(){return state;},async send(e:Event){return state=await service.event(state.id,{...e,revision:state.revision});}};}
async function store(t:ReturnType<typeof setup>){await t.send({type:'search-stores',value:'上海市 人民广场'});await t.send({type:'store',id:'12345'});}
test('extract only spoken products/counts and explicit fulfillment, never treat packing as pickup',()=>{
 const cases:[string,any][]=[
 ['两份巨无霸、一份薯条，到店自取',{items:[{query:'巨无霸',quantity:2},{query:'薯条',quantity:1}],fulfillment:'pickup'}],
 ['请给我２份巨无霸和三杯可乐，麦乐送',{items:[{query:'巨无霸',quantity:2},{query:'可乐',quantity:3}],fulfillment:'delivery'}],
 ['我要麦乐鸡6块、1+1套餐，打包',{items:[{query:'麦乐鸡6块',quantity:1},{query:'1+1套餐',quantity:1}],fulfillment:undefined}],
 ['巨无霸两份，中份薯条',{items:[{query:'巨无霸',quantity:2},{query:'中份薯条',quantity:1}],fulfillment:undefined}],
 ['二十份巨无霸，不要配送，自取',{items:[{query:'巨无霸',quantity:20}],fulfillment:'pickup'}],
 ['巨无霸，自取或者配送',{items:[{query:'巨无霸',quantity:1}],fulfillment:undefined}],
 ['到店自取',{items:[],fulfillment:'pickup'}],
 ['麦乐鸡和苹果派',{items:[{query:'麦乐鸡',quantity:1},{query:'苹果派',quantity:1}],fulfillment:undefined}]
 ];for(const [text,expected]of cases)assert.deepEqual(parseOrderIntent(text),expected,text);
 assert.equal(parseOrderIntent('查看历史订单'),null);assert.equal(parseOrderIntent('你好'),null);
});
test('invalid quantities fail completely rather than partially adding requests',()=>{
 for(const q of ['零','0','21','二十一','一百'])assert.throws(()=>parseOrderIntent('两份薯条、'+q+'份巨无霸'),/1 至 20/);
 assert.throws(()=>parseOrderIntent('两份巨无霸三份'),/说清/);
});
test('exact matching never selects ambiguous, fuzzy or unavailable products',()=>{
 const meals=[{code:'a',name:'巨无霸'},{code:'b',name:'巨无霸'},{code:'c',name:'薯条',available:false}];
 assert.equal(exactRequestedMeals(meals,'巨无霸').length,2);assert.equal(exactRequestedMeals(meals,'巨无').length,0);assert.equal(exactRequestedMeals(meals,'薯条').length,0);
});
test('sequential requests use real details, keep quantities on back and only advance after add or skip',async()=>{
 const t=setup();await t.send({type:'start-order-intent',value:'两份巨无霸、一份中份薯条，到店自取'});assert.equal(t.state.screen,'location');await store(t);
 assert.equal(t.state.screen,'meal');assert.equal(t.state.presentation!.quantity,2);assert.equal(t.db.get(t.state.id)!.cart.length,0);
 await t.send({type:'quantity',value:4});await t.send({type:'back'});assert.equal(t.state.screen,'menu');await t.send({type:'meal',id:'bigmac'});assert.equal(t.state.presentation!.quantity,4);
 const rev=t.state.revision;await t.send({type:'add'});assert.equal(t.state.screen,'meal');assert.equal(t.state.presentation!.quantity,1);assert.equal(t.state.presentation!.orderProgress,'第2/2项');
 await assert.rejects(t.service.event(t.state.id,{type:'add',revision:rev}),/页面已更新/);assert.equal(t.db.get(t.state.id)!.cart.length,1);
 await t.send({type:'add'});assert.equal(t.state.screen,'cart');assert.deepEqual(t.db.get(t.state.id)!.cart.map(x=>x.item.quantity),[4,1]);assert.equal(t.db.get(t.state.id)!.orderDraft,undefined);
 assert.equal(t.gateway.calls.filter(x=>x.name==='query-meals').length,1);assert.ok(!t.gateway.calls.some(x=>['create-order','auto-bind-coupons','delivery-create-address'].includes(x.name)));
});
test('ambiguous and missing matches stay in five-item menu, skip is local and cart remains',async()=>{
 const t=setup();await t.send({type:'start-order-intent',value:'两份薯条、一份不存在的汉堡，到店自取'});await store(t);assert.equal(t.state.screen,'menu');assert.ok(t.state.rows.length<=5);
 await t.send({type:'meal',id:'fries'});assert.equal(t.state.presentation!.quantity,2);await t.send({type:'add'});assert.equal(t.state.screen,'menu');assert.equal(t.state.rows.length,0);assert.ok(t.state.actions.some(a=>a.event.type==='menu-search'));
 await t.send({type:'skip-order-item'});assert.equal(t.state.screen,'cart');assert.equal(t.db.get(t.state.id)!.cart.length,1);
});
test('queue survives device storage reopening, old sessions remain compatible',async()=>{
 const t=setup();await t.send({type:'start-order-intent',value:'两份巨无霸'});const reopened=new Service(new DeviceStore(t.storage),t.gateway);assert.equal(reopened.resume().screen,'fulfillment');await t.send({type:'fulfillment',value:'pickup'});await store(t);assert.equal(t.state.presentation!.quantity,2);
 await t.send({type:'skip-order-item'});assert.equal(new Service(new DeviceStore(t.storage),t.gateway).resume().screen,'cart');
});
test('detail failure retains queue, failed reads cannot duplicate added lines',async()=>{
 const t=setup();const original=t.gateway.call.bind(t.gateway);t.gateway.call=async(name,args)=>{if(name==='query-meal-detail'&&args?.code==='fries')throw Error('offline');return original(name,args);};
 await t.send({type:'start-order-intent',value:'两份巨无霸、一份中份薯条，到店自取'});await store(t);await t.send({type:'add'});assert.equal(t.state.screen,'menu');assert.match(t.state.presentation!.queryError,/详情/);assert.equal(t.db.get(t.state.id)!.cart.length,1);assert.equal(t.db.get(t.state.id)!.orderDraft!.index,1);
});
test('switching modes or stores preserves existing cart until explicit approval',async()=>{
 const t=setup();await t.send({type:'start-order-intent',value:'巨无霸，自取'});await store(t);await t.send({type:'add'});await t.send({type:'home'});await t.send({type:'start-order-intent',value:'两份薯条，麦乐送'});
 assert.equal(t.state.screen,'cart-change-confirm');assert.equal(t.db.get(t.state.id)!.cart.length,1);await t.send({type:'keep-cart'});assert.equal(t.state.screen,'cart');assert.equal(t.db.get(t.state.id)!.cart.length,1);
 await t.send({type:'home'});await t.send({type:'start-order-intent',value:'两份薯条，麦乐送'});await t.send({type:'approve-cart-change'});assert.equal(t.state.screen,'addresses');assert.equal(t.db.get(t.state.id)!.cart.length,0);
});

test('failed delivery can retry without losing requested quantities or showing fulfillment',async()=>{
 const t=setup();const original=t.gateway.call.bind(t.gateway);let fail=true;t.gateway.call=async(name,args)=>{if(name==='delivery-query-addresses'&&fail)throw Error('network offline');return original(name,args);};
 await t.send({type:'start-order-intent',value:'两份巨无霸，配送'});assert.equal(t.state.screen,'addresses');assert.match(t.state.presentation!.queryError,/网络连接失败/);assert.equal(t.db.get(t.state.id)!.orderDraft!.items[0].quantity,2);fail=false;
 // The existing retry is the original internal event; retrying a started queue must stay valid.
 const retry=t.state.actions.find(a=>a.label==='重试')!.event;await t.send(retry);assert.equal(t.state.screen,'addresses');assert.equal(t.state.presentation!.queryError,undefined);
});

test('failed approved switch remains recoverable and never restores a stale clear-cart prompt',async()=>{
 const t=setup();await t.send({type:'start-order-intent',value:'巨无霸，自取'});await store(t);await t.send({type:'add'});await t.send({type:'home'});await t.send({type:'start-order-intent',value:'两份薯条，配送'});
 const original=t.gateway.call.bind(t.gateway);t.gateway.call=async(name,args)=>{if(name==='delivery-query-addresses')throw Error('offline');return original(name,args);};
 await t.send({type:'approve-cart-change'});assert.equal(t.state.screen,'addresses');assert.equal(t.db.get(t.state.id)!.cartChange,undefined);assert.ok(!t.db.get(t.state.id)!.history.includes('cart-change-confirm'));assert.equal(t.state.actions.find(a=>a.label==='重试')!.event.type,'fulfillment');
});
