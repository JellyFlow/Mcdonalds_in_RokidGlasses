import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {matchMeals} from '../../shared/menu/index.js';
import {Service} from '../../shared/contracts/service.js';
import {DeviceStore} from '../storage/store.js';
import {MockGateway} from '../../server/mock/index.js';
import {presentation} from '../../aiui/components/presentation.js';
import {sceneView,scenes} from '../../scripts/fixtures/scenes.js';
import {listLayout,storeRows,menuRows,couponView,orderView} from '../../aiui/components/layout.js';
import {resolveLocation,resolveStoreDistances} from '../../aiui/runtime/amap.js';
import {controlsFor,spokenNumber} from '../../aiui/components/controls.js';
const source=readFileSync('aiui/pages/index/index.ink','utf8').match(/<script setup>([\s\S]*?)<\/script>/)![1].replace(/^import .*;$/gm,'').replace('export default','return');
export function makePage(Recognition?:any,model:any={availability:async()=> 'unavailable'},locationNavigator?:any,locationApi?:any,GatewayClass:any=MockGateway){
 const data=new Map<string,any>();const wx={...locationApi,getStorageSync:(k:string)=>data.get(k),setStorageSync:(k:string,v:any)=>data.set(k,JSON.parse(JSON.stringify(v)))};
 let closeRequests=0;const runtimeWindow={close(){closeRequests++;}};
 const page=new Function('wx','Service','DeviceStore','DeviceGateway','MCP_TOKEN','controlsFor','spokenNumber','presentation','sceneView','scenes','LanguageModel','SpeechRecognition','listLayout','couponView','orderView','window','navigator','resolveLocation','AMAP_WEB_KEY','storeRows','resolveStoreDistances','menuRows',source)(wx,Service,DeviceStore,GatewayClass,'test-token',controlsFor,spokenNumber,presentation,sceneView,scenes,model,Recognition,listLayout,couponView,orderView,runtimeWindow,locationNavigator,resolveLocation,'test-amap-key',storeRows,resolveStoreDistances,menuRows);
 page.testWindow=runtimeWindow;Object.defineProperty(page,'closeRequests',{get:()=>closeRequests});
 page.data=structuredClone(page.data);page.setData=function(v:any){for(const [key,value] of Object.entries(v)){const parts=key.replace(/\[(\d+)\]/g,'.$1').split('.');let target=this.data;for(const part of parts.slice(0,-1))target=target[part];target[parts.at(-1)!]=value;}};page.visible=true;page.generation=0;
 page.deviceStore=new DeviceStore(wx);page.deviceStore.configure('test-token');page.gateway=new MockGateway();page.gateway.close=async()=>{};
 page.service=new Service(page.deviceStore,page.gateway);page.data.settings=false;page.render(page.service.resume());
 return page;
}
export async function key(page:any,code:string){let prevented=0;await page.onKeyUp({code,preventDefault(){prevented++;}});assert.equal(prevented,1);}
export async function backTwice(page:any){await key(page,'Backspace');await key(page,'Backspace');}
export async function choose(page:any,predicate:(c:any)=>boolean){const c=page.controls.find(predicate);assert.ok(c,'control must be reachable');page.focusId=c.id;page.setData({focusIndex:c.legacy});page.decorate();await key(page,'Enter');}
async function review(page:any){for(const e of [{type:'start'},{type:'fulfillment',value:'pickup'},{type:'search-stores',value:'上海市 人民广场'},{type:'store',id:'12345'},{type:'meal',id:'burger'},{type:'add'},{type:'quote'},{type:'take-way',id:'take-away'}])await page.send(e);assert.equal(page.data.view.screen,'review');}

test('production settings only reconnect; no scene route or gallery focus exists',async()=>{
 const p=makePage();await choose(p,c=>c.command==='settings');assert.equal(p.data.settings,true);
 assert.deepEqual(p.controls.map((c:any)=>c.id),['setting-connect']);
 await backTwice(p);assert.equal(p.data.settings,false);assert.equal(p.data.view.screen,'home');
 assert.equal(p.openGallery,undefined);assert.equal(p.showScene,undefined);
 const text=readFileSync('aiui/pages/index/index.ink','utf8');assert.ok(!/sceneView|query\.scene|setting-gallery|打开场景|浏览场景/.test(text));
});
test('quantity editing is independent and restores cart focus',async()=>{
 const p=makePage();for(const e of [{type:'start'},{type:'fulfillment',value:'pickup'},{type:'search-stores',value:'上海市 人民广场'},{type:'store',id:'12345'},{type:'meal',id:'burger'}])await p.send(e);
 await choose(p,c=>c.event?.type==='quantity'&&c.event.value===2);await p.send({type:'add'});await p.send({type:'cart'});
 await choose(p,c=>c.command==='edit-quantity');assert.equal(p.data.view.screen,'quantity-editor');
 await choose(p,c=>c.command==='quantity-change'&&c.delta===1);assert.equal(p.data.ui.quantity,3);
 await p.understand('减少数量');assert.equal(p.data.ui.quantity,2);
 await backTwice(p);assert.equal(p.data.view.screen,'cart');assert.equal(p.data.controlId,'row-0');
 await choose(p,c=>c.command==='edit-quantity');await p.changeQuantity(-1);await p.changeQuantity(-1);
 assert.equal(p.data.view.screen,'cart');assert.equal(p.data.rows.length,0);
});
test('voice free text stays a draft until accepted and can be rerecorded',async()=>{
 const p=makePage();await p.send({type:'new-address'});const revision=p.data.view.revision;await p.understand('上海市');assert.equal(p.data.view.revision,revision);assert.equal(p.data.voiceDraft,'上海市');assert.equal(p.data.controlId,'input-accept');
 await p.understand('杭州市');assert.equal(p.data.voiceDraft,'杭州市');await key(p,'Enter');assert.equal(p.deviceStore.get(p.data.view.id).addressDraft.city,'杭州市');assert.equal(p.data.voiceDraft,'');
 for(const value of ['张三','13800138000','花园路','502']){await p.understand(value);await key(p,'Enter');}
 assert.equal(p.data.view.screen,'address-confirm');await p.understand('确认保存');assert.equal(p.gateway.calls.filter((x:any)=>x.name==='delivery-create-address').length,0);
 await choose(p,c=>c.event?.type==='confirm');assert.equal(p.gateway.calls.filter((x:any)=>x.name==='delivery-create-address').length,1);
});
test('voice, model selection and direct dispatch cannot confirm; only confirm key submits once',async()=>{
 const p=makePage();await review(p);await p.understand('确认下单');await p.send({type:'confirm',actionId:p.data.view.actionId});await p.activateFocused(false);assert.equal(p.gateway.calls.filter((x:any)=>x.name==='create-order').length,0);
 await choose(p,c=>c.event?.type==='confirm');await key(p,'Enter');assert.equal(p.gateway.calls.filter((x:any)=>x.name==='create-order').length,1);
});
test('claim writes are key-only and explicit voice select cannot bypass guard',async()=>{
 const p=makePage();await p.send({type:'available'});await p.understand('确认领取');await p.send({type:'confirm',actionId:p.data.view.actionId});assert.equal(p.gateway.calls.filter((x:any)=>x.name==='auto-bind-coupons').length,0);await choose(p,c=>c.event?.type==='confirm');assert.equal(p.gateway.calls.filter((x:any)=>x.name==='auto-bind-coupons').length,1);
});
test('long addresses and order receipts have reachable paging controls',async()=>{
 const p=makePage();p.render({screen:'address-confirm',title:'地址',summary:'甲'.repeat(44)+'乙'.repeat(100),rows:[],actions:[],presentation:{}});assert.ok(p.data.ui.descriptionPages>1);const before=p.data.ui.descriptionLines.join();await choose(p,c=>c.command==='description');assert.notEqual(p.data.ui.descriptionLines.join(),before);await p.understand('上一页');assert.equal(p.data.descriptionPage,0);
 p.render({screen:'review',rows:[],actions:[],presentation:{receipt:Array.from({length:9},(_,i)=>({title:'餐品'+i}))}});await choose(p,c=>c.command==='receipt');assert.equal(p.data.receiptScroll,52);assert.equal(p.data.ui.receiptItems.length,9);assert.equal(p.data.ui.receiptPages,1);
});
test('coupon confirmation keeps actions visible and pages long discount details',async()=>{
 const p=makePage();
 p.render({id:'preview',screen:'coupon-confirm',title:'使用这张优惠券？',summary:'满 30 减 5 元',total:'¥27.00',rows:[],actions:[{label:'确认使用',event:{type:'confirm',actionId:'coupon-1'}}],presentation:{heading:'满 30 减 5 元',description:'原应付 ¥32.00 · 本次节省 ¥5.00 · 套餐可用 · 今日有效 · 与其他优惠不可同享 · 仅限指定套餐 · 每单限用一张 · 不与会员折扣同享 · 今日有效'}});
 assert.ok(p.data.ui.couponPages>1);
 const first=p.data.ui.couponPageLines.join('');
 await choose(p,c=>c.command==='coupon');
 assert.notEqual(p.data.ui.couponPageLines.join(''),first);
 assert.equal(p.gateway.calls.filter((x:any)=>x.name==='auto-bind-coupons').length,0);
 await p.understand('下一页');
 assert.equal(p.data.couponPage,0);
 await choose(p,c=>c.event?.type==='confirm');
 assert.equal(p.gateway.calls.filter((x:any)=>x.name==='auto-bind-coupons').length,0);
});
test('wallet keeps every coupon reachable and scroll target follows the focused row',async()=>{
 const p=makePage();p.render(sceneView('26'));
 assert.equal(p.data.view.rows.length,6);
 assert.deepEqual(p.data.ui.rows.slice(0,2).map((r:any)=>r.displayIndex),[1,2]);
 assert.equal(p.controls.filter((c:any)=>c.id.startsWith('row-')).length,6);
 for(let i=0;i<5;i++) await key(p,'ArrowDown');
 assert.equal(p.data.controlId,'row-5');
 assert.ok(p.data.listScroll>0);
 assert.ok(p.data.listScroll+p.data.ui.listHeight>=6*104-8);
 await key(p,'ArrowDown');
 assert.equal(p.data.controlId,'row-0');
 assert.equal(p.data.listScroll,0);
});
test('cancelled speech ignores late results; Enter stops recording, Back cancels',async()=>{
 const p=makePage();let stopped=0,aborted=0;p.recognition={stop(){stopped++;},abort(){aborted++;}};p.data.listening=true;await key(p,'Enter');assert.equal(stopped,1);await backTwice(p);assert.equal(aborted,1);assert.equal(p.data.listening,false);
 p.onVoiceWakeup({keyword:'clickAiAssist',preventDefault(){}});assert.equal(p.data.listening,false);
 let instance:any;class Recognizer{onresult:any;onend:any;constructor(){instance=this;}start(){}stop(){}abort(){}}
 const late=makePage(Recognizer);late.listen();await backTwice(late);instance.onresult({results:[[{transcript:'开始点餐'}]]});assert.equal(late.data.view.screen,'home');
});
test('busy back cancels the request and keeps unresolved submissions',async()=>{
 const p=makePage();await review(p);p.deviceStore.begin(p.data.view.actionId,p.deviceStore.get(p.data.view.id),'order');p.data.busy=true;let closed=0;p.gateway.close=async()=>{closed++;};await backTwice(p);assert.equal(closed,1);assert.equal(p.data.view.screen,'uncertain');assert.ok(p.deviceStore.pending());assert.equal(p.gateway.calls.filter((x:any)=>x.name==='create-order').length,0);
});
test('embedded credential startup and pending account mismatch do not overwrite old state',async()=>{
 const p=makePage();p.deviceStore.configure('old-token');p.render(p.service.resume());await review(p);p.deviceStore.begin(p.data.view.actionId,p.deviceStore.get(p.data.view.id),'order');const before=p.gateway.calls.length;await p.connect();assert.equal(p.deviceStore.token(),'old-token');assert.equal(p.gateway.calls.length,before);assert.equal(p.data.settings,true);
});
test('deterministic Chinese ordinal selection and disabled options are safe',async()=>{
 assert.equal(spokenNumber('四十一'),41);const p=makePage();await p.send({type:'start'});await p.understand('选择第二项');assert.equal(p.data.view.screen,'addresses');
 p.render({screen:'stores',rows:[{id:'closed',title:'暂停营业',disabled:true,event:{type:'store',id:'closed'}}],actions:[],presentation:{}});assert.equal(p.controls.length,0);
});
test('Page has no touch bindings or text input controls',()=>{const template=readFileSync('aiui/pages/index/index.ink','utf8');assert.ok(!/bindtap=|catchtap=|<input\b/.test(template));});

test('model-selected confirmation rows cannot execute writes',async()=>{
 const model={availability:async()=> 'available',create:async()=>({prompt:async()=>JSON.stringify({intent:'select',index:1}),destroy(){}})};
 const p=makePage(undefined,model);await review(p);p.data.view.rows=[{id:'malicious-selection',title:'提交选择',event:{type:'confirm',actionId:p.data.view.actionId}}];p.decorate();
 await p.understand('帮我完成这个操作');assert.equal(p.gateway.calls.filter((x:any)=>x.name==='create-order').length,0);assert.match(p.data.message,/确认键/);
});
test('onShow automatically connects with embedded credential without text entry',async()=>{
 const p=makePage();p.deviceStore.configure('');p.onShow();for(let i=0;i<20&&p.data.busy;i++)await new Promise(r=>setImmediate(r));assert.equal(p.data.busy,false);assert.equal(p.deviceStore.token(),'test-token');assert.ok(p.gateway.calls.some((x:any)=>x.name==='query-my-account'));assert.equal(p.data.settings,false);
});

test('long voice drafts remain fully available through key paging before accepting',async()=>{
 const p=makePage();await p.send({type:'new-address'});await p.understand('甲'.repeat(44)+'乙'.repeat(100));assert.ok(p.data.ui.draftPages>1);const first=p.data.ui.draftText;await choose(p,c=>c.command==='draft');assert.notEqual(p.data.ui.draftText,first);await p.understand('上一页');assert.equal(p.data.draftPage,0);assert.equal(p.data.ui.draftText,first);
});

