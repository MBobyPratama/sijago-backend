import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {eq,inArray} from "drizzle-orm";
import {db,pool} from "../src/db/index.js";
import {reports,reporters,reportFactVersions,agencies,reportAuditLogs} from "../src/db/schema.js";
import {authContext} from "../src/auth-context.js";
import {env} from "../src/config/env.js";
import {createQueueSummaryService} from "../src/services/reportSummary.service.js";
const rollback=new Error('ROLLBACK_QUEUE_SUMMARY');const enabled=env.AI_SUMMARY_ENABLED;env.AI_SUMMARY_ENABLED=true;
try{await assert.rejects(db.transaction(async tx=>{
 const suffix=randomUUID().slice(0,8).toUpperCase();const[agency]=await tx.insert(agencies).values({code:`SUM_${suffix}`,name:'Summary agency',level:'KOTA',officialEmails:[]}).returning();
 const[reporter]=await tx.insert(reporters).values({pseudonymId:`summary-${suffix}`,deviceHash:'test'}).returning();
 const ids:string[]=[];
 for(let i=0;i<27;i++){
 const[r]=await tx.insert(reports).values({ticketCode:`SUM-${suffix}-${String(i).padStart(2,'0')}`,trackingToken:randomUUID(),reporterId:reporter.id,location:{lat:-6.59,lng:106.8},lat:'-6.59',lng:'106.8',currentFactsHash:'a'.repeat(64),status:i===26?'SELESAI':'DITERUSKAN',assignedAgencyId:agency.id,districtName:'Bogor Tengah'}).returning();ids.push(r.id);
 const[f]=await tx.insert(reportFactVersions).values({reportId:r.id,versionNo:1,category:'LUBANG',sizeClass:'SEDANG',landmark:'Taman',lat:'-6.59',lng:'106.8',photoIds:[],freeText:'Jalan tergenang setelah hujan.',factsHash:'a'.repeat(64),createdByActor:'test'}).returning();await tx.update(reports).set({currentFactsVersionId:f.id}).where(eq(reports.id,r.id));}
 const officer={id:randomUUID(),email:'test@example.test',fullName:'Test',role:'PETUGAS_INSTANSI' as const,agencyId:agency.id,agencyCode:agency.code,agencyName:agency.name};
 let calls=0;const service=createQueueSummaryService(tx,async sources=>{calls++;return [{text:'Genangan disebut di dua laporan.',reportIds:sources.slice(0,2).map(s=>s.id)}];});
 await assert.rejects(service({mode:'FILTER'}));await authContext.run({...officer,role:'ADMIN'},()=>assert.rejects(service({mode:'FILTER'})));
 await authContext.run(officer,async()=>{
 const all=await service({mode:'FILTER'});assert.equal(all.total,27);assert.equal(all.included,25);assert.equal(all.truncated,true);assert.equal(Object.values(all.stats.status).reduce((a,b)=>a+b,0),25);assert(!JSON.stringify(all).includes('trackingToken'));
 assert.equal((await service({mode:'FILTER'})).cached,true);assert.equal(calls,1);
 const chosen=await service({mode:'SELECTED',reportIds:ids.slice(0,2)});assert.equal(chosen.included,2);assert.equal(chosen.total,2);
 const filtered=await service({mode:'FILTER',status:'SELESAI'});assert.equal(filtered.total,1);assert.equal(filtered.method,'BASIC');
 assert.equal((await service({mode:'FILTER',query:`SUM-${suffix}-26`})).total,1);
 await assert.rejects(service({mode:'SELECTED',reportIds:[ids[0],randomUUID()]}));
 const fallback=await createQueueSummaryService(tx,async()=>{throw Error('provider');})({mode:'SELECTED',reportIds:ids.slice(0,2)});assert.equal(fallback.method,'BASIC');assert.equal(fallback.included,2);
 const stale=createQueueSummaryService(tx,async sources=>{await tx.update(reports).set({returnedByAgency:true}).where(eq(reports.id,sources[0].id));return [];});await assert.rejects(stale({mode:'SELECTED',reportIds:ids.slice(0,2)}),(e:any)=>e.code==='QUEUE_CHANGED');await assert.rejects(service({mode:'SELECTED',reportIds:ids.slice(0,2)}));
 });
 await authContext.run({...officer,agencyId:randomUUID()},()=>assert.rejects(service({mode:'SELECTED',reportIds:ids.slice(0,2)})));
 assert.equal((await tx.select().from(reportAuditLogs).where(inArray(reportAuditLogs.reportId,ids))).length,0);throw rollback;
}),e=>e===rollback);console.log('PASS agency-only batch scope, filters across full queue, 25 cap, exact stats, cache, fallback, revoked access and stale snapshot. Fixtures rolled back; AI mocked.');}finally{env.AI_SUMMARY_ENABLED=enabled;await pool.end();}
