// Native Geolocation uses GPS/WGS84 coordinates. AMap regeo requires GCJ-02.
// Keep requests cancellable and never expose request URLs or credentials in errors.
function amapClient(api, key) {
  let cancelled=false;const pending=new Map();
  const request=(path, params)=>new Promise((resolve,reject)=>{
    if(cancelled){reject(new Error('位置解析已取消。'));return;}
    const handle={reject,task:null};pending.set(handle,true);
    const finish=(error,data)=>{pending.delete(handle);if(error)reject(error);else resolve(data);};
    const query=Object.entries({key,...params,output:'JSON'}).map(([k,v])=>encodeURIComponent(k)+'='+encodeURIComponent(String(v))).join('&');
    handle.task=api.request({url:'https://restapi.amap.com/v3/'+path+'?'+query,method:'GET',responseType:'text',dataType:'text',timeout:12000,
      success(res){
        if(cancelled)return;
        try{
          if(res.statusCode!==200)throw new Error('高德位置服务暂不可用。');
          const data=typeof res.data==='string'?JSON.parse(res.data):res.data;
          if(data.status!=='1')throw new Error(['10001','10002','10005','10006','10007','10008','10009','10012','10013'].includes(data.infocode)?'高德 Key 或授权配置无效，请检查 Web 服务权限。':'高德位置解析失败，请稍后重试。');
          finish(null,data);
        }catch(e){finish(e instanceof SyntaxError?new Error('高德返回的位置数据无效。'):e);}
      },fail(){finish(new Error(cancelled?'位置解析已取消。':'高德位置服务连接失败或超时。'));}
    });
  });
  return {request,abort(){cancelled=true;for(const h of pending.keys()){h.reject(new Error('位置解析已取消。'));h.task?.abort?.();}pending.clear();}};
}
export function resolveLocation(api,key,longitude,latitude){
  const client=amapClient(api,key),request=client.request;
  const promise=(async()=>{
    if(!key)throw new Error('尚未配置高德 Web 服务 Key。');
    if(!Number.isFinite(longitude)||!Number.isFinite(latitude)||Math.abs(longitude)>180||Math.abs(latitude)>90)throw new Error('定位返回的经纬度无效。');
    const converted=await request('assistant/coordinate/convert',{locations:longitude+','+latitude,coordsys:'gps'});
    const location=converted.locations;
    const values=typeof location==='string'?location.split(',').map(Number):[];
    if(values.length!==2||values.some(v=>!Number.isFinite(v))||Math.abs(values[0])>180||Math.abs(values[1])>90)throw new Error('高德坐标转换结果无效。');
    const data=await request('geocode/regeo',{location,extensions:'base',roadlevel:0});
    const address=data.regeocode,parts=address?.addressComponent;
    const text=v=>typeof v==='string'?v.trim():'';
    const province=text(parts?.province),city=text(parts?.city)||(/^(北京市|上海市|天津市|重庆市)$/.test(province)?province:'');
    const street=text(parts?.streetNumber?.street),township=text(parts?.township),district=text(parts?.district);
    const formattedAddress=text(address?.formatted_address);
    const keyword=formattedAddress.replace(province,'').replace(city,'').trim();
    if(!city||!keyword||!formattedAddress)throw new Error('高德未返回完整的城市和位置，请语音提供城市和位置。');
    return {city,district,keyword,formattedAddress,coordinates:values};
  })();
  return {promise,abort:client.abort};
}

