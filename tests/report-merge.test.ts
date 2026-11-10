import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, pool } from "../src/db/index.js";
import { reports, reporters, users, reportUpvotes, reportConditionTags, reportAuditLogs } from "../src/db/schema.js";
import { authContext } from "../src/auth-context.js";
import { adminMergeDuplicateReport } from "../src/services/moderation.service.js";
const rollback=new Error("ROLLBACK_MERGE_TEST");
try {
 await assert.rejects(db.transaction(async tx=>{
  const suffix=randomUUID().slice(0,8).toUpperCase();
  const [admin]=await tx.insert(users).values({email:`merge-${suffix}@example.test`,fullName:"Merge test",passwordHash:"unusable",role:"ADMIN"}).returning();
  const [reporter]=await tx.insert(reporters).values({pseudonymId:`merge-${suffix}`,deviceHash:"test"}).returning();
  const fixture=async(tag:string)=>(await tx.insert(reports).values({ticketCode:`MRG-${suffix}-${tag}`,trackingToken:randomUUID(),reporterId:reporter.id,location:{lat:-6.59,lng:106.8},lat:"-6.59",lng:"106.8",currentFactsHash:"a".repeat(64),status:"TERVERIFIKASI",upvoteCount:99}).returning())[0];
  const source=await fixture("SOURCE"),parent=await fixture("PARENT"),other=await fixture("OTHER");
  await tx.insert(reportUpvotes).values([{reportId:source.id,voterKey:"shared"},{reportId:source.id,voterKey:"source-only"},{reportId:parent.id,voterKey:"shared"},{reportId:parent.id,voterKey:"parent-only"}]);
  const tag=(reportId:string,voterKey:string,tagCode:string)=>({reportId,voterKey,tagCode,verifiedEmailHash:"a".repeat(64)});
  await tx.insert(reportConditionTags).values([tag(source.id,"shared","BANJIR"),tag(parent.id,"shared","BANJIR"),tag(source.id,"source-only","BANJIR"),tag(source.id,"shared","BERBAHAYA")]);
  await assert.rejects(adminMergeDuplicateReport(source.id,parent.id,undefined,tx));
  await authContext.run({id:admin.id,email:admin.email,fullName:admin.fullName,role:"ADMIN",agencyId:null,agencyCode:null,agencyName:null},async()=>{
   await assert.rejects(adminMergeDuplicateReport(source.id,source.id,undefined,tx));
   const result=await adminMergeDuplicateReport(source.id,parent.id,undefined,tx);
   assert.equal(result.newParentUpvotes,3);
   const [saved]=await tx.select().from(reports).where(eq(reports.id,source.id));
   assert.equal(saved.status,"DUPLIKAT");assert.equal(saved.duplicateOfId,parent.id);
   assert.equal((await tx.select().from(reportUpvotes).where(eq(reportUpvotes.reportId,parent.id))).length,3);
   const tags=await tx.select().from(reportConditionTags).where(eq(reportConditionTags.reportId,parent.id));
   assert.equal(tags.length,3);assert.equal(tags.filter(t=>t.tagCode==="BANJIR").length,2);
   assert.equal((await tx.select().from(reportConditionTags).where(eq(reportConditionTags.reportId,source.id))).length,3);
   await adminMergeDuplicateReport(source.id,parent.id,undefined,tx);
   assert.equal((await tx.select().from(reportAuditLogs).where(eq(reportAuditLogs.reportId,source.id))).length,1);
   await assert.rejects(adminMergeDuplicateReport(source.id,other.id,undefined,tx));
   await assert.rejects(adminMergeDuplicateReport(parent.id,other.id,undefined,tx));
   await assert.rejects(adminMergeDuplicateReport(other.id,source.id,undefined,tx));
  });
  throw rollback;
 }),error=>error===rollback);
 console.log("PASS: unique voters and condition tags merged atomically; source history retained; repeat, self-merge, duplicate parent and chain guards verified. Fixtures rolled back.");
}finally{await pool.end();}
