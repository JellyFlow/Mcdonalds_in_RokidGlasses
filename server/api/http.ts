import {createServer, type IncomingMessage} from 'node:http';
import {timingSafeEqual} from 'node:crypto';
import type {Service} from '../service/index.js';
import {UserError} from '../types/index.js';
async function body(req:IncomingMessage){let text='';for await(const chunk of req){text+=chunk;if(text.length>65536)throw new UserError('请求过大。',413);}try{return JSON.parse(text||'{}');}catch{throw new UserError('请求内容格式无效。');}}
export function httpServer(service:Service,key:string,extraOrigins:string[]=[]){
 if(key.length<20)throw new Error('APP_ACCESS_KEY must contain at least 20 characters');
 return createServer(async(req,res)=>{
  res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
  const origin=req.headers.origin;
  if(origin){let allowed=extraOrigins.includes(origin);try{const u=new URL(origin);allowed ||= ['127.0.0.1','localhost','[::1]'].includes(u.hostname);}catch{}
   if(!allowed){res.writeHead(403);res.end(JSON.stringify({error:'来源未授权，请配置 ALLOWED_ORIGINS。'}));return;}
   res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');
  }
  res.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type');res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');
  if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}
  try{
   const path=new URL(req.url??'/', 'http://localhost').pathname;
   if(path==='/health'&&req.method==='GET'){res.end(JSON.stringify({ok:true,mode:service.gateway.mode}));return;}
   const provided=Buffer.from(String(req.headers.authorization??'').replace(/^Bearer /,'')),expected=Buffer.from(key);
   if(provided.length!==expected.length||!timingSafeEqual(provided,expected))throw new UserError('连接凭证无效，请在设置中重新填写。',401);
   let result:any;
   if(path==='/sessions/current'&&req.method==='GET')result=service.resume();
   else if(path==='/sessions'&&req.method==='POST')result=service.create();
   else {const match=path.match(/^\/sessions\/([\w-]+)(\/events)?$/);if(!match)throw new UserError('接口不存在。',404);
    if(req.method==='GET'&&!match[2])result=service.state(match[1]);
    else if(req.method==='POST'&&match[2]){const event=await body(req);if(typeof event.type!=='string')throw new UserError('缺少操作类型。');result=await service.event(match[1],event);}
    else throw new UserError('不支持的请求方法。',405);
   }
   res.end(JSON.stringify(result));
  }catch(e:any){const status=e instanceof UserError?e.status:500;res.writeHead(status);res.end(JSON.stringify({error:e instanceof UserError?e.message:'服务暂时不可用，请稍后重试。'}));}
 });
}