export function formatDistance(meters){
 if(!Number.isFinite(meters)||meters<0)return '';
 return meters<1000?'直线 '+Math.min(999,Math.round(meters))+' 米':'直线 '+(meters/1000).toFixed(1)+' 公里';
}
export function straightDistance(a,b){
 const rad=x=>x*Math.PI/180,dlat=rad(b[1]-a[1]),dlng=rad(b[0]-a[0]);
 const h=Math.sin(dlat/2)**2+Math.cos(rad(a[1]))*Math.cos(rad(b[1]))*Math.sin(dlng/2)**2;
 return 6371008.8*2*Math.atan2(Math.sqrt(Math.min(1,h)),Math.sqrt(Math.max(0,1-h)));
}
const normalize=value=>String(value||'').replace(/[\s·,，。()（）-]/g,'').toLowerCase();
const roadNumbers=value=>normalize(value).split(/[省市区县]/).pop().match(/[\u4e00-\u9fff]{2,}(?:路|街|道|巷)\d+号?/g)||[];
export function matchStore(store,pois,city){
 const address=normalize(store.address);
 const candidates=(pois||[]).filter(p=>{
  if(!/麦当劳|mcdonald/i.test(String(p.name)))return false;
  if(p.cityname&&normalize(p.cityname)!==normalize(city))return false;
  const target=normalize(p.address);
  if(!target||!address)return false;
  const building=address.split(/街道|乡|镇/).pop().split(/[0-9]/)[0].replace(/麦当劳.*$/,'');
  const buildingMatch=building.length>=4&&!/(路|街|道|巷)$/.test(building)&&target.includes(building);
  const contained=Math.min(target.length,address.length)>=6&&(address.includes(target)||target.includes(address));
  const nums=roadNumbers(address),otherNums=roadNumbers(target);
  const numbered=nums.some(n=>otherNums.some(m=>n.replace(/号$/,'')===m.replace(/号$/,'')));
  if(nums.length&&otherNums.length&&!numbered)return false;
  // An exact address or street+doorplate must uniquely identify a McDonald's POI.
  // A name alone cannot distinguish branches in the same city.
  if(!contained&&!numbered&&!buildingMatch)return false;
  const coordinate=String(p.location||'').split(',').map(Number);
  return coordinate.length===2&&coordinate.every(Number.isFinite)&&Math.abs(coordinate[0])<=180&&Math.abs(coordinate[1])<=90;
 });
 const unique=new Map(candidates.map(p=>[p.id||p.location+'|'+normalize(p.name),p]));
 return unique.size===1?[...unique.values()][0]:null;
}
export function branchName(name,city,district=''){
 let result=normalize(name).replace(/^麦当劳/,'').replace(/(?:餐厅|店)$/,'');
 for(const area of [city,district]){
  const short=normalize(area).replace(/[市区县]$/,'');
  if(short&&result.startsWith(short))result=result.slice(short.length).replace(/^[市区县]/,'');
 }
 return result;
}
export function verifiedNearbyPoi(store,pois,geocodes,city,district=''){
 const branch=branchName(store.storeName,city,district);
 const precise=(geocodes||[]).filter(g=>['门牌号','兴趣点'].includes(g.level));
 const fixes=(precise.length?precise:geocodes||[]).filter(g=>['门牌号','门址','兴趣点'].includes(g.level)&&(!g.city||normalize(g.city)===normalize(city))).map(g=>String(g.location||'').split(',').map(Number)).filter(c=>c.length===2&&c.every(Number.isFinite)&&Math.abs(c[0])<=180&&Math.abs(c[1])<=90);
 if(!branch||!fixes.length)return null;
 const matched=(pois||[]).filter(p=>{
  if(!/麦当劳/i.test(String(p.name))||p.cityname&&normalize(p.cityname)!==normalize(city))return false;
  const candidate=branchName(String(p.name).replace(/[()（）]/g,''),city,district);
  if(candidate!==branch)return false;
  const point=String(p.location||'').split(',').map(Number);
  return point.length===2&&point.every(Number.isFinite)&&Math.abs(point[0])<=180&&Math.abs(point[1])<=90&&fixes.every(f=>straightDistance(f,point)<=150);
 });
 const unique=new Map(matched.map(p=>[p.id||p.location+'|'+normalize(p.name),p]));
 return unique.size===1?[...unique.values()][0]:null;
}
export function resolveStoreDistances(api,key,origin,city,stores,onResult,district=''){
 const client=amapClient(api,key);let cancelled=false,index=0,matched=0,unmatched=0;
 const work=async()=>{
  while(!cancelled&&index<stores.length){
   const store=stores[index++];let label='';
   try{
    const branch=branchName(store.storeName,city,district);
    const data=await client.request('place/text',{keywords:'麦当劳 '+branch,city,citylimit:'true',types:'050000',offset:20,page:1,extensions:'base'});
    let poi=matchStore(store,data.pois,city);
    if(!poi&&store.address){
      const address=await client.request('geocode/geo',{address:city+district+store.address,city});
      poi=verifiedNearbyPoi(store,data.pois,address.geocodes,city,district);
    }
    if(poi)label=formatDistance(straightDistance(origin,String(poi.location).split(',').map(Number)));
   }catch(e){/* A missing or ambiguous POI never falls back to an unverified distance. */}
   if(cancelled)return;
   if(label)matched++;else unmatched++;
   onResult(String(store.storeCode),label);
  }
 };
 const promise=Promise.all([work(),work()]).then(()=>({matched,unmatched}));
 return {promise,abort(){cancelled=true;client.abort();}};
}
