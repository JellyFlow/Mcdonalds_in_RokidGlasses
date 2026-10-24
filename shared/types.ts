import type {OrderDraft} from './order-intent.js';
export type Obj = Record<string, any>;
export type Event = { type: string; id?: string; value?: any; revision?: number; actionId?: string };
export type Screen = 'home'|'fulfillment'|'location'|'addresses'|'address-entry'|'address-confirm'|'stores'|'menu'|'meal'|'customize'|'cart'|'coupon-select'|'coupon-confirm'|'tableware'|'time'|'reservation'|'remark'|'review'|'payment'|'order-status'|'orders'|'wallet'|'claim-confirm'|'claim-result'|'nutrition'|'account'|'campaign'|'error'|'uncertain'|'cancel-reasons'|'cancel-confirm'|'cart-change-confirm';
export interface Session {
 id: string; revision: number; screen: Screen; history: Screen[]; mode: 'live'|'mock';
 fulfillment: 'pickup'|'delivery'; stores: Obj[]; store?: Obj; addresses: Obj[]; address?: Obj;
 addressDraft: Obj; addressStep: number; city?: string; keyword?: string;
 orderDraft?:OrderDraft;cartChange?:{kind:'fulfillment'|'store';value:string};
 menuQuery?: string; menuBatch?: number; meals: Obj[]; detail?: Obj; selected?: Obj; cart: Obj[]; coupons: Obj[]; coupon?: Obj;
 needTableware: boolean; reservationDate?: string; remark: string; takeWayCode?: string;
 price?: Obj; quoteAt?: number; quoteHash?: string; action?: {id:string; kind:string; revision:number};
 cancelDraft?:{orderId:string;reason?:string};
 orderSource?: 'history'|'checkout'; order?: Obj; orders: Obj[]; content?: any; error?: string; retry?: Event; input?: string;
}
export interface Row {group?:string; quantity?:number; id:string; title:string; subtitle?:string; price?:string; image?:string; event:Event; selected?:boolean}
export interface View { presentation?:Obj;id:string; revision:number; mode:string; screen:string; title:string; summary:string; hero?:string; rows:Row[]; actions:{label:string;event:Event}[]; input?:{placeholder:string;value:string}; actionId?:string; total?:string; caption?:string; busy?:boolean}
export interface Gateway { mode:'live'|'mock'; call(name:string,args?:Obj):Promise<any>; tools():Promise<Obj[]>;supportsInput?(name:string,args:Obj):Promise<boolean>; close():Promise<void> }
export class UserError extends Error { constructor(message:string,public status=400){super(message);} }