test('coupon details preserve list position and do not claim or bind while paging',async()=>{
 const p=makePage();await p.send({type:'query',value:'wallet'});
 const before=p.gateway.calls.length;await choose(p,c=>c.rowIndex===0);
 assert.equal(p.data.view.screen,'coupon-detail');assert.equal(p.gateway.calls.length,before);
 await p.understand('下一页');assert.equal(p.gateway.calls.length,before);
 await backTwice(p);assert.equal(p.data.view.screen,'wallet');assert.equal(p.data.controlId,'row-0');
 assert.ok(!p.controls.some((c:any)=>['back','home'].includes(c.event?.type)));
});
test('order details return with a fresh revision and restored list focus',async()=>{
 const p=makePage();await review(p);await choose(p,c=>c.event?.type==='confirm');await p.send({type:'query',value:'orders'});
 const control=p.controls.find((c:any)=>c.rowIndex===0);assert.ok(control);
 await choose(p,c=>c.id===control.id);assert.equal(p.data.view.screen,'order-detail');
 await backTwice(p);assert.equal(p.data.view.screen,'orders');assert.equal(p.data.controlId,control.id);
 await choose(p,c=>c.id===control.id);assert.equal(p.data.view.screen,'order-detail');assert.equal(p.data.message,'');
});
test('single return expires; only home double return requests application close',async()=>{
 const p=makePage();let exited=0;p.exitPage=()=>{exited++;};
 await key(p,'Backspace');await new Promise(r=>setTimeout(r,520));assert.equal(p.backPending,false);assert.equal(p.data.view.screen,'home');
 await backTwice(p);assert.equal(exited,1);assert.equal(p.data.view.screen,'home');
 await key(p,'Backspace');p.openSettings();assert.equal(p.backPending,false);
 await key(p,'Backspace');p.cleanup();assert.equal(p.backPending,false);
});
test('all fixtures have a Figma node and no invisible return focus targets',()=>{
 assert.equal(scenes.length,60);assert.equal(new Set(scenes.map((s:any)=>s.id)).size,60);
 for(const scene of scenes){assert.ok(scene.figmaNode,scene.id);const v=sceneView(scene.id),ui=presentation(v,0,false);
  assert.ok(!ui.actions.some((a:any)=>['back','home'].includes(a.event.type)));
  assert.ok(!controlsFor({view:v,ui,previewScene:true}).some((c:any)=>/footer-back|setting-back/.test(c.id)));
 }
});
test('variable-height lists keep the last focused row fully visible and preserve footer focus',()=>{
 for(const screen of ['wallet','orders','addresses','gallery']){
  const rows=Array.from({length:screen==='gallery'?60:6},(_,i)=>({title:i===4?'长'.repeat(24):'条目'+i,subtitle:''}));
  const layout=listLayout(rows,screen,true,rows.length-1,0);
  assert.ok(layout.scroll>0);assert.equal(layout.overflowBelow,false);
  assert.equal(listLayout(rows,screen,true,undefined,layout.scroll).scroll,layout.scroll);
 }
});
test('order detail pagination keeps long item lists reachable without network calls',async()=>{
 const p=makePage();p.render({screen:'order-detail',title:'订单详情',rows:[],actions:[],presentation:{order:{id:'long-order',items:Array.from({length:10},(_,i)=>({name:'餐品'+i,quantity:12}))}}});
 const calls=p.gateway.calls.length;assert.equal(p.data.ui.descriptionPages,4);
 await choose(p,c=>c.command==='description');assert.equal(p.data.descriptionPage,1);assert.equal(p.gateway.calls.length,calls);
 assert.equal(p.data.ui.orderItems[0].name,'餐品3');
});

test('raw back boundary includes 500ms; repeats do not count as a second press',async()=>{
 const p=makePage();await p.send({type:'start'});let backs=0;p.goBack=()=>{p.clearBackTimer();backs++;};
 const original=Date.now;let now=10000;Date.now=()=>now;
 try{
  await key(p,'Backspace');now+=500;await key(p,'Backspace');assert.equal(backs,1);
  now+=1000;await key(p,'Backspace');now+=501;await key(p,'Backspace');assert.equal(backs,1);
  await p.onKeyUp({code:'Backspace',repeat:true,preventDefault(){}});assert.equal(backs,1);
  p.clearBackTimer();
 }finally{Date.now=original;p.clearBackTimer();}
});
test('receipt scroll exposes all rows, clamps at both ends and never submits',async()=>{
 const p=makePage();p.render({screen:'review',rows:[],actions:[],presentation:{receipt:Array.from({length:14},(_,i)=>({title:'明细'+i,subtitle:'长规格说明'}))}});
 const calls=p.gateway.calls.length;assert.equal(p.data.ui.receiptItems.length,14);
 for(let i=0;i<30;i++)await p.understand('下一页');
 assert.equal(p.data.receiptScroll,p.data.ui.receiptMaxScroll);
 for(let i=0;i<30;i++)await p.understand('上一页');
 assert.equal(p.data.receiptScroll,0);assert.equal(p.gateway.calls.length,calls);
 assert.ok(!p.controls.some((c:any)=>c.id==='receipt-page'));
});

 test('verified host gesture returns once without a second raw double recognizer',async()=>{
 const p=makePage();await p.send({type:'start'});p.usesHostBackGesture=()=>true;let backs=0;p.goBack=()=>{backs++;};
 const event={code:'Backspace',timeStamp:1000,preventDefault(){}};
 await p.onKeyUp(event);await p.onKeyUp(event);assert.equal(backs,1);assert.equal(p.backPending,false);
 await p.onKeyUp({...event,timeStamp:2000});assert.equal(backs,2);
 p.cleanup();assert.equal(p.lastHostBackStamp,undefined);
 });

test('scene launch parameters cannot bypass real startup and connect',async()=>{
 const p=makePage();let connected=0;p.connect=()=>{connected++;};
 p.onLoad({scene:'03'});p.onShow();assert.equal(connected,1);
 assert.equal(p.data.view.screen,'home');assert.equal(p.showScene,undefined);assert.equal(p.data.scenes,undefined);
});
test('missing real order fields remain absent; claim confirmation has no invented amount',()=>{
 const order=orderView({items:[{name:'真实餐品'}]});assert.equal(order.amount,'');assert.equal(order.items[0].quantity,null);
 assert.equal(orderView({quotedAmount:null,realTotalAmount:'',items:[{name:'餐品',quantity:null}]}).amount,'');assert.equal(orderView({items:[{name:'餐品',quantity:null}]}).items[0].quantity,null);assert.equal(orderView({quotedAmount:0}).amount,'¥0.00');
 const page=readFileSync('aiui/pages/index/index.ink','utf8');assert.ok(!page.includes('¥3'));
 for(const screen of ['order-status','payment']){const ui=presentation({id:'real',screen,title:'待核实',summary:'',rows:[],actions:[],presentation:{}},0,false);assert.ok(!/A026|18:45|约 10 分钟/.test(ui.statusNumber||''));}
});


test('host duplicate gesture with distinct stamps returns only one business level',async()=>{
 const p=makePage();p.usesHostBackGesture=()=>true;
 for(const e of [{type:'start'},{type:'fulfillment',value:'pickup'},{type:'search-stores',value:'上海市 人民广场'},{type:'store',id:'12345'},{type:'meal',id:'burger'}])await p.send(e);
 assert.equal(p.data.view.screen,'meal');
 const back=(timeStamp:number)=>p.onKeyUp({code:'Backspace',timeStamp,preventDefault(){}});
 await back(1000);assert.equal(p.data.view.screen,'menu');
 await back(1120);assert.equal(p.data.view.screen,'menu');
 await back(1500);assert.equal(p.data.view.screen,'menu');
 await back(2100);assert.equal(p.data.view.screen,'stores');
});

test('back diagnostic is opt-in and excludes arbitrary event and business fields',()=>{
 const p=makePage();const messages:string[]=[];const original=console.info;
 console.info=(text:string)=>messages.push(text);
 try{
  p.data.input='private-input';p.data.view.summary='private-summary';
  const event={code:'Backspace',timeStamp:42,cancelable:true,defaultPrevented:true,token:'private-token',detail:{text:'private-detail'}};
  p.traceBack('up-consumed',event);assert.equal(messages.length,0);
  p.backTraceEnabled=true;p.traceBack('up-consumed',event);
  assert.equal(messages.length,1);assert.ok(!messages[0].includes('private-'));
  const record=JSON.parse(messages[0].slice('MCD_BACK_TRACE '.length));
  assert.equal(record.defaultPrevented,true);assert.equal(record.cancelable,true);
  assert.deepEqual(Object.keys(record).sort(),['at','busy','cancelable','code','defaultPrevented','listening','phase','repeat','screen','settings','timeStamp'].sort());
 }finally{console.info=original;}
});


test('Backspace is intercepted only on key-up, before dispatching business back',async()=>{
 const p=makePage();await p.send({type:'start'});
 let prevented=0,backs=0;
 p.handleBackPress=()=>{assert.equal(prevented,1);backs++;};
 const event={code:'Backspace',preventDefault(){prevented++;}};
 p.onKeyDown(event);assert.equal(prevented,0);assert.equal(backs,0);
 await p.onKeyUp(event);assert.equal(prevented,1);assert.equal(backs,1);
 p.cleanup();
});
test('home closes explicitly once via window.close, not via business back or voice',async()=>{
 const p=makePage();await p.understand('返回');assert.equal(p.closeRequests,0);
 await key(p,'Backspace');assert.equal(p.closeRequests,0);
 await key(p,'Backspace');assert.equal(p.closeRequests,1);
 await backTwice(p);assert.equal(p.closeRequests,1);
 const missing=makePage();missing.testWindow.close=undefined;await backTwice(missing);
 assert.equal(missing.closeRequests,0);assert.match(missing.data.message,/不支持应用关闭/);
});
test('settings and more overlays consume back before home exit and restore focus',async()=>{
 const p=makePage();p.focusId='home-settings';p.decorate();p.openSettings();
 await backTwice(p);assert.equal(p.data.settings,false);assert.equal(p.data.controlId,'home-settings');assert.equal(p.closeRequests,0);
 const q=makePage();q.focusId='row-0';q.decorate();q.toggleMore();
 await backTwice(q);assert.equal(q.data.more,false);assert.equal(q.data.controlId,'row-0');assert.equal(q.closeRequests,0);
});
test('ordinary return restores originating list focus and scroll without exiting',async()=>{
 const p=makePage();for(const e of [{type:'start'},{type:'fulfillment',value:'pickup'},{type:'search-stores',value:'上海市 人民广场'},{type:'store',id:'12345'}])await p.send(e);
 p.focusId='row-1';p.decorate();const before={focus:p.data.controlId,scroll:p.data.listScroll};
 await choose(p,c=>c.id==='row-1');assert.equal(p.data.view.screen,'meal');
 await backTwice(p);assert.equal(p.data.view.screen,'menu');assert.equal(p.data.controlId,before.focus);assert.equal(p.data.listScroll,before.scroll);assert.equal(p.data.message,'');assert.equal(p.closeRequests,0);
});
test('listening double back cancels without exit or navigation; late recognition is ignored',async()=>{
 let recognizer:any;
 class Recognition{onresult:any;onend:any;onerror:any;start(){recognizer=this;}abort(){}stop(){}}
 const p=makePage(Recognition);p.focusId='row-0';p.decorate();p.listen();assert.equal(p.data.listening,true);
 await backTwice(p);assert.equal(p.data.listening,false);assert.equal(p.data.view.screen,'home');assert.equal(p.data.controlId,'row-0');assert.equal(p.closeRequests,0);
 recognizer.onresult({results:[[{transcript:'开始点餐'}]]});assert.equal(p.data.view.screen,'home');
});
test('busy home cancels waiting rather than closing and one raw burst cannot exit parent',async()=>{
 const p=makePage();p.focusId='home-settings';p.decorate();p.data.busy=true;await backTwice(p);assert.equal(p.data.busy,false);assert.equal(p.closeRequests,0);assert.equal(p.data.controlId,'home-settings');
 const q=makePage();await q.send({type:'start'});
 await backTwice(q);assert.equal(q.data.view.screen,'home');await backTwice(q);assert.equal(q.closeRequests,0);
 q.cleanup();assert.equal(q.lastRawBackAt,undefined);
});

test('wallet screen is published as one complete snapshot even when setData is deferred',()=>{
 const p=makePage(),homeKeys=p.data.ui.rows.map((r:any)=>r.renderKey),updates:any[]=[];
 p.setData=(patch:any)=>updates.push(structuredClone(patch));
 const wallet={...p.data.view,screen:'wallet',rows:[{id:'start',title:'真实返回的优惠券',subtitle:'',event:{type:'start'}}],actions:[],presentation:{count:1}};
 p.render(wallet);
 assert.equal(updates.length,1);
 const update=updates[0];assert.equal(update.view.screen,'wallet');assert.equal(update.ui.title,'我的优惠券');
 assert.deepEqual(update.ui.rows.map((r:any)=>r.title),['真实返回的优惠券']);
 assert.equal(update.ui.rows[0].displayIndexLabel,'(1) ');assert.ok(!homeKeys.includes(update.ui.rows[0].renderKey));
 assert.equal(update.controlId,'row-0');assert.equal(update.listScroll,0);
 assert.equal(p.data.view.screen,'home','candidate state is not read back from setData');
});
test('slow wallet query stays home, ignores repeat activation and enters wallet directly',async()=>{
 const p=makePage(),original=p.gateway.call.bind(p.gateway);let release:any,queries=0;
 const gate=new Promise<void>(resolve=>release=resolve);
 p.gateway.call=async(name:string,args:any)=>{if(name==='query-my-coupons'){queries++;await gate;return {coupons:Array.from({length:12},(_,i)=>({couponId:'coupon'+i,name:i===11?'超长优惠券餐品名称'.repeat(4):'优惠券'+i}))};}return original(name,args);};
 const snapshots:any[]=[],set=p.setData.bind(p);p.setData=(patch:any)=>{set(patch);snapshots.push(structuredClone(p.data));};
 const opening=choose(p,c=>c.event?.type==='query'&&c.event.value==='wallet');
 await Promise.resolve();await Promise.resolve();
 assert.equal(p.data.view.screen,'home');assert.equal(p.data.ui.home,true);assert.equal(p.data.walletLoading,true);
 await key(p,'Enter');assert.equal(queries,1);
 release();await opening;
 assert.equal(p.data.view.screen,'wallet');assert.equal(p.data.controlId,'row-0');assert.equal(p.data.listScroll,0);
 assert.equal(p.data.busy,false);assert.equal(p.data.walletLoading,false);
 assert.deepEqual(p.data.ui.rows.map((r:any)=>r.displayIndexLabel),Array.from({length:12},(_,i)=>'('+(i+1)+') '));
 assert.ok(snapshots.every(d=>d.ui.rows.every((r:any,i:number)=>r.title===d.view.rows[i].title)),'no commit mixes home rows with wallet view');
 assert.deepEqual([...new Set(snapshots.map(d=>d.view.screen))],['home','wallet']);
 for(let i=0;i<11;i++)await key(p,'ArrowDown');assert.equal(p.data.controlId,'row-11');
 assert.ok(p.data.listScroll>0);assert.equal(p.data.ui.overflowBelow,false);
 await key(p,'Enter');assert.equal(p.data.view.screen,'coupon-detail');
 const scroll=p.couponReturn.scroll;await backTwice(p);assert.equal(p.data.controlId,'row-11');assert.equal(p.data.listScroll,scroll);
 p.lastRawBackAt=undefined;await backTwice(p);assert.equal(p.data.view.screen,'home');assert.equal(p.data.controlId,'row-1');
 assert.equal(queries,1);assert.equal(p.closeRequests,0);
});
test('empty wallet and failed wallet query do not show navigation rows under wallet title',async()=>{
 const empty=makePage();empty.gateway.call=async()=>({coupons:[]});
 await choose(empty,c=>c.event?.value==='wallet');assert.equal(empty.data.view.screen,'wallet');
 assert.equal(empty.data.ui.rows.length,0);assert.equal(empty.data.ui.emptyMessage,'暂无可用优惠券');
 const failed=makePage();failed.gateway.call=async()=>{throw new Error('test network unavailable');};
 await choose(failed,c=>c.event?.value==='wallet');assert.equal(failed.data.view.screen,'home');
 assert.equal(failed.data.controlId,'row-1');assert.equal(failed.data.busy,false);assert.equal(failed.data.walletLoading,false);
 assert.match(failed.data.ui.alert,/网络连接失败/);
});
test('voice wallet query is read-only and coupon numbering is stable across eight rows and checkout',async()=>{
 const p=makePage();let queries=0;const original=p.gateway.call.bind(p.gateway);
 p.gateway.call=async(name:string,args:any)=>{if(name==='query-my-coupons'){queries++;return {coupons:Array.from({length:8},(_,i)=>({couponId:String(i),name:'券'+i}))};}return original(name,args);};
 await p.understand('查看优惠券');assert.equal(queries,1);assert.equal(p.data.view.screen,'wallet');
 assert.deepEqual(p.data.ui.rows.map((r:any)=>r.displayIndexLabel),Array.from({length:8},(_,i)=>'('+(i+1)+') '));
 const checkout=presentation({...p.data.view,screen:'coupon-select'},0,false);
 assert.equal(checkout.rows[7].displayIndex,8);assert.equal(checkout.rows[7].displayIndexLabel,'(8) ');
 assert.ok(!p.gateway.calls.some((c:any)=>['auto-bind-coupons','create-order','delivery-create-address'].includes(c.name)));
});

