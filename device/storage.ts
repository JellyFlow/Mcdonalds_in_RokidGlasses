import {clone,canonical} from '../shared/platform.js';
import type {Session} from '../shared/types.js';
import type {StateStore,Submission} from '../shared/store.js';
export interface Storage {getStorageSync(key:string):any;setStorageSync(key:string,value:any):void}
const KEY='mcd.device.v1', MARKER='mcd.device.initialized.v1';
type State={version:1;token:string;accountId?:string;sessions:Record<string,Session>;submissions:Record<string,Submission>;latest?:string};
export class DeviceStore implements StateStore {
 private state:State;private blocked=false;
 constructor(private storage:Storage){
  try{
   const raw=storage.getStorageSync(KEY),marker=storage.getStorageSync(MARKER);
   if(raw===undefined){if(marker!==undefined)throw new Error();this.state={version:1,token:'',sessions:{},submissions:{}};this.persist(this.state);this.writeMarker();}
   else {this.validate(raw);this.state=clone(raw);if(marker===undefined)this.writeMarker();}
   let changed=false;for(const row of Object.values(this.state.submissions)){if(row.status==='submitting'){row.status='uncertain';changed=true;}}
   if(changed)this.persist(this.state);
  }catch{throw new Error('设备存储不可用或记录损坏。已禁止提交，请先核对手机端记录；不要清除应用数据后重试。');}
 }
 private validate(s:any){
  if(!s||s.version!==1||typeof s.token!=='string'||!s.sessions||typeof s.sessions!=='object'||Array.isArray(s.sessions)||!s.submissions||typeof s.submissions!=='object'||Array.isArray(s.submissions))throw new Error();
  for(const [id,row] of Object.entries(s.submissions) as [string,Submission][]){if(!row||row.action_id!==id||!s.sessions[row.session_id]||!['submitting','uncertain','complete'].includes(row.status)||!['order','address','claim','cancel'].includes(row.kind)||!Number.isFinite(row.started_at))throw new Error();}
  for(const [id,row] of Object.entries(s.sessions) as [string,Session][]){if(!row||row.id!==id||!Array.isArray(row.cart)||!Number.isInteger(row.revision))throw new Error();}
  for(const row of Object.values(s.sessions) as Session[]){const d=row.orderDraft;if(d&&(!Array.isArray(d.items)||!d.items.length||!Number.isInteger(d.index)||d.index<0||d.index>=d.items.length||d.items.some(x=>typeof x.query!=='string'||!x.query.trim()||!Number.isInteger(x.quantity)||x.quantity<1||x.quantity>20)||d.selectionQuantity!==undefined&&(!Number.isInteger(d.selectionQuantity)||d.selectionQuantity<1||d.selectionQuantity>20)))throw new Error();if(row.cartChange&&(!['store','fulfillment'].includes(row.cartChange.kind)||typeof row.cartChange.value!=='string'))throw new Error();}
  if(s.latest&&!s.sessions[s.latest])throw new Error();
 }
 private writeMarker(){this.storage.setStorageSync(MARKER,1);if(this.storage.getStorageSync(MARKER)!==1)throw new Error();}
 private persist(state:State){
  if(this.blocked)throw new Error('存储校验失败，写操作已锁定。');
  try{this.storage.setStorageSync(KEY,clone(state));if(canonical(this.storage.getStorageSync(KEY))!==canonical(state))throw new Error();}
  catch{this.blocked=true;throw new Error('设备保存失败，操作未获本地确认。请核实已有操作，不要重复提交。');}
 }
 private update(fn:(s:State)=>void){const next=clone(this.state);fn(next);this.validate(next);this.persist(next);this.state=next;}
 token(){return this.state.token;}
 account(){return this.state.accountId;}
 configure(token:string,accountId?:string){
  if(token===this.state.token&&(!accountId||accountId===this.state.accountId))return;
  if(this.pending())throw new Error('有结果待核实的操作，不能替换或清除 Token。请先核对原账号订单。');
  this.update(s=>{s.token=token;s.accountId=accountId;s.sessions={};s.submissions={};delete s.latest;});
 }
 latest(){return this.state.latest?this.get(this.state.latest):undefined;}
 pending(){return Object.values(this.state.submissions).find(x=>x.status==='submitting'||x.status==='uncertain');}
 get(id:string){return clone(this.state.sessions[id]);}
 save(s:Session){this.update(state=>{state.sessions[s.id]=clone(s);state.latest=s.id;});}
 submission(id:string){return clone(this.state.submissions[id]);}
 begin(id:string,s:Session,kind:string){if(this.pending()||this.submission(id))throw new Error('已有提交记录，禁止重复操作。');this.update(state=>{state.sessions[s.id]=clone(s);state.latest=s.id;state.submissions[id]={action_id:id,session_id:s.id,kind,status:'submitting',order_id:null,started_at:Date.now()};});}
 finish(id:string,status:string,orderId?:string){this.update(state=>{if(!state.submissions[id])throw new Error();Object.assign(state.submissions[id],{status,order_id:orderId??null});});}
 finishSession(id:string,s:Session,orderId?:string){this.update(state=>{if(!state.submissions[id])throw new Error();Object.assign(state.submissions[id],{status:'complete',order_id:orderId??null});state.sessions[s.id]=clone(s);state.latest=s.id;});}
 unresolved(id:string){return clone(Object.values(this.state.submissions).find(x=>x.session_id===id&&(x.status==='submitting'||x.status==='uncertain')));}
}
