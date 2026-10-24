<script def>
{"navigationBarTitleText":"麦当劳 AI 助手"}
</script>
<script setup>
import wx from 'wx';
import { MCP_TOKEN } from '../../lib/credentials.js';
import { listLayout, couponView, orderView } from '../../lib/layout.js';
import { controlsFor, spokenNumber } from '../../lib/controls.js';
import { Service, DeviceStore, DeviceGateway } from '../../lib/device.js';
import { LanguageModel } from 'language-model';
import { presentation } from '../../lib/presentation.js';
import { scenes, sceneView } from '../../lib/scenes.js';
export default {
  data: {
    view: { title: '麦当劳 AI 助手', summary: '直连麦当劳，开始点餐', screen: 'home', rows: [], actions: [] },
    rows: [], actions: [], busy: false, message: '', input: '', listening: false,
    settings: true, controlId: '', voiceDraft: '', draftPage: 0, focusIndex: 0, scrollTarget: '', listScroll: 0, receiptScroll: 0, receiptPage: 0, couponPage: 0, descriptionPage: 0,
    ui: {}, more: false, gallery: false, scenes: scenes, previewScene: false, connectionLabel: '眼镜直连 · 未连接'
  },
  onLoad(query) {
    this.visible = true;
    this.backTimer = null;
    this.backPending = false;
    this.generation = 0;
    try {
      this.deviceStore = new DeviceStore(wx);
      this.setData({ settings: false });
    } catch (e) { this.storageError = e.message; this.setData({ settings:true,message:e.message }); this.decorate(); }
    if (query && query.scene) {
      this.setData({ settings: false });
      this.showScene(String(query.scene));
    }
  },
  onShow() {
    this.visible = true;
    if (!this.controls) this.decorate();
    if (!this.data.previewScene && this.deviceStore) this.connect();
  },
  async refreshState() {
    if (!this.service) return;
    try { this.render(this.service.state(this.data.view.id)); }
    catch (e) { if (this.visible) this.setData({ message: e.message }); }
  },
  onHide() { this.cleanup(); },
  onUnload() { this.cleanup(); },
  cleanup() {
    this.visible = false;
    this.clearBackTimer();
    this.lastHostBackStamp=undefined;
    this.cancelRecognition();
    this.setData({ voiceDraft: '' });
    this.generation = (this.generation || 0) + 1; this.speechGeneration=(this.speechGeneration||0)+1;
    if (this.gateway) this.gateway.close().catch(() => {});
    if (this.recognition) { this.recognition.abort(); this.recognition = null; }
    if (this.model) { this.model.destroy(); this.model = null; }
    if (this.speechPlayer) { this.speechPlayer.destroy(); this.speechPlayer = null; }
    if (this.speechTask) { this.speechTask.abort(); this.speechTask = null; }
    this.setData({ busy: false, listening: false });
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
    const saved = this.deviceStore.token();
    const token = MCP_TOKEN;
    if (token !== saved && this.deviceStore.pending()) { this.setData({ settings: true, message: '原账号有操作待核实，不能切换内置凭证。请核对原账号记录后处理。' }); this.decorate(); return; }
    const generation = this.generation;
    this.setData({ busy: true, message: '正在直连麦当劳' });
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
      if (state.screen === 'uncertain') state = await this.service.event(state.id, { type: 'reconcile', revision: state.revision });
      else if (state.screen === 'review') state = await this.service.event(state.id, { type: 'quote', revision: state.revision });
      else if ((state.screen === 'payment' || state.screen === 'order-status') && state.presentation && state.presentation.orderId) {
        state = await this.service.event(state.id, { type: 'query-order', id: String(state.presentation.orderId), revision: state.revision });
      }
      if (!this.visible || generation !== this.generation) return;
      this.setData({ settings: false, gallery: false, previewScene: false, connectionLabel: '眼镜直连 · 真实 MCP' });
      this.render(state);
    } catch (e) {
      if (!this.visible || generation !== this.generation) return;
      if (saved && token === saved) {
        this.service = new Service(this.deviceStore, gateway);
        this.setData({ settings: false, previewScene: false, connectionLabel: '眼镜直连 · 连接待恢复' });
        try { this.render(this.service.resume()); } catch (storageError) { this.setData({ settings: true, message: storageError.message }); return; }
      }
      this.setData({ settings: true, message: e.message || '直连失败，请检查网络或更新内置凭证。' }); this.focusId = null; this.decorate();
    } finally { if (this.visible && generation === this.generation) this.setData({ busy: false }); }
  },
  render(state) {
    this.clearBackTimer();
    if(state.id&&state.id!=='preview'&&this.deviceStore){
      try{
        const session=this.deviceStore.get(state.id),p={...(state.presentation||{})};
        if(state.screen==='address-confirm'){
          const d=session.addressDraft||{};p.address=(d.city||'')+(d.address||'')+' '+(d.addressDetail||'');p.contact=(d.contactName||'')+' · '+String(d.phone||'').replace(/(\d{3})\d{4}(\d{4})/,'$1****$2');p.description='';
        }
        if(state.screen==='cart')state={...state,rows:state.rows.map(r=>{
          const line=session.cart.find(x=>x.id===r.id),detail=line?.detail;
          const names=(detail?.rounds||[]).flatMap(round=>(round.choices||round.items||[]).filter(c=>c.quantity>0).map(c=>c.name));
          return {...r,subtitle:names.join(' · ')||r.subtitle,price:detail?.price!==undefined?'¥'+(Number(detail.price)*r.quantity).toFixed(2):r.price};
        })};
        if(state.screen==='payment')p.description='订单号 '+(p.orderId||'');
        if(state.screen==='order-status'){p.statusValue=p.pickupCode||session.order?.deliveryInfo?.expectDeliveryTime||p.status||state.title;p.store=session.order?.storeName||p.store;p.heading='';}
        state={...state,presentation:p};
      }catch(e){/* Preview-only views do not read or alter a live session. */}
    }
    this.focusId = null;
    const defaultFocus = state.presentation && state.presentation.defaultFocus !== null && state.presentation.defaultFocus !== undefined ? state.presentation.defaultFocus : 0;
    this.setData({ view: state, voiceDraft: '', draftPage: 0, receiptScroll: 0, receiptPage: 0, couponPage: 0, descriptionPage: 0, more: false, focusIndex: defaultFocus, input: state.input ? state.input.value : '', message: '', scrollTarget: 'row-0', listScroll: 0 });
    this.decorate();
  },
  decorate() {
    const ui = presentation(this.data.view, this.data.focusIndex, this.data.more);
    // Keep every receipt field reachable within the glasses viewport.
    const split=(text,width)=>{
      const result=[];let line='',used=0;
      for(const c of String(text||'')){const size=c.charCodeAt(0)<256?0.55:1;if(used+size>width){result.push(line);line='';used=0;}line+=c;used+=size;}
      if(line)result.push(line);return result.length?result:[''];
    };
    const draftLines=split(this.data.voiceDraft,22);ui.draftPages=Math.max(1,Math.ceil(draftLines.length/2));
    ui.draftText=draftLines.slice((this.data.draftPage||0)*2,((this.data.draftPage||0)+1)*2).join('\n');
    ui.draftStep='识别内容 '+((this.data.draftPage||0)+1)+'/'+ui.draftPages;
    const description=ui.descriptionLines.flatMap(line=>split(line,22));
    ui.descriptionPages=ui.tight?Math.max(1,Math.ceil(description.length/2)):1;
    const descriptionPage=Math.min(this.data.descriptionPage||0,ui.descriptionPages-1);
    if(ui.tight)ui.descriptionLines=description.slice(descriptionPage*2,descriptionPage*2+2);
    ui.descriptionStep=ui.descriptionPages>1?'详情 '+(descriptionPage+1)+'/'+ui.descriptionPages+' ↓':'';
    const couponLines=ui.couponDetails.flatMap(line=>split(line,22));
    ui.couponPages=ui.tight&&this.data.view.screen==='coupon-confirm'?Math.max(1,Math.ceil(couponLines.length/2)):1;
    const couponPage=Math.min(this.data.couponPage||0,ui.couponPages-1);
    ui.couponPageLines=couponLines.slice(couponPage*2,couponPage*2+2);
    ui.couponStep=ui.couponPages>1?'优惠明细 '+(couponPage+1)+'/'+ui.couponPages+' ↓':'';
    const parts=[];
    for(const entry of ui.receipt){
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
    const receiptHeight=40+(ui.address?Math.ceil(ui.address.length/24)*26+12:0)+ui.receipt.reduce((n,r)=>n+(r.inline?44:Math.max(30,r.subtitle?56:30))+4,0);
    ui.receiptMaxScroll=Math.max(0,receiptHeight-156);
    if(this.data.view.screen==='coupon-detail'){
      const info=[['使用日期',ui.coupon.date],['使用时段',ui.coupon.time],['适用方式',String(ui.coupon.fulfillment||'').replace(/\s*[/／]\s*/g,'／')]].filter(x=>x[1]).flatMap(([label,value])=>split(value,17).map((value,i)=>({label:i?'':label,value})));
      if(ui.coupon.description)info.push(...split(ui.coupon.description,22).map(value=>({label:'',value})));
      const size=info.length>3?2:3;ui.descriptionPages=Math.max(1,Math.ceil(info.length/size));
      const page=Math.min(this.data.descriptionPage||0,ui.descriptionPages-1);ui.couponInfo=info.slice(page*size,page*size+size);ui.descriptionLines=[];
      ui.descriptionStep='优惠明细 '+(page+1)+'/'+ui.descriptionPages;
    }
    if(this.data.view.screen==='order-detail')ui.descriptionPages=Math.max(1,Math.ceil((ui.order.items||[]).length/3));
    const controls=controlsFor({...this.data,ui});
    const target=controls.find(c=>c.id===this.focusId)||controls.find(c=>c.legacy===this.data.focusIndex)||controls[0];
    if(this.data.view.screen==='order-detail'){
      const items=ui.order.items||[],page=Math.min(this.data.descriptionPage||0,Math.max(0,Math.ceil(items.length/3)-1));
      ui.descriptionPages=Math.max(1,Math.ceil(items.length/3));ui.orderItems=items.slice(page*3,page*3+3).map(x=>({...x,quantityLabel:/[×x]\s*\d+$/.test(x.name)?'':' ×'+x.quantity}));ui.descriptionStep='餐品明细 '+(page+1)+'/'+ui.descriptionPages+' ↓';
    }
    ui.visibleRows=ui.rows;
    this.controls=controls;this.focusId=target?target.id:'';
    if(target&&target.legacy!==this.data.focusIndex){this.setData({focusIndex:target.legacy});this.decorate();return;}
    const layout=listLayout(this.data.gallery?this.data.scenes.map(x=>({title:x.title})):ui.rows,this.data.gallery?'gallery':this.data.view.screen,!this.data.gallery&&ui.actions.length>0,target?.rowIndex??(this.data.gallery?target?.legacy:undefined),this.data.listScroll);
    if(this.data.view.input&&!this.data.previewScene)ui.centralHeight=276;
    ui.listHeight=ui.largeCompact||this.data.view.screen==='tableware'?220:layout.height;
    ui.overflowAbove=layout.overflowAbove;ui.overflowBelow=layout.overflowBelow;
    const listScroll=layout.scroll;
    this.setData({ ui: ui, rows: ui.rows, actions: ui.actions, controlId:this.focusId, scrollTarget:'', listScroll });
  },
  async send(event, fromKey = false) {
    if (event.type === 'confirm' && !fromKey) { this.setData({message:'核对后请按确认键提交。'}); return; }
    if (this.data.busy) return;
    if (this.data.previewScene) { this.setData({ message: '场景预览为只读；返回连接设置后可交互。' }); return; }
    if (this.recognition) this.cancelRecognition();
    if (event.type === 'locate') { this.locate(); return; }
    this.setData({ busy: true, message: event.type === 'confirm' ? '正在提交，请勿重复操作' : event.type === 'quote' || event.type === 'now' ? '正在算价' : '正在处理' });
    const generation = this.generation;
    try {
      const state = await this.request('/sessions/' + this.data.view.id + '/events', 'POST', { ...event, revision: this.data.view.revision });
      if (this.visible && generation === this.generation) { this.render(state); this.speak(state.title + '。' + (state.total ? '应付' + state.total + '。' : '') + (state.screen === 'review' ? state.summary : state.screen === 'payment' || state.screen === 'uncertain' ? state.summary : '')); }
    } catch (e) {
      if (this.visible && generation === this.generation) {
        this.setData({ message: e.message });
        // Refresh an existing session after a conflict or a lost response. Never resend a write.
        try { const state = await this.request('/sessions/' + this.data.view.id); if (this.visible) this.render(state); this.setData({ message: e.message }); } catch (ignored) {}
      }
    } finally { if (this.visible && generation === this.generation) this.setData({ busy: false }); }
  },
  moveFocus(delta) {
    if(this.focusId==='receipt-scroll'&&this.data.view.screen==='review'){const old=this.data.receiptScroll||0;this.advanceReceipt(delta);if(old!==this.data.receiptScroll)return;}
    const controls=this.controls||[];if(!controls.length)return;
    const current=Math.max(0,controls.findIndex(c=>c.id===this.focusId));
    const target=controls[(current+delta+controls.length)%controls.length];
    this.focusId=target.id;this.setData({focusIndex:target.legacy});this.decorate();
  },
  async activateFocused(fromKey=false) {
    const target=(this.controls||[]).find(c=>c.id===this.focusId);if(!target)return;
    if(this.data.previewScene&&!this.data.gallery){this.setData({message:'只读场景；返回键打开场景总览。'});return;}
    if(target.event&&['wallet','coupon-select'].includes(this.data.view.screen)&&target.rowIndex!==undefined)return this.openCoupon(target);
    if(target.event&&this.data.view.screen==='orders'&&target.event.type==='query-order'){this.listReturn={view:this.data.view,focus:this.focusId,scroll:this.data.listScroll};await this.send(target.event,fromKey);if(this.data.view.screen==='order-status'){const raw=this.deviceStore.get(this.data.view.id).order;this.render({...this.data.view,screen:'order-detail',title:'订单详情',rows:[],actions:[],presentation:{order:orderView(raw)}});}return;}
    if(target.event){if(target.event.type==='back'){this.goBack();return;}return this.send(target.event,fromKey);}
    switch(target.command){
      case 'edit-quantity':return this.openQuantity(target.rowIndex);
      case 'quantity-change':return this.changeQuantity(target.delta);
      case 'quantity-done':return this.closeQuantity();
      case 'coupon-apply':{const event=this.couponReturn.event;this.couponReturn=null;return this.send(event,fromKey);}
      case 'connect':return this.connect();case 'gallery':this.openGallery();break;
      case 'back-settings':this.closeSettings();break;case 'settings':this.openSettings();break;
      case 'listen':this.listen();break;case 'scene':this.showScene(target.sceneId);break;
      case 'back':this.goBack();break;case 'receipt':this.advanceReceipt();break;case 'coupon':this.advanceCoupon();break;
      case 'description':this.advanceDescription();break;case 'draft':this.advanceDraft();break;case 'accept-input':return this.acceptInput();
    }
  },
  async acceptInput(){
    let value=String(this.data.voiceDraft||'').trim();if(!value||!this.data.view.input)return;
    const placeholder=this.data.view.input.placeholder,screen=this.data.view.screen;
    if(screen==='location'&&!/[ ,，]/.test(value))value=value.replace(/^(.+?(?:市|自治州|地区))(.+)$/,'$1 $2');
    await this.send({type:'input',value});
    if(this.data.view.screen===screen&&this.data.view.input&&this.data.view.input.placeholder===placeholder){this.setData({voiceDraft:value});this.focusId='input-accept';this.decorate();}
  },
  toggleMore() { this.focusId=null;this.setData({more:!this.data.more});this.decorate(); },
  goBack() {
    this.clearBackTimer();
    if(this.data.view.screen==='quantity-editor')return this.closeQuantity();
    if(this.data.view.screen==='coupon-detail'&&this.couponReturn){const old=this.couponReturn;this.couponReturn=null;this.render(old.view);this.focusId=old.focus;this.setData({listScroll:old.scroll});this.decorate();return;}
    if(this.data.view.screen==='order-detail'&&this.listReturn){const old=this.listReturn;this.listReturn=null;return this.send({type:'back'}).then(()=>{this.focusId=old.focus;this.setData({listScroll:old.scroll});this.decorate();});}
    if(this.data.gallery){this.setData({gallery:false,settings:true,previewScene:false});this.focusId=null;this.decorate();}
    else if(this.data.previewScene)this.sceneBack();
    else if(this.data.settings)this.closeSettings();
    else if(this.data.more)this.toggleMore();else if(!this.data.ui.home)this.send({type:'back'});
  },
  advanceDraft(delta=1){const n=this.data.ui.draftPages||1;this.setData({draftPage:((this.data.draftPage||0)+delta+n)%n});this.decorate();},
  advanceDescription(delta=1) { const n=this.data.ui.descriptionPages||1;this.setData({descriptionPage:((this.data.descriptionPage||0)+delta+n)%n});this.decorate(); },
  advanceReceipt(delta=1) { this.setData({receiptScroll:Math.max(0,Math.min(this.data.ui.receiptMaxScroll||0,(this.data.receiptScroll||0)+delta*52))}); },
  advanceCoupon(delta=1) { const n=this.data.ui.couponPages||1;this.setData({couponPage:((this.data.couponPage||0)+delta+n)%n});this.decorate(); },
  openSettings() { this.clearBackTimer();if(!this.data.busy){this.focusId=null;this.setData({settings:true,gallery:false,previewScene:false,message:''});this.decorate();} },
  closeSettings(){
    if(this.service){this.setData({settings:false,gallery:false,previewScene:false});this.render(this.service.resume());}
    else {this.setData({message:'尚未连接；请按确认键重试连接，或浏览演示场景。'});this.focusId='setting-connect';this.decorate();}
  },
  openGallery() { this.clearBackTimer();this.focusId=null;this.setData({settings:false,gallery:true,previewScene:true,message:'演示场景 · 只读'});this.decorate(); },
  showScene(id) { this.setData({gallery:false,settings:false,previewScene:true});this.render(sceneView(id)); },
  sceneBack() { this.focusId=null;this.setData({gallery:true,message:'演示场景 · 只读'});this.decorate(); },
  clearBackTimer() { if(this.backTimer){clearTimeout(this.backTimer);this.backTimer=null;} this.backPending=false;this.backPressedAt=0; },
  openCoupon(target) {
    const view=this.data.view,row=this.data.rows[target.rowIndex];
    const session=this.deviceStore.get(view.id),raw=session.coupons.find(c=>String(c.couponId??c.id)===row.id)||{};
    this.couponReturn={view,focus:this.focusId,scroll:this.data.listScroll,event:target.event};
    this.render({...view,screen:'coupon-detail',title:row.title,summary:'',rows:[],actions:[],presentation:{coupon:couponView(row,raw)}});
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
    const state=await this.request('', 'POST', {type:'line-quantity',id:this.quantityReturn.id,value:n,revision:this.data.view.revision});
    this.setData({view:state});this.renderQuantity();
  },
  closeQuantity() {
    const old=this.quantityReturn;this.quantityReturn=null;
    this.render(this.service.state(this.data.view.id));
    if(old){this.focusId=old.focus;this.setData({listScroll:old.scroll});this.decorate();}
  },
  exitPage() {
    this.clearBackTimer(); this.cancelRecognition();
    if (wx.navigateBack) wx.navigateBack();
    else this.setData({message:'已取消语音；请使用眼镜宿主返回退出。'});
  },
  usesHostBackGesture() {
    // Verified device profile only: Ink 0.20.0 already translates the physical
    // double gesture to one Backspace pair. Other runtimes retain raw pairing.
    return typeof navigator!=='undefined' && navigator.versions && /^0\.20\.0(?:$|[-+])/.test(String(navigator.versions.ink||''));
  },
  performBusinessBack() {
    this.clearBackTimer();
    if(this.data.listening)return this.exitPage();
    if(this.data.busy)return this.cancelPending();
    return this.goBack();
  },
  handleBackPress(event={}) {
    if(this.usesHostBackGesture()){
      if(event.timeStamp!==undefined&&this.lastHostBackStamp===event.timeStamp)return;
      this.lastHostBackStamp=event.timeStamp;
      return this.performBusinessBack();
    }
    if (this.backPending && Date.now()-this.backPressedAt<=500) {
      this.clearBackTimer();
      if (this.data.listening) return this.exitPage();
      if (this.data.busy) return this.cancelPending();
      return this.goBack();
    }
    this.clearBackTimer();this.backPressedAt=Date.now();
    this.backPending=true;
    this.backTimer=setTimeout(()=>this.clearBackTimer(),500);
  },
  cancelRecognition(){
    this.clearBackTimer();
    this.recognitionGeneration=(this.recognitionGeneration||0)+1;
    const recognition=this.recognition;this.recognition=null;if(recognition)recognition.abort();
    this.setData({listening:false});
  },
  async cancelPending(){
    this.generation=(this.generation||0)+1;this.cancelRecognition();
    if(this.model){this.model.destroy();this.model=null;}
    if(this.gateway)await this.gateway.close().catch(()=>{});
    this.setData({busy:false});
    if(this.service){try{this.render(this.service.resume());}catch(e){this.setData({message:e.message});}}
    else this.openSettings();
    this.setData({message:'已中止本地等待；已发送的写操作仍须核实。'});
  },
  onKeyDown(event){if(['ArrowUp','ArrowDown','Enter','Backspace','Escape'].includes(event.code))event.preventDefault();},
  onKeyUp(event) {
    if(!['ArrowUp','ArrowDown','Enter','Backspace','Escape'].includes(event.code))return;
    event.preventDefault();
    if(event.code==='Backspace'||event.code==='Escape'){if(event.repeat)return;return this.handleBackPress(event);}
    if(this.data.listening){if(event.code==='Enter'&&this.recognition)this.recognition.stop();return;}
    if(this.data.busy){if(event.code==='Backspace')return this.cancelPending();return;}
    if(event.code==='ArrowUp'||event.code==='ArrowDown'){this.moveFocus(event.code==='ArrowUp'?-1:1);return;}
    return this.activateFocused(true);
  },
  onVoiceWakeup(event) { event.preventDefault();if(event.keyword!=='clickAiAssist')this.listen(); },
  listen() {
    if(this.data.busy)return;
    if(this.recognition){this.recognition.stop();return;}
    try{
      if(this.speechPlayer)this.speechPlayer.destroy();if(this.speechTask)this.speechTask.abort();
      const generation=(this.recognitionGeneration||0)+1;this.recognitionGeneration=generation;
      const recognition=new SpeechRecognition();recognition.lang='zh-CN';recognition.continuous=false;recognition.interimResults=false;
      recognition.onresult=event=>{
        const result=event.results[event.resultIndex||0],text=result&&result[0]?result[0].transcript:'';
        if(this.visible&&generation===this.recognitionGeneration&&text){this.recognition=null;this.setData({listening:false});this.understand(text);}
      };
      recognition.onerror=()=>{if(this.visible&&generation===this.recognitionGeneration)this.setData({message:'语音暂不可用；可按键选择现有选项，或重新唤醒重试。',listening:false});};
      recognition.onend=()=>{if(this.recognition===recognition)this.recognition=null;if(this.visible&&generation===this.recognitionGeneration)this.setData({listening:false});};
      this.recognition=recognition;this.setData({listening:true,message:'正在聆听；确认键结束，双击返回取消并退出'});recognition.start();
    }catch(e){this.recognition=null;this.setData({listening:false,message:'语音暂不可用；自由内容尚未录入，请重试。'});}
  },
  async understand(raw) {
    const text=String(raw||'').trim().replace(/[。！？]$/,'');if(!text||this.data.busy)return;
    if(/^(确认|确认下单|确认保存|确认领取|提交|保存地址|领券)$/.test(text)){this.setData({message:'核对后请按确认键提交。'});return;}
    if(/^(返回|取消)$/.test(text)){this.goBack();return;}
    if(/^(上一项|下一项)$/.test(text)){this.moveFocus(text==='上一项'?-1:1);return;}
    if(/^(上一页|下一页)$/.test(text)){const delta=text==='上一页'?-1:1;if(this.data.voiceDraft&&this.data.ui.draftPages>1)this.advanceDraft(delta);else if(this.data.view.screen==='review'&&this.data.ui.receiptMaxScroll>0)this.advanceReceipt(delta);else if(this.data.view.screen==='coupon-confirm'&&this.data.ui.couponPages>1)this.advanceCoupon(delta);else if(this.data.ui.descriptionPages>1)this.advanceDescription(delta);return;}
    if(/^(领取优惠|查看可领取优惠)$/.test(text)){if(!this.data.previewScene)return this.send({type:'available'});return;}
    if(/^(打开设置|连接设置)$/.test(text)){this.openSettings();return;}
    if(/^(重新连接|连接麦当劳)$/.test(text)){if(!this.data.previewScene)return this.connect();return;}
    if(/^(打开场景|浏览场景)$/.test(text)){this.openGallery();return;}
    if(/^(使用这条内容|使用识别内容)$/.test(text)){if(!this.data.previewScene)return this.acceptInput();return;}
    if(/^(重新录入|重新说|语音输入)$/.test(text)){this.listen();return;}
    const number=text.match(/^(?:选择)?第([零一二两三四五六七八九十\d]+)(?:个|项|屏|场景)$/);
    if(number){const n=spokenNumber(number[1]);if(this.data.gallery||(this.data.previewScene&&/屏|场景/.test(text))){if(this.data.scenes[n-1]){this.showScene(this.data.scenes[n-1].id);}return;}
      const r=this.data.rows[n-1];if(r&&!r.disabled){this.focusId='row-'+r.index;this.decorate();return this.activateFocused(false);}return;}
    if(this.data.previewScene){this.setData({message:'只读场景；可说第几屏，或按返回键选屏。'});return;}
    if(this.data.settings){this.setData({message:'可说重新连接、浏览场景或返回。'});return;}
    if(/^(增加数量|减少数量)$/.test(text)){
      const delta=text==='增加数量'?1:-1;
      if(this.data.view.screen==='quantity-editor')return this.changeQuantity(delta);
      if(this.data.view.screen==='meal')return this.send({type:'quantity',value:Math.max(1,Math.min(20,this.data.ui.quantity+delta))});
      const focus=(this.controls||[]).find(c=>c.id===this.focusId),r=focus&&this.data.rows[focus.rowIndex];
      if(this.data.view.screen==='cart'&&r)return this.send({type:'line-quantity',id:r.id,value:Math.max(0,Math.min(20,(r.quantity||1)+delta))});
      this.setData({message:'请先选择要调整的餐品。'});return;
    }
    if(this.data.view.input){this.setData({voiceDraft:text,draftPage:0,message:'请核对识别内容；确认键使用，语音入口可重录。'});this.focusId='input-accept';this.decorate();return;}
    const direct={'开始点餐':{type:'start'},'到店自取':{type:'fulfillment',value:'pickup'},'麦乐送':{type:'fulfillment',value:'delivery'}};
    if(direct[text])return this.send(direct[text]);
    const state=this.data.view,generation=this.generation;this.setData({busy:true,message:'正在理解需求'});let intent;
    try{
      if((await LanguageModel.availability())!=='available')throw new Error('unavailable');
      this.model=await LanguageModel.create({initialPrompts:[{role:'system',content:'你是点餐意图分类器。只返回 JSON，格式 {"intent":"start|back|wallet|orders|nutrition|account|campaign|select|unknown","index":1}。select 只能选择当前列表中的序号。不得生成确认、下单、地址、领券或任意网络调用。当前选项：'+state.rows.map((r,i)=>(i+1)+':'+r.title).join('；')}]});
      const result=await this.model.prompt(text);intent=JSON.parse(result.replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''));
    }catch(e){const index=state.rows.findIndex(r=>text.includes(r.title));intent=index>=0?{intent:'select',index:index+1}:/点餐|想吃/.test(text)?{intent:'start'}:/优惠券/.test(text)?{intent:'wallet'}:/订单/.test(text)?{intent:'orders'}:/热量|营养/.test(text)?{intent:'nutrition'}:/积分/.test(text)?{intent:'account'}:/活动/.test(text)?{intent:'campaign'}:{intent:'unknown'};}
    finally{if(this.model){this.model.destroy();this.model=null;}if(this.visible&&generation===this.generation)this.setData({busy:false});}
    if(!this.visible||generation!==this.generation)return;
    if(['start','back'].includes(intent.intent))return this.send({type:intent.intent});
    if(['wallet','orders','nutrition','account','campaign'].includes(intent.intent))return this.send({type:'query',value:intent.intent});
    const r=intent.intent==='select'&&Number.isInteger(intent.index)?this.data.rows[intent.index-1]:null;
    if(r&&!r.disabled){this.focusId='row-'+r.index;this.decorate();return this.activateFocused(false);}
    this.setData({message:'没有理解；可按键选择或重新说。'});
  },
  locate() {
    try {
      if (!navigator.geolocation) throw new Error('unavailable');
      this.setData({ busy: true, message: '正在获取位置' });
      const generation = this.generation;
      navigator.geolocation.getCurrentPosition((position) => {
        if (!this.visible || generation !== this.generation) return;
        this.setData({ busy: false }); this.send({ type: 'geo-stores', value: { longitude: position.coords.longitude, latitude: position.coords.latitude } });
      }, () => { if (this.visible) this.setData({ busy: false, message: '定位不可用，请通过语音提供城市和位置。' }); }, { timeout: 10000, maximumAge: 60000 });
    } catch (e) { this.setData({ busy: false, message: '定位不可用，请通过语音提供城市和位置。' }); }
  },
  async speak(text) {
    if (this.data.listening || !this.visible) return;
    const speechGeneration=(this.speechGeneration||0)+1;this.speechGeneration=speechGeneration;
    try {
      if (this.speechPlayer) this.speechPlayer.destroy();
      if (this.speechTask) this.speechTask.abort();
      const task = await speechSynthesis.synthesize(new SpeechSynthesisUtterance(text));
      if (!this.visible || this.speechGeneration!==speechGeneration) { task.abort(); return; }
      this.speechTask = task; this.speechPlayer = new SpeechAudioPlayer(task); this.speechPlayer.play();
      task.finished.catch(() => {});
    } catch (e) { /* Spoken output is optional; all information remains on screen. */ }
  }
};
</script>
<page>
 <view class="{{settings || gallery || view.screen === 'orders' || view.screen === 'order-detail' ? 'screen top-screen' : view.screen === 'review' ? 'screen review-screen' : 'screen'}}">
  <view ink:if="{{settings || gallery}}" class="header"><text class="title">{{settings ? '麦当劳连接设置' : '场景总览'}}</text></view>
  <view ink:elif="{{ui.home}}" class="{{controlId === 'home-settings' ? 'home-brand key-focused' : 'home-brand'}}"><image class="brand" src="/assets/brand/golden-arches.svg" mode="aspectFit"/><text class="brand-name">麦当劳</text></view>
  <view ink:elif="{{!ui.noHeader}}" class="header"><text class="title">{{ui.title}}</text><view class="{{view.screen === 'order-detail' ? 'aside order-detail-status' : ui.asideIcon && ui.fulfillment !== 'delivery' && view.screen !== 'addresses' ? 'aside fulfillment-aside' : 'aside'}}"><image ink:if="{{ui.asideIcon}}" class="aside-icon" src="{{ui.asideIcon}}"/><text>{{view.screen === 'order-detail' ? ui.order.status : ui.aside}}</text></view></view>
  <scroll-view ink:if="{{settings}}" class="content setup" scroll-y="true" scroll-top="{{listScroll}}">
   <text class="copy">内置凭证 · 眼镜直接连接麦当劳</text><text class="hint">上下键选择，确认键执行，返回键返回</text>
   <text class="hint">{{busy ? message : connectionLabel}}</text>
   <button id="setting-connect" class="{{controlId === 'setting-connect' ? 'action primary focused' : 'action primary'}}">重新连接并检测授权</button>
   <button id="setting-gallery" class="{{controlId === 'setting-gallery' ? 'action focused' : 'action'}}">浏览 42 屏与 18 个交互状态</button>
  </scroll-view>
  <scroll-view ink:if="{{gallery}}" class="content" scroll-y="true" scroll-top="{{listScroll}}"><button ink:for="{{scenes}}" ink:key="id" id="{{'scene-' + item.id}}" class="{{controlId === 'scene-' + item.id ? 'option focused' : 'option'}}"><text class="row-title">{{item.id}} · {{item.title}}</text></button></scroll-view>
  <view ink:if="{{!settings && !gallery && (busy || listening)}}" class="center content"><view class="status-circle"><image class="status-image" src="{{listening ? '/assets/icons/wave.svg' : '/assets/icons/loader.svg'}}" mode="aspectFit"/></view><text class="central-title">{{listening ? '想吃什么，直接告诉我' : message}}</text><text class="muted">{{listening ? '说完后，我会帮你确认' : '请稍候，无需重复操作'}}</text><button ink:if="{{listening}}" class="action primary">确认键结束录音</button></view>
  <view ink:if="{{!settings && !gallery && !busy && !listening && ui.home}}" class="home-space content"><button class="{{controlId === 'home-mic' ? 'mic-circle key-focused' : 'mic-circle'}}"><image class="mic-image" src="/assets/icons/mic-idle.svg" mode="aspectFit"/></button><text class="home-title">今天，想吃点什么？</text><text class="home-prompt">“来份板烧鸡腿堡套餐”</text></view>
  <view ink:if="{{!settings && !gallery && !busy && !listening && ui.central && !ui.special}}" style="height: {{ui.centralHeight}}px" class="{{view.screen === 'error' ? 'content center central-shell error-layout' : view.screen === 'claim-result' ? 'content center central-shell result-layout' : view.input && !previewScene ? 'content center central-shell voice-shell' : view.screen === 'address-entry' ? 'content center central-shell address-entry-shell' : 'content center central-shell'}}">
   <view class="{{ui.tight ? 'center central-content compact-center' : 'center central-content'}}"><view ink:if="{{!voiceDraft}}" class="{{ui.plainStatus ? 'plain-status' : 'status-circle' + ui.tone}}"><image class="status-image" src="{{ui.status}}" mode="aspectFit"/></view><text ink:if="{{!voiceDraft}}" class="central-title">{{ui.heading}}</text><text ink:if="{{ui.value}}" class="status-value">{{ui.value}}</text><text ink:for="{{ui.descriptionLines}}" ink:key="*this" class="muted center-copy">{{item}}</text><text ink:if="{{ui.descriptionPages > 1}}" id="description-page" class="{{controlId === 'description-page' ? 'hint receipt-focus' : 'hint'}}">{{ui.descriptionStep}}</text>
   <view ink:if="{{view.input && !previewScene}}" class="voice-entry"><text ink:if="{{view.screen !== 'address-entry'}}" class="muted">{{view.input.placeholder}} · 语音填写</text><text ink:if="{{voiceDraft}}" class="voice-draft">{{ui.draftText}}</text><text ink:if="{{voiceDraft && ui.draftPages > 1}}" id="input-page" class="{{controlId === 'input-page' ? 'hint receipt-focus' : 'hint'}}">{{ui.draftStep}}</text><view class="voice-actions"><button id="input-listen" class="{{controlId === 'input-listen' ? 'action focused' : 'action'}}">{{voiceDraft ? '重新录入' : '语音填写'}}</button><button ink:if="{{voiceDraft}}" id="input-accept" class="{{controlId === 'input-accept' ? 'action focused' : 'action'}}">使用这条内容</button></view></view>
   <button ink:for="{{rows}}" ink:key="id" id="{{item.domId}}" class="{{item.cls}}" data-index="{{item.index}}"><text class="row-title">{{item.selected ? '✓ ' : ''}}{{item.title}}</text></button>
   <text ink:if="{{view.total}}" class="status-value">{{view.total}}</text></view>
  </view>
  <view ink:if="{{!settings && !gallery && !busy && !listening && ui.special}}" class="content special-center" style="height: {{ui.centralHeight}}px">
   <view ink:if="{{view.screen === 'coupon-confirm' || view.screen === 'claim-confirm'}}" class="coupon-layout"><image class="coupon-large" src="/assets/brand/coupon-hover.svg"/><text class="central-title">{{ui.heading}}</text><view ink:if="{{view.screen === 'coupon-confirm'}}" class="price-comparison"><text ink:if="{{ui.originalAmount}}" class="muted">原应付</text><view ink:if="{{ui.originalAmount}}" class="strike-wrap"><text class="muted">{{ui.originalAmount}}</text><view class="strike-line"/></view><text class="status-value">{{view.total}}</text></view><text ink:if="{{view.screen === 'coupon-confirm'}}" class="muted">{{ui.savings ? '本次节省 ' + ui.savings : ''}}</text><text ink:if="{{view.screen === 'coupon-confirm' && ui.couponPageLines.length}}" ink:for="{{ui.couponPageLines}}" ink:key="*this" class="muted coupon-detail">{{item}}</text><text ink:if="{{view.screen === 'coupon-confirm' && ui.couponPages > 1}}" id="coupon-page" class="{{controlId === 'coupon-page' ? 'hint receipt-focus' : 'hint'}}">{{ui.couponStep}}</text><text ink:if="{{view.screen === 'claim-confirm'}}" class="claim-value">¥3</text><text ink:if="{{view.screen === 'claim-confirm'}}" class="muted">{{ui.description}}</text></view>
   <view ink:elif="{{view.screen === 'address-confirm'}}" class="address-layout"><view class="status-inline"><image class="address-pin" src="/assets/icons/pin.svg"/><text class="row-title">{{ui.address}}</text></view><text ink:if="{{ui.contact}}" class="muted">{{ui.contact}}</text><text ink:if="{{!previewScene}}" ink:for="{{ui.descriptionLines}}" ink:key="*this" class="muted">{{item}}</text><text ink:if="{{!previewScene && ui.descriptionPages > 1}}" id="description-page" class="{{controlId === 'description-page' ? 'hint receipt-focus' : 'hint'}}">{{ui.descriptionStep}}</text></view>
   <view ink:else class="payment-layout"><view class="status-inline"><view class="{{'status-circle' + ui.tone}}"><image class="status-image" src="{{ui.status}}"/></view><text ink:if="{{view.screen === 'payment'}}" class="central-title">{{ui.heading}}</text><view ink:else class="status-copy"><text ink:if="{{ui.statusLabel}}" class="muted">{{ui.statusLabel}}</text><text class="order-value">{{ui.statusNumber}}</text></view></view><text ink:if="{{view.screen === 'payment'}}" class="status-value">{{ui.value}}</text><view ink:if="{{view.screen === 'order-status'}}" class="status-inline"><image class="small-icon" src="/assets/icons/pin.svg"/><text class="receipt-title">{{previewScene && ui.fulfillment === 'delivery' ? '家' : ui.store}}</text></view><text ink:if="{{previewScene && view.screen === 'order-status' && ui.fulfillment === 'delivery'}}" class="muted">骑手配送中，请保持手机畅通</text><text ink:if="{{view.screen === 'payment' || !previewScene}}" ink:for="{{ui.descriptionLines}}" ink:key="*this" class="muted">{{item}}</text><text ink:if="{{!previewScene && ui.descriptionPages > 1}}" id="description-page" class="hint">{{ui.descriptionStep}}</text></view>
  </view>
  <view ink:if="{{!settings && !gallery && !busy && !listening && view.screen === 'coupon-detail'}}" class="coupon-detail-layout">
   <view class="status-inline"><image class="coupon-detail-icon" src="/assets/brand/coupon-hover.svg"/><text class="title">{{ui.coupon.title}}</text></view>
   <text ink:if="{{ui.coupon.price}}" class="total">用券价 {{ui.coupon.price}}</text>
   <view class="coupon-info"><view ink:for="{{ui.couponInfo}}" ink:key="value" class="detail-line"><text ink:if="{{item.label}}" class="muted">{{item.label}}</text><text class="coupon-info-value">{{item.value}}</text></view><text ink:if="{{ui.descriptionPages > 1}}" id="description-page" class="hint">{{ui.descriptionStep}}</text></view>
  </view>
  <button ink:if="{{!settings && !gallery && view.screen === 'coupon-detail' && !previewScene}}" id="coupon-apply" class="{{controlId === 'coupon-apply' ? 'action primary focused' : 'action primary'}}">去点餐使用<image class="button-icon" src="/assets/icons/chevron.svg"/></button>
  <view ink:if="{{!settings && !gallery && view.screen === 'quantity-editor'}}" class="quantity-editor">
   <view class="meal-hero"><image class="food" src="{{view.hero}}"/><text class="row-title">{{ui.heading}}</text></view>
   <view class="stepper"><text class="row-title">数量</text><button id="quantity-minus" disabled="{{ui.quantity <= 0}}" class="{{controlId === 'quantity-minus' ? 'step-button focused' : 'step-button'}}">−</button><text class="quantity-value">{{ui.quantityLabel}}</text><button id="quantity-plus" disabled="{{ui.quantity >= 20}}" class="{{controlId === 'quantity-plus' ? 'step-button focused' : 'step-button'}}">＋</button></view>
   <text class="muted">{{view.summary}}</text><text class="muted">减至 0 份将移除餐品</text>
   <button id="quantity-done" class="{{controlId === 'quantity-done' ? 'action primary focused' : 'action primary'}}">完成修改</button>
  </view>
  <view ink:if="{{!settings && !gallery && view.screen === 'order-detail'}}" class="order-detail-layout">
   <view class="detail-card order-summary"><view class="order-store"><image class="small-icon" src="/assets/icons/bag.svg"/><text class="row-title">{{ui.order.store}}</text></view><view class="detail-line"><text class="muted">下单时间 {{ui.order.time}}</text><text class="price">{{ui.order.amount}}</text></view></view>
   <view class="detail-card"><text class="row-title">餐品明细</text><view ink:for="{{ui.orderItems}}" ink:key="name" class="detail-line"><text class="order-item-name">{{item.name}}</text><text class="order-item-quantity">×{{item.quantity}}</text></view><text ink:if="{{ui.descriptionPages > 1}}" id="description-page" class="hint">{{ui.descriptionStep}}</text></view>
   <view class="detail-card order-number"><text class="muted">订单号</text><text class="muted">{{ui.order.id}}</text></view>
  </view>
  <scroll-view ink:if="{{!settings && !gallery && !busy && !listening && view.screen === 'meal'}}" class="content inset-content" style="height: 187px" scroll-y="true" scroll-top="{{listScroll}}">
   <view class="meal-hero"><image class="meal-image" src="{{view.hero || '/assets/icons/bag.svg'}}" mode="aspectFit"/><text class="meal-name">{{view.summary}}</text><text class="price">{{ui.mealPrice}}</text></view>
   <view class="stepper"><text class="row-title">数量</text><button id="row-0" class="{{ui.quantity <= 1 ? 'step-button disabled-step' : ui.minusFocused ? 'step-button key-focused' : 'step-button'}}" disabled="{{ui.quantity <= 1}}">−</button><text class="quantity-value">{{ui.quantityLabel}}</text><button id="row-1" class="{{ui.plusFocused ? 'step-button key-focused' : 'step-button'}}">＋</button></view>
   <text ink:if="{{ui.mealParts}}" class="muted meal-parts">{{ui.mealParts}}</text><button ink:for="{{ui.mealRows}}" ink:key="id" id="{{item.domId}}" class="{{item.cls}}" data-index="{{item.index}}"><view class="row-copy"><text class="row-title">{{item.title}}</text><text class="row-subtitle">{{item.subtitle}}</text></view><image class="chevron" src="/assets/icons/chevron.svg"/></button>
  </scroll-view>
  <scroll-view ink:if="{{!settings && !gallery && !busy && !listening && view.screen === 'review'}}" class="{{ui.address ? 'content receipt delivery-receipt' : 'content receipt'}}" scroll-y="true" scroll-top="{{receiptScroll}}" style="height: 156px">
   <view class="receipt-store"><image class="small-icon" src="{{ui.fulfillment === 'delivery' ? '/assets/icons/navigation.svg' : '/assets/icons/store.svg'}}"/><text class="row-title">{{ui.store}}</text></view><text ink:if="{{ui.address}}" class="receipt-address">{{ui.address}}</text>
   <view ink:for="{{ui.receiptItems}}" ink:key="title" class="{{item.inline ? 'receipt-line receipt-meta' : 'receipt-line'}}"><view ink:if="{{item.inline}}" class="meta-separator"/><view ink:if="{{!item.inline}}" class="row-copy"><text class="receipt-title">{{item.title}}</text><text ink:if="{{item.subtitle}}" class="muted">{{item.subtitle}}</text></view><text ink:if="{{item.inline}}" class="receipt-title">{{item.title}}</text><text ink:if="{{item.inline && item.subtitle}}" class="muted">{{item.subtitle}}</text><text ink:if="{{item.value}}" class="receipt-title">{{item.value}}</text></view>
  </scroll-view>
  <scroll-view ink:if="{{!settings && !gallery && !busy && !listening && view.screen === 'customize'}}" class="content inset-content" style="height: 187px" scroll-y="true" scroll-top="{{listScroll}}">
   <view ink:for="{{ui.groups}}" ink:key="name" class="custom-group"><text class="muted">{{item.name}}</text><view class="chips"><button ink:for="{{item.rows}}" ink:key="id" id="{{item.domId}}" class="{{item.cls}}" data-index="{{item.index}}"><text class="chip-title">{{item.title}}</text><image ink:if="{{item.showCheck}}" class="chip-check" src="/assets/icons/check-button.svg"/></button></view></view>
  </scroll-view>
  <scroll-view ink:if="{{!settings && !gallery && !busy && !listening && view.screen === 'cart'}}" class="content cart-list" style="height: {{ui.listHeight}}px" scroll-y="true" scroll-top="{{listScroll}}">
   <view ink:for="{{ui.cartRows}}" ink:key="id" class="cart-card"><view class="cart-left"><image class="food" src="{{item.image ? item.icon : '/assets/icons/bag.svg'}}"/><view class="row-copy"><text class="row-title">{{item.title}}</text><text class="row-subtitle">{{item.subtitle}}</text></view></view><view class="cart-right"><text class="price">{{item.price}}</text><text class="muted">×{{item.quantityLabel}}</text><button id="{{item.domId}}" class="{{focusIndex === item.index ? 'edit-quantity action focused' : 'edit-quantity action'}}">修改数量<image class="chevron" src="/assets/icons/chevron.svg"/></button></view></view>
  </scroll-view>
  <scroll-view ink:if="{{!settings && !gallery && !busy && !listening && !ui.home && !ui.central && view.screen !== 'meal' && view.screen !== 'review' && view.screen !== 'customize' && view.screen !== 'cart' && view.screen !== 'coupon-detail' && view.screen !== 'order-detail' && view.screen !== 'quantity-editor'}}" class="{{ui.listClass}}" style="height: {{ui.listHeight}}px" scroll-y="true" scroll-top="{{listScroll}}">
   <text ink:if="{{ui.showSummary && view.summary}}" class="summary">{{view.summary}}</text>
   <view ink:if="{{view.input && !previewScene}}" class="voice-entry"><text ink:if="{{view.screen !== 'address-entry'}}" class="muted">{{view.input.placeholder}} · 语音填写</text><text ink:if="{{voiceDraft}}" class="voice-draft">{{ui.draftText}}</text><text ink:if="{{voiceDraft && ui.draftPages > 1}}" id="input-page" class="{{controlId === 'input-page' ? 'hint receipt-focus' : 'hint'}}">{{ui.draftStep}}</text><view class="voice-actions"><button id="input-listen" class="{{controlId === 'input-listen' ? 'action focused' : 'action'}}">{{voiceDraft ? '重新录入' : '语音填写'}}</button><button ink:if="{{voiceDraft}}" id="input-accept" class="{{controlId === 'input-accept' ? 'action focused' : 'action'}}">使用这条内容</button></view></view>
    <view class="{{ui.largeCompact ? 'compact-group fulfillment-group' : ui.timeCompact ? 'time-group' : ui.compact ? 'compact-group' : view.screen === 'customize' ? 'chips' : 'row-group'}}">
    <button ink:for="{{ui.visibleRows}}" ink:key="id" id="{{item.domId}}" class="{{item.cls}}" disabled="{{item.disabled}}" data-index="{{item.index}}"><image ink:if="{{item.icon}}" class="{{item.image ? 'food' : 'row-icon'}}" src="{{item.icon}}" mode="aspectFit"/><view class="row-copy"><text class="row-title">{{item.displayIndex ? item.displayIndex + '. ' : ''}}{{item.selected ? '✓ ' : ''}}{{item.title}}</text><text ink:if="{{item.subtitle && view.screen !== 'customize'}}" class="row-subtitle">{{item.subtitle}}</text></view><text ink:if="{{item.price}}" class="price">{{item.price}}</text><image ink:if="{{item.chevron}}" class="chevron" src="/assets/icons/chevron.svg" mode="aspectFit"/></button>
   </view>
  </scroll-view>
  <view ink:if="{{!settings && !gallery && !busy && !listening && view.screen === 'review' && rows.length}}" class="takeways chips"><button ink:for="{{rows}}" ink:key="id" id="{{item.domId}}" class="{{'chip' + (item.selected ? ' selected' : '') + (focusIndex === item.index ? ' focused' : '')}}" data-index="{{item.index}}"><text class="chip-title">{{item.selected ? '✓ ' : ''}}{{item.title}}</text></button></view>
  <view ink:if="{{!settings && !gallery && !busy && !listening && view.screen === 'review'}}" class="review-total"><view class="total-separator"/><view class="total-label"><text class="receipt-title">应付</text><text id="receipt-scroll" class="{{controlId === 'receipt-scroll' ? 'hint receipt-focus' : 'hint'}}">上下滑动查看明细</text></view><text class="total">{{view.total}}</text></view>
  <view ink:if="{{!settings && !gallery && !busy && !listening && ui.home}}" class="footer"><button class="{{ui.homeStartClass}}" data-index="0"><text>开始点餐</text><image class="button-icon" src="/assets/icons/arrow.svg"/></button><button class="{{ui.homeWalletClass}}" data-index="1"><image class="home-coupon-icon" src="/assets/brand/coupon-hover.svg"/></button><button class="{{ui.homeOrdersClass}}" data-index="2"><image class="button-icon" src="/assets/icons/bag.svg"/></button></view>
  <view ink:if="{{!settings && !gallery && !busy && !listening && !ui.home && (ui.actions.length || (!previewScene && more))}}" class="footer"><button ink:for="{{actions}}" ink:key="label" id="{{'action-' + item.index}}" class="{{item.cls}}" data-index="{{item.index}}"><image ink:if="{{item.icon && !item.iconAfter}}" class="button-icon" src="{{'/assets/icons/' + item.icon + '.svg'}}"/><view ink:if="{{item.iconAfter}}" class="action-label"><text>{{item.label}}</text><image class="button-icon" src="{{'/assets/icons/' + item.icon + '.svg'}}"/></view><text ink:if="{{!item.back && !item.iconAfter}}">{{item.label}}</text></button></view>
  <text ink:if="{{!busy && message}}" class="message">{{message}}</text><text ink:if="{{!busy && ui.alert && !settings}}" class="message">{{ui.alert}}</text>
 </view>