test('native coordinates resolve through AMap and use city search without searchType 3',async()=>{
 let success:any;const requests:any[]=[];
 const api={request(o:any){requests.push(o);queueMicrotask(()=>o.success({statusCode:200,data:requests.length===1?{status:'1',locations:'121.4,31.2'}:{status:'1',regeocode:{formatted_address:'上海市黄浦区南京东路',addressComponent:{city:[],province:'上海市',district:'黄浦区',streetNumber:{street:'南京东路'}}}}}));return {abort(){}};}};
 const p=makePage(undefined,undefined,{geolocation:{getCurrentPosition(ok:any){success=ok;}}},api);
 await p.send({type:'start'});await p.send({type:'fulfillment',value:'pickup'});
 if(!p.data.busy)p.locate();await success({coords:{longitude:121.4,latitude:31.2}});await new Promise(r=>setImmediate(r));
 assert.equal(p.data.view.screen,'stores');assert.ok(requests.length>=2);
 assert.match(requests[0].url,/coordsys=gps/);assert.match(requests[1].url,/geocode\/regeo/);
 assert.deepEqual(p.gateway.calls.find((c:any)=>c.name==='query-nearby-stores').args,{searchType:2,beType:1,city:'上海市',keyword:'黄浦区南京东路'});
 assert.equal(p.data.busy,false);p.cleanup();
});
test('AMap errors leave location page with voice fallback and no store request',async()=>{
 let success:any;const p=makePage(undefined,undefined,{geolocation:{getCurrentPosition(ok:any){success=ok;}}},{request(o:any){queueMicrotask(()=>o.success({statusCode:200,data:{status:'0',infocode:'10001'}}));return {abort(){}};}});
 p.locate();await success({coords:{longitude:121,latitude:31}});
 assert.match(p.data.message,/高德 Key/);assert.match(p.data.message,/语音/);assert.equal(p.gateway.calls.length,0);p.cleanup();
});
test('location error codes, invalid fixes and missing capability are explicit and leave voice available',async()=>{
 for(const code of [1,2,3]){
  let error:any;const p=makePage(undefined,undefined,{geolocation:{getCurrentPosition(_ok:any,fail:any){error=fail;}}});
  p.locate();error({code});assert.equal(p.data.busy,false);assert.match(p.data.message,code===1?/权限/:code===2?/无法获取位置/:/超时/);assert.match(p.data.message,/语音/);assert.equal(p.locationTimer,null);
 }
 let success:any;const invalid=makePage(undefined,undefined,{geolocation:{getCurrentPosition(ok:any){success=ok;}}});invalid.locate();await success({coords:{longitude:181,latitude:0}});assert.match(invalid.data.message,/经纬度无效/);
 const missing=makePage();missing.locate();assert.match(missing.data.message,/未提供定位能力/);assert.equal(missing.data.busy,false);
});
test('double back cancels geolocation waiting; late success and error cannot change restored page',async()=>{
 let success:any,error:any;const p=makePage(undefined,undefined,{geolocation:{getCurrentPosition(ok:any,fail:any){success=ok;error=fail;}}});
 await p.send({type:'start'});await p.send({type:'fulfillment',value:'pickup'});p.gateway.supportsInput=async()=>true;
 p.locate();await backTwice(p);assert.equal(p.data.busy,false);assert.equal(p.data.view.screen,'fulfillment');assert.equal(p.locationTimer,null);
 const message=p.data.message;await success({coords:{longitude:121,latitude:31}});error({code:3});
 assert.equal(p.data.message,message);assert.equal(p.data.view.screen,'fulfillment');assert.equal(p.closeRequests,0);
 assert.equal(p.gateway.calls.filter((c:any)=>c.name==='query-nearby-stores').length,0);
 const hidden=makePage(undefined,undefined,{geolocation:{getCurrentPosition(ok:any){success=ok;}}});hidden.locate();hidden.cleanup();await success({coords:{longitude:121,latitude:31}});assert.equal(hidden.data.busy,false);assert.equal(hidden.locationTimer,null);
});

test('silent location provider times out locally and stale retry reacquires a fix',async()=>{
 let expire:any,requested=0;const p=makePage(undefined,undefined,{geolocation:{getCurrentPosition(){requested++;}}});
 const original=globalThis.setTimeout;
 try{
  globalThis.setTimeout=((callback:any,delay:any)=>{assert.equal(delay,12000);expire=callback;return 1;}) as any;
  p.locate();expire();assert.equal(p.data.busy,false);assert.match(p.data.message,/超时/);
 }finally{globalThis.setTimeout=original;p.cleanup();}
 const retry=makePage(undefined,undefined,{geolocation:{getCurrentPosition(){requested++;}}});
 retry.render({...retry.data.view,screen:'location',input:{placeholder:'城市和位置'},rows:[],actions:[{label:'重试',event:{type:'geo-stores',value:{longitude:121,latitude:31}}}]});
 await choose(retry,c=>c.event?.type==='fulfillment'&&c.event.value==='pickup');assert.equal(requested,2);assert.equal(retry.gateway.calls.length,0);retry.cleanup();
});

test('pickup automatically locates without publishing location screen and failures remain accessible',async()=>{
 let success:any;const states:any[]=[];
 const p=makePage(undefined,undefined,{geolocation:{getCurrentPosition(ok:any){success=ok;}}});await p.send({type:'start'});
 const original=p.setData.bind(p);p.setData=(patch:any)=>{original(patch);states.push({screen:p.data.view.screen,busy:p.data.busy});};
 await choose(p,c=>c.event?.type==='fulfillment'&&c.event.value==='pickup');
 assert.equal(p.data.view.screen,'fulfillment');assert.equal(p.data.busy,true);assert.equal(p.data.locationLoading,true);assert.ok(success);assert.ok(states.every(s=>s.screen!=='location'));
 await p.send({type:'fulfillment',value:'pickup'});assert.equal(p.data.busy,true);
 await backTwice(p);assert.equal(p.data.view.screen,'fulfillment');assert.equal(p.data.busy,false);assert.ok(p.controls.some((c:any)=>c.command==='listen'));assert.ok(p.controls.some((c:any)=>c.event?.type==='fulfillment'&&c.event.value==='pickup'));p.cleanup();
});
test('store rows display MCP distance and returning skips removed location state',async()=>{
 const p=makePage();await p.send({type:'start'});await p.send({type:'fulfillment',value:'pickup'});await p.send({type:'search-stores',value:'上海市 人民广场'});
 assert.equal(p.data.view.screen,'stores');
 const session=p.deviceStore.get(p.data.view.id);session.stores[0].distance=1503;session.stores[0].address='人民广场路123号';p.deviceStore.save(session);p.render(p.service.state(session.id));
 assert.ok(p.data.ui.rows[0].storeAddress);assert.ok(!p.data.ui.rows[0].subtitle.includes('1503'));assert.equal(p.data.ui.rows[0].distanceLabel,'1.5 公里');
 for(const [value,label] of [[462,'462 米'],[0,'0 米'],[1000,'1.0 公里'],[null,''],[-1,'']]){session.stores[0].distance=value;p.deviceStore.save(session);p.render(p.service.state(session.id));assert.equal(p.data.ui.rows[0].distanceLabel,label);}

 const last=p.controls.filter((c:any)=>Number.isInteger(c.rowIndex)).at(-1);p.focusId=last.id;p.decorate();assert.ok(p.data.listScroll>=0);assert.equal(p.data.ui.overflowBelow,false);
 await backTwice(p);assert.equal(p.data.view.screen,'fulfillment');assert.ok(p.controls.some((c:any)=>c.event?.value==='pickup'));p.cleanup();
});
test('store layout derives explicit line geometry from font metrics and retains all characters',()=>{
 const rows=[{id:'a',title:'麦当劳长餐厅名称'.repeat(4),storeAddress:'长地址123号'.repeat(8),storeStatus:'营业中'}];
 const layout=storeRows(rows,(text:string,size:number)=>Array.from(text).length*size);
 assert.equal(layout[0].titleLines.map((l:any)=>l.text).join(''),rows[0].title);assert.equal(layout[0].addressLines.map((l:any)=>l.text).join(''),rows[0].storeAddress);
 assert.ok(layout[0].titleLines.every((l:any)=>l.text.length*22<=338));
 assert.equal(layout[0].height,30+layout[0].titleLines.length*30+4+layout[0].addressLines.length*26+4+26);
 const a=listLayout(layout,'stores',false,0,52),b=listLayout(layout,'stores',false,0,a.scroll);assert.equal(a.scroll,b.scroll);
});
test('old saved location view projects to fulfillment with speech fallback, never to intermediate page',()=>{
 const p=makePage();p.render({...p.data.view,screen:'location',title:'选择附近门店',rows:[],input:{placeholder:'城市和位置',value:''},actions:[{label:'当前位置',event:{type:'locate'}}]});
 assert.equal(p.data.view.screen,'fulfillment');assert.ok(!p.data.actions.some((a:any)=>a.label==='当前位置'));assert.ok(p.controls.some((c:any)=>c.command==='listen'));p.cleanup();
});

test('store numbering is stable and location voice search has no draft or retry page',async()=>{
 const p=makePage();await p.send({type:'start'});await p.send({type:'fulfillment',value:'pickup'});
 assert.equal(p.data.view.screen,'fulfillment');assert.deepEqual(p.data.rows.map((r:any)=>r.id),['pickup','delivery']);assert.equal(p.data.view.input,undefined);assert.equal(p.data.actions.length,0);
 const snapshots:any[]=[];const update=p.setData.bind(p);p.setData=(v:any)=>{update(v);snapshots.push({screen:p.data.view.screen,draft:p.data.voiceDraft,actions:p.data.actions.map((a:any)=>a.label)});};
 const originalCall=p.gateway.call.bind(p.gateway);p.gateway.call=async(name:string,args:any)=>name==='query-nearby-stores'?Array.from({length:12},(_,i)=>({storeCode:'store'+i,storeName:'测试门店'+i,address:'测试地址',businessStatus:true})):originalCall(name,args);
 await p.understand('上海市人民广场');assert.equal(p.data.view.screen,'stores');assert.ok(snapshots.every(s=>!s.draft&&!s.actions.includes('重新定位')));
 assert.deepEqual(p.data.rows.map((r:any)=>r.displayIndexLabel),Array.from({length:12},(_,i)=>'('+(i+1)+') '));
 assert.ok(p.data.ui.rows[0].titleLines[0].text.startsWith('(1) '));
 p.focusId='row-1';p.decorate();assert.equal(p.data.ui.rows[1].displayIndexLabel,'(2) ');p.cleanup();
});

test('pickup reuses only fresh nearby address resolution while querying MCP stores again',async()=>{
 let callback:any,options:any,requests=0;
 const p=makePage(undefined,undefined,{geolocation:{getCurrentPosition(ok:any,_fail:any,opts:any){callback=ok;options=opts;}}},{request(opts:any){requests++;queueMicrotask(()=>opts.success({statusCode:200,data:opts.url.includes('coordinate/convert')?{status:'1',locations:'121.48,31.23'}:{status:'1',regeocode:{formatted_address:'上海市黄浦区人民广场1号',addressComponent:{province:'上海市',city:'上海市',district:'黄浦区'}}}}));return {abort(){}};}});
 await p.send({type:'start'});
 const enter=async(lng=121.47)=>{await p.startPickup();await callback({coords:{longitude:lng,latitude:31.23,accuracy:10},timestamp:Date.now()});await new Promise(r=>setImmediate(r));assert.equal(p.data.view.screen,'stores');};
 await enter();assert.equal(requests,2);assert.equal(options.maximumAge,15000);
 await backTwice(p);await enter();assert.equal(requests,2);assert.equal(p.gateway.calls.filter((c:any)=>c.name==='query-nearby-stores').length,2);
 await backTwice(p);p.resolvedLocationCache.at-=61000;p.resolvedLocationCache.positionAt-=61000;await enter();assert.equal(requests,4);
 await backTwice(p);p.resolvedLocationCache.positionAt-=16000;await enter(121.48);assert.equal(requests,6);
 p.cleanup();assert.equal(p.resolvedLocationCache,null);
});

test('fulfillment warms GPS once and pickup shares it; hiding cancels warmup without late mutation',async()=>{
 let acquisitions=0,complete:any;
 const p=makePage(undefined,undefined,{geolocation:{getCurrentPosition(ok:any){acquisitions++;complete=ok;}}});
 await p.send({type:'start'});assert.equal(acquisitions,1);assert.equal(p.data.busy,false);
 await p.startPickup();assert.equal(acquisitions,1);assert.equal(p.data.busy,true);
 const before=p.data.view.screen;p.cleanup();complete({coords:{longitude:120,latitude:30,accuracy:10},timestamp:Date.now()});await new Promise(r=>setImmediate(r));
 assert.equal(p.data.view.screen,before);assert.equal(p.gateway.calls.filter((c:any)=>c.name==='query-nearby-stores').length,0);
 const q=makePage(undefined,undefined,{geolocation:{getCurrentPosition(){}}});await q.send({type:'start'});const warm=q.pickupPositionWarmup;q.cleanup();assert.deepEqual(await warm.promise,{error:{code:3}});
});

