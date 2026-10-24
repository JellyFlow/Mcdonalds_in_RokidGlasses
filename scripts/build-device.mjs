import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
const require=createRequire(import.meta.url),Ajv=require('ajv'),standalone=require('ajv/dist/standalone');
const allowed=new Set(['now-time-info','list-nutrition-foods','delivery-query-addresses','delivery-create-address','delivery-query-stores','query-nearby-stores','query-store-coupons','query-meals','query-meal-detail','calculate-price','create-order','cancel-order','query-order','order-list','campaign-calendar','available-coupons','auto-bind-coupons','query-my-coupons','query-my-account']);
const tools=JSON.parse(readFileSync('docs/mcp-tool-contracts.json')).tools.filter(t=>allowed.has(t.name));
const ajv=new Ajv({strict:false,allErrors:true,code:{source:true}}),exports={},contracts=[];
for(const [i,tool] of tools.entries()){
 const entry={name:tool.name,input:tool.inputSchema,output:tool.outputSchema,inputValidator:'input'+i};
 ajv.addSchema(tool.inputSchema,'input'+i);exports['input'+i]='input'+i;
 if(tool.outputSchema){entry.outputValidator='output'+i;ajv.addSchema(tool.outputSchema,'output'+i);exports['output'+i]='output'+i;}
 contracts.push(entry);
}
mkdirSync('device/generated',{recursive:true});writeFileSync('device/generated/checks.cjs',standalone(ajv,exports));
writeFileSync('device/validators.js',`import validators from './generated/checks.cjs';\nexport {validators};\nexport const contracts=${JSON.stringify(contracts)};\nexport function canonical(value){if(value===undefined)return 'null';if(value===null||typeof value!=='object')return JSON.stringify(value);if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';return '{'+Object.keys(value).filter(k=>value[k]!==undefined).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';}\n`);
const result=await build({entryPoints:['device/entry.ts'],outfile:'aiui/lib/device.js',bundle:true,platform:'browser',format:'esm',target:'es2022',minify:true,metafile:true,plugins:[{name:'ink-static-schemas',setup(b){b.onResolve({filter:/validation\/ajv-provider\.js$/},()=>({path:resolve('device/ajv-unavailable.ts')}));}}]});
const inputs=Object.keys(result.metafile.inputs);if(inputs.some(p=>p.includes('server/src/mock')))throw new Error('Mock gateway in production device bundle');if(inputs.some(p=>p.startsWith('node:')))throw new Error('Node dependency in device bundle');
writeFileSync('docs/device-build.json',JSON.stringify({sdk:JSON.parse(readFileSync('node_modules/@modelcontextprotocol/sdk/package.json')).version,tools:contracts.map(c=>c.name),bundleBytes:result.metafile.outputs['aiui/lib/device.js'].bytes,nodeBuiltins:[],dynamicSchemaCompilation:false},null,2)+'\n');
console.log('On-device SDK, business core and static validators bundled.');
