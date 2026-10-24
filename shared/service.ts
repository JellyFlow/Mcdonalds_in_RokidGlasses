import {clone, canonical, defaultRuntime, type Runtime} from './platform.js';
import type {Event,Gateway,Obj,Screen,Session} from './types.js';
import {UserError} from './types.js';
import type {StateStore} from './store.js';
import {array,context,fingerprint,initialDetail,lineItem,money,plain,priceArgs,roundChoices,toggleMod,takeWayLabel,cancelReasons,orderCancelled,orderPendingPayment} from './domain.js';
import {menuBatch} from './menu.js';
import {view} from './view.js';
import {parseOrderIntent,exactRequestedMeals} from './order-intent.js';
export class Service {
 private locks=new Map<string,Promise<any>>();
 // Undo is deliberately process-local; no deleted product snapshot enters device storage.
 private cartUndo=new Map<string,{lines:Obj[];index:number;cartHash:string;all?:boolean}>();
 private cartNotices=new Map<string,string>();
 discardCartUndo(id:string){this.cartUndo.delete(id);this.cartNotices.delete(id);}
 private present(s:Session){
  let undo=this.cartUndo.get(s.id);
  if(undo&&undo.cartHash!==fingerprint(s.cart)){this.discardCartUndo(s.id);undo=undefined;}
  const v=view(s);
  if(s.screen==='cart'){
   v.presentation!.cartNotice=this.cartNotices.get(s.id)||'';
   if(undo){v.actions=v.actions.filter(a=>a.event.type!=='clear-cart');v.presentation!.undoAll=!!undo.all;v.presentation!.undoLineId=undo.lines[0].id;v.actions.splice(v.actions.findIndex(a=>a.event.type==='back'),0,{label:'撤销删除',event:{type:'undo-remove-line'}});}
  }
  return v;
 }
 private cartLineNotice(verb:string,line:Obj){const name=Array.from(plain(line.name));return verb+' '+name.slice(0,12).join('')+(name.length>12?'…':'')+' ×'+line.item.quantity;}
 private removeLine(s:Session,id:string){
  if(s.screen!=='cart')throw new UserError('请先打开购物车。');
  const index=s.cart.findIndex(x=>x.id===id);if(index<0)throw new UserError('餐品已移除，请按当前编号选择。');
  const line=clone(s.cart[index]);s.cart.splice(index,1);this.invalidate(s);
  this.cartUndo.set(s.id,{lines:[line],index,cartHash:fingerprint(s.cart)});
  this.cartNotices.set(s.id,this.cartLineNotice('已删除',line));
 }
 constructor(public db:StateStore,public gateway:Gateway,private runtime:Runtime=defaultRuntime){}
 resume(){
  const pending=this.db.pending();const latest=pending?this.db.get(String(pending.session_id)):this.db.latest();
  if(latest&&!pending&&latest.screen==='order-status'&&(latest.orderSource==='history'||(!latest.orderSource&&latest.history.at(-1)==='orders'))){
   latest.orderSource='history';latest.screen='orders';if(latest.history.at(-1)==='orders')latest.history.pop();delete latest.retry;delete latest.error;this.db.save(latest);
  }
  return latest?this.state(latest.id):this.create();
 }
 create(){const pending=this.db.pending();if(pending)return this.state(String(pending.session_id));const s:Session={id:this.runtime.uuid(),revision:0,screen:'home',history:[],mode:this.gateway.mode,fulfillment:'pickup',stores:[],addresses:[],addressDraft:{},addressStep:0,meals:[],cart:[],coupons:[],needTableware:false,remark:'',orders:[]};this.db.save(s);return this.present(s);}
 state(id:string){const s=this.db.get(id);if(!s)throw new UserError('会话不存在，请重新连接。',404);if(this.db.unresolved(id))s.screen='uncertain';return this.present(s);}
 event(id:string,event:Event){const previous=this.locks.get(id)??Promise.resolve();const next=previous.catch(()=>{}).then(()=>this.apply(id,event));this.locks.set(id,next);return next.finally(()=>{if(this.locks.get(id)===next)this.locks.delete(id);});}
 private nav(s:Session,screen:Screen){if(s.screen!==screen){s.history.push(s.screen);s.screen=screen;}}
 private invalidate(s:Session){delete s.price;delete s.quoteAt;delete s.quoteHash;delete s.action;delete s.takeWayCode;}
 parseOrder(text:string){return parseOrderIntent(text);}
 private async fulfillment(s:Session,value:string,approved=false){
  if(!['pickup','delivery'].includes(value))throw new UserError('请选择就餐方式。');
  if(s.fulfillment!==value&&s.cart.length&&!approved){s.cartChange={kind:'fulfillment',value};this.nav(s,'cart-change-confirm');return;}
  if(s.fulfillment!==value){s.store=undefined;s.cart=[];this.invalidate(s);}s.fulfillment=value as 'pickup'|'delivery';
  if(value==='delivery'){this.nav(s,'addresses');const addresses=array(await this.gateway.call('delivery-query-addresses'),['addresses']);s.addresses=addresses;this.nav(s,'addresses');}
  else this.nav(s,'location');
 }
 private async selectMeal(s:Session,code:string){
  const meal=s.meals.find(x=>String(x.code)===code);if(!meal||meal.available===false||meal.unavailable===true)throw new UserError('餐品已失效或不可选。');
  const detail=await this.gateway.call('query-meal-detail',{...context(s),code:meal.code});
  s.detail=detail;s.selected=initialDetail(detail,meal);delete s.selected.editId;
  const draft=s.orderDraft;
  if(draft?.items[draft.index]){draft.selectedCode=String(meal.code);s.selected.quantity=draft.selectionQuantity??draft.items[draft.index].quantity;}
  this.nav(s,'meal');
 }
 private async resolveOrderItem(s:Session){
  const draft=s.orderDraft;if(!draft)return;
  const item=draft.items[draft.index];
  if(!item){delete s.orderDraft;s.menuQuery='';s.menuBatch=0;this.nav(s,'cart');return;}
  s.menuQuery=item.query;s.menuBatch=0;delete draft.selectedCode;delete draft.selectionQuantity;
  const matches=exactRequestedMeals(s.meals,item.query);
  if(matches.length===1){
   // Menu matching succeeded, but detail reads may still fail. Keep the queue and menu usable.
   try{await this.selectMeal(s,String(matches[0].code));}
   catch{ s.error='未能读取餐品详情，请选择餐品重试。'; }
  }
 }
 private async nextOrderItem(s:Session){
  if(!s.orderDraft)return;
  s.orderDraft.index++;delete s.selected;
  s.history=s.history.filter(x=>!['meal','customize','menu'].includes(x));s.screen='menu';
  await this.resolveOrderItem(s);
 }
 private async selectStore(s:Session,id:string,approved=false){
  const store=s.stores.find(x=>String(x.storeCode)===id);if(!store||store.businessStatus===false)throw new UserError('门店不可用，请换一家。');
  if(s.store?.storeCode!==store.storeCode&&s.cart.length&&!approved){s.cartChange={kind:'store',value:id};this.nav(s,'cart-change-confirm');return;}
  if(s.store?.storeCode!==store.storeCode){s.cart=[];s.coupon=undefined;this.invalidate(s);}s.store=store;s.menuBatch=0;
  await this.menu(s);await this.resolveOrderItem(s);
 }
 private arm(s:Session,kind:string){s.action={id:this.runtime.uuid(),kind,revision:s.revision+1};}
 private async menu(s:Session){const began=Date.now();const data=await this.gateway.call('query-meals',context(s));console.info('MCD_MENU_PERF '+JSON.stringify({stage:'request',ms:Date.now()-began,count:Object.keys(data.meals??{}).length}));s.meals=Object.entries(data.meals??{}).map(([code,m]:any)=>({code,...m}));this.nav(s,'menu');}
 private async checkoutDefaults(s:Session){
  s.needTableware=false;this.invalidate(s);
  if(s.fulfillment==='delivery')this.nav(s,'remark');else await this.quote(s);
 }
 private selectTakeWay(s:Session,previous?:string){
  const options=s.price?.takeWayList??[];
  s.takeWayCode=options.some((x:Obj)=>String(x.code)===previous)?previous:options.find((x:Obj)=>takeWayLabel(x)==='打包带走')?.code;
  if(s.takeWayCode!==undefined)s.takeWayCode=String(s.takeWayCode);
 }
 private async quote(s:Session){
  const args=priceArgs(s),previous=s.price?.price,previousTakeWay=s.takeWayCode;delete s.action;delete s.quoteAt;delete s.quoteHash;
  const result=await this.gateway.call('calculate-price',args);
  if(!Number.isSafeInteger(result.price)||result.price<0)throw new UserError('算价响应金额无效，请重试。');
  s.price=result;this.selectTakeWay(s,previousTakeWay);s.quoteAt=this.runtime.now();s.quoteHash=fingerprint(args);
  if(previous!==undefined&&previous!==result.price)s.content='价格已变化，请确认新的应付金额。';else s.content=undefined;
  if(s.fulfillment==='pickup'&&!s.takeWayCode)s.content='无法确定打包方式，请选择可用的中文取餐方式。';
  this.nav(s,'review');this.arm(s,'order');
 }
 private async cancelSupported(orderId:string){
  if(!this.gateway.supportsInput||!await this.gateway.supportsInput('cancel-order',{orderId,cancelReasonCode:'1'}))throw new UserError('当前服务不支持取消订单，请在手机麦当劳端处理。');
 }
 private async cancelOrder(s:Session,actionId:string){
  const draft=s.cancelDraft;
  if(s.screen!=='cancel-confirm'||!draft||!Object.keys(cancelReasons).includes(draft.reason??'')||String(s.order?.orderId)!==draft.orderId)throw new UserError('取消确认已失效，请重新查询订单。');
  await this.cancelSupported(draft.orderId);
  const current=await this.gateway.call('query-order',{orderId:draft.orderId});
  if(String(current.orderId)!==draft.orderId)throw new UserError('订单查询不一致，请在手机端核对。');
  s.order=current;
  if(!orderPendingPayment(current)){delete s.action;delete s.cancelDraft;s.screen='order-status';s.content='订单状态已变化，取消确认已失效，请核对最新状态。';return;}
  this.db.begin(actionId,s,'cancel');this.db.finish(actionId,'submitting',draft.orderId);
  try{
   const result=await this.gateway.call('cancel-order',{orderId:draft.orderId,cancelReasonCode:draft.reason});
   if(String(result?.orderId)!==draft.orderId||typeof result?.cancelResult!=='boolean')throw new Error('cancel result incomplete');
   if(result.cancelResult===false){const latest=await this.gateway.call('query-order',{orderId:draft.orderId});if(String(latest.orderId)!==draft.orderId||orderCancelled(latest))throw new Error('conflicting cancel result');s.order=latest;delete s.action;delete s.cancelDraft;s.screen=orderPendingPayment(latest)?'payment':'order-status';s.error='服务未同意取消订单，请在手机端查看原因。';this.db.finishSession(actionId,s,draft.orderId);return;}
   if(result?.cancelResult!==true||String(result.orderId)!==draft.orderId)throw new Error('cancel result incomplete');
   this.db.finish(actionId,'uncertain',draft.orderId);await this.reconcile(s);
  }catch{this.db.finish(actionId,'uncertain',draft.orderId);delete s.action;s.screen='uncertain';s.content='取消结果待核实，请勿重复取消。';await this.reconcile(s).catch(()=>{});}
 }
 private async reconcile(s:Session){
  const pending=this.db.unresolved(s.id);if(!pending)return;
  if(pending.kind==='cancel'){
   const orderId=pending.order_id??s.cancelDraft?.orderId;
   if(!orderId){s.screen='uncertain';s.content='取消订单号缺失，请在手机端核对。';return;}
   const order=await this.gateway.call('query-order',{orderId:String(orderId)});
   if(String(order.orderId)!==String(orderId))throw new UserError('订单查询不一致，请在手机端核对。');
   s.order=order;delete s.action;
   if(orderCancelled(order)){delete s.cancelDraft;s.screen='order-status';s.content='订单已取消';this.db.finishSession(pending.action_id,s,String(orderId));}
   else{s.screen='uncertain';s.content='取消结果尚未核实，请在手机端核对；不会自动重试。';}return;
  }
  if(pending.kind==='address'){s.addresses=array(await this.gateway.call('delivery-query-addresses'),['addresses']);s.content='地址保存结果待核实。请核对以下地址及手机端记录，不要重复保存。';s.screen='uncertain';return;}
  if(pending.kind==='claim'){s.coupons=array(await this.gateway.call('query-my-coupons'));s.content='领券结果待核实。请核对以下券及手机端记录，不要重复领取。';s.screen='uncertain';return;}
  const orderId=s.order?.orderId??pending.order_id;
  if(orderId){s.order=await this.gateway.call('query-order',{orderId:String(orderId)});this.nav(s,'order-status');return;}
  s.orders=array(await this.gateway.call('order-list'),['list']);
  s.content='提交结果尚未确定。以下近期订单仅供核对，查看详情不会解除重复提交保护。请在手机端确认后处理。';
  s.screen='uncertain';
 }
 private async confirm(s:Session,e:Event){
  const action=s.action;
  if(!action||e.actionId!==action.id)throw new UserError('确认已失效，请重新查看确认页。',409);
  const existing=this.db.submission(action.id);
  if(existing){if(existing.status==='complete')return;await this.reconcile(s);return;}
  if(action.revision!==s.revision)throw new UserError('内容已变化，请重新确认。',409);
  if(action.kind==='cancel'){await this.cancelOrder(s,action.id);return;}
  if(action.kind==='order'){
   const args=priceArgs(s);
   if(!s.quoteAt||this.runtime.now()-s.quoteAt>120000||s.quoteHash!==fingerprint(args)){await this.quote(s);s.content='报价已刷新，请重新确认。';return;}
   if(s.fulfillment==='pickup'&&!s.price?.takeWayList?.some((x:Obj)=>String(x.code)===s.takeWayCode))throw new UserError('请先选择取餐方式。');
   if(s.fulfillment==='delivery'&&!s.address?.addressId)throw new UserError('请先选择配送地址。');
   // Reprice immediately before submission, and require another confirmation if it changed.
   const fresh=await this.gateway.call('calculate-price',args);
   if(fresh.price!==s.price?.price||canonical(fresh.takeWayList??[])!==canonical(s.price?.takeWayList??[])){const oldTakeWay=s.takeWayCode;s.price=fresh;this.selectTakeWay(s,oldTakeWay);s.quoteAt=this.runtime.now();this.arm(s,'order');s.content='金额或取餐方式已变化，请重新确认。';return;}
   const params:Obj={...args};
   if(s.fulfillment==='pickup')params.takeWayCode=s.takeWayCode;
   else {params.addressId=String(s.address!.addressId);if(s.remark)params.remark=s.remark;}
   s.orderSource='checkout';
   this.db.begin(action.id,s,'order');this.db.save(s);
   try{
    const order=await this.gateway.call('create-order',params);
    if(!order?.orderId)throw new Error('missing order id');
    s.order={...order.orderDetail,orderId:String(order.orderId),quotedAmount:s.price?.price};
    this.nav(s,'payment');delete s.action;s.cart=[];this.invalidate(s);this.db.finishSession(action.id,s,s.order!.orderId);
   }catch{this.db.finish(action.id,'uncertain');s.screen='uncertain';s.content='下单结果待核实，请勿重复提交。';await this.reconcile(s).catch(()=>{});}
  }else{
   this.db.begin(action.id,s,action.kind);this.db.save(s);
   try {
    if(action.kind==='address'){s.address=await this.gateway.call('delivery-create-address',s.addressDraft);s.addresses.push(s.address!);s.history=s.history.filter(x=>!['address-entry','address-confirm','addresses'].includes(x));s.screen='addresses';}
    else if(action.kind==='claim'){await this.gateway.call('auto-bind-coupons');this.nav(s,'claim-result');}
    delete s.action;this.db.finishSession(action.id,s);
   }catch{this.db.finish(action.id,'uncertain');s.screen='uncertain';s.content='操作结果待核实，请先查询地址或优惠券，避免重复执行。';}
  }
 }
 private async apply(id:string,e:Event):Promise<ReturnType<typeof view>>{
  const s=this.db.get(id);if(!s)throw new UserError('会话不存在。',404);
  if(e.type==='confirm'&&e.actionId){const old=this.db.submission(e.actionId);if(old?.session_id===id){if(old.status!=='complete'){await this.reconcile(s);this.db.save(s);}return this.present(s);}}
  if(e.revision!==s.revision)throw new UserError('页面已更新，请刷新后操作。',409);
  if(this.db.pending()&&!['reconcile','query-order','home','query','back'].includes(e.type))throw new UserError('有结果待核实的操作，请先在手机端核对。',409);
  if(!['remove-line','clear-cart','undo-remove-line','cart'].includes(e.type)&&!(e.type==='line-quantity'&&Number(e.value)===0))this.discardCartUndo(id);
  s.error=undefined;
  try{
   switch(e.type){
    case 'begin-cancel':{
     if(!['payment','order-status'].includes(s.screen)||s.orderSource==='history'||!s.order?.orderId)throw new UserError('请先查询待支付订单。');
     const id=String(s.order.orderId);await this.cancelSupported(id);
     const order=await this.gateway.call('query-order',{orderId:id});
     if(String(order.orderId)!==id)throw new UserError('订单查询不一致。');
     s.order=order;delete s.action;
     if(!orderPendingPayment(order)){this.nav(s,'order-status');s.content='订单状态已变化，请核对最新状态。';break;}
     s.cancelDraft={orderId:id};this.nav(s,'cancel-reasons');break;
    }
    case 'cancel-reason':if(s.screen!=='cancel-reasons'||!s.cancelDraft||!Object.keys(cancelReasons).includes(String(e.value)))throw new UserError('请选择有效的取消原因。');s.cancelDraft.reason=String(e.value);this.nav(s,'cancel-confirm');this.arm(s,'cancel');break;
    case 'keep-order':if(!['cancel-reasons','cancel-confirm'].includes(s.screen))throw new UserError('页面已变化。');delete s.action;delete s.cancelDraft;s.history=s.history.filter(x=>!['cancel-reasons','cancel-confirm'].includes(x));s.screen='payment';break;
    case 'home':s.screen='home';s.history=[];delete s.action;delete s.orderDraft;delete s.cartChange;break;
    case 'back':
     delete s.action;
     if(s.screen==='cart-change-confirm'){delete s.cartChange;delete s.orderDraft;s.menuQuery='';s.screen='cart';s.history=s.history.filter(x=>x!=='cart-change-confirm');break;}
     if(s.screen==='address-confirm'){s.addressStep=4;s.screen='address-entry';break;}
     if(s.screen==='address-entry'&&s.addressStep>0){s.addressStep=Math.min(4,s.addressStep)-1;break;}
     do{s.screen=s.history.pop()??'home';}while(['address-entry','address-confirm'].includes(s.screen)&&s.history.length);
     if(['review','address-confirm','claim-confirm'].includes(s.screen))s.screen='cart';break;
    case 'start-order-intent':{
     if(s.screen!=='home')throw new UserError('请从首页开始新的点餐需求。');
     const intent=parseOrderIntent(String(e.value??''));if(!intent)throw new UserError('请说餐品、数量和到店自取或麦乐送。');
     if(intent.items.length)s.orderDraft={...intent,index:0};else delete s.orderDraft;
     s.menuQuery=intent.items[0]?.query??'';s.menuBatch=0;s.order=undefined;
     if(!s.cart.length){s.reservationDate=undefined;this.invalidate(s);}
     if(intent.fulfillment)await this.fulfillment(s,intent.fulfillment);else this.nav(s,'fulfillment');break;
    }
    case 'approve-cart-change':{
     if(s.screen!=='cart-change-confirm'||!s.cartChange)throw new UserError('页面已变化。');
     const change=s.cartChange;delete s.cartChange;
     s.screen=change.kind==='fulfillment'?'fulfillment':'stores';s.history=s.history.filter(x=>x!=='cart-change-confirm');
     e=change.kind==='fulfillment'?{type:'fulfillment',value:change.value}:{type:'store',id:change.value};
     if(change.kind==='fulfillment')await this.fulfillment(s,change.value,true);else await this.selectStore(s,change.value,true);
     delete s.cartChange;s.history=s.history.filter(x=>x!=='cart-change-confirm');break;
    }
    case 'keep-cart':if(s.screen!=='cart-change-confirm')throw new UserError('页面已变化。');delete s.cartChange;delete s.orderDraft;s.menuQuery='';s.screen='cart';s.history=s.history.filter(x=>x!=='cart-change-confirm');break;
    case 'start':delete s.orderDraft;delete s.cartChange;s.menuQuery=String(e.value??'');s.menuBatch=0;s.order=undefined;if(!s.cart.length){s.reservationDate=undefined;this.invalidate(s);}this.nav(s,'fulfillment');break;
    case 'fulfillment':await this.fulfillment(s,String(e.value));break;
    case 'search-stores':{
     const value=String(e.value??'').trim();const [city,...rest]=value.split(/[ ,，]+/);if(!city||!rest.join(' '))throw new UserError('请输入城市和位置，例如：上海市 人民广场。');
     s.city=city;s.keyword=rest.join(' ');s.stores=array(await this.gateway.call('query-nearby-stores',{searchType:2,beType:1,city,keyword:s.keyword}));this.nav(s,'stores');break;
    }
    case 'geo-stores':{
     const {longitude,latitude}=e.value??{};if(!Number.isFinite(longitude)||!Number.isFinite(latitude)||Math.abs(longitude)>180||Math.abs(latitude)>90)throw new UserError('位置信息无效，请输入城市和位置。');
     s.stores=array(await this.gateway.call('query-nearby-stores',{searchType:3,beType:1,longitude,latitude}));this.nav(s,'stores');break;
    }
    case 'address':s.address=s.addresses.find(x=>String(x.addressId)===e.id);if(!s.address)throw new UserError('地址已失效。');s.stores=array(await this.gateway.call('delivery-query-stores',{addressId:String(s.address.addressId),beType:2}));this.nav(s,'stores');this.invalidate(s);break;
    case 'new-address':s.addressDraft={};s.addressStep=0;this.nav(s,'address-entry');break;
    case 'address-field':{
     const fields=['city','contactName','phone','address','addressDetail'];if(s.screen!=='address-entry'||s.addressStep<0||s.addressStep>=fields.length)throw new UserError('地址步骤已失效，请重新新增地址。');const value=String(e.value??'').trim();if(!value||value.length>150)throw new UserError('请输入有效内容。');if(s.addressStep===2&&!/^1\d{10}$/.test(value))throw new UserError('请输入 11 位手机号码。');
     s.addressDraft[fields[s.addressStep]]=value;s.addressStep++;
     if(s.addressStep===fields.length){this.nav(s,'address-confirm');this.arm(s,'address');}break;
    }
    case 'edit-address':s.addressStep=0;s.screen='address-entry';delete s.action;break;
    case 'store':await this.selectStore(s,String(e.id));break;
    case 'menu-batch':if(s.screen!=='menu')throw new UserError('请先打开菜单。');s.menuBatch=((s.menuBatch||0)+1)%menuBatch(s.meals,s.menuQuery,s.menuBatch).pages;break;
    case 'menu-search':if(s.screen!=='menu')throw new UserError('请先打开菜单。');s.menuQuery=String(e.value||'');s.menuBatch=0;if(s.orderDraft){delete s.orderDraft.selectedCode;if(s.menuQuery)s.orderDraft.items[s.orderDraft.index].query=s.menuQuery;}break;
    case 'skip-order-item':if(!s.orderDraft||!['menu','meal','customize'].includes(s.screen))throw new UserError('没有待处理的点餐需求。');await this.nextOrderItem(s);break;
    case 'menu':await this.menu(s);break;
    case 'meal':await this.selectMeal(s,String(e.id));break;
    case 'customize':if(!s.selected)throw new UserError('请先选择餐品。');this.nav(s,'customize');break;
    case 'choose-round':{
     const [rIndex,cIndex]=String(e.id).split(':').map(Number);const r=s.selected?.rounds?.[rIndex];const c=roundChoices(r??{})[cIndex];if(!r||!c)throw new UserError('规格已失效。');
     if(Number(r.maxQuantity??1)===1){for(const x of roundChoices(r))x.quantity=0;c.quantity=1;}
     else c.quantity=c.quantity?0:1;break;
    }
    case 'mod':{
     const [scope,r,c,g,v]=String(e.id).split(':');const raw=scope==='main'?s.selected?.modification:roundChoices(s.selected?.rounds?.[Number(r)]??{})[Number(c)]?.modification;
     toggleMod(raw,Number(g),Number(v));break;
    }
    case 'quantity':{const n=Number(e.value);if(!s.selected||!Number.isInteger(n)||n<1||n>20)throw new UserError('数量须为 1 至 20。');s.selected.quantity=n;if(s.orderDraft?.selectedCode===String(s.selected.code))s.orderDraft.selectionQuantity=n;break;}
    case 'add':{
     if(!s.selected)throw new UserError('请先选择餐品。');const item=lineItem(s.selected);
     const entry={id:s.selected.editId??this.runtime.uuid(),name:s.selected.name,image:s.selected.image,item,detail:clone(s.selected),withOrder:s.selected.wantWithOrder?s.meals.find(m=>m.code===s.selected!.code)?.withOrder:undefined};
     const index=s.cart.findIndex(x=>x.id===entry.id);if(index>=0)s.cart[index]=entry;else s.cart.push(entry);this.invalidate(s);
     if(s.orderDraft&&!s.selected.editId&&s.orderDraft.selectedCode===String(s.selected.code))await this.nextOrderItem(s);else this.nav(s,'cart');break;
    }
    case 'with-order':if(!s.selected)throw new UserError('请先选择餐品。');s.selected.wantWithOrder=!s.selected.wantWithOrder;break;
    case 'cart':this.nav(s,'cart');break;
    case 'edit-line':{const x=s.cart.find(x=>x.id===e.id);if(!x)throw new UserError('餐品已移除。');s.selected={...clone(x.detail),editId:x.id};this.nav(s,'meal');break;}
    case 'line-quantity':{const line=s.cart.find(x=>x.id===e.id),n=Number(e.value);if(!line||!Number.isInteger(n)||n<0||n>20)throw new UserError('餐品数量无效。');if(n===0)this.removeLine(s,String(e.id));else{line.item.quantity=n;line.detail.quantity=n;}this.invalidate(s);break;}
    case 'remove-line':this.removeLine(s,String(e.id));break;
    case 'clear-cart':{
     if(s.screen!=='cart')throw new UserError('请先打开购物车。');
     if(!s.cart.length)break;
     const lines=clone(s.cart),count=lines.reduce((n,x)=>n+Number(x.item.quantity),0);
     s.cart=[];this.invalidate(s);this.cartUndo.set(id,{lines,index:0,all:true,cartHash:fingerprint(s.cart)});
     this.cartNotices.set(id,'已删除全部商品，共'+count+'份');break;
    }
    case 'undo-remove-line':{
     const undo=this.cartUndo.get(id);
     if(s.screen!=='cart'||!undo||undo.cartHash!==fingerprint(s.cart)||s.cart.some(x=>undo.lines.some(line=>x.id===line.id))){this.discardCartUndo(id);throw new UserError('没有可撤销的删除。');}
     s.cart.splice(Math.min(undo.index,s.cart.length),0,...clone(undo.lines));this.invalidate(s);this.cartUndo.delete(id);this.cartNotices.set(id,undo.all?'已恢复全部商品，共'+undo.lines.reduce((n,x)=>n+Number(x.item.quantity),0)+'份':this.cartLineNotice('已恢复',undo.lines[0]));break;
    }
    case 'checkout':{
     if(!s.cart.length)throw new UserError('购物车为空。');
     const coupons=array(await this.gateway.call('query-store-coupons',context(s)));
     // The store endpoint is not cart-aware. Only exact published product codes
     // that our pricing contract can bind are eligible; never infer from names.
     s.coupons=coupons.filter(coupon=>{try{priceArgs({...s,coupon});return true;}catch{return false;}});
     s.coupon=undefined;this.invalidate(s);
     if(s.coupons.length)this.nav(s,'coupon-select');else await this.checkoutDefaults(s);break;
    }
    case 'coupon':s.content=s.coupons.find(x=>String(x.couponId)===e.id);if(!s.content)throw new UserError('优惠券已失效。');this.nav(s,'coupon-confirm');break;
    case 'coupon-product':{
     const product=s.content?.products?.find((x:Obj)=>String(x.productCode)===e.id);if(!product)throw new UserError('优惠券餐品已失效。');
     const detail=await this.gateway.call('query-meal-detail',{...context(s),code:String(product.productCode)});
     const meal={code:String(product.productCode),name:product.productName};if(!s.meals.some(x=>x.code===meal.code))s.meals.push(meal);
     s.selected=initialDetail(detail,meal);this.nav(s,'meal');break;
    }
    case 'use-coupon':priceArgs({...s,coupon:s.content});s.coupon=s.content;this.invalidate(s);await this.checkoutDefaults(s);break;
    case 'skip-coupon':s.coupon=undefined;this.invalidate(s);await this.checkoutDefaults(s);break;
    case 'checkout-defaults':await this.checkoutDefaults(s);break;
    case 'review-tableware':if(s.screen!=='review')throw new UserError('请先进入确认页。');s.needTableware=e.value===true;await this.quote(s);break;
    case 'tableware':s.needTableware=e.value===true;this.invalidate(s);this.nav(s,'time');break;
    case 'time':this.nav(s,'time');break;
    case 'reservation':delete s.action;s.content='修改预约时间需要重新选择餐品。';this.nav(s,'reservation');break;
    case 'schedule':{
     const date=String(e.value??'');if(!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(date))throw new UserError('时间格式：2030-10-18 12:00。');
     const parsed=new Date(date.replace(' ','T')+':00+08:00');if(!Number.isFinite(parsed.getTime())||parsed.getTime()<=this.runtime.now())throw new UserError('请选择未来的预约时间。');
     const option=s.store?.reservationTimeOptions?.find((o:Obj)=>o.date===date.slice(0,10));if(!s.store?.reservation||!option)throw new UserError('该日期不在门店预约范围。');
     const time=date.slice(11);const ranges=[...String(option.reservationOptionText).matchAll(/(\d{2}:\d{2})至(\d{2}:\d{2})/g)];if(!ranges.length||!ranges.some(r=>time>=r[1]&&time<=r[2]))throw new UserError('该时间不在门店提供的预约时段。');
     s.reservationDate=date;s.cart=[];s.coupon=undefined;this.invalidate(s);await this.menu(s);s.content='预约时间已设置，请从预约菜单重新选择餐品。';break;
    }
    case 'immediate':if(!s.reservationDate){await this.quote(s);break;}s.reservationDate=undefined;s.cart=[];s.coupon=undefined;this.invalidate(s);await this.menu(s);s.content='已改为立即安排，请重新选择餐品。';break;
    case 'now':
     if(s.fulfillment==='delivery')this.nav(s,'remark');else await this.quote(s);break;
    case 'remark':s.remark=String(e.value??'').trim();if(s.remark.length>50)throw new UserError('配送备注最多 50 字。');await this.quote(s);break;
    case 'quote':await this.quote(s);break;
    case 'take-way':if(!s.price?.takeWayList?.some((x:Obj)=>String(x.code)===e.id))throw new UserError('取餐方式已失效。');s.takeWayCode=e.id;this.arm(s,'order');break;
    case 'confirm':await this.confirm(s,e);break;
    case 'reconcile':await this.reconcile(s);break;
    case 'query-order':{
     if(this.db.unresolved(s.id)?.kind==='cancel'){await this.reconcile(s);break;}
     const known=[...s.orders,...(s.order?[s.order]:[])].find(o=>String(o.orderId)===e.id);if(!known)throw new UserError('请选择当前列表中的订单。');
     const source=this.db.unresolved(s.id)?'checkout':s.screen==='orders'?'history':s.orderSource;
     const order=await this.gateway.call('query-order',{orderId:String(e.id)});s.order=order;s.orderSource=source;this.nav(s,source!=='history'&&orderPendingPayment(order)?'payment':'order-status');break;
    }
    case 'query':{
     const map:Obj={wallet:'query-my-coupons',orders:'order-list',nutrition:'list-nutrition-foods',account:'query-my-account',campaign:'campaign-calendar'};const kind=String(e.value);if(!map[kind])throw new UserError('请选择可用查询。');
     const data=await this.gateway.call(map[kind]);if(kind==='wallet')s.coupons=array(data);else if(kind==='orders')s.orders=array(data);else s.content=data;this.nav(s,kind as Screen);break;
    }
    case 'available':s.coupons=array(await this.gateway.call('available-coupons'));this.nav(s,'claim-confirm');this.arm(s,'claim');break;
    case 'input':{
     const value=String(e.value??'').trim();if(!value)throw new UserError('请说出或输入内容。');
     const routed:Obj={location:'search-stores','address-entry':'address-field',reservation:'schedule',remark:'remark'};
     if(routed[s.screen]){e={type:routed[s.screen],value,revision:s.revision};return await this.apply(id,e);}
     if(s.screen==='nutrition'){const foods=array(s.content);s.content=foods.filter((x:Obj)=>String(x.productName??x.name).includes(value));break;}
     throw new UserError('请使用语音意图或选择屏幕上的操作。');
    }
    default:throw new UserError('不支持的操作。');
   }
   delete s.retry;
  }catch(err:any){s.error=err instanceof UserError?err.message:'网络连接失败，请重试。';if(['remove-line','clear-cart','undo-remove-line','line-quantity'].includes(e.type))delete s.retry;else if(!['confirm','new-address','address-field','available','reconcile'].includes(e.type))s.retry=e.type==='start-order-intent'&&s.screen==='addresses'?{type:'fulfillment',value:'delivery'}:{...e};}
  s.revision++;if(s.action)s.action.revision=s.revision;this.db.save(s);return this.present(s);
 }
}