test('coupon details use real price, complete date range, periods and fulfillment without invented values',()=>{
 const c=couponView({title:'19.9元王牌炸鸡任选2'}, {title:'19.9元王牌炸鸡任选2',discountInfo:{discountDesc:'用券价格',discountValue:'19.9'},tradeStartDate:'2026-10-19',tradeEndDate:'2026-10-23',tradeTimePeriods:[{startTime:'10:30:00',endTime:'23:59:59'}],orderTypes:[1,2]});
 assert.equal(c.title,'王牌炸鸡任选2');assert.equal(c.price,'¥19.90');assert.equal(c.date,'2026年10月19日—23日');assert.equal(c.time,'10:30—23:59');assert.equal(c.fulfillment,'到店／外送');
 const missing=couponView({title:'优惠券'},{});assert.equal(missing.price,'');assert.equal(missing.time,'未提供');assert.equal(missing.fulfillment,'未提供');
 assert.equal(couponView({title:'减5元'}, {discountInfo:{discountDesc:'优惠金额',discountValue:'5'}}).price,'');
});
test('duplicate coupon IDs have unique rendering keys and open the selected instance details',async()=>{
 const p=makePage();await p.send({type:'query',value:'wallet'});const s=p.deviceStore.get(p.data.view.id);
 s.coupons=[{id:'same',title:'第一张',tradeStartDate:'2026-10-01'},{id:'same',title:'第二张',tradeStartDate:'2026-11-01'}];p.deviceStore.save(s);p.render(p.service.state(s.id));
 assert.equal(new Set(p.data.ui.assetRows.map((r:any)=>r.renderKey)).size,2);await choose(p,c=>c.rowIndex===1);assert.equal(p.data.ui.coupon.title,'第二张');assert.match(p.data.ui.coupon.date,/11月/);p.cleanup();
});
test('history rows use measured heights and include every title character inside the focused window',()=>{
 const p=makePage();p.render({screen:'orders',title:'历史订单',rows:[{id:'one',title:'麦当劳很长的餐厅名称'.repeat(4),subtitle:'订单已完成 · 2026-08-14 18:37:56',event:{type:'query-order'}},{id:'two',title:'另一家餐厅',subtitle:'订单已取消',event:{type:'query-order'}}],actions:[],presentation:{}});
 const first=p.data.ui.assetRows[0];assert.equal(first.titleLines.map((x:any)=>x.text).join(''),'(1) '+p.data.view.rows[0].title);assert.ok(first.height>84);
 p.focusId='row-1';p.decorate();assert.ok(p.data.listScroll>0);assert.equal(p.data.ui.overflowBelow,false);p.cleanup();
});
test('voice motion changes while listening and cleans up on cancellation without a bottom success message',async()=>{
 class Recognition{start(){}abort(){}stop(){}}
 const p=makePage(Recognition);p.listen();assert.equal(p.data.listening,true);assert.equal(p.data.message,'');assert.equal(p.data.voiceBars.length,5);const initial=p.data.voiceBars.map((x:any)=>x.height);await new Promise(r=>setTimeout(r,180));assert.notDeepEqual(p.data.voiceBars.map((x:any)=>x.height),initial);
 await backTwice(p);assert.equal(p.data.listening,false);assert.equal(p.voiceMotionTimer,null);assert.equal(p.data.message,'');p.cleanup();
});

test('menu matches food preference across full result and hides product icons',async()=>{
 const p=makePage();const rows=Array.from({length:24},(_,i)=>({id:String(i),title:i>=10?'板烧鸡腿堡套餐'+i:'麦辣鸡腿堡'+i,image:'https://example.test/product.png',event:{type:'meal',id:String(i)}}));
 assert.equal(matchMeals(rows,'全部餐品').length,24);
 assert.equal(matchMeals(rows,'想吃板烧').length,14);
 assert.equal(matchMeals(rows,'想吃不辣的汉堡').every((r:any)=>!r.title.includes('辣')),true);
 assert.equal(matchMeals(rows,'咖啡').length,0);
 const ui=presentation({screen:'menu',rows,actions:[]},0,false);assert.equal(ui.rows.length,24);assert.ok(ui.rows.every((r:any)=>!r.icon));
 await p.understand('想吃板烧鸡腿堡');assert.equal(p.data.view.screen,'fulfillment');assert.equal(p.deviceStore.get(p.data.view.id).orderDraft.items[0].query,'板烧鸡腿堡');
 p.cleanup();
});

test('loading ring rotates and releases its timer after completion or hide',async()=>{
 const p=makePage();p.beginLoading({busy:true,message:'正在处理'});await new Promise(r=>setTimeout(r,125));assert.ok(p.data.loadingFrame>0);
 p.setData({busy:false});await new Promise(r=>setTimeout(r,125));assert.equal(p.loadingMotionTimer,null);
 p.beginLoading({busy:true});p.cleanup();assert.equal(p.loadingMotionTimer,null);
});

 test('menu focus submits bounded current batch and updates visible focus',async()=>{const p=makePage();await p.send({type:'start'});await p.send({type:'fulfillment',value:'pickup'});await p.send({type:'search-stores',value:'上海市 人民广场'});await p.send({type:'store',id:'12345'});const rows=p.data.ui.rows;const old=p.focusId;await key(p,'ArrowDown');assert.notEqual(p.focusId,old);assert.ok(p.data.ui.rows.length<=5);assert.ok(p.data.ui.rows[1].cls.includes('focused'));assert.ok(!p.data.ui.rows[0].cls.includes('focused'));p.cleanup();});

test('menu batches 0,1,5,6,12 real records and cycles locally; details restore focus',async()=>{
 for(const count of [0,1,5,6,12]){
  const p=makePage();const session=p.deviceStore.get(p.data.view.id);session.screen='menu';session.meals=Array.from({length:count},(_,i)=>({code:'item'+i,name:'长名称板烧鸡腿堡套餐'+i,currentPrice:'12.5'}));p.deviceStore.save(session);p.render(p.service.state(session.id));
  assert.equal(p.data.rows.length,Math.min(5,count));assert.equal(p.data.ui.aside,count?'1/'+Math.max(1,Math.ceil(count/5)):'');
  const calls=p.gateway.calls.length;
  if(count>5){await choose(p,c=>c.event?.type==='menu-batch');assert.equal(p.data.rows[0].id,'item5');assert.equal(p.data.controlId,'row-0');await p.understand('换一批');assert.equal(p.data.rows[0].id,count===12?'item10':'item0');if(count===12)await p.understand('换一批');assert.equal(p.data.rows[0].id,'item0');}
  assert.equal(p.gateway.calls.length,calls);
  await p.understand('不存在的咖啡');assert.equal(p.data.rows.length,0);assert.match(p.data.view.summary,/没有匹配/);
  await p.understand('全部餐品');assert.equal(p.data.rows.length,Math.min(5,count));assert.equal(p.gateway.calls.length,calls);p.cleanup();
 }
 const p=makePage();await p.send({type:'start'});await p.send({type:'fulfillment',value:'pickup'});await p.send({type:'search-stores',value:'上海市 人民广场'});await p.send({type:'store',id:'12345'});
 const s=p.deviceStore.get(p.data.view.id);s.meals=Array.from({length:12},(_,i)=>({...s.meals[0],code:i===5?'burger':'x'+i}));p.deviceStore.save(s);p.render(p.service.state(s.id));await p.send({type:'menu-batch'});const before=p.capturePosition();await choose(p,c=>c.event?.type==='meal');await p.goBack();assert.equal(p.data.view.presentation.menuPage,1);assert.equal(p.data.controlId,before.focus);assert.equal(p.data.listScroll,before.listScroll);p.cleanup();
});

async function historyFixture(p:any){
 const s=p.deviceStore.get(p.data.view.id);s.screen='orders';s.history=['home'];s.orders=Array.from({length:8},(_,i)=>({orderId:'history'+i,storeName:'历史餐厅'+i,orderStatus:'订单已完成'}));p.deviceStore.save(s);p.render(p.service.state(s.id));
}
test('history opens detail atomically; slow and duplicate keys retain list, back restores focus',async()=>{
 const p=makePage();await historyFixture(p);const call=p.gateway.call.bind(p.gateway);let resolve:any;let reads=0;
 p.gateway.call=async(name:string,args:any)=>{if(name==='query-order'){reads++;return await new Promise(r=>{resolve=()=>r({orderId:args.orderId,orderStatus:'订单已完成',pickupCode:'123',storeName:'历史餐厅'});});}return call(name,args);};
 const screens:string[]=[];const set=p.setData.bind(p);p.setData=(patch:any)=>{if(patch.view)screens.push(patch.view.screen);set(patch);};
 for(let i=0;i<5;i++)await key(p,'ArrowDown');const old=p.capturePosition();const request=key(p,'Enter');await new Promise(r=>setTimeout(r,0));assert.equal(p.data.view.screen,'orders');assert.equal(p.data.orderLoading,true);await key(p,'Enter');assert.equal(reads,1);resolve();await request;
 assert.equal(p.data.view.screen,'order-detail');assert.ok(!screens.includes('order-status'));assert.equal(p.deviceStore.get(p.data.view.id).orderSource,'history');
 await p.goBack();assert.equal(p.data.view.screen,'orders');assert.equal(p.data.controlId,old.focus);assert.equal(p.data.listScroll,old.listScroll);p.cleanup();
});
test('failed history read preserves list and error; cancel or hide ignores late detail',async()=>{
 for(const mode of ['fail','cancel','hide']){
  const p=makePage();await historyFixture(p);let settle:any;
  p.gateway.call=async()=>await new Promise((resolve,reject)=>{settle=()=>mode==='fail'?reject(new Error('network')):resolve({orderId:'history0',orderStatus:'订单已完成'});});
  const screens:string[]=[];const set=p.setData.bind(p);p.setData=(patch:any)=>{if(patch.view)screens.push(patch.view.screen);set(patch);};
  const work=key(p,'Enter');await new Promise(r=>setTimeout(r,0));if(mode==='cancel')await p.cancelPending();if(mode==='hide')p.cleanup();settle();await work;
  assert.ok(!screens.includes('order-status'));assert.ok(!screens.includes('order-detail'));assert.equal(p.data.view.screen,'orders');if(mode==='fail')assert.ok(p.data.message);p.cleanup();
 }
});
test('history resume resets to orders including legacy source, but checkout and unresolved remain protected',async()=>{
 for(const source of ['history','legacy','unknown','checkout']){
  const p=makePage();await historyFixture(p);const s=p.deviceStore.get(p.data.view.id);s.screen='order-status';s.order={orderId:'history0'};s.history=source==='unknown'?['home']:['home','orders'];if(source==='history'||source==='checkout')s.orderSource=source;p.deviceStore.save(s);
  const resumed=p.service.resume();assert.equal(resumed.screen,source==='history'||source==='legacy'?'orders':'order-status');p.cleanup();
 }
 const p=makePage();await historyFixture(p);const s=p.deviceStore.get(p.data.view.id);s.screen='order-status';s.orderSource='history';s.order={orderId:'history0'};s.history=['home','orders'];p.deviceStore.begin('pending-test',s,'order');assert.equal(p.service.resume().screen,'uncertain');p.cleanup();
});


test('reconnect and offline recovery keep historic orders on list without generic status',async()=>{
 for(const offline of [false,true]){
  class LiveGateway extends MockGateway { mode='live' as any; async tools(){if(offline)throw new Error('offline');return [];} async close(){} }
  const p=makePage(undefined,undefined,undefined,undefined,LiveGateway);await historyFixture(p);
  const s=p.deviceStore.get(p.data.view.id);s.mode='live';s.screen='order-status';s.orderSource='history';s.history=['home','orders'];s.order={orderId:'history0'};p.deviceStore.save(s);
  const screens:string[]=[];const set=p.setData.bind(p);p.setData=(v:any)=>{if(v.view)screens.push(v.view.screen);set(v);};
  await p.connect();assert.equal(p.data.view.screen,'orders');assert.equal(p.data.settings,false);assert.ok(!screens.includes('order-status'));assert.ok(!screens.includes('order-detail'));if(offline)assert.match(p.data.message,/网络未连接/);p.cleanup();
 }
});


