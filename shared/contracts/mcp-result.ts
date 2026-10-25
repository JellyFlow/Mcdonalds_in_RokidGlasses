import {decode} from '@toon-format/toon';
import {UserError,type Obj} from '../domain/types.js';
export const ALLOWED = new Set(['now-time-info','list-nutrition-foods','delivery-query-addresses','delivery-create-address','delivery-query-stores','query-nearby-stores','query-store-coupons','query-meals','query-meal-detail','calculate-price','create-order','cancel-order','query-order','order-list','campaign-calendar','available-coupons','auto-bind-coupons','query-my-coupons','query-my-account']);
export const WRITES = new Set(['cancel-order','create-order','delivery-create-address','auto-bind-coupons']);
export function unwrap(result: any): any {
 if (result?.isError) throw new UserError('麦当劳服务未能完成请求，请稍后重试。',502);
 let payload = result?.structuredContent;
 if (!payload && result?.content) {
  const text=result.content.filter((x:Obj)=>x.type==='text').map((x:Obj)=>x.text).join('\n');
  try {payload=JSON.parse(text);} catch {try {payload=decode(text);} catch {payload=text;}}
 }
 payload ??= result;
 if (payload?.success===false || (typeof payload?.code==='number' && payload.code!==200 && payload.code!==0)) {
  const code=payload.code;
  throw new UserError(code===401?'服务授权已失效，请检查或替换 MCP Token。':code===429?'请求较多，请稍后重试。':'麦当劳服务返回业务错误，请调整选择或稍后重试。',code===401?401:code===429?429:502);
 }
 let data=payload?.data ?? payload;
 if (typeof data==='string') {try {data=JSON.parse(data);}catch {try {data=decode(data);}catch { /* marketing text */ }}}
 return data;
}
