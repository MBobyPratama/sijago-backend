import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {eq} from "drizzle-orm";
import {db,pool} from "../src/db/index.js";
import {reports,reporters,reportFactVersions,agencies,reportAuditLogs} from "../src/db/schema.js";
import {authContext} from "../src/auth-context.js";
import {env} from "../src/config/env.js";
import {createReportSummaryService,summarySegments} from "../src/services/reportSummary.service.js";
const rollback=new Error('ROLLBACK_REPORT_SUMMARY');const enabled=env.AI_SUMMARY_ENABLED;env.AI_SUMMARY_ENABLED=true;
try{
 await assert.rejects(db.transaction(async tx=>{
  const suffix=randomUUID().slice(0,8).toUpperCase();
  const[agency]=await tx.insert(agencies).values({code:`SUM_${suffix}`,name:'Summary agency',level:'KOTA',officialEmails:[]}).returning();
  const[reporter]=await tx.insert(reporters).values({pseudonymId:`summary-${suffix}`,deviceHash:'test'}).returning();
  const[report]=await tx.insert(reports).values({ticketCode:`SUM-${suffix}`,trackingToken:randomUUID(),reporterId:reporter.id,location:{lat:-6.59,lng:106.8},lat:'-6.59',lng:'106.8',currentFactsHash:'a'.repeat(64),status:'DITERUSKAN',assignedAgencyId:agency.id}).returning();
  const text='Permukaan jalan di sisi kiri terlihat berlubang sehingga pengendara harus memperlambat kendaraannya. Air menggenang pada bagian jalan yang rusak setelah hujan sehingga batas lubang sulit terlihat. Kendaraan roda dua beberapa kali terlihat menghindari lubang melalui sisi kanan jalan yang masih utuh. Kondisi ini terlihat pada waktu pengamatan warga dan belum disertai pengukuran kedalaman langsung.';
  const[facts]=await tx.insert(reportFactVersions).values({reportId:report.id,versionNo:1,category:'LUBANG',sizeClass:'SEDANG',landmark:'Depan taman uji',lat:'-6.59',lng:'106.8',photoIds:[],freeText:text,factsHash:'a'.repeat(64),createdByActor:'test'}).returning();
  await tx.update(reports).set({currentFactsVersionId:facts.id}).where(eq(reports.id,report.id));
  let selections=0;const service=createReportSummaryService(tx,async()=>{selections++;return[0,2];});
  const admin={id:randomUUID(),email:'test@example.test',fullName:'Test admin',role:'ADMIN' as const,agencyId:null,agencyCode:null,agencyName:null};
  await assert.rejects(service(report.id));
  await authContext.run({...admin,role:'AUDITOR'},async()=>assert.rejects(service(report.id)));
  await authContext.run({...admin,role:'PETUGAS_INSTANSI',agencyId:randomUUID()},async()=>assert.rejects(service(report.id)));
  await authContext.run(admin,async()=>{
   const result=await service(report.id);assert.equal(result.method,'AI_EXTRACTIVE');assert.deepEqual(result.highlights,[summarySegments(text)[0],summarySegments(text)[2]]);assert(result.fields.some(item=>item.value==='Depan taman uji'));assert(!('trackingToken' in result));assert.equal(result.cached,false);
   assert.equal((await service(report.id)).cached,true);assert.equal(selections,1);
  });
  const officer={...admin,role:'PETUGAS_INSTANSI' as const,agencyId:agency.id};
  await authContext.run(officer,async()=>{assert.equal((await service(report.id)).method,'AI_EXTRACTIVE');});assert.equal(selections,1);
  await tx.update(reports).set({returnedByAgency:true}).where(eq(reports.id,report.id));await authContext.run(officer,async()=>assert.rejects(service(report.id)));await tx.update(reports).set({returnedByAgency:false}).where(eq(reports.id,report.id));
  await authContext.run(admin,async()=>{
   const broken=createReportSummaryService(tx,async()=>{throw Error('provider failure');});const fallback=await broken(report.id);assert.equal(fallback.method,'BASIC');assert(fallback.notice.includes('AI belum'));assert.equal(fallback.cached,false);
   const stale=createReportSummaryService(tx,async()=>{await tx.update(reports).set({status:'DIPROSES'}).where(eq(reports.id,report.id));return[0];});await assert.rejects(stale(report.id),(error:any)=>error.code==='REPORT_CHANGED');
   await tx.update(reportFactVersions).set({freeText:'Jalan berlubang. Tidak ada pengukuran langsung.'}).where(eq(reportFactVersions.id,facts.id));const short=await service(report.id);assert.equal(short.method,'BASIC');assert.equal(selections,1);assert.equal(short.highlights.length,2);
  });
  assert.equal((await tx.select().from(reportAuditLogs).where(eq(reportAuditLogs.reportId,report.id))).length,0);
  throw rollback;
 }),error=>error===rollback);
 console.log('PASS: admin/assigned-agency access, current source facts only, extractive highlights/cache, no-call short text, explicit fallback, revoked assignment and stale result rejection. Fixtures rolled back; provider mocked.');
}finally{env.AI_SUMMARY_ENABLED=enabled;await pool.end();}
