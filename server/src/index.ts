import {config} from 'dotenv';
import {Store} from './db.js';
import {McpGateway} from './mcp.js';
import {MockGateway} from './mock.js';
import {Service} from './service.js';
import {httpServer} from './http.js';
config({path:'server/.env',quiet:true});
const mode=process.env.MODE??'live';if(!['live','mock'].includes(mode))throw new Error('MODE must be live or mock');
const db=new Store(process.env.DATABASE_PATH??'server/data/app.sqlite');
const gateway=mode==='mock'?new MockGateway():new McpGateway(process.env.MCD_MCP_TOKEN??'');
const server=httpServer(new Service(db,gateway),process.env.APP_ACCESS_KEY??'',(process.env.ALLOWED_ORIGINS??'').split(',').filter(Boolean));
const host=process.env.HOST??'127.0.0.1',port=Number(process.env.PORT??8787);
server.listen(port,host,()=>console.log(`麦当劳 AIUI 服务：http://${host}:${port} · ${mode==='live'?'真实 MCP':'演示 Mock，不产生真实订单'}\n连接凭证位于 server/.env 的 APP_ACCESS_KEY；凭证不会打印。`));
async function close(){server.close();await gateway.close();db.close();}
process.once('SIGINT',()=>void close());process.once('SIGTERM',()=>void close());
