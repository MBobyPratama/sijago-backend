import assert from "node:assert/strict";
import {env} from "../src/config/env.js";
import {randomUUID} from "node:crypto";
import {eq,inArray} from "drizzle-orm";
import {db,pool} from "../src/db/index.js";
import {reports,reporters,users,reportPhotos,reportAuditLogs} from "../src/db/schema.js";
import {authContext} from "../src/auth-context.js";
import {createDuplicateSuggestionService} from "../src/services/duplicateSuggestions.service.js";
const rollback=new Error("ROLLBACK_DUPLICATE_SUGGESTIONS");
try{
 await assert.rejects(db.transaction(async tx=>{
  const suffix=randomUUID().slice(0,8).toUpperCase();
  const[admin]=await tx.insert(users).values({email:`dups-${suffix}@example.test`,fullName:"Test admin",passwordHash:"unusable",role:"ADMIN"}).returning();
  const[reporter]=await tx.insert(reporters).values({pseudonymId:`dups-${suffix}`,deviceHash:"test"}).returning();
  const fixture=async(tag:string,offset:number,status:typeof reports.$inferInsert.status="TERVERIFIKASI",photo=true)=>{
   const[report]=await tx.insert(reports).values({ticketCode:`DUP-${suffix}-${tag}`,trackingToken:randomUUID(),reporterId:reporter.id,location:{lat:-0.5,lng:100+offset},lat:"-0.5",lng:String(100+offset),currentFactsHash:"a".repeat(64),status}).returning();
   if(photo)await tx.insert(reportPhotos).values({reportId:report.id,kind:"REPORT",cloudinaryPublicId:`test/${report.id}`,publicUrl:"https://example.test/photo",originalSecureUrl:"https://example.test/photo",sha256:"a".repeat(64),uploadedByActor:"test"});
   return report;
  };
  const source=await fixture("SOURCE",0,"MENUNGGU_VERIFIKASI"),a=await fixture("A",.0001),b=await fixture("B",.0002),missing=await fixture("MISSING",.0003,"TERVERIFIKASI",false),fourth=await fixture("FOURTH",.0004);
  const excluded=await Promise.all([fixture("CLOSED",.00001,"DITUTUP"),fixture("DONE",.00002,"SELESAI"),fixture("REJECTED",.00003,"DITOLAK"),fixture("DUP",.00004,"DUPLIKAT"),fixture("DRAFT",.00005,"DRAFT"),fixture("FAR",.01)]);
  let comparisons=0;
  const load=async(id:string)=>({image:`test-image-${id}`,url:`https://example.test/${id}`});
  const check=async()=>{};
  const service=createDuplicateSuggestionService(tx,load,check,async(_source,candidates)=>{comparisons++;assert.deepEqual(candidates.map(c=>c.id),[a.id,b.id]);return candidates.map((c,i)=>({id:c.id,match:i===0?"LIKELY":"DIFFERENT",reason:"Perlu pemeriksaan admin."}));});
  await assert.rejects(service(source.id));
  const actor={id:admin.id,email:admin.email,fullName:admin.fullName,role:"ADMIN" as const,agencyId:null,agencyCode:null,agencyName:null};
  await authContext.run(actor,async()=>{
   const result=await service(source.id);assert.equal(result.candidatesFound,3);assert.equal(result.evaluated,2);assert.equal(result.skipped,1);assert.equal(result.suggestions.length,1);assert.equal(result.suggestions[0].id,a.id);assert(!('image' in result.suggestions[0]));assert.equal(result.cached,false);
   assert.equal((await service(source.id)).cached,true);assert.equal(comparisons,1);
   const enabled=env.AI_DUPLICATE_ENABLED;env.AI_DUPLICATE_ENABLED=false;
   try{await assert.rejects(service(source.id),/dinonaktifkan/);assert.equal(comparisons,1);}finally{env.AI_DUPLICATE_ENABLED=enabled;}
   await tx.update(reports).set({status:"DITUTUP"}).where(eq(reports.id,source.id));await assert.rejects(service(source.id));
   await tx.update(reports).set({status:"MENUNGGU_VERIFIKASI"}).where(eq(reports.id,source.id));
   const broken=createDuplicateSuggestionService(tx,load,check,async()=>[{id:randomUUID(),match:"LIKELY",reason:"Invented candidate"}]);await assert.rejects(broken(source.id));
  });
  await authContext.run({...actor,role:"PETUGAS_INSTANSI"},async()=>{await assert.rejects(service(source.id));});
  const saved=await tx.select().from(reports).where(inArray(reports.id,[a.id,b.id,missing.id,fourth.id,...excluded.map(r=>r.id)]));for(const row of saved)assert.equal(row.duplicateOfId,null);
  assert.equal((await tx.select().from(reportAuditLogs).where(inArray(reportAuditLogs.reportId,[source.id,a.id,b.id]))).length,0);
  throw rollback;
 }),error=>error===rollback);
 console.log("PASS: admin-only, 100m filtering, active statuses, 3-candidate cap, missing-photo disclosure, strict results, cache, no auto-merge/audit changes. All fixtures rolled back; providers mocked.");
}finally{await pool.end();}
