import assert from "node:assert/strict";
import { db } from "../src/db/index.js";
import { reports, reportApprovals, reportDrafts } from "../src/db/schema.js";
import { submitReportFinal } from "../src/services/report.service.js";
import { buildTicketReceiptEmail } from "../src/services/email.service.js";

// In-memory submission/email integration. No database writes or external email delivery.
let report: any, valid = true, auditFailure = false;
const audit: any[] = [];
const select = () => {
  let table: unknown;
  const rows = () => table === reports ? [{ ...report }] : [reportApprovals, reportDrafts].includes(table as any) && valid ? [{ id: "approved" }] : [];
  const query: any = { from(value: unknown) { table = value; return query; }, where() { return query; }, orderBy() { return query; }, limit() { return query; }, for() { return query; }, then(resolve: any, reject: any) { return Promise.resolve(rows()).then(resolve, reject); } };
  return query;
};
const update = () => ({ set: (value: any) => ({ where: () => { Object.assign(report, value); return { returning: async () => [{ ...report }], then: (resolve: any) => Promise.resolve().then(resolve) }; } }) });
const originalTransaction = db.transaction, originalUpdate = db.update;
(db as any).update = update;
(db as any).transaction = async (callback: any) => {
  const before = { ...report }, count = audit.length;
  try { return await callback({ select, update, insert: () => ({ values: (value: any) => { if (auditFailure) throw new Error("audit failure"); audit.push(value); return { returning: async () => [value] }; } }) }); }
  catch (error) { report = before; audit.length = count; throw error; }
};
const reset = (email: string | null = "test@example.test") => { report = { id: "report-1", ticketCode: "SJG-TEST-1", trackingToken: "token", status: "DRAFT", currentFactsHash: "hash", receiptEmailTo: email, receiptEmailStatus: null }; valid = true; auditFailure = false; audit.length = 0; };
const params = { reportId: "report-1", draftId: "approved", approvedFactsHash: "hash", idempotencyKey: "key" };
try {
  let sent = 0;
  const sender = async () => { sent++; return "SENT" as const; };
  reset();
  const first = await submitReportFinal(params, sender);
  assert.equal(first.receiptEmailStatus, "SENT"); assert.equal(sent, 1);
  const replay = await submitReportFinal(params, sender);
  assert.equal(replay.idempotentReplay, true); assert.equal(sent, 1); assert.equal(audit.length, 1);
  await assert.rejects(submitReportFinal({ ...params, idempotencyKey: "other" }, sender)); assert.equal(sent, 1);
  reset(null); assert.equal((await submitReportFinal(params, sender)).receiptEmailStatus, "NOT_REQUESTED"); assert.equal(sent, 1);
  reset(); assert.equal((await submitReportFinal(params, async () => { throw new Error("mail offline"); })).receiptEmailStatus, "FAILED"); assert.equal(report.status, "MENUNGGU_VERIFIKASI");
  reset(); valid = false; await assert.rejects(submitReportFinal(params, sender), { status: 409 }); assert.equal(report.status, "DRAFT");
  reset(); auditFailure = true; await assert.rejects(submitReportFinal(params, sender), /audit failure/); assert.equal(report.status, "DRAFT"); assert.equal(sent, 1);
  const email = buildTicketReceiptEmail("SJG-TEST-1"); assert(email.text.includes("kode=SJG-TEST-1")); assert(email.text.includes("antrean verifikasi"));
  assert(email.html.includes("/images/logo_header_email.png"));
  assert(email.html.includes('width="190" height="66"'));
  assert(email.html.includes("Lacak laporan"));
  assert(!buildTicketReceiptEmail('<script>alert("x")</script>').html.includes("<script>"));
  console.log("PASS: submission and email statuses, replay deduplication, missing email, provider failure, approval validation, audit rollback and receipt link.");
} finally { db.transaction = originalTransaction; db.update = originalUpdate; }
