import {clone} from '../../shared/platform/index.js';
import type { Gateway, Obj } from '../types/index.js';
const stores=[{storeCode:'12345',beCode:'56789',storeName:'麦当劳人民广场餐厅',address:'上海市黄浦区南京西路 88 号',distance:'350米',businessStatus:true,reservation:true,reservationTimeOptions:[{date:'2030-10-18',reservationOptionText:'午餐(10:30至15:29)'}]}];
const meals:Obj={burger:{name:'板烧鸡腿堡套餐',currentPrice:'29.9',image:'/assets/chicken.png'},bigmac:{name:'巨无霸',currentPrice:'25',image:'/assets/bigmac.png'},fries:{name:'中份薯条',currentPrice:'12',image:'/assets/fries.png'}};
export class MockGateway implements Gateway {
 mode='mock' as const; calls:{name:string;args:Obj}[]=[]; orders:Obj[]=[]; failure?:string; failAfterCreate=false;
 async tools(){return [];}
 async supportsInput(name:string,args:Obj){return name==='cancel-order'&&!!args.orderId&&['1','2','3','4','5','-1'].includes(args.cancelReasonCode);}
 async call(name:string,args:Obj={}){
  this.calls.push({name,args:clone(args)});
  if(this.failure===name)throw new Error('simulated unavailable');
  switch(name){
   case 'now-time-info':return {datetime:'2030-10-17 12:00:00'};
   case 'query-nearby-stores':case 'delivery-query-stores':return clone(stores);
   case 'delivery-query-addresses':return {addresses:[{addressId:'home',contactName:'陈先生',phone:'138****1234',fullAddress:'上海市黄浦区南京西路 88 号 501 室'}]};
   case 'delivery-create-address':return {addressId:'new-address',contactName:args.contactName,phone:'138****1234',fullAddress:args.city+args.address+args.addressDetail};
   case 'query-meals':return {categories:[{name:'人气热卖',meals:Object.keys(meals).map(code=>({code}))}],meals};
   case 'query-meal-detail':return {...meals[args.code],code:args.code,price:meals[args.code]?.currentPrice,rounds:args.code==='burger'?[{round:'drink',name:'饮料',minQuantity:1,maxQuantity:1,items:[{code:'cola',name:'可口可乐中杯',quantity:1},{code:'zero',name:'无糖可口可乐中杯',quantity:0}]}]:[],modification:{items:[{minValues:0,maxValues:1,values:[{code:'ice',name:'冰块',minQuantity:0,maxQuantity:1,selectedQuantity:1,selectedKey:'0-1',unselectedKey:'0-0'}]}]}};
   case 'query-store-coupons':case 'query-my-coupons':case 'available-coupons':return {coupons:[{couponId:'coupon1',couponCode:'C1',name:'板烧套餐优惠券',productCode:'burger',description:'以实时算价为准'}]};
   case 'auto-bind-coupons':return {message:'领取成功'};
   case 'calculate-price':{
    const productPrice=(args.items??[]).reduce((sum:number,x:Obj)=>sum+Math.round(Number(meals[x.productCode]?.currentPrice??0)*100)*x.quantity,0);
    const deliveryPrice=args.orderType===2?600:0;const discount=args.items.some((x:Obj)=>x.couponId)?300:0;
    return {productList:(args.items??[]).map((x:Obj)=>({productCode:x.productCode,productName:meals[x.productCode]?.name,quantity:x.quantity,subtotal:Math.round(Number(meals[x.productCode]?.currentPrice??0)*100)*x.quantity})),productPrice,deliveryPrice,discount,tablewarePrice:args.needTableware?10:0,price:productPrice+deliveryPrice-discount+(args.needTableware?10:0),takeWayList:args.orderType===1?[{code:'take-away',name:'打包带走'},{code:'eat-in',name:'店内用餐'}]:[]};
   }
   case 'create-order':{
    const order={orderId:'MOCK-'+(this.orders.length+1),orderStatus:'待支付',storeName:stores[0].storeName,orderProductList:args.items.map((x:Obj)=>({...x,productName:meals[x.productCode]?.name})),realTotalAmount:'29.90',createTime:new Date().toISOString(),storeCode:args.storeCode,beType:String(args.beType)};
    this.orders.push(order);if(this.failAfterCreate)throw new Error('created but response lost');
    return {orderId:order.orderId,payH5Url:'https://example.invalid/mock-pay',orderDetail:order};
   }
   case 'cancel-order':{const order=this.orders.find(o=>o.orderId===args.orderId);if(!order)return {orderId:args.orderId,cancelResult:false};order.orderStatus='已取消';return {orderId:args.orderId,cancelResult:true};}
   case 'order-list':return {list:this.orders};
   case 'query-order':return this.orders.find(o=>o.orderId===args.orderId)??{orderId:args.orderId,orderStatus:'待支付',storeName:stores[0].storeName};
   case 'list-nutrition-foods':return [{productName:'板烧鸡腿堡',energyKcal:409,protein:23.1,fat:16.6}];
   case 'query-my-account':return {availablePoints:1234,expiringPoints:100};
   case 'campaign-calendar':return '本月美味活动\n早餐时段供应超值早餐，具体活动以门店为准。';
   default:throw new Error('Unknown mock tool');
  }
 }
 async close(){}
}
