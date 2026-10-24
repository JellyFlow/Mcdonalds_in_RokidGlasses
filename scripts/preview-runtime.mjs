export const runtimeVersion='0.18.0';
// Pin only the generated import-map entry; do not change the user's global CLI
// runtime selection. Relative runtime dependencies resolve from this module.
export function pinRuntime(html){
 const pattern=/https:\/\/ga\.jspm\.io\/npm:@yodaos-pkg\/ink@[^/]+\/index\.js/g;
 if(!pattern.test(html))throw new Error('Preview import map changed; runtime cannot be pinned safely');
 return html.replace(pattern,'https://ga.jspm.io/npm:@yodaos-pkg/ink@'+runtimeVersion+'/index.js');
}
