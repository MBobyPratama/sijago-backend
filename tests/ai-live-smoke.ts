/** Opt-in: bounded billable requests using the public brand logo and synthetic text, never citizen data. */
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {randomUUID} from "node:crypto";
import {fileURLToPath} from "node:url";
import {analyzeDamagePhoto} from "../src/services/photoAnalysis.service.js";
import {photoSafety,PhotoSafetyError} from "../src/services/photoSafety.service.js";
import {summarizePatterns} from "../src/services/reportSummary.service.js";
import {compareDuplicateEvidence,type DuplicateEvidence} from "../src/services/duplicateSuggestions.service.js";
if(process.env.AI_LIVE_SMOKE!=="true"){console.log('SKIP: set AI_LIVE_SMOKE=true to allow bounded live-provider requests.');process.exit(0);}
const bytes=await readFile(fileURLToPath(new URL('../../sijago-frontend/public/images/logo_header_email.png',import.meta.url)));const image='data:image/png;base64,'+bytes.toString('base64');
let failed=0;
async function check(name:string,work:()=>Promise<void>){try{await work();console.log('PASS live '+name);}catch(error){failed++;const e=error as {status?:number;code?:string;name?:string};console.log(JSON.stringify({test:name,result:'FAIL',status:e.status??null,code:e.code??null,type:e.name??'Error'}));}}
await check('safe image moderation',async()=>{await photoSafety().check(image,false);});
await check('irrelevant logo blocked',async()=>{await assert.rejects(photoSafety().check(image,true),e=>e instanceof PhotoSafetyError&&e.code==='PHOTO_NOT_RELEVANT');});
await check('photo suggestion schema and irrelevant output',async()=>{const r=await analyzeDamagePhoto(image);assert.equal(r.roadDamageVisible,false);assert.equal(r.category,null);assert.equal(r.sizeClass,null);assert.equal(r.condition,'');});
await check('queue patterns with source citations',async()=>{const sources=[{id:randomUUID(),condition:'Lubang tertutup genangan sehingga sulit terlihat setelah hujan.'},{id:randomUUID(),condition:'Genangan menutupi lubang di jalan setelah hujan dan menyulitkan pengendara.'}];const r=await summarizePatterns(sources);assert(r.length>0);assert.equal(r[0].reportIds.length,2);});
await check('duplicate comparison provider schema',async()=>{const evidence:DuplicateEvidence={id:randomUUID(),ticketCode:'TEST-SOURCE',title:'Test',status:'TERVERIFIKASI',distanceMeters:0,category:null,condition:'Gambar uji logo, bukan bukti kerusakan.',observedAt:null,submittedAt:null,image,photoUrl:'https://example.test/logo'};const target={...evidence,id:randomUUID(),distanceMeters:10};const r=await compareDuplicateEvidence(evidence,[target]);assert.equal(r.length,1);assert.equal(r[0].id,target.id);assert.notEqual(r[0].match,'LIKELY');});
if(failed)process.exitCode=1;
