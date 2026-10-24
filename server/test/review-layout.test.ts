import {test} from 'node:test';
import assert from 'node:assert/strict';
import {view} from '../../shared/view.js';
import type {Session} from '../../shared/types.js';
function session():Session{return {id:'test',revision:0,mode:'mock',screen:'review',history:[],fulfillment:'pickup',stores:[],addresses:[],addressDraft:{},addressStep:0,meals:[],cart:[{id:'a',name:'巨无霸',item:{productCode:'a',quantity:2}}],coupons:[],needTableware:false,remark:'',orders:[],takeWayCode:'pack',price:{price:5300,takeWayList:[{code:'pack',title:'打包带走'}],productList:[{productCode:'a',quantity:2,subtotal:5300}]}};}
test('review shows quoted line subtotal and one combined preference row',()=>{
 const s=session(),rows=view(s).presentation!.receipt;
 assert.equal(rows[0].value,'¥53.00');assert.equal(rows[0].title,'巨无霸 ×2');
 assert.equal(rows.filter((r:any)=>r.kind==='preferences').length,1);
 assert.equal(rows[1].title,'立即安排 · 无需餐具 · 打包带走');
 s.reservationDate='2030-10-18 12:00';s.needTableware=true;
 assert.equal(view(s).presentation!.receipt[1].title,'2030-10-18 12:00 · 需要餐具 · 打包带走');
});
test('review never invents or ambiguously assigns product prices',()=>{
 const s=session();const price=()=>view(s).presentation!.receipt[0].value;
 for(const subtotal of [0,99999999]){s.price!.productList[0].subtotal=subtotal;assert.equal(price(),subtotal===0?'¥0.00':'¥999999.99');}
 s.price!.productList[0].subtotal=-1;assert.equal(price(),'价格待核实');
 s.price!.productList[0].subtotal=5300;s.price!.productList[0].quantity=1;assert.equal(price(),'价格待核实');
 s.price!.productList[0].quantity=2;s.cart.push({...s.cart[0],id:'b'});assert.equal(price(),'价格待核实');s.cart.pop();
 s.price!.productList.push({...s.price!.productList[0]});assert.equal(price(),'价格待核实');
 s.price!.productList=[];assert.equal(price(),'价格待核实');
});
