import {UserError} from '../domain/types.js';
export interface OrderRequest {query:string;quantity:number}
export interface OrderIntent {items:OrderRequest[];fulfillment?:'pickup'|'delivery'}
export interface OrderDraft extends OrderIntent {index:number;selectedCode?:string;selectionQuantity?:number}
const digits:Record<string,number>={'零':0,'〇':0,'一':1,'二':2,'两':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9};
function number(text:string){
 if(/^\d+$/.test(text))return Number(text);
 if(text.includes('百'))return 100;
 if(text.includes('十')){const [a,b]=text.split('十');return (a?digits[a]:1)*10+(b?digits[b]:0);}
 return digits[text];
}
const count='([零〇一二两三四五六七八九十百\\d]+)\\s*(?:份|个|杯|盒|套(?!餐))';
const modes='到店自取|到店取餐|自取|自提|麦乐送|外送|配送|送餐|送到家';
export function parseOrderIntent(raw:string):OrderIntent|null {
 const original=String(raw||'').trim().replace(/[０-９]/g,c=>String(c.charCodeAt(0)-0xff10));
 if(!original||original.length>500)return null;
 if(/^(?:查|查看|查询|历史|我的).*(?:订单|优惠券|营养|积分|活动)/.test(original))return null;
 if(!new RegExp(count+'|'+modes+'|想吃|要吃|想要|我要|点餐|来份|来个|巨无霸|堡|薯条|麦乐鸡|可乐|咖啡|套餐|冰淇淋').test(original))return null;
 const choices=new Set<'pickup'|'delivery'>();
 for(const m of original.matchAll(new RegExp(modes,'g'))){
  if(/(?:不要|不用|不是|别|不)$/.test(original.slice(0,m.index)))continue;
  choices.add(/到店|自取|自提/.test(m[0])?'pickup':'delivery');
 }
 const text=original.replace(new RegExp('(?:不要|不用|不是|别|不)?(?:'+modes+')','g'),'')
  .replace(/(?:打包带走|打包|带走|堂食|店内用餐)/g,'')
  .replace(/(?:谢谢|就行|就好|吧)[。！!？?\s]*$/,'').replace(/[。！!？?]/g,'');
 const pieces=text.split(new RegExp('[，,、；;]|以及|还有|再来|加上|另外|(?:和|跟)(?!风)')).filter(Boolean);
 const items:OrderRequest[]=[];
 for(let piece of pieces){
  piece=piece.trim().replace(/^(?:(?:请|麻烦|给我|帮我|我想吃|我想要|想吃|要吃|想要|我要|开始点餐|点餐|来份|来个|来|要|点)\s*)+/,'').trim();
  if(!piece||/^(?:或者|还是|或|和)$/.test(piece))continue;
  if(/^(?:不要|不用|不想|别)/.test(piece))throw new UserError('请只说本次想点的餐品，或分开选择。');
  const all=[...piece.matchAll(new RegExp(count,'g'))];
  const chunks=all.length>1&&all[0].index===0?all.map((m,i)=>piece.slice(m.index,all[i+1]?.index)): [piece];
  for(let chunk of chunks){
   let quantity=1;const prefix=chunk.match(new RegExp('^'+count)),suffix=chunk.match(new RegExp(count+'$'));
   if(prefix&&suffix&&prefix[0]!==chunk)throw new UserError('请把每种餐品和数量分开说，例如两份巨无霸、一份薯条。');
   if(prefix){quantity=number(prefix[1]);chunk=chunk.slice(prefix[0].length);}
   else if(suffix){quantity=number(suffix[1]);chunk=chunk.slice(0,-suffix[0].length);}
   chunk=chunk.trim();
   if(!chunk||new RegExp(count).test(chunk))throw new UserError('请说清每种餐品及数量。');
   if(!Number.isInteger(quantity)||quantity<1||quantity>20)throw new UserError('每种餐品数量可选 1 至 20 份，请重新说。');
   items.push({query:chunk,quantity});
  }
 }
 return {items,fulfillment:choices.size===1?[...choices][0]:undefined};
}
export function exactRequestedMeals(meals:any[],query:string){
 const normalize=(v:any)=>String(v??'').replace(/[\s，。！？、（）()]/g,'');
 return meals.filter(x=>x.available!==false&&x.unavailable!==true&&normalize(x.name)===normalize(query));
}
