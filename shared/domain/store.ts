import type {Session} from './types.js';
export interface Submission { action_id:string;session_id:string;kind:string;status:string;order_id:string|null;started_at:number }
export interface StateStore {
 latest():Session|undefined;pending():any;get(id:string):Session|undefined;save(s:Session):void;
 submission(id:string):any;begin(id:string,s:Session,kind:string):void;finish(id:string,status:string,orderId?:string):void;
 finishSession(id:string,s:Session,orderId?:string):void;unresolved(id:string):any;
}
