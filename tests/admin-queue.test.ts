import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db, pool } from "../src/db/index.js";
import { reporters, reports, reportFactVersions, reportDrafts } from "../src/db/schema.js";
import { adminQueueQuery, listAdminQueue } from "../src/services/adminQueue.service.js";

assert.equal(adminQueueQuery.parse({}).page, 1);
for (const query of [{ page: 0 }, { page: "abc" }, { status: "INVALID" }, { sort: "INVALID" }, { query: "x".repeat(201) }]) assert.equal(adminQueueQuery.safeParse(query).success, false);
const rollback = new Error("ROLLBACK_QUEUE_TEST");
try {
  await assert.rejects(db.transaction(async tx => {
    const suffix = randomUUID().slice(0, 8), prefix = `PAG-${suffix}`;
    const [reporter] = await tx.insert(reporters).values({ pseudonymId: prefix, deviceHash: "queue-test" }).returning();
    const fixtures = await tx.insert(reports).values(Array.from({ length: 61 }, (_, i) => ({ ticketCode: `${prefix}-${i}`, trackingToken: randomUUID(), reporterId: reporter.id, status: i === 60 ? "DRAFT" as const : i < 30 ? "MENUNGGU_VERIFIKASI" as const : "TERVERIFIKASI" as const, districtName: prefix, location: { lat: -6.59, lng: 106.8 }, lat: "-6.59", lng: "106.8", currentFactsHash: "a".repeat(64), priorityScore: String(i), createdAt: new Date(Date.UTC(2026, 0, 1, 0, i)) }))).returning();
    const enrich: any = async ({ reportIds }: { reportIds: string[] }) => fixtures.filter(report => reportIds.includes(report.id));
    const base = adminQueueQuery.parse({ query: prefix });
    const first = await listAdminQueue(base, tx, enrich);
    const second = await listAdminQueue({ ...base, page: 2 }, tx, enrich);
    const third = await listAdminQueue({ ...base, page: 3 }, tx, enrich);
    assert.deepEqual([first.items.length, second.items.length, third.items.length], [10, 10, 10]);
    assert.equal(first.pagination.total, 60);
    assert.equal(first.pagination.totalPages, 6);
    assert.equal(first.pagination.pageSize, 10);
    const remaining = [];
    for (const page of [4, 5, 6]) remaining.push(await listAdminQueue({ ...base, page }, tx, enrich));
    assert.equal(new Set([first, second, third, ...remaining].flatMap(result => result.items.map(item => item.id))).size, 60);
    assert.equal(first.items[0].id, fixtures[59].id);
    assert.equal((await listAdminQueue({ ...base, page: 999 }, tx, enrich)).pagination.page, 6);
    const status = await listAdminQueue({ ...base, status: "MENUNGGU_VERIFIKASI", page: 2 }, tx, enrich);
    assert.equal(status.pagination.total, 30);
    assert.equal(status.items.length, 10);
    assert.equal((await listAdminQueue({ ...base, query: prefix + "%" }, tx, enrich)).pagination.total, 0);
    const [fact] = await tx.insert(reportFactVersions).values({ reportId: fixtures[0].id, versionNo: 1, category: "LUBANG", sizeClass: "SEDANG", landmark: "Test", lat: "-6.59", lng: "106.8", photoIds: [], factsHash: "b".repeat(64), createdByActor: "test" }).returning();
    await tx.insert(reportDrafts).values({ reportId: fixtures[0].id, factsVersionId: fact.id, sourceType: "TEMPLATE", title: `Judul unik ${suffix}`, body: "Test", factsHash: fact.factsHash });
    const titleSearch = await listAdminQueue({ ...base, query: `Judul unik ${suffix}` }, tx, enrich);
    assert.equal(titleSearch.pagination.total, 1);
    assert.equal(titleSearch.items[0].id, fixtures[0].id);
    throw rollback;
  }), error => error === rollback);
  console.log("PASS 10 reports per page across 6 pages, unique ordering, total count, global status/title/district search, wildcard escaping, page clamping and validation. All fixtures rolled back.");
} finally { await pool.end(); }
