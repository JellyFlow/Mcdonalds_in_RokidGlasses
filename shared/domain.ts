import {clone,canonical} from './platform.js';
import type {Obj,Session} from './types.js';
import {UserError} from './types.js';
export function yuan(value:any):number {
 const str=String(value??'').trim();if(!/^\d+(\.\d{1,2})?$/.test(str))throw new UserError('价格格式暂不支持，请重新查询。');
 const [a,b='']=str.split('.');const n=Number(a)*100+Number(b.padEnd(2,'0'));if(!Number.isSafeInteger(n))throw new UserError('金额超出范围。');return n;
}
export const money=(n:any)=>Number.isSafeInteger(n)?'¥'+(n/100).toFixed(2):'以算价为准';
export const plain=(v:any)=>String(v??'').replace(/<[^>]*>/g,' ').replace(/!\[[^\]]*\]\([^)]*\)/g,'').replace(/\[([^\]]+)\]\([^)]*\)/g,'$1').replace(/[#_`]/g,'').trim();
export function array(data:any,keys=['list','items','coupons','addresses','stores','foods']):Obj[]{if(Array.isArray(data))return data;for(const k of keys)if(Array.isArray(data?.[k]))return data[k];return [];}
export const roundChoices=(r:Obj):Obj[]=>r.choices??r.items??r.comboItemList??[];
export function initialDetail(raw:Obj,meal:Obj){
 const d=clone(raw);d.code??=meal.code;d.name??=meal.name;d.image??=meal.image;d.quantity=1;
 for(const r of d.rounds??[])for(const c of roundChoices(r)){c.quantity=Number(c.quantity??(c.isDefault?1:0));}
 return d;
}
export function modification(raw:Obj|undefined){
 if(!raw?.items)return undefined;
 const values:Obj[]=[];
 for(const g of raw.items){
  const selected=(g.values??[]).filter((v:Obj)=>Number(v.selectedQuantity??0)>0);
  const count=selected.reduce((n:number,v:Obj)=>n+Number(v.selectedQuantity),0);
  if(count<Number(g.minValues??0)||count>Number(g.maxValues??Infinity))throw new UserError('请完成必选特调，再加入购物车。');
  for(const v of g.values??[]){const quantity=Number(v.selectedQuantity??0);const key=quantity?v.selectedKey:v.unselectedKey;
   if(key!==undefined)values.push({code:String(v.code),quantity,key:String(key)});
  }
 }
 return values.length?{values}:undefined;
}
export function lineItem(d:Obj):Obj{
 const item:Obj={productCode:String(d.code),quantity:Number(d.quantity)};
 if(!Number.isInteger(item.quantity)||item.quantity<1||item.quantity>20)throw new UserError('每种餐品数量须为 1 至 20。');
 const mod=modification(d.modification);if(mod)item.modification=mod;
 if(d.rounds?.length)item.roundList=d.rounds.map((r:Obj)=>{
  const choices=roundChoices(r).filter((c:Obj)=>c.quantity>0);
  const count=choices.reduce((n:number,c:Obj)=>n+Number(c.quantity),0);
  if(count<Number(r.minQuantity??r.quantity??1)||count>Number(r.maxQuantity??r.quantity??1))throw new UserError('套餐子项数量不符合要求，请调整。');
  return {round:String(r.id??r.round),comboItemList:choices.map((c:Obj)=>{const result:Obj={code:String(c.code),quantity:Number(c.quantity)};const mod=modification(c.modification);if(mod)result.modification=mod;return result;})};
 });
 return item;
}
export function context(s:Session):Obj{
 if(!s.store)throw new UserError('请先选择门店。');
 const args:Obj={storeCode:String(s.store.storeCode),orderType:s.fulfillment==='pickup'?1:2,beType:s.fulfillment==='pickup'?1:2};
 if(s.fulfillment==='delivery'){if(!s.store.beCode)throw new UserError('门店缺少配送业务编码，请换一家。');args.beCode=String(s.store.beCode);}
 if(s.reservationDate)args.reservationDate=s.reservationDate;
 return args;
}
export function priceArgs(s:Session){
 const args:Obj={...context(s),needTableware:s.needTableware,items:s.cart.map(x=>clone(x.item))};
 if(!args.items.length)throw new UserError('购物车为空，请先选择餐品。');
 if(s.coupon){
  const codes=(s.coupon.products??[]).map((p:Obj)=>String(p.productCode));
  if(s.coupon.productCode)codes.push(String(s.coupon.productCode));
  const target=args.items.find((x:Obj)=>codes.includes(x.productCode));
  if(!target)throw new UserError('优惠券对应的餐品未在购物车中，请选择匹配的券。');
  if(!s.coupon.couponId||!s.coupon.couponCode)throw new UserError('该券暂不支持用于当前订单。');
  target.couponId=String(s.coupon.couponId);target.couponCode=String(s.coupon.couponCode);
 }
 const withOrders=s.cart.filter(x=>x.withOrder).map(x=>x.withOrder);
 if(withOrders.length>1)throw new UserError('每单最多选择一种随单购权益。');
 if(withOrders.length){const w=withOrders[0];args.withOrder={...w};if(w.specId){args.withOrder.membershipSpecId=w.specId;delete args.withOrder.specId;}}
 return args;
}
export const fingerprint=(args:Obj)=>canonical(args);
export function toggleMod(raw:Obj,gIndex:number,vIndex:number){
 const group=raw?.items?.[gIndex],v=group?.values?.[vIndex];if(!v)throw new UserError('特调选项已失效。');
 if(group.maxValues===1&&group.minValues===1){for(const x of group.values)x.selectedQuantity=0;v.selectedQuantity=1;}
 else {const next=Number(v.selectedQuantity??0)>0?Number(v.minQuantity??0):Math.min(Number(v.maxQuantity??1),1);v.selectedQuantity=next;}
}

// Labels are presentation only; order parameters always retain the published code.
export function takeWayLabel(option:Obj):string {
 const text=String(option.title??option.name??option.desc??'').trim();
 const key=String(option.code??'').toLowerCase();
 if(/打包|带走|外带/.test(text)||['take-away','takeaway','take-in-store'].includes(text.toLowerCase()||key))return '打包带走';
 if(/堂食|店内用餐/.test(text)||['eat-in','dine-in'].includes(text.toLowerCase()||key))return '堂食';
 return /[\u4e00-\u9fff]/.test(text)?text:'其他取餐方式';
}

export const cancelReasons:Obj={'1':'改主意了','2':'重复下单','3':'点错了/点多了/点少了','4':'地址/电话填错了','5':'送达时间选错了','-1':'其他原因'};
export function orderCancelled(order:Obj){return [order.orderStatusTitle,order.orderStatus].some(value=>/^(?:订单)?(?:已取消|取消成功)$|^cancelled$|^canceled$/i.test(String(value??'').trim()));}
export function orderPendingPayment(order:Obj){if(orderCancelled(order))return false;return [order.orderStatusTitle,order.orderStatus].some(value=>/待支付|待付款|未支付/.test(String(value??'')));}

export function orderDesktopExitAllowed(order:Obj){
 if(orderCancelled(order)||orderPendingPayment(order))return false;
 const allowed=new Set(["餐厅配餐中","配餐中","制作中","餐品制作中","待取餐","等待取餐","待取货","配送中","骑手配送中","已完成","订单已完成","交易完成"]);
 return [order.orderStatusTitle,order.orderStatus].some(value=>allowed.has(String(value??"" ).trim()));
}
