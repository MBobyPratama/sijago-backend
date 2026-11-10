import assert from "node:assert/strict";
import { exportAuditLogs, serializeAuditExport } from "../src/services/auditExport.service.js";

const row = { id: 42, occurredAt: new Date("2026-11-09T01:02:03Z"), reportId: null, actorId: '=HYPERLINK("https://example.test")', actorType: "ADMIN" as const, actionType: "VERIFY_REPORT" as const, snapshotBefore: null, snapshotAfter: { description: 'Jalan rusak, "berlubang"\nBogor', count: 2 }, requestId: "req-test", ipHash: "ip-hash", userAgent: "@SUM(1)", prevEntryHash: "previous-hash", entryHash: "original-hash" };
const csv = serializeAuditExport([row], "csv");
assert.ok(csv.startsWith("\uFEFFid,occurredAt,"));
assert.ok(csv.includes('"2026-11-09T01:02:03.000Z"'));
assert.ok(csv.includes('"\'=HYPERLINK(""https://example.test"")"'));
assert.ok(csv.includes('"\'@SUM(1)"'));
assert.ok(csv.includes('"original-hash"'));
const json = JSON.parse(serializeAuditExport([row], "json"));
assert.deepEqual(json[0].snapshotAfter, row.snapshotAfter);
assert.equal(json[0].actorId, row.actorId);
assert.equal(json[0].occurredAt, row.occurredAt.toISOString());

let audit: any;
let failAudit = false;
const database: any = { transaction: async (run: any) => run({
  select: () => {
    const query: any = { from: () => query, where: () => query, orderBy: () => query, limit: async () => [{ entryHash: row.entryHash }], then: (resolve: any, reject: any) => Promise.resolve([row]).then(resolve, reject) };
    return query;
  },
  insert: () => ({ values: (value: any) => ({ returning: async () => { if (failAudit) throw new Error("Audit unavailable"); audit = value; return [{ id: 43 }]; } }) }),
}) };
const input = { ids: [42], format: "json" as const, actorId: "authenticated-admin" };
const exported = await exportAuditLogs(input, database);
assert.equal(exported.count, 1);
assert.equal(exported.auditEntryId, 43);
assert.equal(audit.actionType, "LOG_EXPORTED");
assert.equal(audit.actorId, input.actorId);
assert.deepEqual(audit.snapshotAfter.entryIds, [42]);
assert.equal(audit.prevEntryHash, row.entryHash);
assert.equal(JSON.parse(exported.content)[0].entryHash, row.entryHash);
failAudit = true;
await assert.rejects(exportAuditLogs(input, database), /Audit unavailable/);
await assert.rejects(exportAuditLogs({ ...input, ids: [42, 43] }, database), /Sebagian entri/);
console.log("PASS CSV escaping/formula protection, JSON snapshot fidelity, original hashes, authenticated export audit, and fail-closed export. No database writes.");
