// All non-touch input resolves to the same visible focus targets.
export function controlsFor(d) {
 const result=[]; const add=(id,label,legacy,command,event,scrollId=id,extra={})=>result.push({id,label,legacy,command,event,scrollId,...extra});
 if(d.settings){add('setting-connect','重新连接',-101,'connect');return result;}
 const {ui,view}=d;
 if(view.presentation?.locationFallback)add('location-voice','语音提供位置',-110,'listen');
 if(view.screen==='quantity-editor'){
  if(ui.quantity>0)add('quantity-minus','减少数量',0,'quantity-change',null,'quantity-minus',{delta:-1});
  if(ui.quantity<20)add('quantity-plus','增加数量',1,'quantity-change',null,'quantity-plus',{delta:1});
  add('quantity-delete','删除商品',2,'delete-line');add('quantity-done','完成修改',3,'quantity-done');return result;
 }
 if(view.screen==='coupon-detail'){
  if(ui.descriptionPages>1)add('description-page','查看下一页内容',-1,'description');
  add('coupon-apply','去点餐使用',0,'coupon-apply');return result;
 }
 if(view.screen==='order-detail'&&ui.descriptionPages>1){add('description-page','查看下一页内容',0,'description');return result;}

 if(ui.home){
  add('home-settings','连接设置',-101,'settings');
  for(const r of ui.rows.slice(0,3))if(!r.disabled)add('row-'+r.index,r.title,r.index,view.screen==='cart'&&r.event.type==='edit-line'?'edit-quantity':null,view.screen==='cart'&&r.event.type==='edit-line'?null:r.event);
  return result;
 }
 if(view.input){
  add('input-listen',d.voiceDraft?'重新录入':'语音填写',-104,'listen');
  if(d.voiceDraft&&ui.draftPages>1)add('input-page','翻阅识别内容',-107,'draft');
  if(d.voiceDraft)add('input-accept','使用这条内容',-105,'accept-input');
 }
 for(const r of ui.rows){
  if(r.disabled||(view.screen==='meal'&&((r.id==='minus'&&ui.quantity<=1)||(r.id==='plus'&&ui.quantity>=20))))continue;
  add('row-'+r.index,r.title,r.index,view.screen==='cart'&&r.event.type==='edit-line'?'edit-quantity':null,view.screen==='cart'&&r.event.type==='edit-line'?null:r.event,'row-'+r.index,{rowIndex:r.index});

 }
 if(ui.receiptMaxScroll>0&&view.screen==='review')add('receipt-scroll','滚动查看明细',ui.rows.length+ui.actions.length,'receipt');
 if(ui.couponPages>1&&view.screen==='coupon-confirm')add('coupon-page','查看优惠明细',ui.rows.length+ui.actions.length,'coupon');
 if(ui.descriptionPages>1)add('description-page','查看下一页内容',ui.rows.length+ui.actions.length+1,'description');
 for(const a of ui.actions)if(!a.disabled)add('action-'+a.index,a.label,ui.rows.length+a.index,a.event.type==='listen'?'listen':null,a.event.type==='listen'?null:a.event,'action-'+a.index,{keyOnly:['confirm','approve-cart-change'].includes(a.event.type)});
 return result;
}
export function spokenNumber(text){
 if(/^\d+$/.test(text))return Number(text);
 const digits={'零':0,'一':1,'二':2,'两':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9};
 if(text==='十')return 10;
 if(text.includes('十')){const [a,b]=text.split('十');return (a?digits[a]:1)*10+(b?digits[b]:0);}
 return digits[text];
}
