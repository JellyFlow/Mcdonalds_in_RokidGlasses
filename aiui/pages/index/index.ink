<script def>
{"navigationBarTitleText":"麦当劳 AI 助手"}
</script>
<script setup>
import wx from 'wx';
import { resolveLocation } from '../../runtime/amap.js';
import { MCP_TOKEN, AMAP_WEB_KEY } from '../../config/credentials.js';
import { listLayout, storeRows, menuRows, couponView, orderView } from '../../components/layout.js';
import { controlsFor, spokenNumber } from '../../components/controls.js';
import { Service, DeviceStore, DeviceGateway } from '../../runtime/device.js';
import { LanguageModel } from 'language-model';
import { presentation } from '../../components/presentation.js';
export default {
  data: {
    view: { title: '麦当劳 AI 助手', summary: '直连麦当劳，开始点餐', screen: 'home', rows: [], actions: [] },
    rows: [], actions: [], busy: false, orderLoading: false, walletLoading: false, locationLoading: false, message: '', homeNoticeLines:[], homeNoticeText:'', input: '', listening: false, inlineListening:false,
    settings: true, controlId: '', voiceDraft: '', draftPage: 0, focusIndex: 0, scrollTarget: '', listScroll: 0, receiptScroll: 0, receiptPage: 0, couponPage: 0, descriptionPage: 0, voiceBars: [], loadingFrame: 0, loadingDots: [],
    ui: {}, more: false, connectionLabel: '眼镜直连 · 未连接'
  },
  onLoad(query) {
    this.visible = true;
    this.backTraceEnabled = query && query.backTrace === '1';
    this.backTimer = null;
    this.backPending = false;
    this.generation = 0;
    try {
      this.deviceStore = new DeviceStore(wx);
      this.setData({ settings: false });
    } catch (e) { this.storageError = e.message; this.setData({ settings:true,message:e.message }); this.decorate(); }

  },
  onShow() {
    this.visible = true;
    this.exitRequested = false;
    this.traceBack('show');
    if (!this.controls) this.decorate();
    if (this.deviceStore) this.connect();
  },
  async refreshState() {
    if (!this.service) return;
    try { this.render(this.service.state(this.data.view.id)); }
    catch (e) { if (this.visible) this.showNotice( e.message ); }
  },
  onHide() { this.traceBack('hide');this.cleanup(); },
  onUnload() { this.traceBack('unload');this.cleanup(); },
  cleanup() {
    this.visible = false;
    if(this.service)this.service.discardCartUndo(this.data.view.id);
    this.stopLoadingMotion();
    this.resolvedLocationCache=null;
    this.pickupPositionWarmup?.cancel?.();
    this.pickupPositionWarmup=null;
    this.clearLocationRequest();
    this.stopStoreDistances(true);
    this.clearBackTimer();
    this.lastHostBackStamp=undefined;
    this.lastRawBackAt=undefined;
    this.cancelRecognition();
    this.setData({ voiceDraft: '' });
    this.generation = (this.generation || 0) + 1;
    if (this.gateway) this.gateway.close().catch(() => {});
    if (this.recognition) { this.recognition.abort(); this.recognition = null; }
    if (this.model) { this.model.destroy(); this.model = null; }
    this.setData({ busy: false, orderLoading:false, walletLoading:false, locationLoading:false, listening: false });
  },
  dataset(event) {
    const target = event.currentTarget || event.target;
    if (!target) return {};
    const attrs = target.attributes || {};
    return target.dataset || { index: attrs['data-index'], id: attrs['data-id'] };
  },
  async request(path, method, data) {
    // Internal dispatch only: the Page owns its business core; no HTTP server is used.
    if (!this.service) throw new Error('请先重新连接麦当劳。');
    if (method === 'POST') return this.service.event(this.data.view.id, data);
    return this.service.state(this.data.view.id);
  },
  async connect() {
    if (this.data.busy) return;
    if (!this.deviceStore) { this.setData({ settings:true,message: this.storageError || '设备存储不可用，禁止提交。' }); this.decorate(); return; }
    this.stopStoreDistances(true);
    this.resolvedLocationCache=null;
    const saved = this.deviceStore.token();
    const token = MCP_TOKEN;
    if (token !== saved && this.deviceStore.pending()) { this.setData({ settings: true, message: '原账号有操作待核实，不能切换内置凭证。请核对原账号记录后处理。' }); this.decorate(); return; }
    const generation = this.generation;
    this.beginLoading({ busy: true, message: '正在直连麦当劳' });
    let gateway;
    try {
      if (this.gateway) await this.gateway.close();
      gateway = new DeviceGateway(wx, token); this.gateway = gateway;
      await gateway.tools();
      const account = await gateway.call('query-my-account');
      if (!this.visible || generation !== this.generation) { await gateway.close(); return; }
      this.deviceStore.configure(token, account && account.accountId ? String(account.accountId) : undefined);
      this.service = new Service(this.deviceStore, gateway);
      let state = this.service.resume();
      if(state.mode==='mock'){
        if(this.deviceStore.pending())throw new Error('旧测试会话存在待核实操作，禁止自动切换或重试。');
        state=this.service.create();
      }
      if (state.screen === 'uncertain') state = await this.service.event(state.id, { type: 'reconcile', revision: state.revision });
      else if (state.screen === 'orders') state = await this.service.event(state.id, { type: 'query', value: 'orders', revision: state.revision });
      else if (['tableware','time'].includes(state.screen)) state = await this.service.event(state.id, { type: 'checkout-defaults', revision: state.revision });
      else if (state.screen === 'review') state = await this.service.event(state.id, { type: 'quote', revision: state.revision });
      else if ((state.screen === 'payment' || state.screen === 'order-status') && state.presentation && state.presentation.orderId) {
        state = await this.service.event(state.id, { type: 'query-order', id: String(state.presentation.orderId), revision: state.revision });
      }
      if (!this.visible || generation !== this.generation) return;
      this.setData({ settings: false, connectionLabel: '眼镜直连 · 真实 MCP' });
      if(state.screen==='cart'&&!state.rows.length)this.autoListenPending=true;
      this.render(state);
      if(state.screen==='orders'&&state.presentation?.queryError)this.showNotice(state.presentation.queryError);
    } catch (e) {
      if (!this.visible || generation !== this.generation) return;
      if (saved && token === saved) {
        this.service = new Service(this.deviceStore, gateway);
        this.setData({ settings: false, connectionLabel: '眼镜直连 · 连接待恢复' });
        try { const restored=this.service.resume();this.render(restored);if(restored.screen==='orders'){this.showNotice('网络未连接，显示已保存的历史订单。');return;} } catch (storageError) { this.setData({ settings: true, message: storageError.message }); return; }
      }
      this.setData({ settings: true, message: e.message || '直连失败，请检查网络或更新内置凭证。' }); this.focusId = null; this.decorate();
    } finally { if (this.visible && generation === this.generation) this.setData({ busy: false }); this.maybeAutoListen(); }
  },
  capturePosition() {
    return {id:this.data.view.id,screen:this.data.view.screen,focus:this.focusId,focusIndex:this.data.focusIndex,listScroll:this.data.listScroll,receiptScroll:this.data.receiptScroll,couponPage:this.data.couponPage,descriptionPage:this.data.descriptionPage,draftPage:this.data.draftPage,voiceDraft:this.data.voiceDraft,homeNoticeLines:this.data.homeNoticeLines,homeNoticeText:this.data.homeNoticeText,message:this.data.busy?'':this.data.message};
  },
  restorePosition(old) {
    if(!old||old.id!==this.data.view.id||old.screen!==this.data.view.screen)return;
    this.focusId=old.focus;
    this.setData({focusIndex:old.focusIndex,listScroll:old.listScroll,receiptScroll:old.receiptScroll,couponPage:old.couponPage,descriptionPage:old.descriptionPage,draftPage:old.draftPage,voiceDraft:old.voiceDraft,homeNoticeLines:old.homeNoticeLines||[],homeNoticeText:old.homeNoticeText||'',message:old.message});
    this.decorate();
    if(['menu','cart'].includes(this.data.view.screen)&&this.data.listening&&this.data.inlineListening)this.listeningReturn=this.capturePosition();
  },
  render(state) {
    const cartPosition=state.screen==='cart'&&this.data.view.screen==='cart'&&state.id===this.data.view.id?{focus:this.focusId,rowId:this.data.rows.find(r=>'row-'+r.index===this.focusId)?.id,scroll:this.data.listScroll}:null;
    const optionPosition=state.screen==='customize'&&this.data.view.screen==='customize'&&state.id===this.data.view.id?{rowId:this.data.rows.find(r=>'row-'+r.index===this.focusId)?.id,scroll:this.data.listScroll}:null;
    if(state.screen==='order-status'&&state.presentation?.orderSource==='history'&&!this.deviceStore?.pending()){
      const raw=this.deviceStore.get(state.id)?.order;
      state={...state,screen:'order-detail',title:'订单详情',summary:'',rows:[],actions:[],presentation:{...state.presentation,order:orderView(raw||{})}};
    }
    const menuRenderStart=Date.now();
    const warmPickup=state.screen==='fulfillment'&&this.data.view.screen!=='fulfillment';
    const menuChanged=state.screen==='menu'&&this.data.view.screen==='menu'&&(state.presentation?.menuPage!==this.data.view.presentation?.menuPage||state.presentation?.menuSearch!==this.data.view.presentation?.menuSearch||state.summary!==this.data.view.summary||state.rows.map(r=>r.id).join('|')!==this.data.view.rows.map(r=>r.id).join('|'));
    const cartBecameEmpty=state.screen==='cart'&&this.data.view.screen==='cart'&&!state.rows.length&&this.data.rows.length>0;
    if(state.screen!==this.data.view.screen||menuChanged||cartBecameEmpty||state.presentation?.orderProgress!==this.data.view.presentation?.orderProgress){if(this.recognition)this.cancelRecognition();this.autoListenPending=['fulfillment','wallet','coupon-select','orders','stores','menu','meal','customize','cart','review'].includes(state.screen);}
    this.clearBackTimer();
    if(state.screen==='location'){
      state={...state,screen:'fulfillment',title:'就餐方式',summary:'',input:undefined,rows:[{id:'pickup',title:'到店自取',subtitle:'确认重试 · 上键语音',event:{type:'fulfillment',value:'pickup'}},{id:'delivery',title:'麦乐送',subtitle:'送到你身边',event:{type:'fulfillment',value:'delivery'}}],actions:[],presentation:{...(state.presentation||{}),locationFallback:true}};
    }
    if(this.data.view.screen==='stores'&&state.screen!=='stores')this.stopStoreDistances();
    if(this.data.view.screen!==state.screen){
      this.returnPositions=this.returnPositions||{};
      this.returnPositions[(this.data.view.id||'')+':'+this.data.view.screen]=this.capturePosition();
    }
    if(state.id&&this.deviceStore&&state.screen!=='menu'){
      try{
        const session=this.deviceStore.get(state.id),p={...(state.presentation||{})};
        if(state.screen==='address-confirm'){
          const d=session.addressDraft||{};p.address=(d.city||'')+(d.address||'')+' '+(d.addressDetail||'');p.contact=(d.contactName||'')+' · '+String(d.phone||'').replace(/(\d{3})\d{4}(\d{4})/,'$1****$2');p.description='';
        }
        if(state.screen==='stores')state={...state,rows:state.rows.map(r=>{
          const store=(session.stores||[]).find(x=>String(x.storeCode)===r.id)||{};
          const storeAddress=String(store.address||''),storeStatus=store.businessStatus===false?'暂停营业':store.businessStatus===true?'营业中':'';
          const meters=typeof store.distance==='number'?store.distance:(typeof store.distance==='string'&&store.distance.trim()!==''?Number(store.distance):NaN);
          const distanceLabel=Number.isFinite(meters)&&meters>=0?(meters<1000?Math.round(meters)+' 米':(meters/1000).toFixed(1)+' 公里'):'';
          return {...r,disabled:!!r.disabled||store.businessStatus===false,subtitle:[storeAddress,storeStatus].filter(Boolean).join(' · '),storeAddress,storeStatus,distanceLabel};
        })};
        if(state.screen==='cart')state={...state,rows:state.rows.map(r=>{
          const line=session.cart.find(x=>x.id===r.id),detail=line?.detail;
          const names=(detail?.rounds||[]).flatMap(round=>(round.choices||round.items||[]).filter(c=>c.quantity>0).map(c=>c.name));
          return {...r,subtitle:names.join(' · ')||r.subtitle,price:detail?.price!==undefined?'¥'+(Number(detail.price)*r.quantity).toFixed(2):r.price};
        })};
        if(state.screen==='payment')p.description='订单号 '+(p.orderId||'');
        if(state.screen==='order-status'){p.statusValue=p.cancelled?'已取消':p.pickupCode||session.order?.deliveryInfo?.expectDeliveryTime||p.status||state.title;p.store=session.order?.storeName||p.store;p.heading='';}
        state={...state,presentation:p};
      }catch(e){/* Preserve the service view if optional presentation enrichment is unavailable. */}
    }
    this.focusId = null;
    const defaultFocus = state.presentation && state.presentation.defaultFocus !== null && state.presentation.defaultFocus !== undefined ? state.presentation.defaultFocus : 0;
    this.decorate({ view: state, voiceDraft: '', draftPage: 0, receiptScroll: 0, receiptPage: 0, couponPage: 0, descriptionPage: 0, more: false, focusIndex: defaultFocus, input: state.input ? state.input.value : '', message: '', scrollTarget: '', listScroll: 0 });
    if(cartPosition){const row=this.data.rows.find(r=>r.id===cartPosition.rowId);this.focusId=row?'row-'+row.index:(this.controls.some(c=>c.id===cartPosition.focus)?cartPosition.focus:null);this.decorate({listScroll:cartPosition.scroll});if(this.data.listening)this.listeningReturn=this.capturePosition();}
    if(optionPosition){const row=this.data.rows.find(r=>r.id===optionPosition.rowId);if(row){this.focusId='row-'+row.index;this.decorate({focusIndex:row.index,listScroll:optionPosition.scroll});}}
    if(state.screen==='menu')console.info('MCD_MENU_PERF '+JSON.stringify({stage:'presentation',ms:Date.now()-menuRenderStart,count:state.rows.length}));
    if(warmPickup)this.warmPickupPosition();
    this.maybeAutoListen();
  },
  decorate(patch = {}) {
    // Derive the entire screen from one snapshot before publishing it to Ink.
    const data = {...this.data, ...patch};
    const ui = presentation(data.view, data.focusIndex, data.more);
    if(data.view.screen==='stores'){
      ui.rows=storeRows(ui.rows);
      ui.listClass+=' store-scroll';
      ui.title='附近的麦当劳';
      ui.emptyMessage=ui.rows.length?'':data.view.summary||'未找到可用门店';
    }
    if(data.view.screen==='menu'){ui.rows=menuRows(ui.rows);ui.listClass+=' menu-scroll';ui.menuContentHeight=ui.rows.reduce((n,r)=>n+r.height+8,0);ui.menuPrefix=0;ui.showSummary=false;ui.menuEmpty=!ui.rows.length;ui.menuNoData=data.view.presentation?.menuTotal===0;if(ui.menuEmpty){ui.aside=data.view.presentation?.orderProgress||'';ui.asideIcon='';}ui.menuEmptyText=ui.menuNoData?'该门店暂无可选餐品':'没有匹配餐品，可重新说需求';ui.menuHint=data.view.presentation?.queryError||(ui.rows.length?(data.view.presentation?.menuSearch?'按需求匹配 · '+data.view.presentation.menuCount+' 项':'说序号、餐名，或说“换一批”'):ui.menuNoData?'可按确认键重新加载':'可说“乐奇”重新说需求');}
    if(data.view.screen==='cart'){ui.rows=storeRows(ui.rows.map(r=>({...r,assetRow:true,storeAddress:r.subtitle})),undefined,192).map(r=>({...r,height:Math.max(149,r.height)}));ui.cartRows=ui.rows;ui.cartHint=data.view.presentation?.queryError||data.view.presentation?.cartNotice||(ui.rows.length?'可说继续加餐或去结算':'说“乐奇”，可继续加餐');}
    ui.assetRows=[];
    if(['wallet','coupon-select','orders'].includes(data.view.screen)){
      ui.rows=storeRows(ui.rows.map(r=>({...r,assetRow:true,storeAddress:data.view.screen==='orders'?r.subtitle:'',storeStatus:''})));
      ui.assetRows=ui.rows;
      ui.listClass+=' asset-scroll';
    }
    // Keep every receipt field reachable within the glasses viewport.
    const split=(text,width)=>{
      const result=[];let line='',used=0;
      for(const c of String(text||'')){const size=c.charCodeAt(0)<256?0.55:1;if(used+size>width){result.push(line);line='';used=0;}line+=c;used+=size;}
      if(line)result.push(line);return result.length?result:[''];
    };
    const draftLines=split(data.voiceDraft,22);ui.draftPages=Math.max(1,Math.ceil(draftLines.length/2));
    ui.draftText=draftLines.slice((data.draftPage||0)*2,((data.draftPage||0)+1)*2).join('\n');
    ui.draftStep='识别内容 '+((data.draftPage||0)+1)+'/'+ui.draftPages;
    if(data.view.screen==='order-status'){ui.store=split(ui.store,21).join('\n');ui.orderNumber=data.view.presentation?.orderId?split('订单号 '+data.view.presentation.orderId,22).join('\n'):'';}
    const description=ui.descriptionLines.flatMap(line=>split(line,22));
    const descriptionSize=['cancel-confirm','cart-change-confirm'].includes(data.view.screen)?5:2;
    ui.descriptionPages=data.view.screen==='order-status'?1:ui.tight?Math.max(1,Math.ceil(description.length/descriptionSize)):1;
    const descriptionPage=Math.min(data.descriptionPage||0,ui.descriptionPages-1);
    if(ui.tight)ui.descriptionLines=description.slice(descriptionPage*descriptionSize,descriptionPage*descriptionSize+descriptionSize);
    ui.descriptionStep=ui.descriptionPages>1?'详情 '+(descriptionPage+1)+'/'+ui.descriptionPages+' ↓':'';
    const couponLines=ui.couponDetails.flatMap(line=>split(line,22));
    ui.couponPages=ui.tight&&data.view.screen==='coupon-confirm'?Math.max(1,Math.ceil(couponLines.length/2)):1;
    const couponPage=Math.min(data.couponPage||0,ui.couponPages-1);
    ui.couponPageLines=couponLines.slice(couponPage*2,couponPage*2+2);
    ui.couponStep=ui.couponPages>1?'优惠明细 '+(couponPage+1)+'/'+ui.couponPages+' ↓':'';
    const parts=[];
    for(const entry of ui.receipt){
      if(data.view.screen==='review'){
        const value=String(entry.value||'');
        const valueWidth=value?Math.max(110,Math.ceil(value.length*13)):0;
        const titleWidth=438-(valueWidth?valueWidth+12:0);
        const titles=split(entry.title,titleWidth/18);
        const subtitles=entry.subtitle?split(entry.subtitle,titleWidth/18):[];
        parts.push({...entry,id:entry.id||'receipt-'+parts.length,title:titles.join('\n'),subtitle:subtitles.join('\n'),value,valueWidth,titleWidth,height:titles.length*26+subtitles.length*26});
        continue;
      }
      const titles=split(entry.title,entry.value?14:20);
      const subtitles=split(entry.subtitle,34);
      if(ui.alert){
        for(let i=0;i<titles.length;i++)parts.push({title:titles[i],value:i===0?entry.value:''});
        if(entry.subtitle)for(const text of split(entry.subtitle,20))parts.push({title:text});
    }else if(entry.inline) parts.push({title:entry.title,subtitle:entry.subtitle||'',value:entry.value||'',inline:true});
    else for(let i=0;i<Math.max(titles.length,subtitles.length);i++)parts.push({title:titles[i]||'续',subtitle:subtitles[i]||'',value:i===0?entry.value:''});
    }
    ui.receipt=parts;
    // Receipt detail is one continuous document; only free-text confirmations paginate.
    ui.receiptItems=ui.receipt;ui.receiptPages=1;ui.receiptStep='';
    const receiptHeight=40+(ui.address?Math.ceil(ui.address.length/24)*26+12:0)+ui.receipt.reduce((n,r)=>n+(r.height||(r.inline?44:Math.max(30,r.subtitle?56:30)))+4,0);
    ui.receiptViewport=ui.rows.length?76:124;
    ui.receiptMaxScroll=Math.max(0,receiptHeight-ui.receiptViewport);
    if(data.view.screen==='coupon-detail'){
      const info=[['使用日期',ui.coupon.date],['使用时段',ui.coupon.time],['适用方式',String(ui.coupon.fulfillment||'').replace(/\s*[/／]\s*/g,'／')]].filter(x=>x[1]).flatMap(([label,value])=>split(value,17).map((value,i)=>({label:i?'':label,value})));
      if(ui.coupon.description)info.push(...split(ui.coupon.description,22).map(value=>({label:'',value})));
      const size=info.length>3?2:3;ui.descriptionPages=Math.max(1,Math.ceil(info.length/size));
      const page=Math.min(data.descriptionPage||0,ui.descriptionPages-1);ui.couponInfo=info.slice(page*size,page*size+size);ui.descriptionLines=[];
      ui.descriptionStep='优惠明细 '+(page+1)+'/'+ui.descriptionPages;
    }
    if(data.view.screen==='order-detail')ui.descriptionPages=Math.max(1,Math.ceil((ui.order.items||[]).length/3));
    const controls=controlsFor({...data,ui});
    const target=controls.find(c=>c.id===this.focusId)||controls.find(c=>c.legacy===data.focusIndex)||controls[0];
    if(data.view.screen==='order-detail'){
      const items=ui.order.items||[],page=Math.min(data.descriptionPage||0,Math.max(0,Math.ceil(items.length/3)-1));
      ui.descriptionPages=Math.max(1,Math.ceil(items.length/3));ui.orderItems=items.slice(page*3,page*3+3).map(x=>({...x,quantityLabel:/[×x]\s*\d+$/.test(x.name)?'':' ×'+x.quantity}));ui.descriptionStep='餐品明细 '+(page+1)+'/'+ui.descriptionPages+' ↓';
    }
    ui.visibleRows=ui.rows;
    this.controls=controls;this.focusId=target?target.id:'';
    if(target&&target.legacy!==data.focusIndex)return this.decorate({...patch,focusIndex:target.legacy});
    const layout=listLayout(ui.rows,data.view.screen,ui.actions.length>0,target?.rowIndex,data.listScroll,ui.menuPrefix||0,['wallet','coupon-select','orders','stores','menu','meal','customize','cart','review'].includes(data.view.screen)?40:0);
    if(data.view.screen==='customize'){
      let total=2,top=0,bottom=0;
      for(const group of ui.groups){
        const index=group.rows.findIndex(r=>r.index===target?.rowIndex);
        if(index>=0){top=total+34+Math.floor(index/2)*56;bottom=top+48;}
        total+=34+Math.ceil(group.rows.length/2)*56+6;
      }
      const viewport=147;let scroll=Math.max(0,Math.min(data.listScroll,Math.max(0,total-viewport)));
      if(bottom){if(top<scroll)scroll=top;else if(bottom>scroll+viewport)scroll=bottom-viewport;}
      layout.scroll=scroll;layout.height=viewport;
    }
    if(data.view.input)ui.centralHeight=276;
    ui.listHeight=ui.menuEmpty||data.view.screen==='cart'?176:ui.largeCompact||data.view.screen==='tableware'?220:layout.height;
    ui.overflowAbove=layout.overflowAbove;ui.overflowBelow=layout.overflowBelow;
    const listScroll=layout.scroll;
    const submitStart=Date.now();
    this.setData({ ...patch, ui: ui, rows: ui.rows, actions: ui.actions, controlId:this.focusId, scrollTarget:'', listScroll });
    if(data.view.screen==='menu')console.info('MCD_MENU_PERF '+JSON.stringify({stage:'submit',ms:Date.now()-submitStart,count:ui.rows.length}));
  },
  async send(event, fromKey = false, resumeOptions = true) {
    const optionTarget=resumeOptions&&this.data.view.screen==='customize'&&['mod','choose-round'].includes(event.type)?this.data.rows.find(r=>r.event.type===event.type&&r.event.id===event.id)?.id:null;
    let optionSucceeded=false;
    if (['confirm','approve-cart-change'].includes(event.type) && !fromKey) { this.showNotice('核对后请按确认键提交。'); return; }
    if (this.data.busy || this.navigationPending) return;
    if(['menu-batch','menu-search'].includes(event.type)){if(this.recognition)this.cancelRecognition();this.autoListenPending=true;this.render(await this.service.event(this.data.view.id,{...event,revision:this.data.view.revision}));return;}
    if (this.recognition) this.cancelRecognition();
    if(['remove-line','clear-cart','undo-remove-line'].includes(event.type))return this.mutateCart(event);
    if(event.type==='cart'&&this.data.view.screen==='home')return this.openCurrentCart();
    if (event.type === 'locate') { this.locate(); return; }
    if(event.type==='fulfillment'&&event.value==='pickup')return this.startPickup();
    if(event.type==='start-order-intent'||event.type==='approve-cart-change')return this.startVoiceOrder(event);
    if((event.type==='search-stores'&&!this.locatingSearch)||(event.type==='fulfillment'&&event.value==='delivery'))this.stopStoreDistances(true);
    const orderQuery=event.type==='query-order'&&this.data.view.screen==='orders';
    const walletQuery=event.type==='query'&&event.value==='wallet';
    const walletPosition=(walletQuery||orderQuery)?this.capturePosition():null;
    const silentBack=event.type==='back'||(event.type==='home'&&this.isCancelledOrderPage());
    if(silentBack)this.navigationPending=true;
    else this.beginLoading({ busy: true, orderLoading:orderQuery, walletLoading:walletQuery, message: event.type==='search-stores'?'正在查询麦当劳门店':walletQuery?'正在查询优惠券':event.type === 'confirm' ? '正在提交，请勿重复操作' : event.type === 'quote' || event.type === 'now' ? '正在算价' : '正在处理' });
    const generation = this.generation;
    try {
      let state = await this.request('/sessions/' + this.data.view.id + '/events', 'POST', { ...event, revision: this.data.view.revision });
      if(event.type==='back'&&state.screen==='location')state=await this.request('/sessions/'+state.id+'/events','POST',{type:'back',revision:state.revision});
      if (this.visible && generation === this.generation) { this.render(state); optionSucceeded=!!optionTarget&&state.screen==='customize'; if(walletQuery&&state.screen!=='wallet')this.restorePosition(walletPosition); if(orderQuery&&state.screen==='orders'){this.restorePosition(walletPosition);this.showNotice(state.presentation?.queryError||'未能读取订单详情，请重试。');} }
    } catch (e) {
      if (this.visible && generation === this.generation) {
        this.showNotice( e.message );
        // Refresh an existing session after a conflict or a lost response. Never resend a write.
        try { const state = await this.request('/sessions/' + this.data.view.id); if (this.visible) this.render(state); this.showNotice( e.message ); } catch (ignored) {}
      }
    } finally { if(silentBack)this.navigationPending=false; if (this.visible && generation === this.generation) this.setData({ busy: false, orderLoading:false, walletLoading:false }); this.maybeAutoListen(); if(optionSucceeded)this.continueCustomization(optionTarget); }
  },
  moveFocus(delta) {
    if(this.focusId==='receipt-scroll'&&this.data.view.screen==='review'){const old=this.data.receiptScroll||0;this.advanceReceipt(delta);if(old!==this.data.receiptScroll)return;}
    const controls=this.controls||[];if(!controls.length)return;
    if(['stores','menu','cart'].includes(this.data.view.screen)){
      const row=controls.find(c=>c.id===this.focusId)?.rowIndex;
      if(Number.isInteger(row)){
        const rows=this.data.ui.rows,top=(this.data.ui.menuPrefix||0)+rows.slice(0,row).reduce((n,r)=>n+r.height+8,0),height=rows[row].height,viewport=this.data.ui.listHeight;
        if(height>viewport){const old=this.data.listScroll,next=Math.max(top,Math.min(top+height-viewport,old+delta*52));if(next!==old){this.setData({listScroll:next});return;}}
      }
    }
    const current=Math.max(0,controls.findIndex(c=>c.id===this.focusId));
    const target=controls[(current+delta+controls.length)%controls.length];

    this.focusId=target.id;this.setData({focusIndex:target.legacy});this.decorate();
  },
  async activateFocused(fromKey=false) {
    if(this.data.busy)return;
    const target=(this.controls||[]).find(c=>c.id===this.focusId);if(!target)return;
    if(target.command==='listen'&&this.recognition)this.cancelRecognition();
    if(target.event?.type==='geo-stores')return this.locate();
    if(target.event&&['wallet','coupon-select'].includes(this.data.view.screen)&&target.rowIndex!==undefined)return this.openCoupon(target);
    if(target.event&&this.data.view.screen==='orders'&&target.event.type==='query-order'){this.listReturn={view:this.data.view,focus:this.focusId,scroll:this.data.listScroll};await this.send(target.event,fromKey);if(this.data.view.screen!=='order-detail')this.listReturn=null;return;}
    if(target.event){if(target.event.type==='back'){this.goBack();return;}return this.send(target.event,fromKey);}
    switch(target.command){
      case 'edit-quantity':return this.openQuantity(target.rowIndex);
      case 'quantity-change':return this.changeQuantity(target.delta);
      case 'quantity-done':return this.closeQuantity();
      case 'delete-line':return this.mutateCart({type:'remove-line',id:this.quantityReturn.id});
      case 'coupon-apply':{const event=this.couponReturn.event;this.couponReturn=null;return this.send(event,fromKey);}
      case 'connect':return this.connect();
      case 'back-settings':this.closeSettings();break;case 'settings':this.openSettings();break;
      case 'listen':this.listen();break;
      case 'back':this.goBack();break;case 'receipt':this.advanceReceipt();break;case 'coupon':this.advanceCoupon();break;
      case 'description':this.advanceDescription();break;case 'draft':this.advanceDraft();break;case 'accept-input':return this.acceptInput();
    }
  },
  async acceptInput(){
    let value=String(this.data.voiceDraft||'').trim();if(!value||!this.data.view.input)return;
    const placeholder=this.data.view.input.placeholder,screen=this.data.view.screen;
    if((screen==='location'||this.data.view.presentation?.locationFallback)&&!/[ ,，]/.test(value))value=value.replace(/^(.+?(?:市|自治州|地区))(.+)$/,'$1 $2');
    await this.send({type:'input',value});
    if(this.data.view.screen===screen&&this.data.view.input&&this.data.view.input.placeholder===placeholder){this.setData({voiceDraft:value});this.focusId='input-accept';this.decorate();}
  },
  toggleMore() {
    this.clearBackTimer();
    if(!this.data.more)this.moreReturn=this.capturePosition();
    this.focusId=null;this.setData({more:!this.data.more});this.decorate();
    if(!this.data.more){this.restorePosition(this.moreReturn);this.moreReturn=null;}
  },
  async goBack() {
    this.clearBackTimer();
    if(this.data.settings)return this.closeSettings();
    if(this.data.more)return this.toggleMore();
    if(this.data.view.screen==='quantity-editor')return this.closeQuantity();
    if(this.data.view.screen==='coupon-detail'&&this.couponReturn){const old=this.couponReturn;this.couponReturn=null;this.render(old.view);this.focusId=old.focus;this.setData({listScroll:old.scroll});this.decorate();return;}
    if(this.data.view.screen==='order-detail'&&this.listReturn){const old=this.listReturn;this.listReturn=null;await this.send({type:'back'});this.focusId=old.focus;this.setData({listScroll:old.scroll});this.decorate();return;}
    if(this.data.view.screen!=='home'){
      await this.send({type:'back'});
      this.restorePosition(this.returnPositions&&this.returnPositions[(this.data.view.id||'')+':'+this.data.view.screen]);
    }
  },
  advanceDraft(delta=1){const n=this.data.ui.draftPages||1;this.setData({draftPage:((this.data.draftPage||0)+delta+n)%n});this.decorate();},
  advanceDescription(delta=1) { if(this.data.view.screen==='order-status')return;const n=this.data.ui.descriptionPages||1;this.setData({descriptionPage:((this.data.descriptionPage||0)+delta+n)%n});this.decorate(); },
  advanceReceipt(delta=1) { this.setData({receiptScroll:Math.max(0,Math.min(this.data.ui.receiptMaxScroll||0,(this.data.receiptScroll||0)+delta*52))}); },
  advanceCoupon(delta=1) { const n=this.data.ui.couponPages||1;this.setData({couponPage:((this.data.couponPage||0)+delta+n)%n});this.decorate(); },
  openSettings() {
    if(this.recognition)this.cancelRecognition();
    this.autoListenPending=false;
    this.clearBackTimer();
    if(!this.data.busy){this.stopStoreDistances();if(this.service)this.service.discardCartUndo(this.data.view.id);this.settingsReturn={view:this.data.view.screen==='cart'?this.service.state(this.data.view.id):this.data.view,position:this.capturePosition()};this.focusId=null;this.setData({settings:true,message:''});this.decorate();}
  },
  closeSettings(){
    if(this.service){
      const old=this.settingsReturn;this.settingsReturn=null;
      const current=this.service.resume();
      this.setData({settings:false});
      this.render(old&&old.view.id===current.id&&old.view.revision===current.revision?old.view:current);
      if(old)this.restorePosition(old.position);
    }else {this.showNotice('尚未连接；请按确认键重试连接。');this.focusId='setting-connect';this.decorate();}
  },
  clearBackTimer() { if(this.backTimer){clearTimeout(this.backTimer);this.backTimer=null;} this.backPending=false;this.backPressedAt=0; },
  openCoupon(target) {
    const view=this.data.view,row=this.data.rows[target.rowIndex];
    const session=this.deviceStore.get(view.id),raw=session.coupons[target.rowIndex]||{};
    this.couponReturn={view,focus:this.focusId,scroll:this.data.listScroll,event:target.event};
    this.render({...view,screen:'coupon-detail',title:row.title,summary:'',rows:[],actions:[],presentation:{coupon:couponView(row,raw)}});
  },
  async openCurrentCart(){
    const generation=this.generation;this.navigationPending=true;
    try{const pending=this.deviceStore.pending();const state=pending?this.service.resume():await this.request('', 'POST',{type:'cart',revision:this.data.view.revision});if(this.visible&&generation===this.generation)this.render(state);}
    catch(e){if(this.visible&&generation===this.generation)this.showNotice(e.message);}
    finally{this.navigationPending=false;this.maybeAutoListen();}
  },
  async mutateCart(event){
    if(this.data.busy||this.navigationPending)return;
    if(this.recognition)this.cancelRecognition();
    const before=this.service.state(this.data.view.id),rows=before.rows;
    const index=Math.max(0,rows.findIndex(r=>r.id===event.id));
    const restoredId=before.presentation?.undoLineId,scroll=event.type==='clear-cart'||(event.type==='undo-remove-line'&&before.presentation?.undoAll)?0:this.data.listScroll,generation=this.generation;
    this.navigationPending=true;
    try{
      const state=await this.request('', 'POST',{...event,revision:this.data.view.revision});
      if(!this.visible||generation!==this.generation)return;
      this.quantityReturn=null;this.render(state);
      if(state.screen==='cart'&&!state.presentation?.queryError){
        const row=event.type==='undo-remove-line'?this.data.rows.find(r=>r.id===restoredId):this.data.rows[Math.min(index,this.data.rows.length-1)];
        const target=row?(this.controls||[]).find(c=>c.rowIndex===row.index):(this.controls||[]).find(c=>c.event?.type==='menu');
        if(target){this.focusId=target.id;this.decorate({focusIndex:target.legacy,listScroll:scroll});}
      }
      if(state.presentation?.queryError)this.showNotice(state.presentation.queryError);
    }catch(e){if(this.visible&&generation===this.generation)this.showNotice(e.message);}
    finally{this.navigationPending=false;this.maybeAutoListen();if(this.data.listening)this.listeningReturn=this.capturePosition();}
  },
  openQuantity(index) {
    this.quantityReturn={focus:this.focusId,scroll:this.data.listScroll,id:this.data.rows[index].id};
    this.renderQuantity();
  },
  renderQuantity() {
    const state=this.service.state(this.data.view.id),row=state.rows.find(r=>r.id===this.quantityReturn.id);
    if(!row){this.closeQuantity();return;}
    this.render({...state,screen:'quantity-editor',title:'修改数量',summary:row.subtitle,hero:row.image,rows:[],actions:[],presentation:{quantity:row.quantity,heading:row.title}});
  },
  async changeQuantity(delta) {
    const n=this.data.ui.quantity+delta;
    if(n<0||n>20)return;
    if(n===0)return this.mutateCart({type:'line-quantity',id:this.quantityReturn.id,value:0});
    await this.request('', 'POST', {type:'line-quantity',id:this.quantityReturn.id,value:n,revision:this.data.view.revision});
    this.renderQuantity();
  },
  closeQuantity() {
    const old=this.quantityReturn;this.quantityReturn=null;
    this.render(this.service.state(this.data.view.id));
    if(old){this.focusId=old.focus;this.setData({listScroll:old.scroll});this.decorate();if(this.data.listening)this.listeningReturn=this.capturePosition();}
  },
  canExitHome() {
    return this.data.view.screen==='home'&&!this.data.settings&&!this.data.more&&!this.data.listening&&!this.data.busy;
  },
  canExitOrderStatus() {
    return this.data.view.screen==='order-status'&&this.data.view.presentation?.desktopExitAllowed===true&&!this.deviceStore?.pending()&&!this.data.settings&&!this.data.more&&!this.data.listening&&!this.data.busy;
  },
  exitPage() {
    if((!this.canExitHome()&&!this.canExitOrderStatus())||this.exitRequested)return;
    if(typeof window==='undefined'||typeof window.close!=='function'){
      this.showNotice('当前运行时不支持应用关闭，请更新宿主。');return;
    }
    this.exitRequested=true;
    this.clearBackTimer();
    this.traceBack('exit-request');
    window.close();
  },
  usesHostBackGesture() {
    // Verified device profile only: Ink 0.20.0 already translates the physical
    // double gesture to one Backspace pair. Other runtimes retain raw pairing.
    return typeof navigator!=='undefined' && navigator.versions && /^0\.20\.0(?:$|[-+])/.test(String(navigator.versions.ink||''));
  },
  isCancelledOrderPage() {
    return ['order-status','order-detail'].includes(this.data.view.screen)
      &&this.data.view.presentation?.cancelled===true&&!this.deviceStore?.pending();
  },
  async performBusinessBack(allowHomeExit=false) {
    if(this.businessBackInFlight)return;
    this.businessBackInFlight=true;
    this.clearBackTimer();
    try {
      if(this.data.listening){
        const old=this.listeningReturn;this.listeningReturn=null;
        this.cancelRecognition();this.restorePosition(old);
        this.showNotice('');return;
      }
      if(this.data.busy)return await this.cancelPending();
      if(this.data.settings||this.data.more)return await this.goBack();
      if(allowHomeExit&&this.isCancelledOrderPage()){
        this.returnPositions={};this.listReturn=null;
        return await this.send({type:'home'});
      }
      if(allowHomeExit&&(this.canExitHome()||this.canExitOrderStatus()))return this.exitPage();
      return await this.goBack();
    } finally { this.businessBackInFlight=false; }
  },
  handleBackPress(event={}) {
    if(this.exitRequested)return;
    if(this.usesHostBackGesture()){
      const stamp=Number.isFinite(event.timeStamp)?event.timeStamp:Date.now();
      // One host-recognized gesture may be delivered more than once with
      // different timestamps. Do not pop the business stack twice.
      if(this.businessBackInFlight)return;
      if(this.lastHostBackStamp!==undefined&&stamp-this.lastHostBackStamp>=0&&stamp-this.lastHostBackStamp<=500)return;
      this.lastHostBackStamp=stamp;
      return this.performBusinessBack(true);
    }
    const now=Date.now();
    if(this.lastRawBackAt!==undefined&&now-this.lastRawBackAt>=0&&now-this.lastRawBackAt<=500)return;
    if (this.backPending && now-this.backPressedAt<=500) {
      this.lastRawBackAt=now;
      this.clearBackTimer();
      return this.performBusinessBack(true);
    }
    this.clearBackTimer();this.backPressedAt=Date.now();
    this.backPending=true;
    this.backTimer=setTimeout(()=>this.clearBackTimer(),500);
  },
  stopLoadingMotion(){if(this.loadingMotionTimer){clearInterval(this.loadingMotionTimer);this.loadingMotionTimer=null;}},
  updateLoadingDots(frame){this.setData({loadingFrame:frame,loadingDots:Array.from({length:12},(_,index)=>({index,left:18+15*Math.sin(index*Math.PI/6),top:18-15*Math.cos(index*Math.PI/6),opacity:0.15+0.85*((index-frame%12+12)%12)/11}))});},
  beginLoading(patch){
    if(this.recognition)this.cancelRecognition();
    this.stopLoadingMotion();this.setData({...patch,loadingFrame:0});let frame=0;this.updateLoadingDots(frame);
    this.loadingMotionTimer=setInterval(()=>{if(!this.visible||!this.data.busy){this.stopLoadingMotion();return;}frame=(frame+1)%12;this.updateLoadingDots(frame);},80);
  },
  stopVoiceMotion(){if(this.voiceMotionTimer){clearInterval(this.voiceMotionTimer);this.voiceMotionTimer=null;}},
  startVoiceMotion(){
    this.stopVoiceMotion();let phase=0;
    const frame=()=>{if(!this.visible||!this.data.listening){this.stopVoiceMotion();return;}this.setData({voiceBars:[0,1,2,3,4].map(index=>({index,height:8+Math.round((Math.sin(phase+index*1.3)+1)*10)}))});phase+=0.8;};
    frame();this.voiceMotionTimer=setInterval(frame,160);
  },
  cancelRecognition(){
    this.stopVoiceMotion();
    this.clearRecognitionTimers();
    this.clearBackTimer();
    this.recognitionGeneration=(this.recognitionGeneration||0)+1;
    const recognition=this.recognition;this.recognition=null;if(recognition)recognition.abort();
    this.setData({listening:false,inlineListening:false});
  },
  async cancelPending(){
    this.clearLocationRequest();
    this.stopStoreDistances(true);
    const old=this.capturePosition();
    this.generation=(this.generation||0)+1;this.cancelRecognition();
    if(this.model){this.model.destroy();this.model=null;}
    if(this.gateway)await this.gateway.close().catch(()=>{});
    this.setData({busy:false,orderLoading:false,walletLoading:false,locationLoading:false});
    if(this.service){try{this.render(this.service.resume());}catch(e){this.showNotice(e.message);}}
    else this.openSettings();
    this.restorePosition(old);
    this.showNotice('已中止本地等待；已发送的写操作仍须核实。');
  },
  traceBack(phase,event) {
    if(!this.backTraceEnabled)return;
    // Deliberate allowlist: never log input text, account data, MCP payloads or credentials.
    const record={phase,at:Date.now(),screen:this.data.view.screen,settings:!!this.data.settings,busy:!!this.data.busy,listening:!!this.data.listening};
    if(event){record.code=event.code;record.timeStamp=event.timeStamp;record.repeat=!!event.repeat;record.cancelable=event.cancelable;record.defaultPrevented=event.defaultPrevented;}
    console.info('MCD_BACK_TRACE '+JSON.stringify(record));
  },
  showNotice(message){
    if(this.data.view.screen==='cart'&&!this.data.rows.length&&message==='可说“乐奇”重试，或按键选择')message='说“乐奇”，可继续加餐';
    const lines=[];let line='',width=0;
    for(const c of String(message||'')){const w=c.charCodeAt(0)<256?0.55:1;if(width+w>24){lines.push(line);line='';width=0;}line+=c;width+=w;}
    if(line)lines.push(line);
    const visible=lines.slice(0,2);if(lines.length>2)visible[1]=visible[1].slice(0,-1)+'…';
    this.setData({message,homeNoticeLines:visible,homeNoticeText:visible.join('\n')});
  },
  onKeyDown(event){
    // Back is owned exclusively by onKeyUp, where Ink runs its default action.
    if(event.code==='Backspace'||event.code==='Escape'){this.traceBack('down-observed',event);return;}
    if(['ArrowUp','ArrowDown','Enter'].includes(event.code))event.preventDefault();
  },
  onKeyUp(event) {
    if(!['ArrowUp','ArrowDown','Enter','Backspace','Escape'].includes(event.code))return;
    event.preventDefault();
    this.traceBack('up-consumed',event);
    if(this.navigationPending)return;
    if(this.data.ui.home&&!this.data.busy&&!this.data.listening&&this.data.message)this.showNotice('');
    if(event.code==='Backspace'||event.code==='Escape'){if(event.repeat)return;return this.handleBackPress(event);}
    if(this.data.listening&&this.data.inlineListening){
      if(event.code==='Enter'){this.cancelRecognition();return this.activateFocused(true);}
      if(event.code==='ArrowUp'||event.code==='ArrowDown'){this.moveFocus(event.code==='ArrowUp'?-1:1);return;}
    }
    if(this.data.listening){if(event.code==='Enter'&&this.recognition)this.recognition.stop();return;}
    if(this.data.busy){if(event.code==='Backspace')return this.cancelPending();return;}
    if(event.code==='ArrowUp'||event.code==='ArrowDown'){this.moveFocus(event.code==='ArrowUp'?-1:1);return;}
    return this.activateFocused(true);
  },
  onVoiceWakeup(event) {
    event.preventDefault();
    if(!this.visible||this.data.busy||this.navigationPending||this.data.listening||this.recognition||event.keyword==='clickAiAssist')return;
    this.listen();
  },
  clearRecognitionTimers(){
    if(this.recognitionTimer)clearTimeout(this.recognitionTimer);
    if(this.recognitionFinalTimer)clearTimeout(this.recognitionFinalTimer);
    this.recognitionTimer=null;this.recognitionFinalTimer=null;
  },
  maybeAutoListen(){
    if(!this.autoListenPending||!this.visible||this.data.busy||this.navigationPending||this.data.settings||!['fulfillment','wallet','coupon-select','orders','stores','menu','meal','customize','cart','review'].includes(this.data.view.screen))return;
    this.autoListenPending=false;
    if(this.data.view.screen==='menu'){if(this.data.view.presentation?.menuTotal===0)return;}else if(['orders','stores','meal','customize'].includes(this.data.view.screen)&&!this.data.rows.some(r=>!r.disabled))return;
    this.listen();
  },
  finishRecognition(){
    if(!this.recognition||this.recognitionStopping)return;
    this.recognitionStopping=true;
    if(this.recognitionTimer)clearTimeout(this.recognitionTimer);this.recognitionTimer=null;
    const generation=this.recognitionGeneration;
    this.recognitionFinalTimer=setTimeout(()=>{if(generation!==this.recognitionGeneration)return;this.cancelRecognition();this.showNotice('可说“乐奇”重试，或按键选择');},3000);
    try{this.recognition.stop();}catch(e){this.cancelRecognition();}
  },
  listen() {
    if(this.data.busy||!this.visible)return;
    if(this.recognition)return;
    const couponList=['wallet','coupon-select'].includes(this.data.view.screen);
    const orderList=this.data.view.screen==='orders';
    const storeList=this.data.view.screen==='stores';
    const menuList=this.data.view.screen==='menu';
    const mealOptions=['meal','customize'].includes(this.data.view.screen);
    const cartList=this.data.view.screen==='cart';
    const reviewPage=this.data.view.screen==='review';
    const inline=(couponList||orderList||storeList||menuList||mealOptions||cartList||reviewPage||this.data.view.screen==='fulfillment'&&!this.data.view.presentation?.locationFallback)&&!this.data.settings;
    try{
      const generation=(this.recognitionGeneration||0)+1;this.recognitionGeneration=generation;this.recognitionStopping=false;
      const recognition=new SpeechRecognition();recognition.lang='zh-CN';recognition.continuous=false;recognition.interimResults=false;
      const active=()=>this.visible&&generation===this.recognitionGeneration;
      recognition.onresult=event=>{
        const result=event.results[event.resultIndex||0],text=result&&result[0]?result[0].transcript:'';
        if(!active()||!text)return;
        this.cancelRecognition();
        if(inline&&!couponList&&!orderList&&!storeList&&!menuList&&!mealOptions&&!cartList&&!reviewPage){
          const pickup=/到店|自取|自提/.test(text),delivery=/麦乐送|外送|配送|送到|送餐/.test(text);
          if(pickup===delivery){this.showNotice('请说“到店自取”或“麦乐送”');return;}
          this.send({type:'fulfillment',value:pickup?'pickup':'delivery'});return;
        }
        this.showNotice('');this.understand(text);
      };
      recognition.onspeechend=()=>{if(active())this.finishRecognition();};
      recognition.onnomatch=()=>{if(active()){this.cancelRecognition();this.showNotice('可说“乐奇”重试，或按键选择');}};
      recognition.onerror=()=>{if(active()){this.cancelRecognition();this.showNotice('语音暂不可用；可按键选择现有选项，或重新唤醒重试。');}};
      recognition.onend=()=>{if(active()){this.cancelRecognition();this.showNotice('可说“乐奇”重试，或按键选择');}};
      this.listeningReturn=this.capturePosition();
      this.recognition=recognition;this.setData({listening:true,inlineListening:inline,message:''});recognition.start();this.startVoiceMotion();
      if(inline)this.recognitionTimer=setTimeout(()=>{if(active())this.finishRecognition();},15000);
    }catch(e){this.cancelRecognition();this.showNotice('语音暂不可用；自由内容尚未录入，请重试。');}
  },
  async selectMealOptionVoice(text){
    const screen=this.data.view.screen;
    if(screen==='meal'){
      const count=text.match(/^(?:数量(?:改为|设为)?|要|来)?([零一二两三四五六七八九十百\d]+)份$/);
      if(count){const n=spokenNumber(count[1]);if(n<1||n>20){this.showNotice('数量可选 1 至 20 份');return;}return this.send({type:'quantity',value:n});}
      if(/^(增加数量|加一份|多一份|减少数量|减一份|少一份)$/.test(text))return this.send({type:'quantity',value:Math.max(1,Math.min(20,this.data.ui.quantity+(/减少|减一|少一/.test(text)?-1:1)))});
      if(/^(选饮料与口味|选择口味|选口味|下一步|继续)$/.test(text)){
        const action=this.data.actions.find(a=>!a.disabled&&a.event.type==='customize');
        if(action)return this.send(action.event);
        const row=this.data.rows.find(r=>!r.disabled&&r.event.type==='customize');if(row)return this.send(row.event);
      }
    }
    if(text==='加入购物车'){
      const action=this.data.actions.find(a=>!a.disabled&&a.event.type==='add');
      if(action)return this.send(action.event);
      this.showNotice('请先完成当前规格选择');return;
    }
    if(screen==='customize')return this.selectCustomizationVoice(text);
    const match=text.match(/^(?:请)?(?:选择|选)?第([零一二两三四五六七八九十百\d]+)(?:个|项)?$/);
    const normalize=v=>String(v).replace(/[\s，。！？、（）()]/g,'');
    const name=normalize(text.replace(/^(?:请)?(?:选择|选)/,''));
    const rows=match?[this.data.rows[spokenNumber(match[1])-1]].filter(Boolean):this.data.rows.filter(r=>normalize(r.title)===name);
    if(rows.length!==1||rows[0].disabled||rows[0].event.type==='confirm'){this.showNotice(rows.length>1?'有同名选项，请按序号选择':'请说当前选项名称或序号');return;}
    this.focusId='row-'+rows[0].index;this.decorate();return this.activateFocused(false);
  },
  async selectCustomizationVoice(text){
    const remove=/^(取消|不要|去掉)/.test(text);
    const input=text.replace(/^(?:请)?(?:同时)?(?:选择|选|取消|不要|去掉)/,'');
    const parts=input.split(/以及|还有|和|跟|、|，|,/).map(s=>s.trim()).filter(Boolean);
    if(!parts.length){this.showNotice('请说选项名称或序号');return;}
    const targets=[];
    for(const part of parts){
      const ordinal=part.match(/^(?:选择|选)?第?([零一二两三四五六七八九十百\d]+)(?:个|项)?$/);
      const name=part.replace(/^(选择|选)/,'').replace(/\s/g,'');
      const found=ordinal?[this.data.rows[spokenNumber(ordinal[1])-1]].filter(Boolean):this.data.rows.filter(r=>r.title.replace(/\s/g,'')===name);
      if(found.length!==1||found[0].disabled||!['mod','choose-round'].includes(found[0].event.type)){this.showNotice(found.length>1?'有同名选项，请按序号选择':'未找到明确选项，请说名称或序号');return;}
      if(!targets.some(r=>r.id===found[0].id))targets.push(found[0]);
    }
    const selected=this.deviceStore.get(this.data.view.id)?.selected;
    if(!selected){this.showNotice('餐品已失效，请重新选择');return;}
    const groups=new Map();
    for(const row of targets){
      const id=String(row.event.id),chunks=id.split(':');let key,max,current,replace;
      if(row.event.type==='mod'){
        const [scope,r,c,g]=chunks;
        const round=selected.rounds?.[Number(r)];
        const choices=round?.choices||round?.items||round?.comboItemList||[];
        const raw=scope==='main'?selected.modification:choices[Number(c)]?.modification;
        const group=raw?.items?.[Number(g)];
        if(!group){this.showNotice('选项已失效，请重新进入');return;}
        key='mod:'+chunks.slice(0,4).join(':');max=Number(group.maxValues??group.values.length);current=group.values.reduce((n,v)=>n+Number(v.selectedQuantity||0),0);replace=max===1&&Number(group.minValues)===1;
      }else{
        const round=selected.rounds?.[Number(chunks[0])];if(!round){this.showNotice('选项已失效，请重新进入');return;}
        const choices=round.choices||round.items||round.comboItemList||[];
        key='round:'+chunks[0];max=Number(round.maxQuantity??1);current=choices.reduce((n,c)=>n+Number(c.quantity||0),0);replace=max===1;
      }
      let group=groups.get(key);if(!group){group={max,current,replace,requested:0,added:0};groups.set(key,group);}
      group.requested++;if(!row.selected)group.added++;
    }
    if(!remove&&[...groups.values()].some(g=>g.requested>g.max||!g.replace&&g.current+g.added>g.max)){this.showNotice('这些选项不能同时选择，请按该组限制选择');return;}
    const generation=this.generation,session=this.data.view.id;
    for(const target of targets){
      if(!this.visible||this.generation!==generation||this.data.view.id!==session||this.data.view.screen!=='customize')return;
      const row=this.data.rows.find(r=>r.id===target.id);
      if(!row||!!row.selected===!remove)continue;
      await this.send(row.event,false,false);
      const updated=this.data.rows.find(r=>r.id===target.id);
      if(!updated||!!updated.selected!==!remove){this.showNotice('当前选项未更改，请检查该组限制');return;}
    }
    this.continueCustomization(targets[targets.length-1].id);
  },
  continueCustomization(rowId){
    if(!this.visible||this.data.settings||this.data.busy||this.navigationPending||this.data.view.screen!=='customize')return;
    const row=this.data.rows.find(r=>r.id===rowId);if(!row||row.disabled)return;
    this.focusId='row-'+row.index;this.decorate({focusIndex:row.index,message:''});
    // Recognition cancellation must restore the newly selected option, not the previous round's focus.
    this.listeningReturn=this.capturePosition();
    this.listen();
  },
  async selectCartVoice(text){
    if(['清空购物车','删除所有商品','全部删除'].includes(text))return this.send({type:'clear-cart'});
    if(text==='撤销删除')return this.send({type:'undo-remove-line'});
    if(/^(?:请)?(?:删除|去掉|移除)/.test(text)){
      const target=text.replace(/^(?:请)?(?:删除|去掉|移除)/,'').trim();
      const ordinal=target.match(/^第?([零〇一二两三四五六七八九十百\d]+)(?:份餐品|个餐品|份|个|项|号)$/);
      const normalize=v=>String(v).replace(/[\s，。！？、（）()]/g,'');
      const found=ordinal?[this.data.rows[spokenNumber(ordinal[1])-1]].filter(Boolean):this.data.rows.filter(r=>normalize(r.title)===normalize(target));
      if(found.length!==1||found[0].disabled){this.showNotice(found.length>1?'有同名餐品，请按序号删除':'未找到明确餐品，请按当前编号删除');return;}
      return this.send({type:'remove-line',id:found[0].id});
    }
    if(text==='继续加餐')return this.send({type:'menu'});
    if(text==='去结算'){
      if(!this.data.rows.length){this.showNotice('购物车还是空的，可说继续加餐');return;}
      return this.send({type:'checkout'});
    }
    const ordinal=text.match(/^(?:请)?(?:修改|选择|选|打开)?第([零一二两三四五六七八九十百\d]+)(?:份餐品|个餐品|份|个|项)?$/);
    const normalize=v=>String(v).replace(/[\s，。！？、（）()]/g,'');
    const name=normalize(text.replace(/^(?:请)?(?:修改|选择|选|打开)/,''));
    const found=ordinal?[this.data.rows[spokenNumber(ordinal[1])-1]].filter(Boolean):this.data.rows.filter(r=>normalize(r.title)===name);
    if(found.length!==1||found[0].disabled){this.showNotice(found.length>1?'有同名餐品，请按序号选择':'请说继续加餐、去结算或餐品序号');return;}
    const row=found[0];this.focusId='row-'+row.index;this.decorate({focusIndex:row.index});
    return this.openQuantity(row.index);
  },
  async selectMenuVoice(text){
    const match=text.match(/^(?:请)?(?:选择|选|点|打开)?第?([零一二两三四五六七八九十百\d]+)(?:份餐品|个餐品|份|个|项|号)?$/);
    let row;
    if(match){row=this.data.rows[spokenNumber(match[1])-1];if(!row||row.disabled){this.showNotice('请选择当前批次的餐品序号');return;}}
    else{
      const normalize=v=>String(v).replace(/[\s，。！？、（）()]/g,'');
      const name=normalize(text.replace(/^(?:请)?(?:选择|选|点|打开)/,''));
      const rows=this.data.rows.filter(r=>!r.disabled&&normalize(r.title)===name);
      if(rows.length>1){this.showNotice('有同名餐品，请按序号选择');return;}
      if(rows.length===1)row=rows[0];
      else{this.mealPreference=/^(全部餐品|全部|菜单|所有餐品)$/.test(text)?'':text;return this.send({type:'menu-search',value:this.mealPreference});}
    }
    this.focusId='row-'+row.index;this.decorate();return this.activateFocused(false);
  },
  async selectStoreVoice(text){
    const match=text.match(/^(?:请)?(?:选择|选|去|打开)?第?([零一二两三四五六七八九十百\d]+)(?:家门店|家餐厅|家|门店|餐厅|个|项|号)?$/);
    let row;
    if(match){row=this.data.rows[spokenNumber(match[1])-1];if(!row||row.disabled){this.showNotice('请选择列表中可用门店的序号');return;}}
    else{
      const normalize=v=>String(v).replace(/[\s，。！？、（）()]/g,'');
      const value=normalize(text.replace(/^(?:请)?(?:选择|选|去|打开)/,''));
      const rows=this.data.rows.filter(r=>!r.disabled&&(normalize(r.title)===value||value.length>=3&&normalize(r.title).includes(value)));
      if(rows.length!==1){this.showNotice(rows.length>1?'有多家同名门店，请按序号选择':'未找到可用门店，请按序号选择');return;}
      row=rows[0];
    }
    this.focusId='row-'+row.index;this.decorate();return this.activateFocused(false);
  },
  async selectOrderVoice(text){
    const match=text.match(/^(?:请)?(?:选择|选|查看|打开)?第?([零一二两三四五六七八九十百\d]+)(?:笔订单|个订单|订单|单|个|项|号)?$/);
    let row;
    if(match){row=this.data.rows[spokenNumber(match[1])-1];if(!row||row.disabled){this.showNotice('没有这个序号，请按订单编号选择');return;}}
    else{
      const normalize=v=>String(v).replace(/[\s，。！？、（）()]/g,'');
      const value=normalize(text.replace(/^(?:请)?(?:选择|选|查看|打开)/,''));
      const rows=this.data.rows.filter(r=>!r.disabled&&(normalize(r.title)===value||value.length>=3&&normalize(r.title).includes(value)));
      if(rows.length!==1){this.showNotice(rows.length>1?'该门店有多笔订单，请按序号选择':'未找到这笔订单，请按序号选择');return;}
      row=rows[0];
    }
    this.focusId='row-'+row.index;this.decorate();return this.activateFocused(false);
  },
  async selectCouponVoice(text){
    const match=text.match(/^(?:请)?(?:选择|选|使用)?第?([零一二两三四五六七八九十百\d]+)(?:张(?:优惠)?券|个|项|号|张)?$/);
    let row;
    if(match){row=this.data.rows[spokenNumber(match[1])-1];if(!row||row.disabled){this.showNotice('没有这个序号，请按列表编号选择。');return;}}
    else {
      const normalize=v=>String(v).replace(/[\s，。！？、（）()]/g,'');
      const value=normalize(text.replace(/^(?:请)?(?:选择|选|使用)/,''));
      const rows=this.data.rows.filter(r=>!r.disabled&&(normalize(r.title)===value||value.length>=3&&normalize(r.title).includes(value)));
      if(rows.length!==1){this.showNotice(rows.length>1?'有多张同名优惠券，请说列表序号。':'未找到这张券，可说“选第一张券”。');return;}
      row=rows[0];
    }
    this.focusId='row-'+row.index;this.decorate();return this.activateFocused(false);
  },
  async understand(raw) {
    const text=String(raw||'').trim().replace(/[。！？]$/,'');if(!text||this.data.busy)return;
    if(/^(确认|确认下单|确认保存|确认领取|确认取消|确认取消订单|提交|保存地址|领券)$/.test(text)){this.showNotice('核对后请按确认键提交。');return;}
    if(/^(返回|取消)$/.test(text))return this.performBusinessBack(false);
    if(/^(上一项|下一项)$/.test(text)){this.moveFocus(text==='上一项'?-1:1);return;}
    if(/^(上一页|下一页)$/.test(text)){const delta=text==='上一页'?-1:1;if(this.data.voiceDraft&&this.data.ui.draftPages>1)this.advanceDraft(delta);else if(this.data.view.screen==='review'&&this.data.ui.receiptMaxScroll>0)this.advanceReceipt(delta);else if(this.data.view.screen==='coupon-confirm'&&this.data.ui.couponPages>1)this.advanceCoupon(delta);else if(this.data.ui.descriptionPages>1)this.advanceDescription(delta);return;}
    if(/^(领取优惠|查看可领取优惠)$/.test(text)){return this.send({type:'available'});return;}
    if(/^(打开设置|连接设置)$/.test(text)){this.openSettings();return;}
    if(/^(重新连接|连接麦当劳)$/.test(text)){return this.connect();return;}
    if(/^(使用这条内容|使用识别内容)$/.test(text)){return this.acceptInput();return;}
    if(/^(重新录入|重新说|重新说需求|语音输入)$/.test(text)){this.listen();return;}
    if(['wallet','coupon-select'].includes(this.data.view.screen)&&!['上一项','下一项','上一页','下一页','打开设置','重新连接','领取优惠','查看可领取优惠'].includes(text))return this.selectCouponVoice(text);
    if(text==='跳过此项'&&this.data.view.presentation?.orderProgress)return this.send({type:'skip-order-item'});
    if(this.data.view.screen==='cart-change-confirm'){if(/^(保留原购物车|保留购物车|不切换)$/.test(text))return this.send({type:'keep-cart'});this.showNotice('切换会清空购物车，请按确认键继续');return;}
    if(!this.data.settings&&['meal','customize'].includes(this.data.view.screen))return this.selectMealOptionVoice(text);
    if(!this.data.settings&&text==='取消订单'&&['payment','order-status'].includes(this.data.view.screen))return this.send({type:'begin-cancel'});
    if(!this.data.settings&&['cancel-reasons','cancel-confirm'].includes(this.data.view.screen)){
      if(/^(保留订单|不取消|不要取消)$/.test(text))return this.send({type:'keep-order'});
      if(this.data.view.screen==='cancel-reasons'){
        const match=text.match(/^(?:选择|选)?第([零一二两三四五六七八九十\d]+)(?:个|项|个原因)?$/);
        const name=text.replace(/^(?:选择|选)/,'');
        const found=match?[this.data.rows[spokenNumber(match[1])-1]].filter(Boolean):this.data.rows.filter(r=>r.title===name);
        if(found.length===1)return this.send(found[0].event);
        this.showNotice('请说取消原因名称或序号');return;
      }
      this.showNotice('取消订单须按确认键，或说保留订单');return;
    }
    if(!this.data.settings&&this.data.view.screen==='review'){
      if(/^(需要餐具|要餐具|不需要餐具|不要餐具)$/.test(text))return this.send({type:'review-tableware',value:!/^不/.test(text)});
      if(/^(打包|打包带走|堂食)$/.test(text)){
        const wanted=text==='堂食'?'堂食':'打包带走';
        const found=(this.data.view.presentation.takeWays||[]).filter(x=>{const value=String(x.title||x.name||x.desc||x.code||'').toLowerCase();return wanted==='堂食'?/堂食|店内用餐|^eat-in$|^dine-in$/.test(value):/打包|带走|外带|^take-away$|^takeaway$|^take-in-store$/.test(value);});
        if(found.length!==1){this.showNotice('当前取餐方式不可用或无法确定');return;}return this.send({type:'take-way',id:String(found[0].code)});
      }
      if(text==='立即安排')return this.send({type:'immediate'});
      if(/^(预约时间|修改预约时间)$/.test(text))return this.send({type:'reservation'});
      if(text==='修改订单')return this.send({type:'cart'});
      this.showNotice('可说需要餐具或修改订单；下单请按确认键');return;
    }
    if(!this.data.settings&&this.data.view.screen==='cart')return this.selectCartVoice(text);
    if(this.data.view.screen==='orders')return this.selectOrderVoice(text);
    if(this.data.view.screen==='stores')return this.selectStoreVoice(text);
    if(this.data.view.screen==='menu'&&text==='换一批')return this.send({type:'menu-batch'});
    if(this.data.view.screen==='menu'&&!/^(查看优惠券|历史订单)$/.test(text))return this.selectMenuVoice(text);
    const number=text.match(/^(?:选择)?第([零一二两三四五六七八九十\d]+)(?:个|项)$/);
    if(number){const n=spokenNumber(number[1]);
      const r=this.data.rows[n-1];if(r&&!r.disabled){this.focusId='row-'+r.index;this.decorate();return this.activateFocused(false);}return;}
    if(this.data.settings){this.showNotice('可说重新连接或返回。');return;}
    if(/^(增加数量|减少数量)$/.test(text)){
      const delta=text==='增加数量'?1:-1;
      if(this.data.view.screen==='quantity-editor')return this.changeQuantity(delta);
      if(this.data.view.screen==='meal')return this.send({type:'quantity',value:Math.max(1,Math.min(20,this.data.ui.quantity+delta))});
      const focus=(this.controls||[]).find(c=>c.id===this.focusId),r=focus&&this.data.rows[focus.rowIndex];
      if(this.data.view.screen==='cart'&&r)return this.send({type:'line-quantity',id:r.id,value:Math.max(0,Math.min(20,(r.quantity||1)+delta))});
      this.showNotice('请先选择要调整的餐品。');return;
    }
    if(this.data.view.presentation?.locationFallback&&!/^(开始点餐|到店自取|麦乐送|查看优惠券|历史订单)$/.test(text)){
      let value=text.replace(/^(?:我在|位置是|我现在在)/,'').trim().replace(/^(.+?(?:市|自治州|地区))(.+)$/,'$1 $2');
      if(!/[ ,，]/.test(value)){
        const city=this.locationCity||this.deviceStore.get(this.data.view.id)?.city;
        if(!city){this.showNotice('请说城市和位置，例如杭州市良睦路。');return;}
        value=city+' '+value;
      }
      return this.send({type:'search-stores',value});
    }
    if(this.data.view.input){this.setData({voiceDraft:text,draftPage:0,message:'请核对识别内容；确认键使用，语音入口可重录。'});this.focusId='input-accept';this.decorate();return;}
    if(this.data.view.screen==='home'&&/^(打开购物车|查看购物车|我的购物车)$/.test(text))return this.send({type:'cart'});
    if(this.data.view.screen==='home'){
      try{const intent=this.service.parseOrder(text);if(intent){this.mealPreference='';return this.send({type:'start-order-intent',value:text});}}
      catch(e){this.showNotice(e.message);return;}
    }
    const direct={'开始点餐':{type:'start'},'到店自取':{type:'fulfillment',value:'pickup'},'麦乐送':{type:'fulfillment',value:'delivery'}};
    if(direct[text]){if(text==='开始点餐')this.mealPreference='';return this.send(direct[text]);}
    const state=this.data.view,generation=this.generation;this.beginLoading({busy:true,message:'正在理解需求'});let intent;
    try{
      if((await LanguageModel.availability())!=='available')throw new Error('unavailable');
      this.model=await LanguageModel.create({initialPrompts:[{role:'system',content:'你是点餐意图分类器。只返回 JSON，格式 {"intent":"start|back|wallet|orders|nutrition|account|campaign|select|unknown","index":1}。select 只能选择当前列表中的序号。不得生成确认、下单、地址、领券或任意网络调用。当前选项：'+state.rows.map((r,i)=>(i+1)+':'+r.title).join('；')}]});
      const result=await this.model.prompt(text);intent=JSON.parse(result.replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''));
    }catch(e){const index=state.rows.findIndex(r=>text.includes(r.title));intent=index>=0?{intent:'select',index:index+1}:/点餐|想吃/.test(text)?{intent:'start'}:/优惠券/.test(text)?{intent:'wallet'}:/订单/.test(text)?{intent:'orders'}:/热量|营养/.test(text)?{intent:'nutrition'}:/积分/.test(text)?{intent:'account'}:/活动/.test(text)?{intent:'campaign'}:{intent:'unknown'};}
    finally{if(this.model){this.model.destroy();this.model=null;}if(this.visible&&generation===this.generation)this.setData({busy:false,orderLoading:false,walletLoading:false,locationLoading:false});}
    if(!this.visible||generation!==this.generation)return;
    if(['start','back'].includes(intent.intent))return this.send({type:intent.intent});
    if(['wallet','orders','nutrition','account','campaign'].includes(intent.intent))return this.send({type:'query',value:intent.intent});
    const r=intent.intent==='select'&&Number.isInteger(intent.index)?this.data.rows[intent.index-1]:null;
    if(r&&!r.disabled){this.focusId='row-'+r.index;this.decorate();return this.activateFocused(false);}
    this.showNotice(this.data.ui.home?'可说“乐奇”再试，或按键选择':'没有理解；可按键选择或重新说。');
  },
  async startVoiceOrder(event){
    if(this.data.busy||this.navigationPending)return;
    this.stopStoreDistances(true);
    const generation=this.generation;
    this.beginLoading({busy:true,locationLoading:true,message:'正在准备点餐'});
    try{
      const state=await this.request('/sessions/'+this.data.view.id+'/events','POST',{...event,revision:this.data.view.revision});
      if(!this.visible||generation!==this.generation)return;
      if(state.screen==='location'&&!state.presentation?.queryError){
        // Do not publish an intermediate fulfillment/location view during pickup.
        this.setData({view:{...this.data.view,id:state.id,revision:state.revision},busy:false});
        return this.locate();
      }
      this.setData({busy:false,locationLoading:false});this.render(state);if(state.presentation?.queryError)this.showNotice(state.presentation.queryError);
    }catch(e){if(this.visible&&generation===this.generation){this.setData({busy:false,locationLoading:false});this.showNotice(e.message);}}
  },
  async startPickup(){
    if(this.data.busy)return;
    this.stopStoreDistances(true);
    const generation=this.generation;
    this.beginLoading({busy:true,locationLoading:true,message:'正在获取当前位置'});
    try{
      const state=await this.request('/sessions/'+this.data.view.id+'/events','POST',{type:'fulfillment',value:'pickup',revision:this.data.view.revision});
      if(!this.visible||generation!==this.generation)return;
      if(state.screen!=='location'||state.presentation?.queryError){this.setData({busy:false,locationLoading:false});this.render(state);if(state.presentation?.queryError)this.showNotice(state.presentation.queryError);return;}
      // Keep the existing fulfillment cards; only the revision changes internally.
      this.setData({view:{...this.data.view,id:state.id,revision:state.revision},busy:false});
      return this.locate();
    }catch(e){if(this.visible&&generation===this.generation)this.setData({busy:false,locationLoading:false,message:e.message});}
  },
  stopStoreDistances(clearOrigin=false){
    this.storeLookupGeneration=(this.storeLookupGeneration||0)+1;
    if(this.storeLookup){this.storeLookup.abort();this.storeLookup=null;}
    if(clearOrigin){this.locationOrigin=null;this.storeDistances={};this.storeDistanceSession=null;}
  },
  locationFailed(message){
    this.setData({busy:false,locationLoading:false});
    if(this.service){try{const state=this.service.state(this.data.view.id);if(state.screen==='location')this.render(state);}catch(e){}}
    this.showNotice(message+'确认键重试，上键可语音提供城市和位置。');
  },
  clearLocationRequest() {
    this.locationGeneration=(this.locationGeneration||0)+1;
    if(this.locationLookup){this.locationLookup.abort();this.locationLookup=null;}
    if(this.locationTimer){clearTimeout(this.locationTimer);this.locationTimer=null;}
  },
  warmPickupPosition() {
    if(typeof navigator==='undefined'||!navigator.geolocation?.getCurrentPosition)return null;
    const previous=this.pickupPositionWarmup;
    if(previous&&!previous.consumed&&Date.now()-previous.startedAt<12000)return previous;
    const sample={startedAt:Date.now(),promise:null};
    sample.promise=new Promise(resolve=>{
      let settled=false;
      const finish=value=>{if(settled)return;settled=true;clearTimeout(timer);resolve(value);};
      const timer=setTimeout(()=>finish({error:{code:3}}),12000);
      sample.cancel=()=>finish({error:{code:3}});
      try{navigator.geolocation.getCurrentPosition(position=>finish({position}),error=>finish({error}),{enableHighAccuracy:true,timeout:10000,maximumAge:15000});}
      catch(e){finish({error:{code:'unsupported'}});}
    });
    this.pickupPositionWarmup=sample;
    return sample;
  },
  async searchPickupLocation(location,generation,timing) {
    this.locationCity=location.city;
    this.setData({busy:false,message:''});
    this.locatingSearch=true;
    try{await this.send({type:'search-stores',value:location.city+' '+location.keyword});}
    finally{this.locatingSearch=false;if(this.visible&&generation===this.generation){this.setData({locationLoading:false});timing('stores');}}
  },
  locate() {
    if(this.data.busy)return;
    this.clearLocationRequest();
    const ticket=this.locationGeneration,generation=this.generation,startedAt=Date.now();
    const timing=stage=>console.info('[mcd-pickup-timing] '+JSON.stringify({stage,elapsedMilliseconds:Date.now()-startedAt}));
    const active=()=>this.visible&&generation===this.generation&&ticket===this.locationGeneration;
    const fail=(code)=>{
      if(!active())return;
      this.clearLocationRequest();
      const reason={1:'定位权限未获授权，请检查眼镜位置权限。',2:'暂时无法获取位置，请检查眼镜或配对手机的定位。',3:'获取位置超时，请到信号较好的位置重试。',unsupported:'当前运行时未提供定位能力。',invalid:'定位返回的经纬度无效。'}[code]||'定位失败，请稍后重试。';
      this.locationFailed(reason);
    };
    try {
      if(typeof navigator==='undefined'||!navigator.geolocation||typeof navigator.geolocation.getCurrentPosition!=='function'){fail('unsupported');return;}
      this.beginLoading({busy:true,locationLoading:this.data.view.screen==='fulfillment',message:'正在获取经纬度'});
      const recent=this.resolvedLocationCache;
      if(recent&&Date.now()-recent.positionAt>=0&&Date.now()-recent.positionAt<=15000){
        timing('recent-location');
        this.searchPickupLocation(recent.location,generation,timing).catch(e=>{if(active())this.locationFailed(e.message);});
        return;
      }
      // Some native providers do not honor their timeout; keep the Page cancellable.
      this.locationTimer=setTimeout(()=>fail(3),12000);
      const onPosition=async position=>{
        if(!active())return;
        const longitude=position?.coords?.longitude,latitude=position?.coords?.latitude;
        if(!Number.isFinite(longitude)||!Number.isFinite(latitude)||Math.abs(longitude)>180||Math.abs(latitude)>90){fail('invalid');return;}
        if(this.locationTimer){clearTimeout(this.locationTimer);this.locationTimer=null;}
        timing('position');
        const accuracy=position?.coords?.accuracy,age=Date.now()-position?.timestamp;
        this.locationQuality={accuracyMeters:Number.isFinite(accuracy)?accuracy:null,ageMilliseconds:Number.isFinite(age)?Math.max(0,age):null};
        this.locationDistanceTrusted=Number.isFinite(accuracy)&&accuracy>=0&&accuracy<=100&&Number.isFinite(age)&&age>=-5000&&age<=60000;
        console.info('[mcd-location-quality] '+JSON.stringify({...this.locationQuality,distanceEligible:this.locationDistanceTrusted}));
        try {
          const cached=this.resolvedLocationCache;
          const reuse=this.locationDistanceTrusted&&cached&&Date.now()-cached.at>=0&&Date.now()-cached.at<=60000&&Math.abs(cached.longitude-longitude)<=0.0001&&Math.abs(cached.latitude-latitude)<=0.0001;
          let location;
          if(reuse){location=cached.location;timing('address-cache');}
          else{
            this.showNotice('正在解析当前位置');
            const lookup=resolveLocation(wx,AMAP_WEB_KEY,longitude,latitude);
            this.locationLookup=lookup;
            location=await lookup.promise;
            if(!active())return;
            this.locationLookup=null;
            if(this.locationDistanceTrusted)this.resolvedLocationCache={at:Date.now(),positionAt:position.timestamp,longitude,latitude,location};
            timing('address');
          }
          if(!active())return;
          this.clearLocationRequest();
          await this.searchPickupLocation(location,generation,timing);
        }catch(e){if(active()){this.clearLocationRequest();this.locationFailed(e.message||'位置解析失败。');}}
      };
      const warm=this.pickupPositionWarmup;
      const reusable=warm&&!warm.consumed&&Date.now()-warm.startedAt>=0&&Date.now()-warm.startedAt<12000;
      if(reusable){warm.consumed=true;warm.promise.then(result=>{if(active()){if(result.position)onPosition(result.position);else fail(result.error?.code);}});}
      else navigator.geolocation.getCurrentPosition(onPosition,error=>fail(error?.code),{enableHighAccuracy:true,timeout:10000,maximumAge:15000});
    }catch(e){fail('unsupported');}
  },

};
</script>
<page>
 <view class="{{settings || view.screen === 'menu' || view.screen === 'stores' || view.screen === 'orders' || view.screen === 'order-detail' || view.screen === 'cart' ? 'screen top-screen' : view.screen === 'review' ? 'screen review-screen' : 'screen'}}">
  <view ink:if="{{settings}}" class="header"><text class="title">麦当劳连接设置</text></view>
  <view ink:elif="{{ui.home || busy && (walletLoading || locationLoading)}}" class="{{controlId === 'home-settings' ? 'home-brand key-focused' : 'home-brand'}}"><image class="brand" src="/assets/brand/golden-arches.svg" mode="aspectFit"/><text class="brand-name">麦当劳</text></view>
  <view ink:elif="{{!ui.noHeader && !(busy && (walletLoading || locationLoading))}}" class="header"><text class="title">{{ui.title}}</text><button ink:if="{{view.presentation.locationFallback}}" id="location-voice" class="{{controlId === 'location-voice' ? 'location-mic key-focused' : 'location-mic'}}"><image class="button-icon" src="/assets/icons/mic-idle.svg"/></button><view class="{{view.screen === 'order-detail' ? 'aside order-detail-status' : ui.asideIcon && ui.fulfillment !== 'delivery' && view.screen !== 'addresses' ? 'aside fulfillment-aside' : 'aside'}}"><image ink:if="{{ui.asideIcon}}" class="aside-icon" src="{{ui.asideIcon}}"/><text>{{view.screen === 'order-detail' ? ui.order.status : ui.aside}}</text></view></view>
  <view ink:if="{{!settings && !busy && view.screen === 'fulfillment'}}" class="inline-listen"><view ink:if="{{inlineListening && listening}}" class="inline-wave"><view ink:for="{{voiceBars}}" ink:key="index" class="voice-bar" style="height: {{item.height}}px"/></view><text>{{inlineListening && listening ? '可说到店自取或麦乐送' : (message || '说“乐奇”，可选到店自取或麦乐送')}}</text></view>
  <view ink:if="{{!settings && (!busy || orderLoading) && (view.screen === 'wallet' || view.screen === 'coupon-select' || view.screen === 'orders' || view.screen === 'stores' || view.screen === 'menu' || view.screen === 'cart' || view.screen === 'review')}}" class="coupon-voice-row"><view ink:if="{{listening && inlineListening}}" class="inline-wave"><view ink:for="{{voiceBars}}" ink:key="index" class="voice-bar" style="height: {{item.height}}px"/></view><text class="coupon-voice-label">{{listening && inlineListening ? (view.screen === 'review' ? '可说需要餐具、打包或修改订单' : view.screen === 'cart' ? (view.presentation.cartNotice || (rows.length ? '可说继续加餐或删除第一项' : '正在聆听，可说继续加餐')) : view.screen === 'menu' ? (ui.menuEmpty ? '正在聆听，说想吃的餐品' : '正在聆听，说“选第一份”') : view.screen === 'stores' ? '正在聆听，说“选第一家”' : view.screen === 'orders' ? '正在聆听，说“选第一单”' : '正在聆听，说“选第一张券”') : (message ? (view.screen === 'menu' ? (message.length > 22 ? message.slice(0,21) + '…' : message) : message.indexOf('未找到这张券') === 0 ? '未找到这张券，请按序号选择' : message) : (view.screen === 'review' ? (view.presentation.queryError || '说“乐奇”，可修改餐具与取餐方式') : view.screen === 'cart' ? ui.cartHint : view.screen === 'menu' ? ui.menuHint : view.screen === 'stores' || view.screen === 'orders' ? '说“乐奇”，按序号或门店选择' : '说“乐奇”，按序号或券名选择'))}}</text></view>
  <scroll-view ink:if="{{settings}}" class="content setup" scroll-y="true" scroll-top="{{listScroll}}">
   <text class="copy">内置凭证 · 眼镜直接连接麦当劳</text><text class="hint">上下键选择，确认键执行，返回键返回</text>
   <text class="hint">{{busy ? message : connectionLabel}}</text>
   <button id="setting-connect" class="{{controlId === 'setting-connect' ? 'action primary focused' : 'action primary'}}">重新连接并检测授权</button>
  </scroll-view>
  <view ink:if="{{!settings && ((busy && !orderLoading) || (listening && !inlineListening))}}" class="center content"><view class="status-circle"><view ink:if="{{listening}}" class="voice-wave"><view ink:for="{{voiceBars}}" ink:key="index" class="voice-bar" style="height: {{item.height}}px"/></view><view ink:else class="loading-ring"><view ink:for="{{loadingDots}}" ink:key="index" class="loading-dot" style="left: {{item.left}}px; top: {{item.top}}px; opacity: {{item.opacity}}"/></view></view><text class="central-title">{{listening ? '想吃什么，直接告诉我' : walletLoading || locationLoading ? '正在处理' : message}}</text><text class="muted">{{listening ? '说完后，我会帮你确认' : '请稍候，无需重复操作'}}</text><button ink:if="{{listening}}" class="action primary">确认键结束录音</button></view>
  <view ink:if="{{!settings && !busy && !listening && ui.home}}" class="home-space content"><text class="home-title">今天，想吃点什么？</text><view ink:if="{{message && !walletLoading}}" class="home-notice"><text class="home-notice-line">{{homeNoticeText}}</text></view><text ink:else class="home-prompt">{{walletLoading ? message : '“来份板烧鸡腿堡套餐”'}}</text></view>
  <view ink:if="{{!settings && !busy && !listening && ui.central && !ui.special}}" style="height: {{ui.centralHeight}}px" class="{{view.screen === 'error' ? 'content center central-shell error-layout' : view.screen === 'claim-result' ? 'content center central-shell result-layout' : view.input ? 'content center central-shell voice-shell' : view.screen === 'address-entry' ? 'content center central-shell address-entry-shell' : 'content center central-shell'}}">
   <view class="{{ui.tight ? 'center central-content compact-center' : 'center central-content'}}"><view ink:if="{{!voiceDraft}}" class="{{ui.plainStatus ? 'plain-status' : 'status-circle' + ui.tone}}"><image class="status-image" src="{{ui.status}}" mode="aspectFit"/></view><text ink:if="{{!voiceDraft}}" class="central-title">{{ui.heading}}</text><text ink:if="{{ui.value}}" class="status-value">{{ui.value}}</text><text ink:for="{{ui.descriptionLines}}" ink:key="*this" class="muted center-copy">{{item}}</text><text ink:if="{{ui.descriptionPages > 1}}" id="description-page" class="{{controlId === 'description-page' ? 'hint receipt-focus' : 'hint'}}">{{ui.descriptionStep}}</text>
   <view ink:if="{{view.input}}" class="voice-entry"><text ink:if="{{view.screen !== 'address-entry'}}" class="muted">{{view.input.placeholder}} · 语音填写</text><text ink:if="{{voiceDraft}}" class="voice-draft">{{ui.draftText}}</text><text ink:if="{{voiceDraft && ui.draftPages > 1}}" id="input-page" class="{{controlId === 'input-page' ? 'hint receipt-focus' : 'hint'}}">{{ui.draftStep}}</text><view class="voice-actions"><button id="input-listen" class="{{controlId === 'input-listen' ? 'action focused' : 'action'}}">{{voiceDraft ? '重新录入' : '语音填写'}}</button><button ink:if="{{voiceDraft}}" id="input-accept" class="{{controlId === 'input-accept' ? 'action focused' : 'action'}}">使用这条内容</button></view></view>
   <button ink:for="{{rows}}" ink:key="id" id="{{item.domId}}" class="{{item.cls}}" data-index="{{item.index}}"><text class="row-title">{{item.selected ? '✓ ' : ''}}{{item.title}}</text></button>
   <text ink:if="{{view.total}}" class="status-value">{{view.total}}</text></view>
  </view>
  <view ink:if="{{!settings && !busy && !listening && ui.special}}" class="{{view.screen === 'order-status' ? 'content special-center order-status-center' : 'content special-center'}}" style="height: {{ui.centralHeight}}px">
   <view ink:if="{{view.screen === 'coupon-confirm' || view.screen === 'claim-confirm'}}" class="coupon-layout"><image class="coupon-large" src="/assets/brand/coupon-hover.svg"/><text class="central-title">{{ui.heading}}</text><view ink:if="{{view.screen === 'coupon-confirm'}}" class="price-comparison"><text ink:if="{{ui.originalAmount}}" class="muted">原应付</text><view ink:if="{{ui.originalAmount}}" class="strike-wrap"><text class="muted">{{ui.originalAmount}}</text><view class="strike-line"/></view><text class="status-value">{{view.total}}</text></view><text ink:if="{{view.screen === 'coupon-confirm'}}" class="muted">{{ui.savings ? '本次节省 ' + ui.savings : ''}}</text><text ink:if="{{view.screen === 'coupon-confirm' && ui.couponPageLines.length}}" ink:for="{{ui.couponPageLines}}" ink:key="*this" class="muted coupon-detail">{{item}}</text><text ink:if="{{view.screen === 'coupon-confirm' && ui.couponPages > 1}}" id="coupon-page" class="{{controlId === 'coupon-page' ? 'hint receipt-focus' : 'hint'}}">{{ui.couponStep}}</text><text ink:if="{{view.screen === 'claim-confirm'}}" class="muted">{{ui.description}}</text></view>
   <view ink:elif="{{view.screen === 'cancel-confirm' || view.screen === 'cart-change-confirm'}}" class="address-layout cancel-layout"><text ink:for="{{ui.descriptionLines}}" ink:key="*this" class="muted">{{item}}</text><text ink:if="{{ui.descriptionPages > 1}}" id="description-page" class="hint">{{ui.descriptionStep}}</text></view>
   <view ink:elif="{{view.screen === 'address-confirm'}}" class="address-layout"><view class="status-inline"><image class="address-pin" src="/assets/icons/pin.svg"/><text class="row-title">{{ui.address}}</text></view><text ink:if="{{ui.contact}}" class="muted">{{ui.contact}}</text><text ink:for="{{ui.descriptionLines}}" ink:key="*this" class="muted">{{item}}</text><text ink:if="{{ui.descriptionPages > 1}}" id="description-page" class="{{controlId === 'description-page' ? 'hint receipt-focus' : 'hint'}}">{{ui.descriptionStep}}</text></view>
   <view ink:else class="payment-layout"><view class="status-inline"><view class="{{'status-circle' + ui.tone}}"><image class="status-image" src="{{ui.status}}"/></view><text ink:if="{{view.screen === 'payment'}}" class="central-title">{{ui.heading}}</text><view ink:else class="status-copy"><text ink:if="{{ui.statusLabel}}" class="muted">{{ui.statusLabel}}</text><text class="order-value">{{ui.statusNumber}}</text></view></view><text ink:if="{{view.screen === 'payment'}}" class="status-value">{{ui.value}}</text><view ink:if="{{view.screen === 'order-status' && ui.store}}" class="status-inline"><image class="small-icon" src="/assets/icons/pin.svg"/><text class="receipt-title order-store-name">{{ui.store}}</text></view><text ink:if="{{view.screen === 'order-status' && ui.orderNumber}}" class="muted order-number">{{ui.orderNumber}}</text><text ink:for="{{ui.descriptionLines}}" ink:key="*this" class="muted">{{item}}</text><text ink:if="{{ui.descriptionPages > 1}}" id="description-page" class="hint">{{ui.descriptionStep}}</text></view>
  </view>
  <view ink:if="{{!settings && !busy && !listening && view.screen === 'coupon-detail'}}" class="coupon-detail-layout">
   <view class="status-inline"><image class="coupon-detail-icon" src="/assets/brand/coupon-hover.svg"/><text class="title">{{ui.coupon.title}}</text></view>
   <text ink:if="{{ui.coupon.price}}" class="total">用券价 {{ui.coupon.price}}</text>
   <view class="coupon-info"><view ink:for="{{ui.couponInfo}}" ink:key="value" class="detail-line"><text ink:if="{{item.label}}" class="muted">{{item.label}}</text><text class="coupon-info-value">{{item.value}}</text></view><text ink:if="{{ui.descriptionPages > 1}}" id="description-page" class="hint">{{ui.descriptionStep}}</text></view>
  </view>
  <button ink:if="{{!settings && !busy && !listening && view.screen === 'coupon-detail'}}" id="coupon-apply" class="coupon-apply {{controlId === 'coupon-apply' ? 'action primary focused' : 'action primary'}}">去点餐使用<image class="button-icon" src="/assets/icons/chevron.svg"/></button>
  <view ink:if="{{!settings && view.screen === 'quantity-editor'}}" class="quantity-editor">
   <view class="meal-hero"><image class="food" src="{{view.hero}}"/><text class="row-title">{{ui.heading}}</text></view>
   <view class="stepper"><text class="row-title">数量</text><button id="quantity-minus" disabled="{{ui.quantity <= 0}}" class="{{controlId === 'quantity-minus' ? 'step-button focused' : 'step-button'}}">−</button><text class="quantity-value">{{ui.quantityLabel}}</text><button id="quantity-plus" disabled="{{ui.quantity >= 20}}" class="{{controlId === 'quantity-plus' ? 'step-button focused' : 'step-button'}}">＋</button></view>
   <text class="muted">{{view.summary}}</text><text class="muted">减至 0 份将移除餐品</text>
   <view class="footer"><button id="quantity-delete" class="{{controlId === 'quantity-delete' ? 'action focused' : 'action'}}">删除商品</button><button id="quantity-done" class="{{controlId === 'quantity-done' ? 'action primary focused' : 'action primary'}}">完成修改</button></view>
  </view>
  <view ink:if="{{!settings && view.screen === 'order-detail'}}" class="order-detail-layout">
   <view class="detail-card order-summary"><view class="order-store"><image class="small-icon" src="/assets/icons/bag.svg"/><text class="row-title">{{ui.order.store}}</text></view><view class="detail-line"><text class="muted">下单时间 {{ui.order.time}}</text><text class="price">{{ui.order.amount}}</text></view></view>
   <view class="detail-card"><text class="row-title">餐品明细</text><view ink:for="{{ui.orderItems}}" ink:key="name" class="detail-line"><text class="order-item-name">{{item.name}}</text><text ink:if="{{item.quantity !== null}}" class="order-item-quantity">×{{item.quantity}}</text></view><text ink:if="{{ui.descriptionPages > 1}}" id="description-page" class="hint">{{ui.descriptionStep}}</text></view>
   <view class="detail-card order-number"><text class="muted">订单号</text><text class="muted">{{ui.order.id}}</text></view>
  </view>
  <view ink:if="{{!settings && !busy && (view.screen === 'meal' || view.screen === 'customize')}}" class="coupon-voice-row"><view ink:if="{{listening && inlineListening}}" class="inline-wave"><view ink:for="{{voiceBars}}" ink:key="index" class="voice-bar" style="height: {{item.height}}px"/></view><text class="coupon-voice-label">{{message || (listening && inlineListening ? (view.screen === 'meal' ? '可说“两份”或“选饮料与口味”' : '可说选项名称或“加入购物车”') : '说“乐奇”，调整数量或选择口味')}}</text></view>
  <scroll-view ink:if="{{!settings && !busy && (!listening || inlineListening) && view.screen === 'meal'}}" class="content inset-content" style="height: 147px" scroll-y="true" scroll-top="{{listScroll}}">
   <view class="meal-hero"><image class="meal-image" src="{{view.hero || '/assets/icons/bag.svg'}}" mode="aspectFit"/><text class="meal-name">{{view.summary}}</text><text class="price">{{ui.mealPrice}}</text></view>
   <view class="stepper"><text class="row-title">数量</text><button id="row-0" class="{{ui.quantity <= 1 ? 'step-button disabled-step' : ui.minusFocused ? 'step-button key-focused' : 'step-button'}}" disabled="{{ui.quantity <= 1}}">−</button><text class="quantity-value">{{ui.quantityLabel}}</text><button id="row-1" class="{{ui.plusFocused ? 'step-button key-focused' : 'step-button'}}">＋</button></view>
   <text ink:if="{{ui.mealParts}}" class="muted meal-parts">{{ui.mealParts}}</text><button ink:for="{{ui.mealRows}}" ink:key="id" id="{{item.domId}}" class="{{item.cls}}" data-index="{{item.index}}"><view class="row-copy"><text class="row-title">{{item.title}}</text><text class="row-subtitle">{{item.subtitle}}</text></view><image class="chevron" src="/assets/icons/chevron.svg"/></button>
  </scroll-view>
  <scroll-view ink:if="{{!settings && !busy && (!listening || inlineListening) && view.screen === 'review'}}" class="{{ui.address ? 'content receipt delivery-receipt' : 'content receipt'}}" scroll-y="true" scroll-top="{{receiptScroll}}" style="height: {{ui.receiptViewport}}px">
   <view class="receipt-store"><image class="small-icon" src="{{ui.fulfillment === 'delivery' ? '/assets/icons/navigation.svg' : '/assets/icons/store.svg'}}"/><text class="row-title">{{ui.store}}</text></view><text ink:if="{{ui.address}}" class="receipt-address">{{ui.address}}</text>
   <view ink:for="{{ui.receiptItems}}" ink:key="id" class="receipt-line" style="height: {{item.height}}px"><view class="receipt-copy" style="width: {{item.titleWidth}}px"><text class="receipt-title">{{item.title}}</text><text ink:if="{{item.subtitle}}" class="muted">{{item.subtitle}}</text></view><text ink:if="{{item.value}}" class="receipt-title receipt-value" style="width: {{item.valueWidth}}px">{{item.value}}</text></view>
  </scroll-view>
  <scroll-view ink:if="{{!settings && !busy && (!listening || inlineListening) && view.screen === 'customize'}}" class="content inset-content customize-scroll" style="height: 147px" scroll-y="true" scroll-top="{{listScroll}}">
   <view ink:for="{{ui.groups}}" ink:key="name" class="custom-group"><text class="muted">{{item.name}}</text><view class="chips"><button ink:for="{{item.rows}}" ink:key="id" id="{{item.domId}}" class="{{item.cls}}" data-index="{{item.index}}"><text class="chip-title">{{item.title}}</text><image ink:if="{{item.showCheck}}" class="chip-check" src="/assets/icons/check-button.svg"/></button></view></view>
  </scroll-view>
  <scroll-view ink:if="{{!settings && !busy && (!listening || inlineListening) && view.screen === 'cart'}}" class="content cart-list" style="height: {{ui.listHeight}}px" scroll-y="true" scroll-top="{{listScroll}}"><text ink:if="{{!ui.cartRows.length}}" class="summary">购物车还是空的</text>
   <view ink:for="{{ui.cartRows}}" ink:key="id" class="cart-card" style="height: {{item.height}}px"><view class="cart-left"><image class="food" src="{{item.image ? item.icon : '/assets/icons/bag.svg'}}"/><view class="row-copy"><text ink:for="{{item.titleLines}}" ink:for-item="line" ink:key="index" class="row-title">{{line.text}}</text><view class="cart-subtitle"><text ink:for="{{item.addressLines}}" ink:for-item="line" ink:key="index" class="row-subtitle">{{line.text}}</text></view></view></view><view class="cart-right"><text class="price">{{item.price}}</text><text class="muted">×{{item.quantityLabel}}</text><button id="{{item.domId}}" class="{{focusIndex === item.index ? 'edit-quantity action focused' : 'edit-quantity action'}}">修改数量<image class="chevron" src="/assets/icons/chevron.svg"/></button></view></view>
  </scroll-view>
  <scroll-view ink:if="{{!settings && (!busy || orderLoading) && (!listening || inlineListening) && (view.screen === 'wallet' || view.screen === 'coupon-select' || view.screen === 'orders')}}" class="content list asset-scroll" style="height: {{ui.listHeight}}px" scroll-y="true" scroll-top="{{listScroll}}">
   <text ink:if="{{ui.emptyMessage}}" class="summary">{{ui.emptyMessage}}</text>
   <view class="asset-group"><view ink:for="{{ui.assetRows}}" ink:key="renderKey" id="{{item.domId}}" class="{{controlId === item.domId ? 'asset-card focused' : 'asset-card'}}" style="height: {{item.height}}px">
    <image class="asset-icon" src="{{item.icon}}" mode="aspectFit"/><view class="asset-copy"><text ink:for="{{item.titleLines}}" ink:for-item="line" ink:key="index" class="asset-title">{{line.text}}</text><view ink:if="{{item.addressLines.length}}" class="asset-subtitle"><text ink:for="{{item.addressLines}}" ink:for-item="line" ink:key="index" class="asset-meta">{{line.text}}</text></view></view>
   </view></view>
  </scroll-view>
  <view ink:if="{{!settings && !busy && view.screen === 'menu' && ui.menuEmpty}}" class="menu-empty"><text class="row-title">{{ui.menuEmptyText}}</text></view>
  <scroll-view ink:if="{{!settings && !busy && (!listening || inlineListening) && !ui.menuEmpty && !ui.home && !ui.central && view.screen !== 'meal' && view.screen !== 'review' && view.screen !== 'customize' && view.screen !== 'cart' && view.screen !== 'coupon-detail' && view.screen !== 'order-detail' && view.screen !== 'quantity-editor' && view.screen !== 'wallet' && view.screen !== 'coupon-select' && view.screen !== 'orders'}}" class="{{ui.listClass}}" style="height: {{ui.listHeight}}px" scroll-y="true" scroll-top="{{listScroll}}">
   <text ink:if="{{ui.emptyMessage}}" class="summary">{{ui.emptyMessage}}</text>
   <text ink:if="{{ui.showSummary && view.summary}}" class="summary">{{view.summary}}</text>
   <view ink:if="{{view.input}}" class="voice-entry"><text ink:if="{{view.screen !== 'address-entry'}}" class="muted">{{view.input.placeholder}} · 语音填写</text><text ink:if="{{voiceDraft}}" class="voice-draft">{{ui.draftText}}</text><text ink:if="{{voiceDraft && ui.draftPages > 1}}" id="input-page" class="{{controlId === 'input-page' ? 'hint receipt-focus' : 'hint'}}">{{ui.draftStep}}</text><view class="voice-actions"><button id="input-listen" class="{{controlId === 'input-listen' ? 'action focused' : 'action'}}">{{voiceDraft ? '重新录入' : '语音填写'}}</button><button ink:if="{{voiceDraft}}" id="input-accept" class="{{controlId === 'input-accept' ? 'action focused' : 'action'}}">使用这条内容</button></view></view>
    <view style="{{view.screen === 'menu' ? 'height: ' + ui.menuContentHeight + 'px' : ''}}" class="{{ui.largeCompact ? 'compact-group fulfillment-group' : ui.timeCompact ? 'time-group' : ui.compact ? 'compact-group' : view.screen === 'customize' ? 'chips' : 'row-group'}}">
    <view ink:if="{{view.screen === 'stores'}}" class="store-group">
     <view ink:for="{{ui.visibleRows}}" ink:key="renderKey" id="{{item.domId}}" class="{{item.disabled ? 'store-card disabled-store' : controlId === item.domId ? 'store-card focused' : 'store-card'}}" style="height: {{item.height}}px">
      <image class="row-icon" src="/assets/icons/pin-list.svg"/>
      <view class="store-copy"><text ink:for="{{item.titleLines}}" ink:for-item="line" ink:key="index" class="store-title">{{line.text}}</text><view class="store-address"><text ink:for="{{item.addressLines}}" ink:for-item="line" ink:key="index" class="store-address-line">{{line.text}}</text></view><text class="store-status">{{item.statusLine}}</text></view>
      <image class="chevron" src="/assets/icons/chevron.svg"/>
     </view>
    </view>
    <view ink:if="{{view.screen === 'menu'}}" ink:for="{{ui.visibleRows}}" ink:key="renderKey" id="{{item.domId}}" class="{{controlId === item.domId ? 'menu-card focused' : 'menu-card'}}" style="height: {{item.height}}px"><view class="menu-copy" style="width: {{item.titleWidth}}px"><text ink:for="{{item.titleLines}}" ink:for-item="line" ink:key="index" class="menu-title">{{line.text}}</text><text ink:if="{{item.subtitle}}" class="menu-meta">{{item.subtitle}}</text></view><text class="menu-price" style="width: {{item.priceWidth}}px">{{item.price}}</text><image class="chevron" src="/assets/icons/chevron.svg"/></view>
    <button ink:if="{{view.screen !== 'stores' && view.screen !== 'menu'}}" ink:for="{{ui.visibleRows}}" ink:key="renderKey" id="{{item.domId}}" class="{{item.cls}}" style="{{view.screen === 'menu' ? 'height: ' + item.height + 'px' : ''}}" disabled="{{item.disabled}}" data-index="{{item.index}}"><image ink:if="{{item.icon && view.screen !== 'menu'}}" class="{{item.image ? 'food' : 'row-icon'}}" src="{{item.icon}}" mode="aspectFit"/><view class="row-copy"><text ink:if="{{view.screen === 'menu'}}" ink:for="{{item.titleLines}}" ink:for-item="line" ink:key="index" class="row-title">{{line.text}}</text><text ink:else class="row-title">{{item.displayIndexLabel}}{{item.selected ? '✓ ' : ''}}{{item.title}}</text><text ink:if="{{item.subtitle && view.screen !== 'customize'}}" class="row-subtitle">{{view.screen === 'fulfillment' && item.id === 'pickup' && locationLoading ? message : item.subtitle}}</text></view><text ink:if="{{item.price}}" class="price">{{item.price}}</text><image ink:if="{{item.chevron}}" class="chevron" src="/assets/icons/chevron.svg" mode="aspectFit"/></button>
   </view>
  </scroll-view>
  <view ink:if="{{!settings && !busy && (!listening || inlineListening) && view.screen === 'review' && rows.length}}" class="takeways chips"><button ink:for="{{rows}}" ink:key="id" id="{{item.domId}}" class="{{'chip' + (item.selected ? ' selected' : '') + (focusIndex === item.index ? ' focused' : '')}}" data-index="{{item.index}}"><text class="chip-title">{{item.selected ? '✓ ' : ''}}{{item.title}}</text></button></view>
  <view ink:if="{{!settings && !busy && (!listening || inlineListening) && view.screen === 'review'}}" class="review-total"><view class="review-rule"/><view class="total-label"><text class="receipt-title">应付</text><text id="receipt-scroll" class="{{controlId === 'receipt-scroll' ? 'hint receipt-focus' : 'hint'}}">上下滑动查看明细</text></view><text class="total">{{view.total}}</text></view>
  <view ink:if="{{!settings && !busy && !listening && ui.home}}" class="footer"><button class="{{ui.homeStartClass}}" data-index="0"><text>开始点餐</text><image class="button-icon" src="/assets/icons/arrow.svg"/></button><button class="{{ui.homeWalletClass}}" data-index="1"><image class="home-coupon-icon" src="/assets/brand/coupon-hover.svg"/></button><button class="{{ui.homeOrdersClass}}" data-index="2"><image class="button-icon" src="/assets/icons/bag.svg"/></button></view>
  <view ink:if="{{!settings && !busy && (!listening || inlineListening) && !ui.home && (ui.actions.length || (more))}}" class="footer"><button ink:for="{{actions}}" ink:key="label" id="{{'action-' + item.index}}" class="{{item.cls}}" data-index="{{item.index}}"><image ink:if="{{item.icon && !item.iconAfter}}" class="button-icon" src="{{'/assets/icons/' + item.icon + '.svg'}}"/><view ink:if="{{item.iconAfter}}" class="action-label"><text>{{item.label}}</text><image class="button-icon" src="{{'/assets/icons/' + item.icon + '.svg'}}"/></view><text ink:if="{{!item.back && !item.iconAfter}}">{{item.label}}</text></button></view>
  <view ink:if="{{orderLoading}}" class="order-loading"><view class="loading-ring"><view ink:for="{{loadingDots}}" ink:key="index" class="loading-dot" style="left: {{item.left}}px; top: {{item.top}}px; opacity: {{item.opacity}}"/></view><text class="hint">正在读取订单详情</text></view>
  <view ink:if="{{!busy && !listening && message && !ui.home && view.screen !== 'review' && view.screen !== 'wallet' && view.screen !== 'coupon-select' && view.screen !== 'orders' && view.screen !== 'stores' && view.screen !== 'menu' && view.screen !== 'meal' && view.screen !== 'customize' && view.screen !== 'cart' && view.screen !== 'fulfillment' && !view.presentation.locationFallback}}" class="notice-inline"><text class="hint">{{message}}</text></view>
 </view>
