import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Service} from '../../shared/service.js';
import {DeviceStore} from '../../device/storage.js';
import {MockGateway} from '../src/mock.js';
import type {Event} from '../../shared/types.js';
async function cart(){
 const data=new Map<string,any>(),storage={getStorageSync:(k:string)=>data.get(k),setStorageSync:(k:string,v:any)=>data.set(k,structuredClone(v))};const db=new DeviceStore(storage),gateway=new MockGateway(),service=new Service(db,gateway);let state=service.create();
 const t={db,gateway,service,storage,get state(){return state;},async send(e:Event){return state=await service.event(state.id,{...e,revision:state.revision});}};
 await t.send({type:'start-order-intent',value:'两份巨无霸、一份中份薯条，自取'});await t.send({type:'search-stores',value:'上海市 人民广场'});await t.send({type:'store',id:'12345'});await t.send({type:'add'});await t.send({type:'add'});return t;
}
test('remove and undo preserve complete row, original position and quantities without MCP requests',async()=>{
 const t=await cart(),s=t.db.get(t.state.id)!,original=structuredClone(s.cart);await t.send({type:'quote'});await t.send({type:'cart'});const calls=t.gateway.calls.length;
 await t.send({type:'remove-line',id:original[0].id});assert.deepEqual(t.db.get(s.id)!.cart,[original[1]]);assert.ok(t.state.actions.some(a=>a.event.type==='undo-remove-line'));assert.match(t.state.presentation!.cartNotice,/×2/);
 const removed=t.db.get(s.id)!;for(const field of ['price','quoteAt','quoteHash','action','takeWayCode'])assert.equal((removed as any)[field],undefined);
 assert.ok(!Object.keys(removed).some(k=>/undo/i.test(k)));
 await t.send({type:'undo-remove-line'});assert.deepEqual(t.db.get(s.id)!.cart,original);assert.equal(t.gateway.calls.length,calls);assert.ok(!t.state.actions.some(a=>a.event.type==='undo-remove-line'));
 await t.send({type:'undo-remove-line'});assert.equal(t.db.get(s.id)!.cart.length,2);assert.match(t.state.presentation!.queryError,/没有可撤销/);
});
test('zero quantity has same undo behavior; latest deletion replaces previous snapshot',async()=>{
 const t=await cart(),original=t.db.get(t.state.id)!.cart;
 await t.send({type:'line-quantity',id:original[0].id,value:0});await t.send({type:'remove-line',id:original[1].id});assert.equal(t.state.rows.length,0);
 await t.send({type:'undo-remove-line'});assert.deepEqual(t.db.get(t.state.id)!.cart,[original[1]]);
});
test('cart edits, leaving the flow and reopening invalidate undo',async()=>{
 for(const event of [{type:'line-quantity',value:2},{type:'home'},{type:'menu'},{type:'edit-line'},{type:'checkout'}]){
  const t=await cart(),original=t.db.get(t.state.id)!.cart;await t.send({type:'remove-line',id:original[0].id});await t.send({...event,id:original[1].id});await t.send({type:'cart'});assert.ok(!t.state.actions.some(a=>a.event.type==='undo-remove-line'),event.type);
 }
 const t=await cart();await t.send({type:'remove-line',id:t.state.rows[0].id});const reopened=new Service(new DeviceStore(t.storage),t.gateway);assert.ok(!reopened.resume().actions.some(a=>a.event.type==='undo-remove-line'));
});
test('stale or duplicate deletions cannot remove another line or duplicate restored rows',async()=>{
 const t=await cart(),id=t.state.rows[0].id,revision=t.state.revision;await t.send({type:'remove-line',id});await assert.rejects(t.service.event(t.state.id,{type:'remove-line',id,revision}),/页面已更新/);
 await t.send({type:'remove-line',id});assert.equal(t.state.rows.length,1);assert.match(t.state.presentation!.queryError,/餐品已移除/);assert.ok(!t.state.actions.some(a=>a.label==='重试'));await t.send({type:'undo-remove-line'});assert.equal(t.state.rows.length,2);
});
test('pending submission protects opening, removal and undo from business changes',async()=>{
 const t=await cart(),s=t.db.get(t.state.id)!,original=s.cart;t.db.begin('pending-cart-test',s,'order');
 for(const e of [{type:'cart'},{type:'remove-line',id:original[0].id},{type:'undo-remove-line'}])await assert.rejects(t.service.event(s.id,{...e,revision:s.revision}),/待核实/);
 assert.deepEqual(t.db.get(s.id)!.cart,original);assert.equal(t.service.resume().screen,'uncertain');
});
test('clear entire cart and undo preserve specs, quantities and order without MCP or persisted snapshots',async()=>{
 const t=await cart();await t.send({type:'quote'});await t.send({type:'cart'});const s=t.db.get(t.state.id)!,original=structuredClone(s.cart),calls=t.gateway.calls.length;
 assert.ok(t.state.actions.some(a=>a.event.type==='clear-cart'));
 await t.send({type:'clear-cart'});assert.deepEqual(t.db.get(s.id)!.cart,[]);assert.match(t.state.presentation!.cartNotice,/共3份/);assert.equal(t.state.presentation!.undoAll,true);assert.ok(!t.state.actions.some(a=>a.event.type==='clear-cart'));
 for(const field of ['price','quoteAt','quoteHash','action','takeWayCode'])assert.equal((t.db.get(s.id)! as any)[field],undefined);
 await t.send({type:'clear-cart'});await t.send({type:'undo-remove-line'});assert.deepEqual(t.db.get(s.id)!.cart,original);assert.equal(t.gateway.calls.length,calls);
 await t.send({type:'clear-cart'});const reopened=new Service(t.db,t.gateway).resume();assert.ok(!reopened.actions.some(a=>a.event.type==='undo-remove-line'));
});
test('clear and single delete replace latest undo and clear respects pending protection',async()=>{
 const t=await cart(),original=structuredClone(t.db.get(t.state.id)!.cart);
 await t.send({type:'remove-line',id:original[0].id});await t.send({type:'clear-cart'});await t.send({type:'undo-remove-line'});assert.deepEqual(t.db.get(t.state.id)!.cart,[original[1]]);
 await t.send({type:'clear-cart'});await t.send({type:'undo-remove-line'});await t.send({type:'remove-line',id:original[1].id});await t.send({type:'undo-remove-line'});assert.deepEqual(t.db.get(t.state.id)!.cart,[original[1]]);
 await t.send({type:'clear-cart'});await t.send({type:'home'});await t.send({type:'cart'});assert.ok(!t.state.actions.some(a=>a.event.type==='undo-remove-line'));
 const s=t.db.get(t.state.id)!;t.db.begin('pending-clear',s,'order');await assert.rejects(t.service.event(s.id,{type:'clear-cart',revision:s.revision}),/待核实/);
});
