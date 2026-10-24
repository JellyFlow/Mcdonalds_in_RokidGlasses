import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
const banned=String.fromCodePoint(0x5168,0x5f69);
const paths=execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{encoding:'utf8'}).split('\0').filter(Boolean);
const errors=[];
for(const p of new Set(paths)){
 if(/(^|\/)(?:node_modules|local|\.git|\.aix)(?:\/|$)|(^|\/)(?:\.env|\.env\.local|credentials\.js|agent\.json)$|\.(?:aix|zip|sqlite|log)$/.test(p))errors.push('Private/generated path: '+p);
 const b=readFileSync(p),s=b.toString('utf8');
 if(s.includes(banned))errors.push('Disallowed wording: '+p);
 if(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}/.test(s))errors.push('Credential pattern: '+p);
 if(/^export const (?:MCP_TOKEN|AMAP_WEB_KEY)\s*=\s*['"](?!\$\{)[^'"]{16,}['"]/m.test(s)&&!p.endsWith('.test.mjs'))errors.push('Literal credential: '+p);
}
for(const p of ['README.md','LICENSE','CONTEST_DECLARATION.md','MCP_INTEGRATION.md','mcp-config.example.json'])if(!paths.includes(p))errors.push('Missing contest file: '+p);
if(errors.length){console.error(errors.join('\n'));process.exitCode=1;}else console.log('Public source paths, credential patterns and wording checked ('+new Set(paths).size+' files).');
