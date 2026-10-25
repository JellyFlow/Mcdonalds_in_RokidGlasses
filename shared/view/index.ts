import type {Session,View,Event,Obj,Row} from '../domain/types.js';
import {menuBatch} from '../menu/index.js';
import {array,money,plain,roundChoices,yuan,takeWayLabel,cancelReasons,orderCancelled,orderPendingPayment,orderDesktopExitAllowed} from '../domain/index.js';
export function view(s:Session):View{
 const batch=s.screen==='menu'?menuBatch(s.meals,s.menuQuery,s.menuBatch):undefined;
 const v:View={id:s.id,revision:s.revision,mode:s.mode,screen:s.screen,title:'麦当劳',summary:'',rows:[],actions:[],caption:s.mode==='mock'?'演示数据 · 不产生真实订单':'真实 MCP · 下单前请确认'};
 const row=(id:string,title:string,event:Event,subtitle='',image?:string,price?:string,selected=false)=>v.rows.push({id,title:plain(title),subtitle:plain(subtitle),image,price,event,selected});
 const action=(label:string,event:Event)=>v.actions.push({label,event});
 const input=(placeholder:string,value='')=>v.input={placeholder,value};
 const back=()=>action('返回',{type:'back'});
 const cartSummary=()=>s.cart.map(x=>`${x.name} ×${x.item.quantity}`).join('\n');
 switch(s.screen){
  case 'home':
   v.title='麦当劳 AI 助手';v.summary='想吃什么，告诉我';
   row('start','开始点餐',{type:'start'},'到店自取 / 麦乐送');
   for(const [id,title] of [['wallet','我的优惠券'],['orders','历史订单'],['nutrition','餐品营养'],['account','我的积分'],['campaign','活动日历']])row(id,title,{type:'query',value:id});break;
  case 'fulfillment':v.title='就餐方式';row('pickup','到店自取',{type:'fulfillment',value:'pickup'},'到店取餐，随取随走');row('delivery','麦乐送',{type:'fulfillment',value:'delivery'},'送到你身边');back();break;
  case 'location':v.title='选择附近门店';v.summary='输入城市和位置，或使用当前位置';input('上海市 人民广场');action('当前位置',{type:'locate'});back();break;
  case 'stores':v.title='选择门店';v.summary=s.stores.length?'请选择营业中的餐厅':'未找到可用门店，请返回更换位置或地址';for(const x of s.stores)row(String(x.storeCode),x.storeName,{type:'store',id:String(x.storeCode)},[x.distance,x.address,x.businessStatus===false?'暂停营业':'营业中'].filter(Boolean).join(' · '));back();break;
  case 'addresses':v.title='选择外送地址';v.summary=s.addresses.length?'请选择配送地址':'暂无配送地址';for(const x of s.addresses)row(String(x.addressId),x.fullAddress,{type:'address',id:String(x.addressId)},`${x.contactName??''} ${x.phone??''}`);action('新增地址',{type:'new-address'});back();break;
  case 'address-entry':{
   const labels=['城市','联系人姓名','手机号码','街道与小区','楼栋与门牌'];const keys=['city','contactName','phone','address','addressDetail'];
   v.title=`补充${labels[s.addressStep]}`;v.summary=`第 ${s.addressStep+1} / 5 步 · 说出或输入${labels[s.addressStep]}`;input(labels[s.addressStep],s.addressDraft[keys[s.addressStep]]??'');back();break;
  }
  case 'address-confirm':v.title='确认新增地址';v.summary=`${s.addressDraft.city}${s.addressDraft.address}\n${s.addressDraft.addressDetail}\n${s.addressDraft.contactName} ${String(s.addressDraft.phone).replace(/(\d{3})\d{4}(\d{4})/,'$1****$2')}`;action('确认保存',{type:'confirm',actionId:s.action?.id});action('修改',{type:'edit-address'});back();break;
  case 'menu':{const current=batch!;v.title='选择餐品';v.summary=current.count?(s.menuQuery?'按需求匹配 · '+current.count+' 项':''):'没有匹配的餐品，可重新说需求或说“全部餐品”';for(const x of current.items){let price='';try{price=money(yuan(x.currentPrice??x.price));}catch{}row(x.code,x.name,{type:'meal',id:String(x.code)},x.discountType??'',x.image,price);}if(!current.count){if(s.meals.length){action('全部餐品',{type:'menu-search',value:''});action('重新说需求',{type:'listen'});}else action('重新加载',{type:'menu'});}else if(current.pages>1)action('换一批',{type:'menu-batch'});action(`购物车 ${s.cart.length}`,{type:'cart'});back();break;}
  case 'meal':{
   v.title='套餐详情';v.hero=s.selected?.image;v.summary=s.selected?.name??'';
   const n=s.selected?.quantity??1;row('minus','减少数量',{type:'quantity',value:Math.max(1,n-1)},`当前数量 ${n}`);row('plus','增加数量',{type:'quantity',value:Math.min(20,n+1)},`当前数量 ${n}`);
   const meal=s.meals.find(x=>x.code===s.selected?.code);if(meal?.withOrder)row('membership',s.selected?.wantWithOrder?'已选择随单购权益':'随单购会员权益',{type:'with-order'},'会额外购买会员权益，最终金额以算价为准',undefined,undefined,s.selected?.wantWithOrder);
   action((s.selected?.rounds?.length||s.selected?.modification)?'选饮料与口味':s.selected?.editId?'保存修改':'加入购物车',{type:(s.selected?.rounds?.length||s.selected?.modification)?'customize':'add'});back();break;
  }
  case 'customize':{
   v.title='饮料与特调';v.summary=s.selected?.name??'';
   const mods=(raw:Obj|undefined,scope:string,r=-1,c=-1)=>{for(const [gIndex,g] of (raw?.items??[]).entries())for(const [vIndex,x] of (g.values??[]).entries())row(`mod:${scope}:${r}:${c}:${gIndex}:${vIndex}`,x.name,{type:'mod',id:`${scope}:${r}:${c}:${gIndex}:${vIndex}`},`已选 ${x.selectedQuantity??0} · 本组需选 ${g.minValues??0}–${g.maxValues??1}`,undefined,undefined,Number(x.selectedQuantity)>0);};
   mods(s.selected?.modification,'main');
   for(const [rIndex,r] of (s.selected?.rounds??[]).entries()){
    for(const [cIndex,c] of roundChoices(r).entries()){
     row(`round:${rIndex}:${cIndex}`,c.name,{type:'choose-round',id:`${rIndex}:${cIndex}`},`${r.name??'套餐子项'} ${c.diffPrice??''}`,undefined,undefined,c.quantity>0);
     if(c.quantity>0)mods(c.modification,'choice',rIndex,cIndex);
    }
   }
   if(!v.rows.length)v.summary='该餐品无需特调';action(s.selected?.editId?'保存修改':'加入购物车',{type:'add'});back();break;
  }
  case 'cart':v.title='购物车';v.summary=s.cart.length?s.store?.storeName??'':'购物车还是空的';for(const x of s.cart){row(x.id,x.name,{type:'edit-line',id:x.id},`点击修改饮料与口味`,x.image);v.rows[v.rows.length-1].quantity=x.item.quantity;}action('继续加餐',{type:'menu'});if(s.cart.length){action('去结算',{type:'checkout'});action('清空购物车',{type:'clear-cart'});}back();break;
  case 'coupon-select':v.title='选择优惠';v.summary=s.coupons.length?'选择适合当前餐品的优惠券':'暂无可用优惠，可继续结算';for(const x of s.coupons)row(String(x.couponId??x.id),x.name??x.couponName??x.title??'优惠券',{type:'coupon',id:String(x.couponId)},x.description??x.subtitle??x.tradeDateTime??'以实时算价为准');action('不使用',{type:'skip-coupon'});back();break;
  case 'coupon-confirm':for(const product of s.content?.products??[])row(String(product.productCode),product.productName??'优惠券餐品',{type:'coupon-product',id:String(product.productCode)},'加入该券适用餐品');v.title='确认使用优惠';v.summary=plain(s.content?.name??s.content?.couponName??s.content?.title??'使用此优惠券，最终优惠以算价为准');action('使用优惠',{type:'use-coupon'});back();break;
  case 'tableware':v.title='餐具偏好';row('no','不需要餐具',{type:'tableware',value:false},'少一份餐具，多一份环保');row('yes','需要餐具',{type:'tableware',value:true},'餐具费用以实时算价为准');back();break;
  case 'time':v.title=s.fulfillment==='pickup'?'取餐时间':'配送时间';row('now',s.reservationDate??'立即安排',{type:'now'},s.reservationDate?'按当前预约时间结算':'按门店当前营业情况安排');if(s.reservationDate)row('immediate','改为立即安排',{type:'immediate'},'清空购物车并重新加载当前菜单');if(s.store?.reservation)row('schedule','预约时间',{type:'reservation'},'修改时间需重新选择餐品');back();break;
  case 'reservation':{
   v.title='预约时间';v.summary='选择门店提供的预约时段';
   for(const option of s.store?.reservationTimeOptions??[]){
    for(const match of String(option.reservationOptionText).matchAll(/(\d{2}):(\d{2})至(\d{2}):(\d{2})/g)){
     const end=Number(match[3])*60+Number(match[4]);
     for(let minute=Number(match[1])*60+Number(match[2]);minute<=end;minute+=30){
      const time=String(Math.floor(minute/60)).padStart(2,'0')+':'+String(minute%60).padStart(2,'0');const date=option.date+' '+time;
      if(new Date(date.replace(' ','T')+':00+08:00').getTime()>Date.now())row(date,date,{type:'schedule',value:date},'预约时段 · 重新加载此时段菜单');
     }
    }
   }
   if(!v.rows.length){v.summary='暂无可选预约时段，请返回选择立即安排';}back();break;
  }
  case 'remark':v.title='配送备注';v.summary='选填，最多 50 字';input('例如：无接触配送',s.remark);action('跳过备注',{type:'remark',value:''});back();break;
  case 'review':{
   v.title='确认订单';v.summary=[s.store?.storeName,s.fulfillment==='pickup'?'到店自取':`麦乐送 · ${s.address?.fullAddress??''}`,s.reservationDate??'立即安排',cartSummary(),s.coupon?(s.coupon.name??s.coupon.couponName??'已选优惠券'):'未使用优惠券',`配送费 ${money(s.price?.deliveryPrice??0)} · 餐具 ${s.needTableware?'需要':'不需要'} ${money(s.price?.tablewarePrice??0)}`,`优惠 ${money(s.price?.discount??0)}`,s.remark?`备注：${s.remark}`:'',typeof s.content==='string'?s.content:''].filter(Boolean).join('\n');
   for(const x of s.takeWayCode?[]:s.price?.takeWayList??[])row(String(x.code),takeWayLabel(x),{type:'take-way',id:String(x.code)},'取餐方式',undefined,undefined,s.takeWayCode===String(x.code));
   v.total=money(s.price?.price);action('确认下单',{type:'confirm',actionId:s.action?.id});action('修改订单',{type:'cart'});break;
  }
  case 'payment':v.title='订单待支付';v.summary=`订单已创建，请在手机端麦当劳完成支付\n${s.order?.storeName??''}\n订单号 ${s.order?.orderId??''}`;action('查询支付状态',{type:'query-order',id:String(s.order?.orderId)});action('取消订单',{type:'begin-cancel'});break;
  case 'cancel-reasons':v.title='为什么取消订单？';v.summary='请选择取消原因，下一步确认后才会取消';for(const [code,label] of Object.entries(cancelReasons))row(code,String(label),{type:'cancel-reason',value:code});action('保留订单',{type:'keep-order'});break;
  case 'cart-change-confirm':v.title='切换前请确认';v.summary='切换'+(s.cartChange?.kind==='store'?'门店':'就餐方式')+'将清空当前购物车。\n已加购餐品不会转到新门店，请按确认键继续或保留原购物车。';action('确认切换',{type:'approve-cart-change'});action('保留原购物车',{type:'keep-cart'});break;
  case 'cancel-confirm':v.title='确认取消订单？';v.summary=[s.order?.storeName,'订单号 '+s.cancelDraft?.orderId,'原因：'+cancelReasons[s.cancelDraft?.reason??''],'按确认键后将尝试取消这笔真实订单'].filter(Boolean).join('\n');action('确认取消',{type:'confirm',actionId:s.action?.id});action('保留订单',{type:'keep-order'});break;
  case 'order-status':v.title=s.order?.orderStatusTitle??s.order?.orderStatus??'订单状态';v.summary='';if(s.order?.lockerQrCode)v.hero=s.order.lockerQrCode;action('刷新状态',{type:'query-order',id:String(s.order?.orderId)});action('首页',{type:'home'});break;
  case 'orders':v.title='历史订单';v.summary=s.orders.length?'最近订单':'暂无历史订单';for(const x of s.orders)row(String(x.orderId),x.storeName??'麦当劳订单',{type:'query-order',id:String(x.orderId)},`${x.orderStatus??''} · ${x.createTime??''}`);back();break;
  case 'wallet':v.title='我的优惠券';v.summary=s.coupons.length?`共 ${s.coupons.length} 张优惠券`:'暂无可用优惠券';for(const x of s.coupons)row(String(x.couponId??x.id),x.name??x.couponName??x.title??'优惠券',{type:'start'},x.subtitle??x.description??x.tradeEndDateTime??'选择门店后查看是否可用');action('领取优惠',{type:'available'});back();break;
  case 'claim-confirm':v.title='确认领取';v.summary=`当前可领取 ${s.coupons.length} 项优惠\n确认后将尝试一键领取账户当前可领取的券`;if(s.coupons.length)action('确认领取',{type:'confirm',actionId:s.action?.id});back();break;
  case 'claim-result':v.title='领取成功';v.summary='已完成领取请求，可查看我的优惠券';action('查看优惠券',{type:'query',value:'wallet'});action('首页',{type:'home'});break;
  case 'nutrition':v.title='餐品营养';v.summary='营养数据供参考，以实际餐品为准';input('输入餐品名称筛选');action('全部餐品',{type:'query',value:'nutrition'});for(const [i,x] of array(s.content).entries())row(String(i),x.productName??x.name??'餐品',{type:'query',value:'nutrition'},`${x.energyKcal??'—'} 千卡 · 蛋白质 ${x.protein??'—'}克 · 脂肪 ${x.fat??'—'}克`);back();break;
  case 'account':v.title='我的积分';v.summary=accountText(s.content);back();break;
  case 'campaign':v.title='活动日历';v.summary=calendarText(s.content);back();break;
  case 'uncertain':if(s.action?.kind==='address')for(const x of s.addresses)row(String(x.addressId),x.fullAddress,{type:'reconcile'},x.contactName??'');else if(s.action?.kind==='claim')for(const x of s.coupons)row(String(x.couponId??x.id),x.title??x.name??'优惠券',{type:'reconcile'},x.subtitle??'');v.title='操作结果待核实';v.summary=typeof s.content==='string'?s.content:'请在手机端核对操作结果，避免重复执行。';for(const x of s.orders)row(String(x.orderId),x.storeName??'近期订单',{type:'query-order',id:String(x.orderId)},`${x.orderStatus??''} · ${x.createTime??''}`);action('重新核查',{type:'reconcile'});action('首页',{type:'home'});break;
  case 'error':v.title='暂时无法完成';v.summary=s.error??'请稍后重试';back();break;
 }
 if(s.screen==='review'&&typeof s.content==='string')v.caption=s.content;
 if(s.error){v.caption=s.error;if(s.retry&&!v.actions.some(a=>a.event.type===s.retry!.type&&a.event.id===s.retry!.id&&a.event.value===s.retry!.value))action('重试',s.retry);}
 v.presentation={queryError:s.error,takeWays:s.price?.takeWayList??[],orderSource:s.orderSource??(s.screen==='order-status'&&s.history.at(-1)==='orders'?'history':undefined),...(s.screen==='menu'?{menuPage:batch!.page,menuPages:batch!.pages,menuCount:batch!.count,menuTotal:s.meals.length,menuSearch:!!s.menuQuery}:{}),fulfillment:s.fulfillment,count:s.screen==='cart'?s.cart.reduce((n,x)=>n+x.item.quantity,0):v.rows.length,quantity:s.selected?.quantity??1,
 mealParts:s.selected?.rounds?.flatMap((r:Obj)=>roundChoices(r).filter(c=>c.quantity>0).map(c=>c.name)).join(' · '),
 mealPrice:s.screen==='meal'?(()=>{try{return money(yuan(s.selected?.price??s.meals.find(x=>x.code===s.selected?.code)?.currentPrice??0));}catch{return '';}})():'',
 step:`${s.addressStep+1} / 5`,store:s.screen==='order-status'?s.order?.storeName:s.store?.storeName,address:s.fulfillment==='delivery'?s.address?.fullAddress:undefined,
 desktopExitAllowed:orderDesktopExitAllowed(s.order??{}),cancelled:orderCancelled(s.order??{}),receipt:s.screen==='review'?[
 ...s.cart.map(x=>({id:x.id,kind:'product',title:`${x.name} ×${x.item.quantity}`,value:quotedLinePrice(s,x),subtitle:(x.detail?.rounds??[]).flatMap((r:Obj)=>roundChoices(r).filter(c=>c.quantity>0).map(c=>c.name)).join(' · ')})),
 {id:'preferences',kind:'preferences',title:[s.reservationDate??'立即安排',s.needTableware?'需要餐具':'无需餐具',...(s.fulfillment==='pickup'?[s.takeWayCode?takeWayLabel((s.price?.takeWayList??[]).find((x:Obj)=>String(x.code)===s.takeWayCode)??{}):'请选择取餐方式']:[])].join(' · ')},
 {title:'配送费',value:money(s.price?.deliveryPrice??0)},
 {title:'餐具费',value:money(s.price?.tablewarePrice??0)},
 {title:'优惠',value:money(s.price?.discount??0)},
 ...(s.fulfillment==='delivery'&&s.address?.fullAddress?[{title:'配送地址',subtitle:s.address.fullAddress}]:[]),
 ...(s.remark?[{title:'备注',subtitle:s.remark}]:[]),
 ...(typeof s.content==='string'?[{title:s.content}]:[])
 ]:[],paidAmount:s.order?.quotedAmount!==undefined?money(s.order.quotedAmount):'',description:s.screen==='order-status'?'':s.screen==='payment'?`请在手机端麦当劳完成支付\n订单号 ${s.order?.orderId??''}`:undefined,orderId:s.order?.orderId,status:s.order?.orderStatus,pickupCode:s.order?.pickupCode,
 };
 if(s.orderDraft&&['menu','meal','customize'].includes(s.screen)){
  v.presentation.orderProgress=`第${s.orderDraft.index+1}/${s.orderDraft.items.length}项`;
  action('跳过此项',{type:'skip-order-item'});
 }
 v.actionId=s.action?.id;
 return v;
}
function contentText(content:any):string{
 if(typeof content==='string')return plain(content);
 if(Array.isArray(content))return content.map(contentText).join('\n\n');
 if(content&&typeof content==='object')return Object.entries(content).filter(([k])=>!/trace|token|phone|mobile/i.test(k)).map(([k,v])=>`${({availablePoints:'可用积分',totalPoints:'累计积分',expiringPoints:'即将过期积分',frozenPoints:'冻结积分',points:'积分',name:'名称',title:'活动',description:'说明',startTime:'开始时间',endTime:'结束时间'} as Obj)[k]??k}：${typeof v==='object'?contentText(v):plain(v)}`).join('\n');
 return plain(content);
}