</page>
<style>
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
.mic-circle { --button-radius: 32px; --button-background-color: #1c180b; --button-padding-x: 0px; --button-padding-y: 0px; width: 64px; height: 64px; padding: 0px; border: 1px solid #625529; border-radius: 32px; background-color: #1c180b; display: flex; justify-content: center; align-items: center; }
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
.stepper { display: flex; flex-direction: row; align-items: center; gap: 12px; margin: 0px 0px 12px 0px; }
.step-button { --button-radius: 24px; --button-padding-x: 0px; --button-padding-y: 0px; width: 48px; height: 48px; padding: 0px; border: 2px solid #505050; border-radius: 24px; font-size: var(--font-quantity); line-height: var(--line-quantity); }
.custom-group { flex-shrink: 0; display: flex; flex-direction: column; gap: 8px; margin: 0px 0px 10px 0px; }
.chip-title { font-size: var(--font-body); line-height: var(--line-body); }
.cart-card { flex-shrink: 0; border: 1px solid #444444; border-radius: 24px; background-color: #141414; padding: 12px; margin: 0px 0px 12px 0px; }
.cart-main { --button-background-color: #141414; --button-padding-x: 0px; --button-padding-y: 0px; padding: 0px; display: flex; flex-direction: row; align-items: center; gap: 10px; width: 100%; margin: 0px 0px 12px 0px; }
.chips { flex-shrink: 0; display: flex; flex-direction: row; flex-wrap: wrap; gap: 8px; }
.chip { flex-basis: 0; --button-radius: 26px; --button-padding-x: 12px; --button-padding-y: 7px; padding: 7px 12px; border: 2px solid #505050; border-radius: 26px; height: 48px; flex-grow: 1; font-size: 24px; }
.fulfillment-badge { margin-left: auto; display: flex; flex-direction: row; align-items: center; gap: 4px; }
.receipt-address { margin: 8px 0px 8px 0px; color: #c1c1c1; font-size: var(--font-body); line-height: var(--line-body); }
.receipt-store { flex-shrink: 0; display: flex; flex-direction: row; align-items: center; gap: 9px; margin: 0px 0px 10px 0px; }
.small-icon { width: 22px; height: 22px; }
.receipt-line { flex-shrink: 0; display: flex; flex-direction: row; justify-content: space-between; gap: 12px; margin: 0px 0px 4px 0px; }
.receipt-title { font-size: var(--font-body); line-height: var(--line-body); }
.review-total { position: relative; display: flex; flex-direction: row; align-items: center; justify-content: space-between; border-top: 1px solid #4c493d; padding: 9px 0px 0px 0px; height: 47px; flex-shrink: 0; }
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
.total-separator { position: absolute; width: 100%; height: 1px; background-color: #4c493d; transform: translateY(-28px); }
.meta-separator { position: absolute; width: 100%; height: 1px; background-color: #363636; transform: translateY(-10px); }
.fulfillment-aside { color: #ffcf32; }
.receipt { padding: 0px 5px 8px 5px; }
.receipt-meta { position: relative; padding-top: 6px; margin-top: 6px; }
.menu-action { --button-background-color: #23211a; --button-text-color: #ffe08b; --button-border-color: #6b6142; background-color: #23211a; color: #ffe08b; border-color: #6b6142; }
.selected { --button-border-color: #8a7440; border-color: #8a7440; }
.focused { --button-border-color: #ffcf32; --button-background-color: #302d23; --button-text-color: #ffffff; border-color: #ffcf32; background-color: #302d23; box-shadow: 0px 0px 0px 1px #ffcf32; }
.quantity-value { width: 26px; text-align: center; font-size: var(--font-quantity); line-height: var(--line-quantity); font-weight: 700; }
.address-pin { width: 28px; height: 28px; }
.coupon-layout { gap: 8px; min-height: 0px; max-height: 100%; overflow: hidden; }
.coupon-detail { max-width: 442px; text-align: center; }
.payment-layout { gap: 15px; }
.home-coupon-icon { width: 38px; height: 38px; }
.error-layout .status-circle { width: 72px; height: 72px; }
.error-layout .status-image { width: 44px; height: 44px; }
.chip-title { font-size: var(--font-body); line-height: var(--line-body); }
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
.home-space { height: 172px; flex-shrink: 0; }
.home-brand { height: 30px; }
.central-content { padding: 16px 8px; }
.plain-status { margin-bottom: 4px; }
.special-center { flex-grow: 0; }
.coupon-detail-layout { display: flex; flex-direction: column; gap: 12px; padding: 12px 10px; }
.coupon-detail-icon { width: 42px; height: 42px; }
.detail-line { display: flex; flex-direction: row; justify-content: space-between; align-items: center; gap: 12px; }
.order-detail-layout { display: flex; flex-direction: column; gap: 8px; margin: 2px 4px 0px 4px; }
.detail-card { display: flex; flex-direction: column; gap: 8px; padding: 12px 14px; border: 1px solid #444444; border-radius: 18px; background-color: #141414; }
.order-summary { gap: 4px; }
.quantity-editor { display: flex; flex-direction: column; gap: 12px; }
.cart-card { display: flex; flex-direction: row; align-items: center; justify-content: space-between; gap: 12px; }
.cart-left { display: flex; flex-direction: row; align-items: center; gap: 12px; flex-grow: 1; flex-basis: 0; }
.cart-right { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; }
.edit-quantity { flex-grow: 0; flex-basis: auto; }
.stepper { justify-content: flex-end; }
.address-layout { align-items: flex-start; }
.address-layout .status-inline { justify-content: flex-start; }
.detail-card.detail-line { flex-direction: row; }
.mic-circle { border-color: #888888; border-style: dashed; background-color: #111111; }
.coupon-layout { gap: 12px; }
.coupon-detail-layout { height: 213px; box-sizing: border-box; }
.coupon-detail-layout > .total { text-align: center; }
.central-content { padding: 8px; }
.plain-status { margin-bottom: 0px; }
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
.mic-circle { --button-background-color: #111111; --button-border-color: #888888; }
.address-layout .status-inline { width: 100%; gap: 12px; }
.address-layout .row-title { flex: 1; min-width: 0px; font-size: var(--font-body); line-height: var(--line-body); }
.address-entry-shell .status-circle { width: 64px; height: 64px; border: 1px dashed #888888; background-color: #111111; }
</style>