</page>
<style>
.order-loading { position: absolute; left: 16px; right: 16px; bottom: 16px; height: 48px; display: flex; flex-direction: row; align-items: center; justify-content: center; gap: 12px; background-color: #171717; border-radius: 12px; }
.loading-ring { width: 42px; height: 42px; position: relative; }
.loading-dot { width: 6px; height: 6px; border-radius: 3px; position: absolute; background-color: #ffcf32; }
.screen { --color-primary: #ffcf32; --color-text-primary: #ffffff; --color-text-secondary: #c1c1c1; --button-background-color: #181818; --button-text-color: #ffffff; --button-border-color: #505050; --button-border-width: 0px; --button-focus-border-color: #ffcf32; --button-focus-background-color: #302d23; --button-focus-text-color: #ffffff; --input-background-color: #171717; --input-border-color: #686868; --input-placeholder-color: #aaaaaa; --font-home-title: 30px; --line-home-title: 38px; --font-home-prompt: 22px; --line-home-prompt: 30px; --font-title: 22px; --line-title: 30px; --font-body: 18px; --line-body: 26px; --font-step: 18px; --line-step: 26px; --font-button: 20px; --line-button: 28px; --font-quantity: 22px; --line-quantity: 30px; --font-price: 24px; --line-price: 32px; --font-total: 30px; --line-total: 38px; width: 100%; height: 100%; padding: 16px; box-sizing: border-box; display: flex; flex-direction: column; justify-content: flex-end; gap: 12px; background-color: #000000; color: #ffffff; font-weight: 500; font-family: "Noto Sans SC"; }
.header { position: relative; display: flex; flex-direction: row; align-items: center; justify-content: center; height: 32px; flex-shrink: 0; width: 100%; }
.title { font-size: var(--font-title); line-height: var(--line-title); font-weight: 700; text-align: center; }
.aside { position: absolute; transform: translateX(174px); display: flex; flex-direction: row; align-items: center; gap: 5px; font-size: var(--font-step); line-height: var(--line-step); color: #d0d0d0; }
.aside-icon { width: 20px; height: 20px; }
.demo-dot { position: absolute; transform: translateX(-198px); font-size: 12px; line-height: 16px; color: #988655; }
.home-brand { height: 24px; display: flex; flex-direction: row; justify-content: center; align-items: center; gap: 10px; }
.brand { width: 24px; height: 24px; }
.brand-name { font-size: 18px; color: #dddddd; }
.mode-label { font-size: 12px; color: #988655; }
.content { flex-grow: 0; flex-shrink: 1; width: 100%; }
.coupon-scroll { flex-grow: 0; flex-shrink: 0; }
.home-space { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; }
.mic-image { width: 32px; height: 32px; }
.home-title { font-size: var(--font-home-title); line-height: var(--line-home-title); font-weight: 700; text-align: center; }
.home-prompt { font-size: var(--font-home-prompt); line-height: var(--line-home-prompt); color: #bfbfbf; text-align: center; }
.footer { display: flex; flex-direction: row; gap: 8px; flex-shrink: 0; height: 48px; }
.action { --button-radius: 26px; --button-padding-x: 12px; --button-padding-y: 6px; display: flex; flex-direction: row; justify-content: center; align-items: center; gap: 8px; flex-grow: 1; flex-basis: 0; height: 48px; padding: 7px 12px; border: 2px solid #505050; border-radius: 26px; font-size: var(--font-button); line-height: var(--line-button); font-weight: 500; background-color: #181818; color: #ffffff; }
.primary { --button-background-color: #23211a; --button-text-color: #ffe08b; --button-border-color: #6b6142; border-color: #6b6142; background-color: #302d22; color: #ffe08b; box-shadow: none; }
.action-label { display: flex; flex-direction: row; align-items: center; justify-content: center; gap: 8px; width: 100%; }
.icon-action { width: 48px; flex-grow: 0; flex-basis: 48px; padding: 7px; }
.button-icon { width: 23px; height: 23px; }
.option { --button-radius: 24px; --button-background-color: #141414; --button-padding-x: 14px; --button-padding-y: 12px; display: flex; flex-direction: row; align-items: center; justify-content: flex-start; width: 100%; height: 96px; flex-shrink: 0; padding: 12px 14px; margin: 0px 0px 8px 0px; gap: 10px; background-color: #141414; border: 2px solid #444444; border-radius: 24px; color: #ffffff; }
.focused { --button-background-color: #302d23; --button-border-color: #ffcf32; background-color: #302d23; border-color: #ffcf32; }
.selected { --button-text-color: #ffdf80; color: #ffdf80; }
.long-row { height: 128px; }
.row-copy { flex-grow: 1; flex-basis: 0; display: flex; flex-direction: column; gap: 4px; }
.row-title { font-size: var(--font-title); line-height: var(--line-title); font-weight: 700; text-align: left; }
.row-subtitle { font-size: var(--font-body); line-height: var(--line-body); color: #c2c2c2; text-align: left; }
.row-icon { width: 30px; height: 30px; flex-shrink: 0; }
.food { width: 64px; height: 64px; flex-shrink: 0; }
.chevron { width: 20px; height: 20px; flex-shrink: 0; }
.price { font-size: var(--font-price); line-height: var(--line-price); color: #ffdc72; font-weight: 700; }
.row-group { flex-shrink: 0; }
.compact-group { flex-shrink: 0; width: 400px; margin: 0px 24px; }
.compact-group .option { height: 104px; min-height: 104px; margin: 0px 0px 12px 0px; padding: 12px 16px; gap: 12px; }
.compact-group .row-icon { width: 28px; height: 28px; }
.compact-group .row-title { font-size: var(--font-title); line-height: var(--line-title); }
.fulfillment-group .option { height: 104px; min-height: 104px; padding: 16px 24px; gap: 20px; }
.fulfillment-group .row-icon { width: 40px; height: 40px; }
.fulfillment-group .row-title { font-size: var(--font-title); line-height: var(--line-title); }
.time-group { flex-shrink: 0; width: 442px; margin: 0px 3px; }
.time-group .option { height: 96px; min-height: 96px; margin: 0px 0px 8px 0px; padding: 12px 16px; gap: 12px; }
.time-group .row-icon { width: 28px; height: 28px; }
.time-group .row-title { font-size: var(--font-title); line-height: var(--line-title); }
.summary { flex-shrink: 0; font-size: var(--font-body); line-height: var(--line-body); color: #c1c1c1; margin: 4px 0px 12px 0px; }
.center { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; width: 100%; text-align: center; }
.central-content { padding: 4px 8px; box-sizing: border-box; }
.central-title { flex-shrink: 0; font-size: 24px; line-height: 32px; font-weight: 700; text-align: center; }
.muted { flex-shrink: 0; font-size: var(--font-body); line-height: var(--line-body); color: #c1c1c1; }
.center-copy { text-align: center; }
.status-circle { width: 58px; height: 58px; border-radius: 36px; border: 1px solid #66552c; background-color: #19160e; display: flex; justify-content: center; align-items: center; flex-shrink: 0; }
.plain-status { width: 42px; height: 42px; display: flex; justify-content: center; align-items: center; flex-shrink: 0; }
.status-image { width: 34px; height: 34px; }
.plain-status .status-image { width: 42px; height: 42px; }
.green { border-color: #3f6d50; background-color: #0e1a12; }
.red { border-color: #82534d; background-color: #241411; }
.status-value { font-size: var(--font-total); line-height: var(--line-total); font-weight: 700; color: #ffdf80; }
.meal-parts { margin: 0px 0px 16px 0px; }
.meal-hero { display: flex; flex-direction: row; align-items: center; gap: 12px; margin: 0px 0px 16px 0px; }
.meal-image { width: 80px; height: 80px; flex-shrink: 0; }
.meal-name { flex-grow: 1; flex-basis: 0; font-size: var(--font-title); line-height: var(--line-title); font-weight: 700; }
.stepper { display: flex; flex-direction: row; align-items: center; gap: 12px; margin: 0px 0px 8px 0px; }
.step-button { --button-radius: 24px; --button-padding-x: 0px; --button-padding-y: 0px; width: 48px; height: 48px; padding: 0px; border: 2px solid #505050; border-radius: 24px; font-size: var(--font-quantity); line-height: var(--line-quantity); }
.custom-group { flex-shrink: 0; display: flex; flex-direction: column; gap: 8px; margin: 0px 0px 10px 0px; }
.chip-title { font-size: var(--font-body); line-height: var(--line-body); }
.cart-card { box-sizing: border-box; flex-shrink: 0; border: 1px solid #444444; border-radius: 24px; background-color: #141414; padding: 12px; margin: 0px 0px 8px 0px; }
.cart-main { --button-background-color: #141414; --button-padding-x: 0px; --button-padding-y: 0px; padding: 0px; display: flex; flex-direction: row; align-items: center; gap: 10px; width: 100%; margin: 0px 0px 8px 0px; }
.chips { flex-shrink: 0; display: flex; flex-direction: row; flex-wrap: wrap; gap: 8px; }
.chip { flex-basis: 0; --button-radius: 26px; --button-padding-x: 12px; --button-padding-y: 7px; padding: 7px 12px; border: 2px solid #505050; border-radius: 26px; height: 48px; flex-grow: 1; font-size: 24px; }
.fulfillment-badge { margin-left: auto; display: flex; flex-direction: row; align-items: center; gap: 4px; }
.receipt-address { margin: 8px 0px 8px 0px; color: #c1c1c1; font-size: var(--font-body); line-height: var(--line-body); }
.receipt-store { flex-shrink: 0; display: flex; flex-direction: row; align-items: center; gap: 9px; margin: 0px 0px 10px 0px; }
.small-icon { width: 22px; height: 22px; }
.receipt-line { flex-shrink: 0; display: flex; flex-direction: row; justify-content: space-between; gap: 12px; margin: 0px 0px 4px 0px; }
.receipt-title { font-size: var(--font-body); line-height: var(--line-body); }
.review-total { position: relative; display: flex; flex-direction: row; align-items: center; justify-content: space-between;  padding: 9px 0px 0px 0px; height: 47px; flex-shrink: 0; }
.total-label { display: flex; flex-direction: row; align-items: center; gap: 10px; }
.total { font-size: var(--font-total); line-height: var(--line-total); font-weight: 700; color: #ffdf7e; }
.hint { font-size: var(--font-step); line-height: var(--line-step); color: #aaaaaa; }
.input-row { display: flex; flex-direction: row; align-items: center; gap: 8px; width: 100%; margin: 4px 0px; }
.input { --input-padding-x: 0px; --input-padding-y: 0px; --input-border-width: 0px; width: 100%; height: 48px; padding: 8px 10px; border: 1px solid #777777; border-radius: 8px; background-color: #171717; color: #ffffff; font-size: 19px; line-height: 26px; }
.grow { flex-grow: 1; flex-basis: 0; }
.submit { --button-background-color: #211f19; --button-text-color: #ffe08b; padding: 10px; height: 48px; border: 1px solid #68604a; border-radius: 12px; font-size: 19px; color: #ffe08b; }
.copy { font-size: var(--font-body); line-height: var(--line-body); color: #c1c1c1; margin: 4px 0px 10px 0px; }
.setup .action { width: 100%; margin: 8px 0px; }
.message { background-color: #302814; color: #ffe8a0; font-size: 18px; line-height: 24px; padding: 6px; flex-shrink: 0; }
.key-focused { outline: 2px solid #ffcf32; }
.review-screen { gap: 12px; }
.receipt-focus { color: #ffcf32; font-weight: 700; }
.compact-center { gap: 6px; }
.compact-center .status-circle { width: 48px; height: 48px; }
.compact-center .status-image { width: 30px; height: 30px; }
.compact-center .center-copy { font-size: 18px; line-height: 24px; }
.compact-center .status-value { line-height: 36px; }
.focused { --button-background-color: #302d23; --button-border-color: #ffcf32; background-color: #302d23; border-color: #ffcf32; }
.central-shell { justify-content: flex-end; }
.special-center { display: flex; flex-direction: column; align-items: center; justify-content: center; }
.coupon-layout, .address-layout, .payment-layout { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; width: 100%; }
.status-inline { display: flex; flex-direction: row; align-items: center; justify-content: center; gap: 17px; }
.status-copy { display: flex; flex-direction: column; align-items: center; gap: 7px; }
.order-value { color: #b1edc9; font-size: var(--font-total); line-height: var(--line-total); font-weight: 700; }
.coupon-large { width: 58px; height: 58px; }
.price-comparison { display: flex; flex-direction: row; align-items: center; gap: 12px; }
.strike-wrap { display: grid; }
.strike-wrap .muted { grid-area: 1 / 1; }
.strike-line { grid-area: 1 / 1; align-self: center; width: 65px; height: 1px; background-color: #c1c1c1; }
.review-rule { position: absolute; top: 0px; width: 100%; height: 1px; background-color: #4c493d; }
.receipt-copy { flex-shrink: 0; display: flex; flex-direction: column; }
.receipt-value { flex-shrink: 0; text-align: right; }
.meta-separator { position: absolute; width: 100%; height: 1px; background-color: #363636; transform: translateY(-10px); }
.fulfillment-aside { color: #ffcf32; }
.receipt { box-sizing: border-box; padding: 0px 5px 8px 5px; }
.receipt-meta { position: relative; padding-top: 6px; margin-top: 6px; }
.menu-action { --button-background-color: #23211a; --button-text-color: #ffe08b; --button-border-color: #6b6142; background-color: #23211a; color: #ffe08b; border-color: #6b6142; }
.selected { --button-border-color: #8a7440; border-color: #8a7440; }
.focused { --button-border-color: #ffcf32; --button-background-color: #302d23; --button-text-color: #ffffff; border-color: #ffcf32; background-color: #302d23; box-shadow: 0px 0px 0px 1px #ffcf32; }
.quantity-value { width: 26px; text-align: center; font-size: var(--font-quantity); line-height: var(--line-quantity); font-weight: 700; }
.address-pin { width: 28px; height: 28px; }
.coupon-layout { gap: 8px; min-height: 0px; max-height: 100%; overflow: hidden; }
.coupon-detail { max-width: 442px; text-align: center; }
.payment-layout { gap: 15px; }
.cancel-layout { gap: 8px; }
.home-coupon-icon { width: 38px; height: 38px; }
.error-layout .status-circle { width: 72px; height: 72px; }
.error-layout .status-image { width: 44px; height: 44px; }
.chip-title { font-size: var(--font-body); line-height: var(--line-body); }
.customize-scroll { flex-shrink: 0; }
.customize-scroll .chip { flex-basis: 217px; flex-grow: 0; width: 217px; box-sizing: border-box; }
.chip-check { width: 22px; height: 22px; }
.chip { display: flex; flex-direction: row; align-items: center; justify-content: center; gap: 6px; }
.disabled-option { --button-text-color: #a5a5a5; opacity: 1; background-color: #0d0d0d; border-color: #2e2e2e; }
.disabled-option .row-title { color: #a5a5a5; }
.disabled-option .row-subtitle { color: #aaaaaa; }
.disabled-option .price { color: #b9a269; }
.coupon-option .row-icon { width: 38px; height: 38px; }
.order-option .row-icon { width: 28px; height: 28px; }
.order-option .price { font-size: var(--font-price); line-height: var(--line-price); color: #ffdc72; }
.order-option { height: 84px; }
.cart-main { align-items: flex-start; }
.cart-card .row-title { font-size: 22px; line-height: 30px; }
.cart-card .price { font-size: 24px; line-height: 30px; }
.cart-card .stepper { margin-bottom: 0px; }
.delivery-receipt .receipt-store { margin-bottom: 0px; }
.delivery-receipt .receipt-address { margin-top: 0px; }
.header { height: 32px; }
.primary.focused { --button-text-color: #ffe08b; color: #ffe08b; }
.muted, .row-subtitle, .receipt-title, .receipt-address, .hint { font-weight: 500; }
.fulfillment-group .option { --button-padding-x: 24px; --button-padding-y: 16px; }
.compact-group .option { --button-padding-x: 16px; }
.fulfillment-group .option { --button-padding-x: 24px; }
.cart-main { display: grid; grid-template-columns: 64px minmax(0,1fr) auto; column-gap: 10px; row-gap: 4px; }
.cart-main .food { grid-column: 1; grid-row: 1 / 3; align-self: center; }
.cart-title { grid-column: 2; grid-row: 1; }
.cart-price { grid-column: 3; grid-row: 1; }
.cart-subtitle { grid-column: 2 / 4; grid-row: 2; text-align: left; }
.cart-card .row-title { font-size: var(--font-title); line-height: var(--line-title); }
.cart-card .price { font-size: var(--font-price); line-height: var(--line-price); }
.claim-value { font-size: var(--font-total); line-height: var(--line-total); color: #ffdf80; }
.home-brand { height: 32px; }
.row-group { width: 442px; margin: 0px 3px; }
.inset-content { padding: 0px 3px; }
.focused { border-width: 3px; }
.address-layout { gap: 12px; padding-bottom: 8px; }
.disabled-step { --button-text-color: #666666; --button-background-color: #080808; color: #666666; opacity: 0.55; }
.cart-card .stepper { gap: 16px; }
.delivery-separator { width: 100%; height: 1px; background-color: #363636; margin-top: 10px; }
.review-screen .header { height: 32px; }
.review-screen { gap: 8px; }
.review-screen .coupon-voice-row { height: 40px; }
.review-screen .receipt { flex: none; }
.aside { font-weight: 500; }
.result-layout .central-content { transform: translateY(-6px); }
.inset-content { box-sizing: border-box; }
.custom-group { margin-bottom: 14px; }
.review-total { height: 42px; }
.delivery-receipt .receipt-store { margin-bottom: 10px; }
.delivery-receipt .receipt-address { margin-bottom: 12px; }
.delivery-separator { margin-top: 0px; }
.voice-entry { display: flex; flex-direction: column; gap: 8px; width: 100%; }
.voice-draft { font-size: 20px; line-height: 28px; color: #ffdf80; }
.voice-actions { display: flex; flex-direction: row; gap: 8px; width: 100%; }
.voice-shell { gap: 6px; }
.voice-shell .central-content { gap: 6px; padding: 0px; }
.voice-shell .status-circle { width: 40px; height: 40px; }
.voice-shell .status-image { width: 26px; height: 26px; }
.voice-shell .central-title { font-size: 24px; line-height: 30px; }
.voice-shell .voice-entry { gap: 4px; }
.voice-shell .voice-entry .muted { font-size: 18px; line-height: 24px; }
.voice-shell .voice-actions .action { height: 40px; font-size: 20px; line-height: 26px; padding: 4px 8px; }
.top-screen { justify-content: flex-start; }
.top-screen > .content { flex-grow: 1; flex-basis: 0; }
.home-space { height: 92px; flex-shrink: 0; }
.home-brand { height: 30px; }
.central-content { padding: 16px 8px; }
.plain-status { margin-bottom: 4px; }
.special-center { flex-grow: 0; }
.order-status-center { justify-content: flex-start; }
.coupon-detail-layout { display: flex; flex-direction: column; gap: 12px; padding: 12px 10px; }
.coupon-detail-icon { width: 42px; height: 42px; }
.detail-line { display: flex; flex-direction: row; justify-content: space-between; align-items: center; gap: 12px; }
.order-detail-layout { display: flex; flex-direction: column; gap: 8px; margin: 2px 4px 0px 4px; }
.detail-card { display: flex; flex-direction: column; gap: 8px; padding: 12px 14px; border: 1px solid #444444; border-radius: 18px; background-color: #141414; }
.order-summary { gap: 4px; }
.quantity-editor { display: flex; flex-direction: column; gap: 12px; }
.cart-card { display: flex; flex-direction: row; align-items: center; justify-content: space-between; gap: 12px; }
.cart-left .row-copy { gap: 0px; }
.cart-subtitle { margin-top: 4px; display: flex; flex-direction: column; }
.cart-left { display: flex; flex-direction: row; align-items: center; gap: 12px; flex-grow: 1; flex-basis: 0; }
.cart-right { width: 142px; flex-shrink: 0; display: flex; flex-direction: column; align-items: flex-end; gap: 4px; }
.edit-quantity { flex-grow: 0; flex-basis: auto; }
.stepper { justify-content: flex-end; }
.address-layout { align-items: flex-start; }
.address-layout .status-inline { justify-content: flex-start; }
.detail-card.detail-line { flex-direction: row; }
.coupon-layout { gap: 12px; }
.coupon-detail-layout { height: 213px; box-sizing: border-box; }
.coupon-detail-layout > .total { text-align: center; }
.central-content { padding: 8px; }
.plain-status { margin-bottom: 0px; }
.order-store-name { max-width: 396px; flex-shrink: 1; text-align: center; }
.order-number { width: 438px; text-align: center; }
.payment-layout { padding: 10px 0px; gap: 12px; }
.coupon-layout { padding: 8px 0px; gap: 10px; }
.address-layout { padding: 8px 0px; gap: 12px; }
.inset-content { padding: 2px 3px; box-sizing: border-box; }
.meal-hero { margin-bottom: 12px; }
.stepper { margin-bottom: 16px; }
.meal-parts { margin-bottom: 0px; }
.coupon-detail-layout { gap: 10px; padding: 4px 16px 10px 16px; }
.coupon-detail-layout .status-inline { gap: 10px; }
.coupon-info { display: flex; flex-direction: column; gap: 6px; border-top: 1px solid #3d3d3d; padding-top: 8px; }
.coupon-info-value { color: #ffffff; font-size: var(--font-body); line-height: var(--line-body); font-weight: 500; text-align: right; }
.order-store { display: flex; flex-direction: row; align-items: center; gap: 10px; }
.order-detail-status { color: #86efac; }
.order-number { flex-direction: row; justify-content: flex-start; gap: 10px; }
.order-item-name, .order-item-quantity { font-size: var(--font-body); line-height: var(--line-body); color: #dddddd; }
.home-space { justify-content: flex-start; }
.brand { width: 28px; height: 28px; }
.address-layout .status-inline { width: 100%; gap: 12px; }
.address-layout .row-title { flex: 1; min-width: 0px; font-size: var(--font-body); line-height: var(--line-body); }
.address-entry-shell .status-circle { width: 64px; height: 64px; border: 1px dashed #888888; background-color: #111111; }
.store-scroll { flex-shrink: 0; flex-grow: 0; }
.store-group { width: 442px; flex-shrink: 0; }
.store-card { box-sizing: border-box; width: 442px; flex-shrink: 0; display: flex; flex-direction: row; align-items: center; gap: 10px; padding: 12px 14px; border: 3px solid #444444; border-radius: 24px; margin-bottom: 8px; background-color: #141414; }
.disabled-store { opacity: 0.55; }
.store-card.focused { background-color: #302d23; border-color: #ffcf32; }
.store-copy { width: 338px; flex-shrink: 0; display: flex; flex-direction: column; }
.store-title { width: 338px; height: 30px; flex-shrink: 0; font-size: 22px; line-height: 30px; font-weight: 700; text-align: left; }
.store-address { margin-top: 4px; flex-shrink: 0; }
.store-address-line, .store-status { width: 338px; height: 26px; flex-shrink: 0; font-size: 18px; line-height: 26px; font-weight: 500; color: #c2c2c2; text-align: left; }
.store-status { margin-top: 4px; }
.location-mic { position: absolute; right: 0px; width: 32px; height: 32px; padding: 2px; border-radius: 16px; }
.asset-scroll { flex-shrink: 0; flex-grow: 0; flex-basis: auto; }
.top-screen > .cart-list, .top-screen > .asset-scroll, .top-screen > .store-scroll, .top-screen > .menu-scroll { flex-grow: 0; flex-shrink: 0; flex-basis: auto; }
.asset-group { width: 442px; margin: 0px 3px; flex-shrink: 0; }
.asset-card { box-sizing: border-box; width: 442px; flex-shrink: 0; display: flex; flex-direction: row; align-items: center; gap: 10px; padding: 12px 14px; margin-bottom: 8px; border: 3px solid #444444; border-radius: 24px; background-color: #141414; }
.asset-card.focused { background-color: #302d23; border-color: #ffcf32; }
.asset-icon { width: 30px; height: 30px; flex-shrink: 0; }
.asset-copy { width: 338px; flex-shrink: 0; display: flex; flex-direction: column; }
.asset-title { width: 338px; height: 30px; flex-shrink: 0; font-size: 22px; line-height: 30px; font-weight: 700; text-align: left; }
.asset-subtitle { margin-top: 4px; }
.asset-meta { width: 338px; height: 26px; flex-shrink: 0; font-size: 18px; line-height: 26px; color: #c2c2c2; }
.voice-wave { width: 38px; height: 36px; display: flex; flex-direction: row; align-items: center; justify-content: center; gap: 3px; }
.voice-bar { width: 4px; background-color: #ffcf32; border-radius: 2px; transition: height 160ms linear; }
.notice-inline { position: absolute; top: 48px; left: 16px; width: 448px; padding: 4px; background-color: #171717; }
.coupon-detail-layout { height: 260px; padding: 48px 16px 12px 16px; flex-shrink: 0; }
.coupon-apply { box-sizing: border-box; --button-padding-y: 0px; padding: 0px 14px; height: 48px; min-height: 48px; flex-shrink: 0; }
.inline-listen { flex-shrink: 0; height: 26px; display: flex; flex-direction: row; align-items: center; justify-content: center; gap: 8px; color: #aaaaaa; font-size: 16px; line-height: 22px; }
.inline-wave { display: flex; flex-direction: row; align-items: center; gap: 3px; height: 26px; }
.home-space { position: relative; }
.home-notice { margin-top: -8px; width: 448px; height: 52px; flex-shrink: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; color: #bfbfbf; font-size: 18px; line-height: 26px; text-align: center; }
.home-title { flex-shrink: 0; }
.home-notice-line { width: 448px; font-size: 18px; line-height: 26px; color: #bfbfbf; text-align: center; }
.menu-card { box-sizing: border-box; width: 442px; flex-shrink: 0; display: flex; flex-direction: row; align-items: center; gap: 10px; padding: 12px 14px; border: 2px solid #444444; border-radius: 24px; margin-bottom: 8px; background-color: #141414; }
.menu-card.focused { background-color: #302d23; border-color: #ffcf32; }
.menu-copy { flex-shrink: 0; display: flex; flex-direction: column; gap: 4px; }
.menu-title { height: 30px; flex-shrink: 0; font-size: 22px; line-height: 30px; font-weight: 700; text-align: left; }
.menu-meta { height: 26px; flex-shrink: 0; font-size: 18px; line-height: 26px; color: #c1c1c1; }
.menu-price { height: 32px; flex-shrink: 0; font-size: 24px; line-height: 32px; font-weight: 700; color: #ffdc72; text-align: right; }
.menu-empty { height: 176px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; }
.menu-scroll { flex-grow: 0; flex-shrink: 0; flex-basis: auto; }
.coupon-voice-row { height: 28px; flex-shrink: 0; display: flex; flex-direction: row; align-items: center; justify-content: center; gap: 8px; }
.coupon-voice-label { font-size: 20px; line-height: 28px; color: #c1c1c1; text-align: center; }
</style>