function accountText(raw:Obj):string {
 const fields:Obj={availablePoint:'可用积分',availablePoints:'可用积分',accumulativePoint:'累计积分',totalPoints:'累计积分',frozenPoint:'冻结积分',frozenPoints:'冻结积分',currentMouthExpirePoint:'本月即将过期',nextMouthExpirePoint:'下月即将过期',expiringPoints:'即将过期积分'};
 return Object.entries(fields).filter(([k])=>raw?.[k]!==undefined).map(([k,label])=>`${label}：${plain(raw[k])}`).join('\n')||'暂无积分信息';
}
function calendarText(raw:any):string {
 if(!Array.isArray(raw?.dailyList))return contentText(raw);
 return raw.dailyList.slice(0,14).map((day:Obj)=>`${plain(day.dateText??day.date)}\n${(day.events??[]).slice(0,3).map((event:Obj)=>plain(event.articleDto?.highlights||event.articleDto?.title||event.activityTitle||'门店活动')).join('\n')}`).join('\n\n');
}

// The quote has no cart-line identifier: repeated codes cannot safely identify customizations.
function quotedLinePrice(s:Session,line:Obj):string {
 const code=line.item?.productCode;
 const matches=Array.isArray(s.price?.productList)?s.price.productList.filter((p:Obj)=>String(p.productCode)===String(code)):[];
 if(code==null||s.cart.filter(x=>String(x.item?.productCode)===String(code)).length!==1||matches.length!==1)return '价格待核实';
 const product=matches[0];
 return product.quantity===line.item.quantity&&Number.isSafeInteger(product.subtotal)&&product.subtotal>=0?money(product.subtotal):'价格待核实';
}
