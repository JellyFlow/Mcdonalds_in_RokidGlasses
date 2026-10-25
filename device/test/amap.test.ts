import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolveLocation} from '../../aiui/runtime/amap.js';

test('AMap cancellation rejects pending lookup and ignores late response',async()=>{
 let options:any,aborts=0;
 const lookup=resolveLocation({request(o:any){options=o;return {abort(){aborts++;}};}},'fixture-key',121,31);
 const rejected=assert.rejects(lookup.promise,/取消/);lookup.abort();
 options.success({statusCode:200,data:{status:'1',locations:'121,31'}});
 await rejected;assert.equal(aborts,1);
});
test('AMap rejects invalid coordinates before sending and incomplete address without inventing city',async()=>{
 let calls=0;
 const api={request(o:any){calls++;queueMicrotask(()=>o.success({statusCode:200,data:calls===1?{status:'1',locations:'121,31'}:{status:'1',regeocode:{formatted_address:'地址',addressComponent:{city:[],province:'浙江省',district:'某区'}}}}));return {abort(){}};}};
 await assert.rejects(resolveLocation(api,'fixture-key',NaN,31).promise,/经纬度/);assert.equal(calls,0);
 await assert.rejects(resolveLocation(api,'fixture-key',121,31).promise,/完整/);assert.equal(calls,2);
});

import {formatDistance,straightDistance,matchStore,resolveStoreDistances} from '../../aiui/runtime/amap.js';
test('distance formatting uses explicit straight-line meters and kilometers, including zero',()=>{
 assert.equal(formatDistance(0),'直线 0 米');assert.equal(formatDistance(873),'直线 873 米');
 assert.equal(formatDistance(999.9),'直线 999 米');assert.equal(formatDistance(1000),'直线 1.0 公里');assert.equal(formatDistance(1503),'直线 1.5 公里');assert.equal(formatDistance(NaN),'');
 assert.equal(straightDistance([121,31],[121,31]),0);assert.ok(Math.abs(straightDistance([0,0],[0,1])-111195)<2);
});
test('store POI matching requires unique verified address and rejects conflicting doorplates/cities',()=>{
 const store={storeName:'麦当劳杭州铂澜大象城餐厅',address:'浙江省杭州市西湖区文一路294号'};
 const poi={id:'p',name:'麦当劳(文一路店)',cityname:'杭州市',address:'文一路294号',location:'120.1,30.2'};
 assert.equal(matchStore(store,[poi],'杭州市'),poi);
 assert.equal(matchStore(store,[{...poi,address:'文一路295号'}],'杭州市'),null);
 assert.equal(matchStore(store,[{...poi,cityname:'上海市'}],'杭州市'),null);
 assert.equal(matchStore(store,[poi,{...poi,id:'p2',location:'120.2,30.3'}],'杭州市'),null);
 assert.equal(matchStore(store,[{...poi,address:'文一路',location:'invalid'}],'杭州市'),null);
});
test('distance lookup runs at most two requests and cancellation prevents late updates',async()=>{
 const queued:any[]=[],results:any[]=[];let active=0,max=0,aborts=0;
 const api={request(o:any){active++;max=Math.max(max,active);queued.push(o);return {abort(){aborts++;}};}};
 const stores=Array.from({length:5},(_,i)=>({storeCode:String(i),storeName:'麦当劳'+i,address:'文一路294号'}));
 const lookup=resolveStoreDistances(api,'fixture-key',[120,30],'杭州市',stores,(id:any,value:any)=>results.push({id,value}));
 assert.equal(queued.length,2);
 active--;queued[0].success({statusCode:200,data:{status:'1',pois:[]}});await new Promise(r=>setImmediate(r));assert.equal(queued.length,3);active--;queued[2].success({statusCode:200,data:{status:'1',geocodes:[]}});await new Promise(r=>setImmediate(r));assert.equal(queued.length,4);assert.equal(max,2);assert.equal(results[0].value,'');
 lookup.abort();for(const o of queued)o.success({statusCode:200,data:{status:'1',pois:[]}});await lookup.promise;assert.equal(results.length,1);assert.equal(aborts,2);
});

import {branchName,verifiedNearbyPoi} from '../../aiui/runtime/amap.js';
test('branch-specific POI matching verifies alternate address against precise geocoding',()=>{
 const store={storeName:'麦当劳杭州余杭IT公园餐厅',address:'文一西路1217号'};
 const poi={id:'it',name:'麦当劳(IT公园店)',cityname:'杭州市',location:'120.1,30.2'};
 assert.equal(branchName(store.storeName,'杭州市','余杭区'),'it公园');
 const fixes=[{level:'门牌号',city:'杭州市',location:'120.1,30.2'}];
 assert.equal(verifiedNearbyPoi(store,[poi],fixes,'杭州市','余杭区'),poi);
 assert.equal(verifiedNearbyPoi(store,[poi],[{...fixes[0],level:'道路'}],'杭州市','余杭区'),null);
 assert.equal(verifiedNearbyPoi(store,[poi],[{...fixes[0],location:'121,31'}],'杭州市','余杭区'),null);
 assert.equal(verifiedNearbyPoi(store,[poi,{...poi,id:'other'}],fixes,'杭州市','余杭区'),null);
});
