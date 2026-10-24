import {readFileSync,existsSync,readdirSync} from 'node:fs';import {join,dirname} from 'node:path';
function walk(dir){return readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(join(dir,e.name)):[join(dir,e.name)]);}
for(const p of [...walk('docs'),...['README.md','MCP_INTEGRATION.md','THIRD_PARTY_NOTICES.md','CONTRIBUTING.md']].filter(p=>p.endsWith('.md'))){for(const m of readFileSync(p,'utf8').matchAll(/(?:\]\(([^)]+)\)|(?:src|href)="([^"]+)")/g)){const link=m[1]||m[2];if(/^(?:https?:|#)/.test(link))continue;const target=link.split('#')[0];if(target&&!existsSync(join(dirname(p),target)))throw new Error('Broken local link in '+p+': '+link);}}
console.log('Markdown local links checked.');
