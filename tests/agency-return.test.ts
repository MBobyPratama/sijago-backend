import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, pool } from "../src/db/index.js";
import { reports, reporters, agencies, reportAuditLogs } from "../src/db/schema.js";
import { agencyReturnReportToAdmin, listEnrichedReports } from "../src/services/moderation.service.js";

const rollback = new Error("ROLLBACK_AGENCY_RETURN_TEST");
try {
  await assert.rejects(db.transaction(async tx => {
    const suffix = randomUUID().slice(0,8).toUpperCase();
    const [agency] = await tx.insert(agencies).values({code:`RETURN_${suffix}`,name:"Test agency",level:"KOTA",officialEmails:[]}).returning();
    const [reporter] = await tx.insert(reporters).values({pseudonymId:`return-${suffix}`,deviceHash:"test"}).returning();
    const fixture = async (tag:string, returned=false) => (await tx.insert(reports).values({ticketCode:`RET-${suffix}-${tag}`,trackingToken:randomUUID(),reporterId:reporter.id,location:{lat:-6.59,lng:106.8},lat:"-6.59",lng:"106.8",currentFactsHash:"a".repeat(64),status:returned?"TERVERIFIKASI":"DITERUSKAN",assignedAgencyId:agency.id,forwardedAt:new Date(),returnedByAgency:returned}).returning())[0];
    const active=await fixture("ACTIVE"), legacy=await fixture("LEGACY",true);
    const ids=[active.id,legacy.id];
    const queue=()=>listEnrichedReports({agencyCode:agency.code,reportIds:ids},tx);
    assert.deepEqual((await queue()).map(item=>item.id),[active.id]);
    await agencyReturnReportToAdmin({reportIdOrCode:active.ticketCode,agencyCode:agency.code,reason:"Di luar kewenangan"},tx);
    const [saved]=await tx.select().from(reports).where(eq(reports.id,active.id));
    assert.equal(saved.status,"TERVERIFIKASI");
    assert.equal(saved.assignedAgencyId,null);
    assert.equal(saved.forwardedAt,null);
    assert.equal(saved.returnedByAgency,true);
    assert.deepEqual(await queue(),[]);
    assert.equal((await listEnrichedReports({reportIds:ids},tx)).length,2);
    const logs=await tx.select().from(reportAuditLogs).where(eq(reportAuditLogs.reportId,active.id));
    assert.equal(logs.length,1);
    assert.equal(logs[0].actionType,"STATUS_CHANGED");
    await tx.update(reports).set({assignedAgencyId:agency.id,returnedByAgency:false,status:"DITERUSKAN"}).where(eq(reports.id,active.id));
    assert.deepEqual((await queue()).map(item=>item.id),[active.id]);
    throw rollback;
  }),error=>error===rollback);
  console.log("PASS: returned and legacy-returned reports leave the agency queue, remain available to admin, and reappear only after reassignment. All fixtures rolled back.");
} finally { await pool.end(); }

