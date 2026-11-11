import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
const root=fileURLToPath(new URL('../',import.meta.url));
const tests=['photo-analysis','photo-safety','photo-registration','photo-storage','photo-evidence-gate','duplicate-comparison','duplicate-suggestions','report-summary-selection','report-summary'];
for(const name of tests){console.log(`\nTesting ${name}`);const result=spawnSync(process.execPath,['node_modules/tsx/dist/cli.mjs',`tests/${name}.test.ts`],{cwd:root,stdio:'inherit'});if(result.error)throw result.error;if(result.status!==0)process.exit(result.status??1);}
console.log(`\nPASS ${tests.length}/${tests.length} AI suites. Providers mocked; database fixtures rolled back.`);
