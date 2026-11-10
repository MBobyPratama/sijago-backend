import { and, desc, eq, ilike, ne, notInArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import { reports, reportStatusEnum } from "../db/schema.js";
import { listEnrichedReports } from "./moderation.service.js";

export const adminQueueQuery = z.object({
  page: z.coerce.number().int().min(1).max(1000000).default(1),
  query: z.string().trim().max(200).default(""),
  status: z.enum(["ALL", ...reportStatusEnum.enumValues]).default("ALL"),
  sort: z.enum(["PRIORITY", "NEWEST"]).default("PRIORITY"),
});
export const ADMIN_QUEUE_PAGE_SIZE = 10;
// Match the approved draft, or the latest draft when not yet approved.
const reportTitle = sql<string>`coalesce((select d.title from report_drafts d where d.report_id = ${reports.id} order by (d.id = ${reports.approvedDraftId}) desc nulls last, d.created_at desc, d.id desc limit 1), '[LUBANG] Laporan Kerusakan Jalan')`;

export async function listAdminQueue(input: z.infer<typeof adminQueueQuery>, database: Pick<typeof db, "select"> = db, enrich: typeof listEnrichedReports = listEnrichedReports) {
  const search = `%${input.query.replace(/[\\%_]/g, "\\$&")}%`;
  const where = and(ne(reports.status, "DRAFT"), input.status !== "ALL" ? eq(reports.status, input.status) : undefined,
    input.query ? or(ilike(reports.ticketCode, search), ilike(reports.districtName, search), ilike(reportTitle, search)) : undefined);
  const [count] = await database.select({ total: sql<number>`count(*)::int` }).from(reports).where(where);
  const total = count.total;
  const totalPages = Math.max(1, Math.ceil(total / ADMIN_QUEUE_PAGE_SIZE));
  const page = Math.min(input.page, totalPages);
  const ids = await database.select({ id: reports.id }).from(reports).where(where)
    .orderBy(...(input.sort === "PRIORITY" ? [desc(reports.priorityScore), desc(reports.createdAt), desc(reports.id)] : [desc(reports.createdAt), desc(reports.id)]))
    .limit(ADMIN_QUEUE_PAGE_SIZE).offset((page - 1) * ADMIN_QUEUE_PAGE_SIZE);
  const enriched = await enrich({ reportIds: ids.map(row => row.id) });
  const byId = new Map(enriched.map(report => [report.id, report]));
  return { items: ids.flatMap(row => byId.has(row.id) ? [byId.get(row.id)!] : []), pagination: { page, pageSize: ADMIN_QUEUE_PAGE_SIZE, total, totalPages } };
}

/** Independent of queue filters/pages so merging can target reports on other pages. */
export async function listMergeCandidates() {
  return db.select({ id: reports.id, ticketCode: reports.ticketCode, title: reportTitle, districtName: sql<string>`coalesce(${reports.districtName}, '')` })
    .from(reports).where(notInArray(reports.status, ["DRAFT", "DUPLIKAT", "DITOLAK"]))
    .orderBy(desc(reports.createdAt), desc(reports.id));
}
