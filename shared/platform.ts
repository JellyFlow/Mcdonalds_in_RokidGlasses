export interface Runtime { uuid():string; now():number }
export const defaultRuntime:Runtime={uuid:()=>crypto.randomUUID(),now:()=>Date.now()};
export function clone<T>(value:T):T{return value===undefined?value:JSON.parse(JSON.stringify(value));}
export function canonical(value:any):string {if(value===undefined)return 'null';if(value===null||typeof value!=='object')return JSON.stringify(value);if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';return '{'+Object.keys(value).filter(k=>value[k]!==undefined).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';}
