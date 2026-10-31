import assert from "node:assert/strict";
import { eq, inArray, sql } from "drizzle-orm";
import { db, pool } from "../src/db/index.js";
import { reports, reportFactVersions, reportDrafts, reportApprovals, reportUpvotes } from "../src/db/schema.js";
import { DEMO_REPORTS, seedDemoReports } from "../src/db/seed-demo.js";

// Optional Neon integration test: all inserts are rolled back, never committed.
const rollback = new Error("ROLLBACK_DEMO_TEST");
try {
  const before = await db.execute(sql`SELECT count(*)::int AS reports FROM reports`);
  await assert.rejects(db.transaction(async tx => {
    const first = await seedDemoReports(tx);
    const second = await seedDemoReports(tx);
    assert.equal(first.created + first.skipped, DEMO_REPORTS.length);
    assert.deepEqual(second, { created: 0, skipped: DEMO_REPORTS.length });
    const rows = await tx.select().from(reports).where(inArray(reports.ticketCode, DEMO_REPORTS.map(item => item.code)));
    assert.equal(rows.length, DEMO_REPORTS.length);
    for (const row of rows) {
      assert(row.currentFactsVersionId && row.approvedDraftId);
      const [fact] = await tx.select().from(reportFactVersions).where(eq(reportFactVersions.id, row.currentFactsVersionId));
      const [draft] = await tx.select().from(reportDrafts).where(eq(reportDrafts.id, row.approvedDraftId));
      const [approval] = await tx.select().from(reportApprovals).where(eq(reportApprovals.draftId, draft.id));
      const votes = await tx.select().from(reportUpvotes).where(eq(reportUpvotes.reportId, row.id));
      assert(draft.title.startsWith("[SIMULASI]"));
      assert.equal(row.currentFactsHash, fact.factsHash);
      assert.equal(approval.approvedFactsHash, draft.factsHash);
      assert.equal(votes.length, row.upvoteCount);
    }
    throw rollback;
  }), error => error === rollback);
  const after = await db.execute(sql`SELECT count(*)::int AS reports FROM reports`);
  assert.equal(after.rows[0].reports, before.rows[0].reports);
  console.log("PASS: demo relations, approvals/facts hashes, vote totals, repeat-run idempotency and rollback; no demo rows persisted.");
} finally { await pool.end(); }
