export function matchMeals(rows:any[],query:string){
    const clean=(t:any)=>String(t||'').replace(/[\s，。！？、]/g,'');
    const q=clean(query).replace(/^(?:我)?(?:今天)?(?:想吃|要吃|想要|来一?份|给我来份|帮我找|找一下|找|我要|要)/,'').replace(/(?:的餐品|的东西|吧|谢谢)$/,'');
    if(!q||/^(?:点餐|随便|全部|全部餐品|所有餐品|菜单)$/.test(q))return rows;
    const terms=[q,...['鸡腿堡','板烧','巨无霸','牛肉','鸡肉','汉堡','薯条','可乐','咖啡','早餐','套餐','冰淇淋','麦乐鸡'].filter(t=>q.includes(t))];
    if(/不辣/.test(q))terms.push('板烧');else if(/辣/.test(q))terms.push('麦辣','香辣');
    return rows.map((r,i)=>({r,i,score:terms.reduce((n,t)=>n+(clean(r.title).includes(t)?t.length:0),0)})).filter(x=>x.score>0&&(!/不辣/.test(q)||!/[辣]/.test(x.r.title))).sort((a,b)=>b.score-a.score||a.i-b.i).map(x=>x.r);
  }
export function menuBatch(meals:any[],query="",batch=0){const matched=matchMeals(meals.map(m=>({...m,title:m.name})),query);const pages=Math.max(1,Math.ceil(matched.length/5));const page=Math.max(0,Math.min(batch,pages-1));return {items:matched.slice(page*5,page*5+5),page,pages,count:matched.length};}
