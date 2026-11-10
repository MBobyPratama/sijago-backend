import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { db, pool } from "../src/db/index.js";
import { reports, reporters, reportAuditLogs } from "../src/db/schema.js";
import { closeExpiredReports } from "../src/services/reportMonitoring.service.js";
const rollback=new Error("ROLLBACK_MONITORING_TEST");
try {
 await assert.rejects(db.transaction(async tx=>{
  const suffix=randomUUID().slice(0,8).toUpperCase(),now=new Date("2026-11-10T12:00:00Z");
  const [reporter]=await tx.insert(reporters).values({pseudonymId:`monitor-${suffix}`,deviceHash:"test"}).returning();
  const fixture=async(tag:string,status:"SELESAI"|"DIBUKA_KEMBALI"|"DIPROSES",end:Date|null)=>(await tx.insert(reports).values({ticketCode:`MON-${suffix}-${tag}`,trackingToken:randomUUID(),reporterId:reporter.id,location:{lat:-6.59,lng:106.8},lat:"-6.59",lng:"106.8",currentFactsHash:"a".repeat(64),status,monitoringEndsAt:end}).returning())[0];
  const expired=await fixture("EXPIRED","SELESAI",new Date(now.getTime()-1));
  const boundary=await fixture("BOUNDARY","SELESAI",now);
  const future=await fixture("FUTURE","SELESAI",new Date(now.getTime()+1));
  const reopened=await fixture("REOPENED","DIBUKA_KEMBALI",new Date(now.getTime()-1000));
  const missing=await fixture("MISSING","SELESAI",null);
  const progress=await fixture("PROGRESS","DIPROSES",new Date(now.getTime()-1000));
  await closeExpiredReports(tx,now);
  const ids=[expired.id,boundary.id,future.id,reopened.id,missing.id,progress.id];
  const saved=await tx.select().from(reports).where(inArray(reports.id,ids));
  for(const original of[expired,boundary]){const row=saved.find(r=>r.id===original.id)!;assert.equal(row.status,"DITUTUP");assert.equal(row.closedAt?.getTime(),now.getTime());}
  for(const original of[future,reopened,missing,progress])assert.equal(saved.find(r=>r.id===original.id)?.status,original.status);
  await closeExpiredReports(tx,now);
  for(const original of[expired,boundary]){const logs=await tx.select().from(reportAuditLogs).where(eq(reportAuditLogs.reportId,original.id));assert.equal(logs.length,1);assert.equal(logs[0].actorType,"SISTEM");}
  throw rollback;
 }),error=>error===rollback);
 console.log("PASS: expired completed reports close at boundary, reopened/in-progress/future/missing-date reports stay unchanged, repeat execution does not duplicate audit. All changes rolled back.");
}finally{await pool.end();}