test('Leqi wakeup is consumed, idempotent and silent; busy/hidden pages do not record',()=>{
 let starts=0,stops=0,aborts=0,created=0;let instance:any;
 class Recognition {onresult:any;onend:any;onerror:any;constructor(){created++;instance=this;}start(){starts++;}stop(){stops++;}abort(){aborts++;}}
 const p=makePage(Recognition);let consumed=0;const wake=()=>p.onVoiceWakeup({keyword:'乐奇',preventDefault(){consumed++;}});
 wake();assert.equal(p.data.listening,true);assert.equal(starts,1);wake();assert.equal(created,1);assert.equal(stops,0);assert.equal(consumed,2);
 p.cancelRecognition();assert.equal(aborts,1);assert.equal(p.data.listening,false);p.setData({busy:true});wake();assert.equal(starts,1);p.setData({busy:false});
 wake();assert.equal(starts,2);const late=instance.onresult;p.onHide();late({results:[[{transcript:'查看优惠券'}]]});assert.equal(p.data.listening,false);wake();assert.equal(starts,2);p.cleanup();
 const text=readFileSync('aiui/pages/index/index.ink','utf8');assert.ok(!/speechSynthesis|SpeechSynthesisUtterance|SpeechAudioPlayer|speechPlayer|speechTask|speak\(/.test(text));
});
test('Leqi unavailable recognition gives visible retry message without speech',()=>{
 const p=makePage();p.onVoiceWakeup({keyword:'乐奇',preventDefault(){}});assert.equal(p.data.listening,false);assert.match(p.data.message,/语音暂不可用/);p.cleanup();
});


test('fulfillment auto listens once inline, keeps key focus and cancels on selection',async()=>{
 let created=0,aborted=0;class Recognition{constructor(){created++;}start(){}abort(){aborted++;}stop(){}}
 const p=makePage(Recognition);await p.send({type:'start'});assert.equal(created,1);assert.equal(p.data.inlineListening,true);assert.equal(p.data.rows.length,2);
 p.render(p.service.state(p.data.view.id));assert.equal(created,1);p.onVoiceWakeup({keyword:'乐奇',preventDefault(){}});assert.equal(created,1);
 await key(p,'ArrowDown');assert.equal(p.data.controlId,'row-1');await key(p,'Enter');assert.equal(aborted,1);assert.equal(p.data.listening,false);assert.equal(p.data.view.screen,'addresses');p.cleanup();
});
test('fulfillment speech ends once and only unambiguous choice navigates',async()=>{
 for(const text of ['我要配送','到店自取','随便','自取或者配送']){
  let r:any,stops=0,aborts=0;class Recognition{onresult:any;onspeechend:any;constructor(){r=this;}start(){}stop(){stops++;}abort(){aborts++;}}
  const p=makePage(Recognition);await p.send({type:'start'});const events:any[]=[];p.send=async(e:any)=>{events.push(e);};
  r.onspeechend();r.onspeechend();assert.equal(stops,1);r.onresult({results:[[{transcript:text}]]});assert.equal(p.data.listening,false);assert.equal(p.recognitionTimer,null);assert.equal(p.recognitionFinalTimer,null);
  assert.equal(events.length,/随便|或者/.test(text)?0:1);if(events.length)assert.equal(events[0].value,text.includes('配送')?'delivery':'pickup');assert.ok(aborts);p.cleanup();
 }
});
test('fulfillment 15 second stop plus 3 second deadline releases microphone without restart',(t)=>{
 t.mock.timers.enable({apis:['setTimeout']});let stops=0,aborts=0,created=0;class Recognition{constructor(){created++;}start(){}stop(){stops++;}abort(){aborts++;}}
 const p=makePage(Recognition);p.render({id:p.data.view.id,screen:'fulfillment',title:'就餐方式',rows:[],actions:[],presentation:{}});assert.equal(created,1);
 t.mock.timers.tick(14999);assert.equal(stops,0);t.mock.timers.tick(1);assert.equal(stops,1);t.mock.timers.tick(3000);assert.equal(aborts,1);assert.equal(p.data.listening,false);p.decorate();p.maybeAutoListen();assert.equal(created,1);p.cleanup();
});
test('inline listening back/settings/hide cancel and late results cannot navigate',async()=>{
 for(const exit of ['back','settings','hide']){
  let r:any;class Recognition{onresult:any;constructor(){r=this;}start(){}stop(){}abort(){}}
  const p=makePage(Recognition);await p.send({type:'start'});const result=r.onresult;
  if(exit==='back')await backTwice(p);else if(exit==='settings')p.openSettings();else p.onHide();
  assert.equal(p.data.listening,false);assert.equal(p.recognitionTimer,null);result({results:[[{transcript:'麦乐送'}]]});assert.equal(p.data.view.screen,'fulfillment');p.cleanup();
 }
});


test('home hint replaces example, preserves error reason and clears on next navigation key',async()=>{
 const p=makePage();await p.understand('不相关的话');assert.equal(p.data.view.screen,'home');assert.equal(p.data.message,'可说“乐奇”再试，或按键选择');assert.ok(p.data.homeNoticeLines.length<=2);
 p.showNotice('网络错误：服务器连接失败，请检查网络后重试');assert.match(p.data.homeNoticeLines.join(''),/服务器连接失败/);const focus=p.data.controlId;await key(p,'ArrowDown');assert.equal(p.data.message,'');assert.notEqual(p.data.controlId,focus);
 p.showNotice('语音暂不可用；可按键选择现有选项，或重新唤醒重试。');assert.ok(p.data.homeNoticeLines.length<=2);p.showNotice('网络错误：'+'连接失败'.repeat(30));assert.equal(p.data.homeNoticeLines.length,2);assert.match(p.data.homeNoticeLines[1],/…$/);assert.match(p.data.message,/连接失败/);p.cleanup();
 const template=readFileSync('aiui/pages/index/index.ink','utf8');assert.match(template,/message && !ui.home && view.screen/);assert.match(template,/class="home-notice"/);
});


test('coupon voice supports ordinal, unique title, ambiguity and invalid targets without writes',async()=>{
 const p=makePage();await p.send({type:'query',value:'wallet'});const base=p.data.view;const rows=Array.from({length:12},(_,i)=>({id:'coupon'+i,title:i<2?'同名美式':'优惠券'+i,event:{type:'start'}}));
 const opened:any[]=[];p.openCoupon=async(t:any)=>opened.push(t.rowIndex);
 for(const text of ['选第一张券','选择第三项','选12号','优惠券8']){p.render({...base,rows});await p.understand(text);}
 assert.deepEqual(opened,[0,2,11,8]);
 for(const text of ['同名美式','选99号','不存在的优惠券']){p.render({...base,rows});await p.understand(text);assert.ok(p.data.message);}
 assert.equal(opened.length,4);assert.ok(!p.gateway.calls.some((c:any)=>/auto-bind|create-order/.test(c.name)));p.cleanup();
});
test('coupon wakeup stays inline and ends before opening chosen detail',async()=>{
 let r:any;class Recognition{onresult:any;constructor(){r=this;}start(){}stop(){}abort(){}}
 const p=makePage(Recognition);await p.send({type:'query',value:'wallet'});assert.equal(p.data.listening,true);p.onVoiceWakeup({keyword:'乐奇',preventDefault(){}});assert.equal(p.data.inlineListening,true);assert.ok(p.recognitionTimer);let chosen=0;p.openCoupon=async()=>{chosen++;};r.onresult({results:[[{transcript:'选第一张券'}]]});await Promise.resolve();assert.equal(chosen,1);assert.equal(p.data.listening,false);assert.equal(p.recognitionTimer,null);p.cleanup();
});
test('menu measured rows follow every focus and preserve last position on footer',async()=>{
 const p=makePage();p.render({id:p.data.view.id,screen:'menu',rows:Array.from({length:5},(_,i)=>({id:'meal'+i,title:i===3?'超长餐品名称'.repeat(3):'餐品'+i,price:'¥19.00',event:{type:'meal',id:'meal'+i}})),actions:[{label:'换一批',event:{type:'menu-batch'}}],presentation:{menuPage:0,menuPages:2}});
 for(let i=0;i<5;i++){
  const row=p.data.ui.rows[i],top=p.data.ui.rows.slice(0,i).reduce((n:number,r:any)=>n+r.height+8,0);assert.ok(p.data.listScroll>=0);if(row.height<=p.data.ui.listHeight)assert.ok(top+row.height<=p.data.listScroll+p.data.ui.listHeight);await key(p,'ArrowDown');
 }
 const scroll=p.data.listScroll;assert.equal(p.data.controlId,'action-0');await key(p,'ArrowUp');assert.equal(p.data.controlId,'row-4');assert.equal(p.data.listScroll,scroll);p.cleanup();
});


test('coupon voice row reserves readable space and last focus avoids footer',()=>{
 for(const screen of ['wallet','coupon-select']){
 const p=makePage();p.render({id:p.data.view.id,screen,rows:Array.from({length:12},(_,i)=>({id:'coupon'+i,title:'优惠券'+i,event:{type:'start'}})),actions:screen==='coupon-select'?[{label:'继续',event:{type:'start'}}]:[],presentation:{}});
 p.focusId='row-11';p.decorate();assert.equal(p.data.ui.listHeight,screen==='wallet'?236:176);assert.equal(p.data.ui.overflowBelow,false);p.cleanup();
 }
});

 test('coupon lists automatically listen once per entry and release after deadline',(t)=>{
 t.mock.timers.enable({apis:['setTimeout']});
 for(const screen of ['wallet','coupon-select']){
 let created=0,stopped=0,aborted=0;class Recognition{constructor(){created++;}start(){}stop(){stopped++;}abort(){aborted++;}}
 const p=makePage(Recognition);const state={id:p.data.view.id,screen,rows:[{id:'coupon',title:'优惠券',event:{type:'start'}}],actions:[],presentation:{}};
 p.render(state);assert.equal(created,1);assert.equal(p.data.inlineListening,true);assert.equal(p.data.rows.length,1);
 p.render(state);p.decorate();p.onVoiceWakeup({keyword:'乐奇',preventDefault(){}});assert.equal(created,1);
 t.mock.timers.tick(15000);assert.equal(stopped,1);t.mock.timers.tick(3000);assert.equal(aborted,1);assert.equal(p.data.listening,false);p.maybeAutoListen();assert.equal(created,1);
 p.render({id:state.id,screen:'home',rows:[],actions:[],presentation:{}});p.render(state);assert.equal(created,2);p.onHide();assert.equal(p.data.listening,false);assert.equal(p.recognitionTimer,null);p.cleanup();
 }
 });

test('orders auto listen once, select directly and restore numbered list on return',async()=>{
 let r:any,created=0,aborted=0;class Recognition{onresult:any;constructor(){r=this;created++;}start(){}stop(){}abort(){aborted++;}}
 const p=makePage(Recognition);await historyFixture(p);assert.equal(created,1);assert.equal(p.data.inlineListening,true);assert.equal(p.data.ui.rows[0].displayIndexLabel,'(1) ');
 p.render(p.service.state(p.data.view.id));p.onVoiceWakeup({keyword:'乐奇',preventDefault(){}});assert.equal(created,1);
 const original=p.data.rows[0];r.onresult({results:[[{transcript:'选第一单'}]]});await new Promise(resolve=>setTimeout(resolve,10));assert.equal(p.data.view.screen,'order-detail');assert.equal(p.data.listening,false);assert.ok(aborted);
 await backTwice(p);assert.equal(p.data.view.screen,'orders');assert.equal(created,2);assert.equal(p.data.controlId,'row-0');assert.equal(p.data.rows[0].id,original.id);p.cleanup();
});
test('order voice resolves ordinals and unique stores, refuses ambiguity and invalid targets',async()=>{
 const p=makePage();const base={id:p.data.view.id,screen:'orders',actions:[],presentation:{},rows:[{id:'a',title:'同名门店',event:{type:'query-order',id:'a'}},{id:'b',title:'同名门店',event:{type:'query-order',id:'b'}},{id:'c',title:'唯一门店',event:{type:'query-order',id:'c'}}]};
 const chosen:any[]=[];p.activateFocused=async()=>chosen.push(p.focusId);p.render(base);
 for(const text of ['选第一单','选择第三项','唯一门店'])await p.understand(text);assert.deepEqual(chosen,['row-0','row-2','row-2']);
 for(const text of ['同名门店','选99单','陌生门店']){await p.understand(text);assert.ok(p.data.message);}assert.equal(chosen.length,3);assert.equal(p.gateway.calls.length,0);p.cleanup();
});
test('order empty list does not record; timeout stops without looping and hide ignores late result',(t)=>{
 t.mock.timers.enable({apis:['setTimeout']});let r:any,created=0,stopped=0;class Recognition{onresult:any;constructor(){r=this;created++;}start(){}stop(){stopped++;}abort(){}}
 const p=makePage(Recognition),id=p.data.view.id;p.render({id,screen:'orders',rows:[],actions:[],presentation:{}});assert.equal(created,0);
 p.render({id,screen:'home',rows:[],actions:[],presentation:{}});const state={id,screen:'orders',rows:[{id:'x',title:'门店',event:{type:'query-order',id:'x'}}],actions:[],presentation:{}};p.render(state);assert.equal(created,1);
 t.mock.timers.tick(15000);assert.equal(stopped,1);t.mock.timers.tick(3000);assert.equal(p.data.listening,false);p.maybeAutoListen();assert.equal(created,1);
 p.onVoiceWakeup({keyword:'乐奇',preventDefault(){}});const late=r.onresult;p.onHide();late({results:[[{transcript:'选第一单'}]]});assert.equal(p.data.view.screen,'orders');assert.equal(p.data.listening,false);assert.equal(p.recognitionTimer,null);p.cleanup();
});

async function storeVoiceFixture(p:any){
 const s=p.deviceStore.get(p.data.view.id);s.screen='stores';s.history=['home','fulfillment'];s.stores=[{storeCode:'12345',beCode:'56789',storeName:'唯一人民广场餐厅',address:'上海市南京西路88号',businessStatus:true,distance:350},{storeCode:'b',beCode:'b',storeName:'同名餐厅',address:'长地址'.repeat(12),businessStatus:true,distance:1500},{storeCode:'c',beCode:'c',storeName:'同名餐厅',address:'另一地址',businessStatus:true,distance:1600},{storeCode:'d',beCode:'d',storeName:'暂停门店',address:'地址',businessStatus:false,distance:1700}];p.deviceStore.save(s);p.render(p.service.state(s.id));
}
test('stores auto listen once, preserve full address and MCP distance, select menu and restore focus',async()=>{
 let r:any,created=0,aborted=0;class Recognition{onresult:any;constructor(){created++;r=this;}start(){}stop(){}abort(){aborted++;}}
 const p=makePage(Recognition);await storeVoiceFixture(p);assert.equal(created,1);assert.equal(p.data.inlineListening,true);assert.equal(p.data.ui.listHeight,236);assert.equal(p.data.ui.rows[0].statusLine,'350 米 · 营业中');assert.ok(!p.controls.some((c:any)=>c.id==='row-3'));
 const row=p.data.ui.rows[1];assert.equal(row.addressLines.map((x:any)=>x.text).join(''),'长地址'.repeat(12));p.render(p.service.state(p.data.view.id));p.onVoiceWakeup({keyword:'乐奇',preventDefault(){}});assert.equal(created,1);
 r.onresult({results:[[{transcript:'选第一家'}]]});await new Promise(resolve=>setTimeout(resolve,10));assert.equal(p.data.view.screen,'menu');assert.equal(p.data.listening,true);assert.ok(aborted);await p.goBack();assert.equal(p.data.view.screen,'stores');assert.equal(p.data.controlId,'row-0');assert.equal(created,3);await key(p,'ArrowDown');await key(p,'ArrowDown');const scroll=p.data.listScroll;assert.ok(scroll>0);await key(p,'Enter');assert.equal(p.data.view.screen,'menu');await p.goBack();assert.equal(p.data.controlId,'row-2');assert.equal(p.data.listScroll,scroll);assert.equal(created,5);p.cleanup();
});
test('store voice accepts ordinal and unique name but rejects ambiguity, unavailable and out of range',async()=>{
 const p=makePage();await storeVoiceFixture(p);const chosen:any[]=[];p.activateFocused=async()=>chosen.push(p.focusId);
 for(const text of ['选第一家','选择第三项','唯一人民广场餐厅'])await p.understand(text);assert.deepEqual(chosen,['row-0','row-2','row-0']);
 for(const text of ['同名餐厅','选择第四家','暂停门店','选99家','不存在的门店']){await p.understand(text);assert.ok(p.data.message);}assert.equal(chosen.length,3);assert.equal(p.gateway.calls.length,0);p.cleanup();
});
test('store tall row scrolls all text before changing focus and last available row stays visible',async()=>{
 const p=makePage();p.render({id:p.data.view.id,screen:'stores',rows:[{id:'long',title:'长门店名'.repeat(6),storeAddress:'完整的非常长门店地址'.repeat(20),event:{type:'store',id:'long'}},{id:'last',title:'末项门店',storeAddress:'地址',event:{type:'store',id:'last'}}],actions:[],presentation:{}});
 // This pure layout fixture bypasses session enrichment to exercise arbitrary-length text.
 const state={...p.data.view,rows:p.data.view.rows.map((r:any,i:number)=>({...r,storeAddress:i===0?'完整的非常长门店地址'.repeat(20):'地址'}))};p.decorate({view:state});
 const first=p.data.ui.rows[0],bottom=first.height-p.data.ui.listHeight;assert.ok(bottom>0);assert.equal(first.addressLines.map((x:any)=>x.text).join(''),'完整的非常长门店地址'.repeat(20));
 for(let i=0;i<100&&p.data.listScroll<bottom;i++){await key(p,'ArrowDown');assert.equal(p.data.controlId,'row-0');}assert.equal(p.data.listScroll,bottom);await key(p,'ArrowDown');assert.equal(p.data.controlId,'row-1');assert.equal(p.data.ui.overflowBelow,false);await key(p,'ArrowUp');assert.equal(p.data.controlId,'row-0');assert.equal(p.data.listScroll,bottom);await key(p,'ArrowUp');assert.ok(p.data.listScroll<bottom);p.cleanup();
});
test('store microphone timeout, key selection, hidden late result and empty lists are safe',async(t)=>{
 t.mock.timers.enable({apis:['setTimeout']});let r:any,created=0,stopped=0;class Recognition{onresult:any;constructor(){r=this;created++;}start(){}stop(){stopped++;}abort(){}}
 const p=makePage(Recognition);p.render({id:p.data.view.id,screen:'stores',rows:[],actions:[],presentation:{}});assert.equal(created,0);p.render({id:p.data.view.id,screen:'home',rows:[],actions:[],presentation:{}});await storeVoiceFixture(p);assert.equal(created,1);
 t.mock.timers.tick(15000);assert.equal(stopped,1);t.mock.timers.tick(3000);assert.equal(p.data.listening,false);p.maybeAutoListen();assert.equal(created,1);p.onVoiceWakeup({keyword:'乐奇',preventDefault(){}});let activeAtSelection=true;p.activateFocused=async()=>{activeAtSelection=p.data.listening;};await key(p,'Enter');assert.equal(activeAtSelection,false);
 p.onVoiceWakeup({keyword:'乐奇',preventDefault(){}});const late=r.onresult;p.onHide();late({results:[[{transcript:'选第一家'}]]});assert.equal(p.data.view.screen,'stores');assert.equal(p.data.listening,false);assert.equal(p.recognitionTimer,null);p.cleanup();
});

test('business back preserves detail without publishing processing and rejects repeated navigation',async()=>{
 const p=makePage();await historyFixture(p);await choose(p,c=>c.rowIndex===2);assert.equal(p.data.view.screen,'order-detail');const old=p.capturePosition();
 const request=p.request.bind(p);let release:any,backs=0;p.request=async(path:any,method:any,data:any)=>{if(data?.type==='back'){backs++;await new Promise(r=>release=r);}return request(path,method,data);};
 let loadingStarts=0;const begin=p.beginLoading.bind(p);p.beginLoading=(patch:any)=>{loadingStarts++;begin(patch);};const states:any[]=[];const set=p.setData.bind(p);p.setData=(patch:any)=>{states.push(patch);set(patch);};const back=p.goBack();await Promise.resolve();assert.equal(p.data.view.screen,'order-detail');assert.equal(p.data.busy,false);assert.equal(loadingStarts,0);await p.send({type:'back'});assert.equal(backs,1);release();await back;
 assert.equal(p.data.view.screen,'orders');assert.equal(p.data.controlId,'row-2');assert.equal(p.navigationPending,false);assert.ok(states.every(s=>s.busy!==true&&!/正在处理/.test(s.message||'')));assert.equal(p.gateway.calls.filter((c:any)=>/create-order|auto-bind/.test(c.name)).length,0);p.cleanup();
});

function menuVoiceFixture(p:any,count=12){
 const s=p.deviceStore.get(p.data.view.id);s.screen='menu';s.history=['home','fulfillment','stores'];s.fulfillment='pickup';s.store={storeCode:'12345',beCode:'56789',storeName:'测试餐厅'};s.menuBatch=0;s.menuQuery='';s.meals=Array.from({length:count},(_,i)=>({code:i===5?'burger':'item'+i,name:i===5?'板烧鸡腿堡套餐':i<5?'麦辣鸡腿堡'+i:'板烧套餐'+i,currentPrice:'29.9'}));p.deviceStore.save(s);p.render(p.service.state(s.id));
}
test('menu compact measured columns keep numbering, long names and large prices complete',()=>{
 for(const count of [0,1,5,6,12]){
 const p=makePage();menuVoiceFixture(p,count);assert.equal(p.data.rows.length,Math.min(5,count));assert.deepEqual(p.data.rows.map((r:any)=>r.displayIndexLabel),Array.from({length:Math.min(5,count)},(_,i)=>'('+(i+1)+') '));assert.equal(p.data.ui.menuPrefix,0);p.cleanup();
 }
 const rows=menuRows([{title:'豆浆',displayIndexLabel:'(1) ',price:'¥9.50'},{title:'长餐名'.repeat(15),displayIndexLabel:'(2) ',price:'¥999999.99'}]);
 assert.equal(menuRows([{title:'豆浆',displayIndexLabel:'(1) ',price:'¥9.50'}])[0].height,80);assert.equal(rows[1].titleLines.map((l:any)=>l.text).join(''),'(2) '+'长餐名'.repeat(15));assert.ok(rows[1].height>80);assert.equal(rows[1].price,'¥999999.99');assert.ok(rows[1].priceWidth>96);assert.equal(rows[1].titleWidth+rows[1].priceWidth+20+20+28+4,442);
});
test('menu voice ordinals are batch-local; exact names select, ambiguity and invalid ordinals never search',async()=>{
 const p=makePage();menuVoiceFixture(p);const chosen:any[]=[];p.activateFocused=async()=>chosen.push(p.focusId);const calls=p.gateway.calls.length;
 await p.understand('选第一份');await p.understand('选择第三项');await p.understand('麦辣鸡腿堡4');assert.deepEqual(chosen,['row-0','row-2','row-4']);
 await p.understand('选第六份');assert.match(p.data.message,/当前批次/);assert.equal(p.data.rows.length,5);assert.equal(chosen.length,3);
 const v={...p.data.view,rows:p.data.view.rows.map((r:any)=>({...r,title:'同名餐品'}))};p.render(v);await p.understand('同名餐品');assert.match(p.data.message,/同名/);assert.equal(chosen.length,3);assert.equal(p.gateway.calls.length,calls);p.cleanup();
});
test('menu auto listens once on entry, batch and search, stops for detail and restores batch focus',async()=>{
 let created=0,r:any;class Recognition{onresult:any;constructor(){created++;r=this;}start(){}stop(){}abort(){}}
 const p=makePage(Recognition);menuVoiceFixture(p);assert.equal(created,1);assert.equal(p.data.inlineListening,true);p.render(p.service.state(p.data.view.id));p.onVoiceWakeup({keyword:'乐奇',preventDefault(){}});assert.equal(created,1);
 const calls=p.gateway.calls.length;await p.understand('换一批');assert.equal(created,2);assert.equal(p.data.ui.aside,'2/3');assert.equal(p.data.rows[0].displayIndexLabel,'(1) ');assert.equal(p.data.rows[0].title,'板烧鸡腿堡套餐');assert.equal(p.gateway.calls.length,calls);
 r.onresult({results:[[{transcript:'选第一份'}]]});await new Promise(resolve=>setTimeout(resolve,10));assert.equal(p.data.view.screen,'meal');assert.equal(p.data.inlineListening,true);await p.goBack();assert.equal(p.data.view.presentation.menuPage,1);assert.equal(p.data.controlId,'row-0');assert.equal(p.data.listening,true);assert.equal(created,4);
 await p.understand('想吃板烧');assert.equal(p.data.view.presentation.menuPage,0);assert.equal(p.data.view.presentation.menuCount,7);assert.equal(created,5);const reads=p.gateway.calls.length;await p.understand('全部餐品');assert.equal(p.data.view.presentation.menuCount,12);assert.equal(created,6);assert.equal(p.gateway.calls.length,reads);p.cleanup();
});
test('empty menu permits wakeup search; menu timeout does not loop and stale recognition cannot select',(t)=>{
 t.mock.timers.enable({apis:['setTimeout']});let created=0,stopped=0,r:any;class Recognition{onresult:any;constructor(){created++;r=this;}start(){}stop(){stopped++;}abort(){}}
 const p=makePage(Recognition);menuVoiceFixture(p,0);assert.equal(created,0);p.onVoiceWakeup({keyword:'乐奇',preventDefault(){}});assert.equal(created,1);assert.equal(p.data.inlineListening,true);p.cancelRecognition();menuVoiceFixture(p,5);assert.equal(created,2);
 t.mock.timers.tick(15000);assert.equal(stopped,1);t.mock.timers.tick(3000);assert.equal(p.data.listening,false);p.maybeAutoListen();assert.equal(created,2);p.onVoiceWakeup({keyword:'乐奇',preventDefault(){}});const late=r.onresult;p.openSettings();late({results:[[{transcript:'选第一份'}]]});assert.equal(p.data.settings,true);assert.equal(p.data.view.screen,'menu');assert.equal(p.data.listening,false);assert.equal(p.recognitionTimer,null);p.cleanup();
});

test('meal and customization inline voice uses real quantity and option events, rejects ambiguity and protected writes',async()=>{
 let created=0;class Recognition{constructor(){created++;}start(){}stop(){}abort(){}}
 const p=makePage(Recognition);menuVoiceFixture(p);await p.understand('选第一份');assert.equal(p.data.view.screen,'meal');assert.equal(p.data.inlineListening,true);const n=created;p.render(p.service.state(p.data.view.id));assert.equal(created,n);
 await p.understand('两份');assert.equal(p.data.ui.quantity,2);await p.understand('加一份');assert.equal(p.data.ui.quantity,3);await p.understand('二十一份');assert.equal(p.data.ui.quantity,3);
 p.cancelRecognition();await p.send({type:'customize'});const row=p.data.rows.find((r:any)=>r.event.type==='mod');await p.understand(row.title);assert.equal(p.data.rows.find((r:any)=>r.id===row.id).selected,true);const count=p.gateway.calls.length;await p.understand('选择第九项');await p.understand('确认下单');assert.equal(p.gateway.calls.length,count);p.cleanup();
});

test('customization checks all selected options and voice can select two without toggling existing choices',async()=>{
 const p=makePage();menuVoiceFixture(p);await p.understand('选第一份');const session=p.deviceStore.get(p.data.view.id);session.selected.rounds=[];session.selected.modification={items:[{minValues:0,maxValues:2,values:['生菜','烤味酱','芝士'].map((name,i)=>({code:'mod'+i,name,minQuantity:0,maxQuantity:1,selectedQuantity:0}))}]};p.deviceStore.save(session);await p.send({type:'customize'});
 await p.understand('选生菜和烤味酱');assert.deepEqual(p.data.rows.map((r:any)=>!!r.selected),[true,true,false]);assert.deepEqual(p.data.ui.rows.map((r:any)=>r.showCheck),[true,true,false]);
 await p.understand('选生菜和烤味酱');assert.deepEqual(p.data.rows.map((r:any)=>!!r.selected),[true,true,false]);await p.understand('选芝士');assert.equal(p.data.rows[2].selected,false);
 await p.understand('取消生菜');assert.equal(p.data.rows[0].selected,false);await p.understand('选择第一项和第三项');assert.equal(p.data.rows[0].selected,false);assert.equal(p.data.rows[2].selected,false);
 await p.understand('取消烤味酱');await p.understand('选择第一项和第三项');assert.deepEqual(p.data.rows.map((r:any)=>!!r.selected),[true,false,true]);
 const revision=p.data.view.revision;await p.understand('生菜和不存在');assert.equal(p.data.view.revision,revision);p.cleanup();
});
test('customization rejects two mutually exclusive choices before changing any selection',async()=>{
 const p=makePage();menuVoiceFixture(p);await p.understand('选第一份');const session=p.deviceStore.get(p.data.view.id);session.selected.modification={items:[{minValues:1,maxValues:1,values:['生菜','烤味酱'].map((name,i)=>({code:'mod'+i,name,minQuantity:0,maxQuantity:1,selectedQuantity:i===0?1:0}))}]};session.selected.rounds=[];p.deviceStore.save(session);await p.send({type:'customize'});const revision=p.data.view.revision;await p.understand('生菜和烤味酱');assert.equal(p.data.view.revision,revision);assert.deepEqual(p.data.ui.rows.map((r:any)=>r.showCheck),[true,false]);await p.understand('选烤味酱');assert.deepEqual(p.data.ui.rows.map((r:any)=>r.showCheck),[false,true]);p.cleanup();
});

test('customization selection focuses the selected row and resumes one listening round for voice and keys',async(t)=>{
 t.mock.timers.enable({apis:['setTimeout']});let created=0,r:any;class Recognition{onresult:any;constructor(){created++;r=this;}start(){}stop(){}abort(){}}
 const p=makePage(Recognition);menuVoiceFixture(p);await p.understand('选第一份');const session=p.deviceStore.get(p.data.view.id);session.selected.rounds=[];session.selected.modification={items:[{minValues:0,maxValues:2,values:['标准','去冰','多冰','少冰'].map((name,i)=>({code:'ice'+i,name,minQuantity:0,maxQuantity:1,selectedQuantity:0}))}]};p.deviceStore.save(session);await p.send({type:'customize'});
 const before=created;await p.understand('选多冰');assert.equal(p.data.controlId,'row-2');assert.equal(p.data.focusIndex,2);assert.equal(p.data.ui.rows[2].showCheck,true);assert.equal(p.data.inlineListening,true);assert.equal(p.data.listening,true);assert.equal(created,before+1);p.render(p.service.state(p.data.view.id));assert.equal(created,before+1);
 p.cancelRecognition();assert.equal(p.data.controlId,'row-2');await p.understand('选少冰');assert.equal(p.data.controlId,'row-3');assert.equal(p.data.listening,true);assert.equal(p.data.ui.rows[2].showCheck,true);const late=r.onresult;
 p.cancelRecognition();p.focusId='row-2';p.decorate();await key(p,'Enter');assert.equal(p.data.controlId,'row-2');assert.equal(p.data.listening,true);const active=created;p.openSettings();late({results:[[{transcript:'选标准'}]]});assert.equal(p.data.settings,true);assert.equal(p.data.listening,false);assert.equal(created,active);p.cleanup();
});

test('filtered empty menu keeps recovery controls and listens once; show all is local and restores first row',async()=>{
 let created=0;class Recognition{constructor(){created++;}start(){}stop(){}abort(){}}
 const p=makePage(Recognition);menuVoiceFixture(p);const reads=p.gateway.calls.length;await p.understand('不存在的测试美食');assert.equal(p.data.rows.length,0);assert.equal(p.data.view.presentation.menuTotal,12);assert.equal(p.data.ui.aside,'');assert.equal(p.data.ui.asideIcon,'');assert.equal(p.data.controlId,'action-0');assert.deepEqual(p.data.actions.map((a:any)=>a.label),['全部餐品','重新说需求']);assert.equal(p.data.listening,true);const n=created;p.render(p.service.state(p.data.view.id));assert.equal(created,n);await choose(p,c=>c.command==='listen');assert.equal(created,n+1);assert.equal(p.gateway.calls.length,reads);
 await choose(p,c=>c.event?.type==='menu-search');assert.equal(p.data.rows.length,5);assert.equal(p.data.view.presentation.menuPage,0);assert.equal(p.data.controlId,'row-0');assert.equal(p.data.listScroll,0);assert.equal(p.gateway.calls.length,reads);p.cleanup();
});
test('empty search timeout retains buttons, repeated queries rearm once, and stale results cannot restore a hidden page',async(t)=>{
 t.mock.timers.enable({apis:['setTimeout']});let created=0,stops=0,r:any;class Recognition{onresult:any;constructor(){created++;r=this;}start(){}stop(){stops++;}abort(){}}
 const p=makePage(Recognition);menuVoiceFixture(p);await p.understand('不存在的餐品甲');const count=created;t.mock.timers.tick(15000);assert.equal(stops,1);t.mock.timers.tick(3000);assert.equal(p.data.listening,false);assert.equal(p.data.actions.length,2);p.maybeAutoListen();assert.equal(created,count);await p.understand('不存在的餐品乙');assert.equal(created,count+1);const late=r.onresult;p.onHide();late({results:[[{transcript:'全部餐品'}]]});assert.equal(p.data.rows.length,0);assert.equal(p.data.listening,false);p.cleanup();
});
test('truly empty upstream menu exposes reload without auto listening and recovers through a read-only query',async()=>{
 let created=0;class Recognition{constructor(){created++;}start(){}stop(){}abort(){}}
 const p=makePage(Recognition);menuVoiceFixture(p,0);assert.equal(created,0);assert.equal(p.data.ui.menuEmptyText,'该门店暂无可选餐品');assert.deepEqual(p.data.actions.map((a:any)=>a.label),['重新加载']);const original=p.gateway.call.bind(p.gateway);let requests=0;p.gateway.call=async(name:any,args:any)=>{if(name==='query-meals'){requests++;return {meals:{}};}return original(name,args);};await choose(p,c=>c.event?.type==='menu');assert.equal(p.data.view.screen,'menu');assert.equal(requests,1);assert.equal(created,0);assert.equal(p.data.actions[0].label,'重新加载');
 p.gateway.call=async(name:any,args:any)=>{if(name==='query-meals'){requests++;return {meals:{burger:{name:'真实接口样式测试餐品',currentPrice:'12.00'}}};}return original(name,args);};await choose(p,c=>c.event?.type==='menu');assert.equal(requests,2);assert.equal(p.data.rows.length,1);assert.equal(p.data.controlId,'row-0');assert.equal(created,1);assert.equal(p.data.listening,true);p.cleanup();
});

test('empty menu reload rejects duplicate activation, shows actual errors and ignores hidden late results',async()=>{
 const p=makePage();menuVoiceFixture(p,0);let release:any,requests=0;p.gateway.call=async(name:any)=>{assert.equal(name,'query-meals');requests++;return new Promise(resolve=>release=resolve);};const loading=p.send({type:'menu'});await new Promise(resolve=>setImmediate(resolve));assert.equal(p.data.busy,true);await p.send({type:'menu'});assert.equal(requests,1);p.onHide();release({meals:{burger:{name:'迟到餐品',currentPrice:'10'}}});await loading;assert.equal(p.data.rows.length,0);assert.equal(p.data.listening,false);p.cleanup();
 const failed=makePage();menuVoiceFixture(failed,0);failed.gateway.call=async()=>{throw new Error('network');};await failed.send({type:'menu'});assert.match(failed.data.ui.menuHint,/网络连接失败/);assert.equal(failed.data.actions.filter((a:any)=>a.event.type==='menu').length,1);assert.equal(failed.data.busy,false);failed.cleanup();
});

function cartVoiceFixture(p:any,count=3){
 menuVoiceFixture(p);const s=p.deviceStore.get(p.data.view.id);s.screen='cart';s.history=['home','fulfillment','stores','menu'];s.cart=Array.from({length:count},(_,i)=>({id:'line'+i,name:i===2?'长餐名'.repeat(12):'购物车餐品'+(i+1),item:{quantity:i+1,code:'burger'},detail:{code:'burger',name:'餐品'+i,quantity:i+1}}));p.deviceStore.save(s);p.render(p.service.state(s.id));
}
test('cart auto listens once with cards intact; voice opens quantity and returning restores focus and scroll',async()=>{
 let created=0;class Recognition{constructor(){created++;}start(){}stop(){}abort(){}}
 const p=makePage(Recognition);cartVoiceFixture(p);assert.equal(p.data.view.screen,'cart');assert.equal(p.data.inlineListening,true);assert.equal(p.data.listening,true);assert.equal(p.data.ui.listHeight,176);const count=created;await p.understand('修改第三份');assert.equal(p.data.view.screen,'quantity-editor');assert.equal(p.quantityReturn.id,'line2');assert.equal(p.data.listening,false);assert.equal(created,count);const scroll=p.quantityReturn.scroll;assert.ok(scroll>0);p.closeQuantity();assert.equal(p.data.controlId,'row-2');assert.equal(p.data.listScroll,scroll);assert.equal(p.data.listening,true);assert.equal(created,count+1);p.render(p.service.state(p.data.view.id));assert.equal(p.data.controlId,'row-2');assert.equal(p.data.listScroll,scroll);assert.equal(created,count+1);p.cleanup();
});
test('cart deterministic actions select exact names, reject ambiguity and empty checkout; checkout never submits',async()=>{
 const p=makePage();cartVoiceFixture(p);const names=p.data.rows.map((r:any)=>r.title);await p.understand(names[1]);assert.equal(p.data.view.screen,'quantity-editor');assert.equal(p.quantityReturn.id,'line1');p.closeQuantity();await p.understand('选择第九项');assert.equal(p.data.view.screen,'cart');const s=p.deviceStore.get(p.data.view.id);s.cart[1].name=s.cart[0].name;p.deviceStore.save(s);p.render(p.service.state(s.id));await p.understand(s.cart[0].name);assert.match(p.data.message,/同名/);await p.understand('去结算');assert.equal(p.data.view.screen,'review');assert.equal(p.gateway.calls.filter((c:any)=>c.name==='create-order').length,0);p.cleanup();
 const empty=makePage();cartVoiceFixture(empty,0);await empty.understand('去结算');assert.equal(empty.data.view.screen,'cart');assert.match(empty.data.message,/空/);assert.equal(empty.gateway.calls.length,0);await empty.understand('继续加餐');assert.equal(empty.data.view.screen,'menu');assert.equal(empty.gateway.calls.filter((c:any)=>c.name==='query-meals').length,1);empty.cleanup();
});
test('cart recording times out once, keyboard releases microphone, and late results after hide cannot checkout',async(t)=>{
 t.mock.timers.enable({apis:['setTimeout']});let created=0,stops=0,r:any;class Recognition{onresult:any;constructor(){created++;r=this;}start(){}stop(){stops++;}abort(){}}
 const p=makePage(Recognition);cartVoiceFixture(p);const count=created;t.mock.timers.tick(15000);assert.equal(stops,1);t.mock.timers.tick(3000);assert.equal(p.data.listening,false);p.maybeAutoListen();assert.equal(created,count);p.onVoiceWakeup({keyword:'乐奇',preventDefault(){}});let listeningAtOpen=true;const open=p.openQuantity.bind(p);p.openQuantity=(index:any)=>{listeningAtOpen=p.data.listening;open(index);};p.focusId='row-0';p.decorate();await key(p,'Enter');assert.equal(listeningAtOpen,false);assert.equal(p.data.view.screen,'quantity-editor');p.closeQuantity();const late=r.onresult;const reads=p.gateway.calls.length;p.onHide();late({results:[[{transcript:'去结算'}]]});assert.equal(p.data.view.screen,'cart');assert.equal(p.gateway.calls.length,reads);assert.equal(p.data.listening,false);p.cleanup();
});

test('review auto listens inline once and voice preferences never submit an order',async()=>{
 let created=0,r:any;class Recognition{onresult:any;constructor(){created++;r=this;}start(){}stop(){}abort(){}}
 const p=makePage(Recognition);await review(p);await p.send({type:'cart'});await p.send({type:'quote'});assert.equal(p.data.listening,true);assert.equal(p.data.inlineListening,true);const count=created;p.decorate();p.maybeAutoListen();assert.equal(created,count);
 r.onresult({results:[[{transcript:'需要餐具'}]]});for(let i=0;i<10;i++)await new Promise(resolve=>setImmediate(resolve));assert.equal(p.deviceStore.get(p.data.view.id).needTableware,true);assert.equal(p.data.listening,false);
 await p.understand('堂食');assert.equal(p.deviceStore.get(p.data.view.id).takeWayCode,'eat-in');await p.understand('打包');assert.equal(p.deviceStore.get(p.data.view.id).takeWayCode,'take-away');await p.understand('确认下单');assert.match(p.data.message,/确认键/);assert.equal(p.gateway.calls.filter((x:any)=>x.name==='create-order').length,0);p.cleanup();
});

test('review recording times out once and hidden late speech cannot alter preferences',async(t)=>{
 t.mock.timers.enable({apis:['setTimeout']});let created=0,stops=0,r:any;class Recognition{onresult:any;constructor(){created++;r=this;}start(){}stop(){stops++;}abort(){}}
 const p=makePage(Recognition);await review(p);await p.send({type:'cart'});await p.send({type:'quote'});const count=created;t.mock.timers.tick(15000);assert.ok(stops>0);t.mock.timers.tick(3000);assert.equal(p.data.listening,false);p.maybeAutoListen();assert.equal(created,count);p.onVoiceWakeup({preventDefault(){}});const late=r.onresult;const calls=p.gateway.calls.length;p.onHide();late({results:[[{transcript:'需要餐具'}]]});assert.equal(p.gateway.calls.length,calls);assert.equal(p.deviceStore.get(p.data.view.id).needTableware,false);p.cleanup();
});

test('empty cart listens on entry, last-item deletion and reconnect but not redraw',async()=>{
 let created=0,r:any;class Recognition{onresult:any;constructor(){created++;r=this;}start(){}stop(){}abort(){}}
 class LiveMock extends MockGateway{mode:any='live';}
 const p=makePage(Recognition,undefined,undefined,undefined,LiveMock);cartVoiceFixture(p,0);const saved=p.deviceStore.get(p.data.view.id);saved.mode='live';p.deviceStore.save(saved);assert.equal(p.data.listening,true);assert.equal(p.data.inlineListening,true);const count=created;p.render(p.service.state(p.data.view.id));assert.equal(created,count);p.cancelRecognition();p.showNotice('可说“乐奇”重试，或按键选择');assert.equal(p.data.message,'说“乐奇”，可继续加餐');await p.connect();assert.equal(p.data.listening,true);assert.equal(created,count+1);p.cleanup();
 const q=makePage(Recognition);cartVoiceFixture(q,1);q.cancelRecognition();q.openQuantity(0);await q.changeQuantity(-1);assert.equal(q.data.view.screen,'cart');assert.equal(q.data.rows.length,0);assert.equal(q.data.listening,true);assert.equal(q.data.inlineListening,true);q.cleanup();
});
test('cancel voice navigates and selects reasons but only physical confirmation cancels',async()=>{
 const p=makePage();await review(p);await p.send({type:'confirm',actionId:p.data.view.actionId},true);assert.equal(p.data.view.screen,'payment');assert.equal(p.data.actions.length,2);await p.understand('取消订单');assert.equal(p.data.view.screen,'cancel-reasons');await p.understand('选择第三项');assert.equal(p.data.view.screen,'cancel-confirm');assert.match(p.data.view.summary,/点错/);await p.understand('确认取消');await p.send({type:'confirm',actionId:p.data.view.actionId});assert.equal(p.gateway.calls.filter((x:any)=>x.name==='cancel-order').length,0);assert.match(p.data.message,/确认键/);await p.understand('保留订单');assert.equal(p.data.view.screen,'payment');assert.equal(p.data.view.actionId,undefined);p.cleanup();
});

test('review measures independent price and wrapped name columns with a single total border',()=>{
 const p=makePage();p.render({screen:'review',rows:[],actions:[],presentation:{receipt:[{id:'long',kind:'product',title:'超长餐品名称'.repeat(12)+' ×2',subtitle:'真实规格说明'.repeat(5),value:'¥999999.99'},{id:'preferences',kind:'preferences',title:'立即安排 · 无需餐具 · 打包带走'}]}});
 const [product,prefs]=p.data.ui.receiptItems;assert.equal(prefs.height,26);assert.equal(prefs.title.includes('\n'),false);
 assert.equal(product.titleWidth+product.valueWidth+12,438);assert.ok(product.title.includes('\n'));assert.equal(product.value,'¥999999.99');
 assert.equal(product.height,(product.title.split('\n').length+product.subtitle.split('\n').length)*26);assert.ok(p.data.ui.receiptMaxScroll>0);
 const source=readFileSync('aiui/pages/index/index.ink','utf8');assert.ok(!source.includes('total-separator'));assert.equal((source.match(/class="review-rule"/g)||[]).length,1);assert.ok(!/\.review-total \{[^}]*border/.test(source));
});

function cancelledOrderPage(p:any,source='checkout',status='已取消'){
 const s=p.deviceStore.get(p.data.view.id);s.screen='order-status';s.history=['home',source==='history'?'orders':'payment'];s.orderSource=source;s.order={orderId:'mock-cancelled',orderStatus:status,storeName:'测试门店'};p.deviceStore.save(s);p.render(p.service.state(s.id));return s;
}
test('cancelled order host gesture goes silently home once and next independent gesture closes',async()=>{
 for(const source of ['checkout','history']){
  const p=makePage();cancelledOrderPage(p,source);if(source==='checkout')p.render(p.service.resume());p.usesHostBackGesture=()=>true;
  assert.equal(p.data.view.screen,source==='history'?'order-detail':'order-status');
  const patches:any[]=[];const setData=p.setData;p.setData=function(patch:any){patches.push(patch);setData.call(this,patch);};
  p.returnPositions={stale:{}};p.listReturn={stale:true};const calls=p.gateway.calls.length;
  const gesture=(timeStamp:number)=>p.onKeyUp({code:'Backspace',timeStamp,preventDefault(){}});
  await gesture(1000);assert.equal(p.data.view.screen,'home');assert.equal(p.closeRequests,0);assert.deepEqual(p.deviceStore.get(p.data.view.id).history,[]);
  assert.equal(p.listReturn,null);assert.equal(patches.some(x=>x.busy===true),false);assert.equal(p.gateway.calls.length,calls);
  await gesture(1120);await gesture(1500);assert.equal(p.closeRequests,0);assert.equal(p.data.view.screen,'home');
  await gesture(2100);assert.equal(p.closeRequests,1);p.cleanup();
 }
});
test('cancelled raw double returns home, single and repeated raw events never exit',async()=>{
 const p=makePage();cancelledOrderPage(p);await key(p,'Backspace');assert.equal(p.data.view.screen,'order-status');
 await key(p,'Backspace');assert.equal(p.data.view.screen,'home');await key(p,'Backspace');await key(p,'Backspace');assert.equal(p.closeRequests,0);
 p.lastRawBackAt=Date.now()-501;await backTwice(p);assert.equal(p.closeRequests,1);p.cleanup();
});
test('cancelled gesture keeps listening, busy and overlay priorities; voice keeps ordinary back',async()=>{
 const p=makePage();cancelledOrderPage(p);p.data.listening=true;p.cancelRecognition=()=>{p.data.listening=false;};
 await p.performBusinessBack(true);assert.equal(p.data.view.screen,'order-status');assert.equal(p.data.listening,false);
 p.data.busy=true;let cancelled=0;p.cancelPending=async()=>{cancelled++;p.data.busy=false;};await p.performBusinessBack(true);assert.equal(cancelled,1);assert.equal(p.data.view.screen,'order-status');
 p.openSettings();await p.performBusinessBack(true);assert.equal(p.data.settings,false);assert.equal(p.data.view.screen,'order-status');
 p.data.more=true;await p.performBusinessBack(true);assert.equal(p.data.more,false);assert.equal(p.data.view.screen,'order-status');
 cancelledOrderPage(p,'history');await p.performBusinessBack(false);assert.equal(p.data.view.screen,'orders');assert.equal(p.closeRequests,0);p.cleanup();
});
test('ordinary order and uncertain screens never use cancelled home shortcut',async()=>{
 for(const status of ['待支付','制作中','订单已完成','取消处理中']){
  const p=makePage();cancelledOrderPage(p,'history',status);await p.performBusinessBack(true);assert.equal(p.data.view.screen,'orders');assert.equal(p.closeRequests,0);p.cleanup();
 }
 const p=makePage();cancelledOrderPage(p);p.data.view.screen='uncertain';assert.equal(p.isCancelledOrderPage(),false);
 p.data.view.screen='order-status';p.deviceStore.pending=()=>({kind:'cancel'});assert.equal(p.isCancelledOrderPage(),false);p.cleanup();
});


test('homepage one sentence skips fulfillment, preserves multiple counts and resets listening per item',async()=>{
 class Recognition {start(){}abort(){}stop(){}}
 const p=makePage(Recognition);const rendered:string[]=[];const render=p.render.bind(p);p.render=(s:any)=>{rendered.push(s.screen);render(s);};
 p.locate=async()=>{await p.send({type:'geo-stores',value:{longitude:120,latitude:30}});};
 try{
  await p.understand('两份巨无霸、一份中份薯条，到店自取');
  assert.equal(p.data.view.screen,'stores');assert.ok(!rendered.includes('fulfillment')&&!rendered.includes('location'));
  await p.send({type:'store',id:'12345'});assert.equal(p.data.view.screen,'meal');assert.equal(p.data.ui.quantity,2);assert.equal(p.data.ui.aside,'第1/2项');assert.ok(p.recognition);
  await p.understand('三份');await p.understand('选饮料与口味');await p.understand('加入购物车');assert.equal(p.data.view.screen,'meal');assert.equal(p.data.ui.quantity,1);assert.equal(p.data.ui.aside,'第2/2项');assert.ok(p.recognition);
  await p.understand('跳过此项');assert.equal(p.data.view.screen,'cart');assert.equal(p.data.rows[0].quantity,3);assert.equal(p.gateway.calls.filter((c:any)=>c.name==='query-meals').length,1);
  assert.ok(!p.gateway.calls.some((c:any)=>['create-order','auto-bind-coupons','delivery-create-address'].includes(c.name)));
 }finally{p.cleanup();}
});
test('homepage delivery bypasses fulfillment; missing or conflicting mode retains item counts',async()=>{
 for(const [text,screen] of [['巨无霸两份，麦乐送','addresses'],['两份巨无霸','fulfillment'],['两份巨无霸，自取或者配送','fulfillment']]){
  const p=makePage();try{await p.understand(text);assert.equal(p.data.view.screen,screen);assert.equal(p.deviceStore.get(p.data.view.id).orderDraft.items[0].quantity,2);}finally{p.cleanup();}
 }
});
test('cart mode switch requires physical key and pickup guard does not locate before approval',async()=>{
 const p=makePage();try{
  await review(p);await p.send({type:'home'});let located=0;p.locate=async()=>{located++;};
  await p.understand('一份巨无霸，麦乐送');assert.equal(p.data.view.screen,'cart-change-confirm');assert.equal(p.deviceStore.get(p.data.view.id).cart.length,1);
  await p.send({type:'approve-cart-change'});assert.equal(p.data.view.screen,'cart-change-confirm');
  await choose(p,c=>c.event?.type==='approve-cart-change');assert.equal(p.data.view.screen,'addresses');assert.equal(p.deviceStore.get(p.data.view.id).cart.length,0);assert.equal(located,0);
 }finally{p.cleanup();}
});
test('late homepage request does not render after hide and duplicate activation is ignored',async()=>{
 const p=makePage();try{
  let release:any;const original=p.gateway.call.bind(p.gateway);p.gateway.call=async(name:string,args:any)=>{if(name==='delivery-query-addresses')await new Promise(r=>release=r);return original(name,args);};
  const task=p.understand('巨无霸两份，麦乐送');await new Promise(r=>setTimeout(r,0));await p.understand('中份薯条，麦乐送');p.onHide();release();await task;
  assert.equal(p.data.view.screen,'home');assert.equal(p.deviceStore.get(p.data.view.id).orderDraft.items.length,1);assert.equal(p.deviceStore.get(p.data.view.id).orderDraft.items[0].query,'巨无霸');
 }finally{p.cleanup();}
});

test('home cart commands bypass parser/model and preserve current cart with no new homepage control',async()=>{
 for(const text of ['打开购物车','查看购物车','我的购物车']){
  const p=makePage();try{
   await review(p);const original=p.deviceStore.get(p.data.view.id).cart;await p.send({type:'home'});const count=p.controls.length;
   p.service.parseOrder=()=>{throw Error('must not parse a cart command');};await p.understand(text);
   assert.equal(p.data.view.screen,'cart');assert.deepEqual(p.deviceStore.get(p.data.view.id).cart,original);assert.ok(p.data.rows[0].displayIndexLabel==='(1) ');
   await p.send({type:'home'});assert.equal(p.controls.length,count);
  }finally{p.cleanup();}
 }
});
test('home opens empty cart with listening and pending submission always takes priority',async()=>{
 class Recognition {start(){}stop(){}abort(){}}
 const p=makePage(Recognition);try{await p.understand('打开购物车');assert.equal(p.data.view.screen,'cart');assert.ok(p.data.listening);assert.equal(p.data.rows.length,0);p.cancelRecognition();await p.send({type:'home'});const s=p.deviceStore.get(p.data.view.id);p.deviceStore.begin('pending-cart',s,'order');await p.understand('我的购物车');assert.equal(p.data.view.screen,'uncertain');}finally{p.cleanup();}
});
async function fixtureCart(p:any){await review(p);await p.send({type:'cart'});const s=p.deviceStore.get(p.data.view.id),base=s.cart[0];s.cart=Array.from({length:3},(_,i)=>({...structuredClone(base),id:'delete-fixture-'+i,name:i===1?'中份薯条':'板烧鸡腿堡套餐',item:{...base.item,quantity:i+1},detail:{...base.detail,quantity:i+1}}));p.deviceStore.save(s);p.render(p.service.state(s.id));}
test('voice deletes full line by ordinal, undo restores focus, and last removal keeps adjacent focus',async()=>{
 const p=makePage();try{
  await fixtureCart(p);const calls=p.gateway.calls.length;await p.understand('删除第一项');assert.equal(p.data.rows.length,2);assert.equal(p.data.controlId,'row-0');assert.equal(p.data.rows[0].title,'中份薯条');assert.equal(p.data.actions.filter((a:any)=>a.event.type==='undo-remove-line').length,1);
  await p.understand('撤销删除');assert.equal(p.data.rows.length,3);assert.equal(p.data.controlId,'row-0');
  await p.understand('去掉第三份');assert.equal(p.data.rows.length,2);assert.equal(p.data.controlId,'row-1');assert.ok(p.data.listScroll>0);
  await p.understand('撤销删除');assert.equal(p.data.controlId,'row-2');assert.equal(p.data.rows[2].quantity,3);assert.equal(p.gateway.calls.length,calls);
 }finally{p.cleanup();}
});
test('duplicate names, out-of-range and partial names do not delete; exact name works',async()=>{
 const p=makePage();try{
  await fixtureCart(p);for(const text of ['删除板烧鸡腿堡套餐','删除第十项','删除板烧']){await p.understand(text);assert.equal(p.data.rows.length,3);}
  await p.understand('删除中份薯条');assert.equal(p.data.rows.length,2);assert.match(p.data.view.presentation.cartNotice,/×2/);
 }finally{p.cleanup();}
});
test('quantity editor delete is key reachable, zero is undoable, and empty focus goes to continue meal',async()=>{
 const p=makePage();try{
  await review(p);await p.send({type:'cart'});await choose(p,c=>c.command==='edit-quantity');await choose(p,c=>c.command==='delete-line');assert.equal(p.data.view.screen,'cart');assert.equal(p.data.rows.length,0);assert.equal(p.controls.find((c:any)=>c.id===p.data.controlId).event.type,'menu');
  await p.understand('撤销删除');assert.equal(p.data.rows.length,1);await choose(p,c=>c.command==='edit-quantity');await p.changeQuantity(-1);assert.equal(p.data.view.screen,'cart');assert.equal(p.data.rows.length,0);assert.ok(p.data.actions.some((a:any)=>a.event.type==='undo-remove-line'));
 }finally{p.cleanup();}
});
test('cart deletion releases microphone and ignores late ASR; settings and hide discard undo',async()=>{
 class Recognition {start(){}stop(){}abort(){}}
 const p=makePage(Recognition);try{
  await fixtureCart(p);const old=p.recognition;await p.understand('删除第一项');assert.equal(p.recognition,null);old.onresult({results:[[{transcript:'删除第一项'}]]});assert.equal(p.data.rows.length,2);
  p.openSettings();p.closeSettings();assert.ok(!p.data.actions.some((a:any)=>a.event.type==='undo-remove-line'));
  await p.understand('删除第一项');p.onHide();assert.ok(!p.service.state(p.data.view.id).actions.some((a:any)=>a.event.type==='undo-remove-line'));
 }finally{p.cleanup();}
});
test('clear cart voice aliases bypass single-delete matching and undo restores first focus at top',async()=>{
 for(const text of ['清空购物车','删除所有商品','全部删除']){
  const p=makePage();try{
   await fixtureCart(p);const original=structuredClone(p.deviceStore.get(p.data.view.id).cart),calls=p.gateway.calls.length;
   assert.deepEqual(p.data.actions.map((a:any)=>a.label),['继续加餐','去结算','清空购物车']);
   await p.understand(text);assert.equal(p.data.rows.length,0);assert.match(p.data.view.presentation.cartNotice,/共6份/);assert.equal(p.controls.find((c:any)=>c.id===p.data.controlId).event.type,'menu');assert.equal(p.data.listScroll,0);
   await p.understand(text);await p.understand('撤销删除');assert.deepEqual(p.deviceStore.get(p.data.view.id).cart,original);assert.equal(p.data.controlId,'row-0');assert.equal(p.data.listScroll,0);assert.equal(p.gateway.calls.length,calls);
  }finally{p.cleanup();}
 }
});
test('clear cart button is key focusable and releases microphone before local mutation',async()=>{
 class Recognition {start(){}stop(){}abort(){}}
 const p=makePage(Recognition);try{await fixtureCart(p);const old=p.recognition;await choose(p,c=>c.event?.type==='clear-cart');assert.equal(p.data.rows.length,0);assert.notEqual(p.recognition,old);old.onresult({results:[[{transcript:'撤销删除'}]]});assert.equal(p.data.rows.length,0);await p.understand('撤销删除');assert.equal(p.data.rows.length,3);}finally{p.cleanup();}
});
test('order status only exposes actual restaurant once without generic description pagination',async()=>{
 const p=makePage();try{
  for(const status of ['餐厅配餐中','待取餐','已完成','已取消'])for(const name of ['真实订单餐厅','麦当劳测试很长名称餐厅'.repeat(3),'']){
   const s=p.deviceStore.get(p.data.view.id);s.screen='order-status';s.store={storeName:'不应显示的购物车餐厅'};s.order={orderId:'hidden-order-id',orderStatus:status,storeName:name,pickupCode:name?'35069':undefined,lockerCode:'hidden-locker-code'};p.deviceStore.save(s);p.render(p.service.state(s.id));
   assert.equal(p.data.ui.store.replace(/\n/g,''),name);assert.equal(p.data.view.summary,'');assert.deepEqual(p.data.ui.descriptionLines,[]);assert.equal(p.data.ui.descriptionPages,1);assert.equal(p.data.ui.descriptionStep,'');assert.ok(!p.controls.some((c:any)=>c.command==='description'));assert.ok(p.controls.some((c:any)=>c.event?.type==='query-order'));
   const page=p.data.descriptionPage;await p.understand('下一页');assert.equal(p.data.descriptionPage,page);p.advanceDescription();assert.equal(p.data.descriptionPage,page);assert.equal(p.data.ui.statusNumber,name?'35069':status);
  }
 }finally{p.cleanup();}
});
test('paid status physical gesture closes directly once while preserving session and voice back',async()=>{
 for(const status of ['餐厅配餐中','制作中','待取餐','配送中','订单已完成']){
  const p=makePage();try{cancelledOrderPage(p,'checkout',status);p.usesHostBackGesture=()=>true;const saved=structuredClone(p.deviceStore.get(p.data.view.id)),patches:any[]=[];const set=p.setData;p.setData=function(x:any){patches.push(x);set.call(this,x);};
   await p.onKeyUp({code:'Backspace',timeStamp:1000,preventDefault(){}});await p.onKeyUp({code:'Backspace',timeStamp:1100,preventDefault(){}});assert.equal(p.closeRequests,1);assert.equal(p.data.view.screen,'order-status');assert.deepEqual(p.deviceStore.get(saved.id),saved);assert.ok(!patches.some(x=>x.busy));
  }finally{p.cleanup();}
 }
 const p=makePage();try{cancelledOrderPage(p,'checkout','制作中');await p.performBusinessBack(false);assert.equal(p.closeRequests,0);assert.equal(p.data.view.screen,'payment');}finally{p.cleanup();}
});
test('status exit rejects pending, unknown, conflicting payment and historical detail; overlays win',async()=>{
 const p=makePage();try{
  for(const status of ['待支付','取消处理中','未知状态']){cancelledOrderPage(p,'checkout',status);assert.equal(p.canExitOrderStatus(),false);}
  cancelledOrderPage(p,'checkout','制作中');let s=p.deviceStore.get(p.data.view.id);s.order.orderStatusTitle='待支付';p.deviceStore.save(s);p.render(p.service.state(s.id));assert.equal(p.canExitOrderStatus(),false);
  cancelledOrderPage(p,'checkout','制作中');p.data.view.screen='order-detail';assert.equal(p.canExitOrderStatus(),false);
  cancelledOrderPage(p,'checkout','制作中');p.data.listening=true;p.cancelRecognition=()=>{p.data.listening=false;};await p.performBusinessBack(true);assert.equal(p.closeRequests,0);
  p.openSettings();await p.performBusinessBack(true);assert.equal(p.closeRequests,0);assert.equal(p.data.settings,false);
  p.data.more=true;await p.performBusinessBack(true);assert.equal(p.closeRequests,0);
  p.testWindow.close=undefined;await p.performBusinessBack(true);assert.equal(p.closeRequests,0);assert.match(p.data.message,/不支持应用关闭/);assert.equal(p.data.view.screen,'order-status');
  p.deviceStore.pending=()=>({kind:'cancel'});assert.equal(p.canExitOrderStatus(),false);
 }finally{p.cleanup();}
});
test('status centered display retains full order ID and wraps long names without description pages',()=>{
 const p=makePage();try{const s=cancelledOrderPage(p);s.order.storeName='麦当劳完整长餐厅名称'.repeat(3);s.order.orderId='10302395100008086300693876021234567890';p.deviceStore.save(s);p.render(p.service.state(s.id));assert.equal(p.data.ui.store.replace(/\n/g,''),s.order.storeName);assert.equal(p.data.ui.orderNumber.replace(/\n/g,''),'订单号 '+s.order.orderId);assert.ok(p.data.ui.store.includes('\n'));assert.ok(p.data.ui.orderNumber.includes('\n'));assert.equal(p.data.ui.descriptionPages,1);s.order={orderStatus:'已完成'};p.deviceStore.save(s);p.render(p.service.state(s.id));assert.equal(p.data.ui.orderNumber,'');assert.equal(p.data.ui.store,'');}finally{p.cleanup();}
});
