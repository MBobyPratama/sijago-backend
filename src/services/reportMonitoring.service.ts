import { and, eq, lte } from "drizzle-orm";
import { db } from "../db/index.js";
import { reports } from "../db/schema.js";
import { appendAuditLog } from "./audit.service.js";

/** Row locks also serialize expiry with community sign-off. Each batch is atomic. */
export async function closeExpiredReports(database: Pick<typeof db, "transaction"> = db, now = new Date()) {
  return database.transaction(async tx => {
    const expired = await tx.select().from(reports)
      .where(and(eq(reports.status, "SELESAI"), lte(reports.monitoringEndsAt, now)))
      .orderBy(reports.id).limit(100).for("update", { skipLocked: true });
    for (const report of expired) {
      await tx.update(reports).set({ status: "DITUTUP", closedAt: now, updatedAt: now }).where(eq(reports.id, report.id));
      await appendAuditLog({ reportId: report.id, actorId: "system_monitoring_expiry", actorType: "SISTEM", actionType: "STATUS_CHANGED",
        snapshotBefore: { status: report.status, monitoringEndsAt: report.monitoringEndsAt },
        snapshotAfter: { status: "DITUTUP", closedAt: now, reason: "MONITORING_PERIOD_ENDED" } }, tx);
    }
    return expired.length;
  });
}

/** Catch up on startup, then every minute while the backend is running. */
export function startReportMonitoring() {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try { while (await closeExpiredReports() === 100) { /* Drain overdue batches. */ } }
    catch (error) { console.error("[report-monitoring] Automatic closure failed; retrying next minute.", error instanceof Error ? error.message : "Unknown error"); }
    finally { running = false; }
  };
  void run();
  const timer = setInterval(() => void run(), 60_000);
  timer.unref();
  return () => clearInterval(timer);
}
