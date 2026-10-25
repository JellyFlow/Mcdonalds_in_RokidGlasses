// The same row geometry is used by the template and the key scroll controller.
export function listLayout(rows, screen, hasFooter, focusedRow, previous = 0, prefix = 0, reserved = 0) {
 const viewport=276-(hasFooter?60:0)-reserved;
 const heights=rows.map(r=>r.height|| (screen==='cart'?149:screen==='orders'?84:(r.title.length>18||(r.subtitle||'').length>30)?128:96));
 const total=prefix+heights.reduce((n,h)=>n+h+8,0)-8;
 let scroll=Math.min(Math.max(0,previous),Math.max(0,total-viewport));
 if(Number.isInteger(focusedRow)&&focusedRow>=0&&focusedRow<rows.length){
  const top=prefix+heights.slice(0,focusedRow).reduce((n,h)=>n+h+8,0),bottom=top+heights[focusedRow];
  if(heights[focusedRow]>viewport)scroll=Math.max(top,Math.min(bottom-viewport,scroll));
  else if(top<scroll)scroll=top;
  else if(bottom>scroll+viewport)scroll=bottom-viewport;
 }
 return {height:Math.min(Math.max(0,total),viewport),scroll,overflowAbove:scroll>0,overflowBelow:total>scroll+viewport};
}
let textContext;
function measureStoreText(text,size,bold){
 if(!textContext&&typeof Canvas!=='undefined')textContext=new Canvas(1,1).getContext('2d');
 if(textContext){textContext.font=(bold?'700 ':'500 ')+size+'px sans-serif';return textContext.measureText(text).width;}
 // Headless unit tests have no Ink Canvas. Production uses the runtime font metrics.
 return Array.from(text).reduce((n,c)=>n+(/[\u0000-\u00ff]/.test(c)?size*0.65:size),0);
}
export function storeRows(rows,measure=measureStoreText,width=338){
 const wrap=(value,size,bold)=>{
  const lines=[];let line='';
  for(const char of String(value||'')){
   if(char==='\n'){lines.push(line);line='';continue;}
   if(line&&measure(line+char,size,bold)>width){lines.push(line);line='';}
   line+=char;
  }
  if(line)lines.push(line);
  return lines.map((text,index)=>({text,index}));
 };
 return rows.map(row=>{
  const titleLines=wrap((row.displayIndexLabel||'')+row.title,22,true),addressLines=wrap(row.storeAddress||'',18,false);
  const height=Math.max(96,30+titleLines.length*30+(addressLines.length?4+addressLines.length*26:0)+(row.assetRow?0:30));
  return {...row,titleLines,addressLines,height,statusLine:[row.distanceLabel||row.distanceHint,row.storeStatus].filter(Boolean).join(' · ')};
 });
}
// Menu columns share measured geometry with the native card template.
export function menuRows(rows,measure=measureStoreText){
 const priceWidth=Math.max(96,...rows.map(r=>Math.ceil(measure(r.price||'',24,true))+2));
 const titleWidth=Math.max(22,370-priceWidth);
 return storeRows(rows,measure,titleWidth).map(r=>({...r,priceWidth,titleWidth,height:Math.max(80,28+r.titleLines.length*30+(r.subtitle?30:0))}));
}
export function couponView(row, raw = {}) {
 const text=value=>typeof value==='string'?value.trim():'';
 const amount=raw.discountInfo?.discountDesc==='用券价格'?raw.discountInfo.discountValue:raw.usePrice;
 const validAmount=amount!==undefined&&amount!==null&&amount!==''&&Number.isFinite(Number(amount))&&Number(amount)>=0;
 const price=validAmount?'¥'+Number(amount).toFixed(2):row.price||'';
 let title=text(raw.title)||row.title;
 if(validAmount)title=title.replace(/^\d+(?:\.\d+)?元\s*/,'');
 const start=text(raw.tradeStartDate)||text(raw.tradeStartDateTime).slice(0,10),end=text(raw.tradeEndDate)||text(raw.tradeEndDateTime).slice(0,10);
 const dateParts=value=>value.match(/^(\d{4})[-.](\d{2})[-.](\d{2})$/);
 const a=dateParts(start),b=dateParts(end);
 let date=text(raw.validDate)||text(raw.tradeDateTime)||text(raw.tradeEndDateTime);
 const full=parts=>Number(parts[1])+'年'+Number(parts[2])+'月'+Number(parts[3])+'日';
 if(a&&b)date=start===end?full(a):full(a)+'—'+(a[1]===b[1]&&a[2]===b[2]?Number(b[3])+'日':full(b));
 else if(a||b)date=full(a||b);
 const periods=(raw.tradeTimePeriods||[]).map(p=>[text(p.startTime).slice(0,5),text(p.endTime).slice(0,5)]).filter(p=>p.every(Boolean));
 const time=text(raw.validTime)||(raw.isAllTradeTime===1?'全天':periods.map(p=>p.join('—')).join('、'));
 const types=raw.orderTypes||[],tags=(raw.tags||[]).map(t=>text(t.label));
 const pickup=types.includes(1)||tags.includes('到店专用'),delivery=types.includes(2)||tags.includes('外送专用');
 const fulfillment=text(raw.fulfillmentLabel)||(pickup&&delivery?'到店／外送':pickup?'仅到店':delivery?'仅外送':'');
 return {title,price,date:date||'未提供',time:time||'未提供',fulfillment:fulfillment||'未提供',description:text(raw.description)};
}
export function orderView(raw = {}) {
 const valid=value=>value!==undefined&&value!==null&&value!==''&&Number.isFinite(Number(value));
 const amount=valid(raw.quotedAmount)?'¥'+(Number(raw.quotedAmount)/100).toFixed(2):valid(raw.realTotalAmount)?'¥'+Number(raw.realTotalAmount).toFixed(2):'';
 return {id:String(raw.orderId||''),store:String(raw.storeName||''),status:String(raw.orderStatus||''),time:String(raw.createTime||''),amount,items:(raw.orderProductList||raw.items||raw.products||[]).map(x=>({name:String(x.productName||x.name||''),quantity:valid(x.quantity)?Number(x.quantity):null}))};
}
