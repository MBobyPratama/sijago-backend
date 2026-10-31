import assert from "node:assert/strict";
import { db } from "../src/db/index.js";
import { reports, escalations, adminNotes, reportAuditLogs } from "../src/db/schema.js";
import { authContext } from "../src/auth-context.js";
import { adminCancelVerification } from "../src/services/moderation.service.js";

// In-memory query adapter: no changes to real reports or Neon accounts.
let current: any;
let forwarded = false;
let failAudit = false;
const notes: any[] = [], audit: any[] = [];
function select() {
  let table: unknown;
  const rows = () => table === reports ? [{ ...current }] : table === escalations && forwarded ? [{ id: "sent" }] : [];
  const query: any = { from(value: unknown) { table = value; return query; }, where() { return query; }, orderBy() { return query; }, limit: async () => rows(), for: async () => rows() };
  return query;
}
const originalSelect = db.select, originalTransaction = db.transaction;
(db as any).select = select;
(db as any).transaction = async (callback: any) => {
  const before = { ...current }, noteCount = notes.length, auditCount = audit.length;
  const tx = { select, update: () => ({ set: (value: any) => ({ where: async () => { Object.assign(current, value); } }) }), insert: (table: unknown) => ({ values: (value: any) => {
    if (table === reportAuditLogs && failAudit) throw new Error("audit unavailable");
    (table === adminNotes ? notes : audit).push(value);
    return { returning: async () => [value] };
  } }) };
  try { return await callback(tx); } catch (error) { current = before; notes.length = noteCount; audit.length = auditCount; throw error; }
};
const reset = () => { current = { id: "report-id", ticketCode: "SJG-TEST", status: "TERVERIFIKASI", verifiedAt: new Date(), forwardedAt: null, assignedAgencyId: null }; forwarded = false; notes.length = 0; audit.length = 0; };
try {
  await authContext.run({ id: "admin-id", email: "admin@example.test", fullName: "Admin", role: "ADMIN", agencyId: null, agencyCode: null, agencyName: null }, async () => {
    reset();
    for (const reason of [undefined, "   ", "x".repeat(2001)]) await assert.rejects(adminCancelVerification("SJG-TEST", reason), { status: 400 });
    for (const status of ["MENUNGGU_VERIFIKASI", "DITERUSKAN", "DIPROSES", "SELESAI", "DITOLAK"]) {
      reset(); current.status = status;
      await assert.rejects(adminCancelVerification("SJG-TEST", "Perlu pemeriksaan ulang"), { status: 409 });
      assert.equal(notes.length, 0);
    }
    for (const field of ["forwardedAt", "assignedAgencyId", "history"]) {
      reset(); if (field === "history") forwarded = true; else current[field] = "set";
      await assert.rejects(adminCancelVerification("SJG-TEST", "Perlu pemeriksaan ulang"), { status: 409 });
    }
    reset(); failAudit = true;
    await assert.rejects(adminCancelVerification("SJG-TEST", "Perlu pemeriksaan ulang"), /audit unavailable/);
    assert.equal(current.status, "TERVERIFIKASI"); assert.equal(notes.length, 0);
    failAudit = false;
    const result = await adminCancelVerification("SJG-TEST", "  Lokasi perlu diperiksa ulang  ");
    assert.equal(result.status, "MENUNGGU_VERIFIKASI"); assert.equal(current.verifiedAt, null);
    assert.equal(notes[0].authorId, "admin-id");
    assert.equal(audit[0].snapshotAfter.reason, "Lokasi perlu diperiksa ulang");
    assert.equal(audit[0].snapshotBefore.status, "TERVERIFIKASI");
    await assert.rejects(adminCancelVerification("SJG-TEST", "Ulang"), { status: 409 });
  });
  console.log("PASS: reason validation, status and forwarding guards, atomic rollback, audit actor/reason, verification reset and repeated cancellation.");
} finally { db.select = originalSelect; db.transaction = originalTransaction; }
