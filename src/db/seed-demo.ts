import { randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
import { eq, sql } from "drizzle-orm";
import { db, pool } from "./index.js";
import { agencies, reporters, reports, reportFactVersions, reportDrafts, reportApprovals, reportUpvotes, agencyUpdates } from "./schema.js";
import { computeFactsHash, hashWithSalt } from "../utils/hash.js";
import { buildDeterministicTemplateDraft } from "../services/aiDraft.service.js";
import { appendAuditLog } from "../services/audit.service.js";

// Explicit demo namespace: never overwrite a resident report or create login credentials.
export const DEMO_REPORTS = [
  { code: "DEMO-001", status: "MENUNGGU_VERIFIKASI", category: "LUBANG", size: "SEDANG", district: "Bogor Tengah", lat: -6.5971, lng: 106.8060, agency: null },
  { code: "DEMO-002", status: "TERVERIFIKASI", category: "RETAK", size: "KECIL", district: "Bogor Timur", lat: -6.6090, lng: 106.8200, agency: null },
  { code: "DEMO-003", status: "DITERUSKAN", category: "LUBANG", size: "BESAR", district: "Bogor Tengah", lat: -6.6020, lng: 106.8000, agency: "PUPR_KOTA_BOGOR" },
  { code: "DEMO-004", status: "DIPROSES", category: "BERGELOMBANG", size: "SEDANG", district: "Bogor Utara", lat: -6.5750, lng: 106.8150, agency: "BINAMARGA_JABAR" },
  { code: "DEMO-005", status: "DITERUSKAN", category: "GENANGAN_DRAINASE", size: "BESAR", district: "Bogor Selatan", lat: -6.6300, lng: 106.8180, agency: "BBPJN_NASIONAL" },
  { code: "DEMO-006", status: "DITOLAK", category: "LAINNYA", size: "KECIL", district: "Bogor Barat", lat: -6.5900, lng: 106.7750, agency: null },
] as const;
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function seedDemoReports(tx: Transaction, now = new Date()) {
  // Serialize repeated seed runs; never reset existing demo activity.
  await tx.execute(sql`SELECT pg_advisory_xact_lock(7102026)`);
  const agencyRows = await tx.select().from(agencies);
  const agencyMap = new Map(agencyRows.map(agency => [agency.code, agency]));
  for (const item of DEMO_REPORTS) if (item.agency && !agencyMap.has(item.agency)) throw new Error("Data master instansi belum lengkap. Jalankan npm run db:seed terlebih dahulu.");
  let created = 0;
  for (const [index, item] of DEMO_REPORTS.entries()) {
    const key = `sijago-demo-v1:${item.code}`;
    const [existing] = await tx.select({ id: reports.id, idempotencyKey: reports.idempotencyKey }).from(reports).where(eq(reports.ticketCode, item.code)).limit(1);
    if (existing) {
      if (existing.idempotencyKey !== key) throw new Error(`Kode ${item.code} sudah dipakai data lain; seed dibatalkan tanpa perubahan.`);
      continue;
    }
    const timestamp = new Date(now.getTime() - (index + 1) * 86400000);
    const [reporter] = await tx.insert(reporters).values({ pseudonymId: key, deviceHash: hashWithSalt(key), consentAt: timestamp }).onConflictDoUpdate({ target: reporters.pseudonymId, set: { deviceHash: hashWithSalt(key) } }).returning();
    const facts = { category: item.category, sizeClass: item.size, landmark: `[SIMULASI] Titik demo ${item.district}`, observedAt: timestamp.toISOString(), impactTags: ["MEMBAHAYAKAN_RODA_DUA"], freeText: "Data dummy untuk demonstrasi SIJAGO, bukan kondisi jalan nyata. Koordinat dan penugasan instansi hanya ilustrasi.", lat: item.lat, lng: item.lng, photoIds: [] as string[] };
    const factsHash = computeFactsHash(facts);
    const verified = ["TERVERIFIKASI", "DITERUSKAN", "DIPROSES"].includes(item.status);
    const agency = item.agency ? agencyMap.get(item.agency)! : null;
    const votes = verified ? 2 : 0;
    const [report] = await tx.insert(reports).values({ ticketCode: item.code, trackingToken: `trk_${randomBytes(24).toString("hex")}`, reporterId: reporter.id, status: item.status, location: { lat: item.lat, lng: item.lng }, lat: String(item.lat), lng: String(item.lng), locationSource: "MANUAL_PIN", districtName: item.district, currentFactsHash: factsHash, assignedAgencyId: agency?.id ?? null, submittedAt: timestamp, verifiedAt: verified ? timestamp : null, forwardedAt: agency ? timestamp : null, inProgressAt: item.status === "DIPROSES" ? timestamp : null, rejectionReason: item.status === "DITOLAK" ? "OUTSIDE_SCOPE" : null, rejectionNote: item.status === "DITOLAK" ? "[SIMULASI] Contoh laporan di luar lingkup penanganan." : null, upvoteCount: votes, priorityScore: String((item.size === "BESAR" ? 85 : item.size === "SEDANG" ? 72.5 : 55) + votes * 1.5), idempotencyKey: key, createdAt: timestamp }).returning();
    const [version] = await tx.insert(reportFactVersions).values({ reportId: report.id, versionNo: 1, category: item.category, sizeClass: item.size, landmark: facts.landmark, observedAt: timestamp, impactTags: facts.impactTags, freeText: facts.freeText, lat: String(item.lat), lng: String(item.lng), photoIds: [], factsHash, createdByActor: key, createdAt: timestamp }).returning();
    const template = buildDeterministicTemplateDraft(facts);
    const [draft] = await tx.insert(reportDrafts).values({ reportId: report.id, factsVersionId: version.id, sourceType: "TEMPLATE", title: `[SIMULASI] ${item.category.replaceAll("_", " ")} — ${item.district}`, body: template.body, factsHash, promptVersion: "demo-v1", createdAt: timestamp }).returning();
    await tx.insert(reportApprovals).values({ reportId: report.id, draftId: draft.id, approvedFactsHash: factsHash, approvedAt: timestamp });
    await tx.update(reports).set({ currentFactsVersionId: version.id, approvedDraftId: draft.id }).where(eq(reports.id, report.id));
    for (let vote = 0; vote < votes; vote++) await tx.insert(reportUpvotes).values({ reportId: report.id, voterKey: `${key}:vote:${vote}`, createdAt: timestamp });
    if (agency && item.status === "DIPROSES") await tx.insert(agencyUpdates).values({ reportId: report.id, agencyId: agency.id, newStatus: "DIPROSES", note: "[SIMULASI] Contoh penanganan untuk demonstrasi; tidak ada pekerjaan lapangan nyata.", updatedAt: timestamp });
    await appendAuditLog({ reportId: report.id, actorId: "seed-demo-v1", actorType: "SISTEM", actionType: "REPORT_SUBMITTED", snapshotAfter: { demo: true, status: item.status, ticketCode: item.code, note: "Data simulasi dibuat melalui seed demo, tanpa pengiriman email atau tindakan petugas nyata." } }, tx);
    created++;
  }
  return { created, skipped: DEMO_REPORTS.length - created };
}

async function main() {
  if (!process.argv.includes("--apply")) {
    console.table(DEMO_REPORTS.map(item => ({ tiket: item.code, status: item.status, instansi: item.agency ?? "Belum ditugaskan" })));
    console.log("Pratinjau saja; database tidak diubah. Jalankan npm run db:seed:demo -- --apply untuk menyimpan ke DATABASE_URL yang dikonfigurasi.");
    return;
  }
  const result = await db.transaction(tx => seedDemoReports(tx));
  console.log(`Seed demo selesai: ${result.created} laporan dibuat, ${result.skipped} dilewati. Tidak ada akun, foto, email, atau data cuaca dummy dibuat.`);
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch(error => { console.error("Seed demo gagal:", error instanceof Error ? error.message : "Database tidak dapat diakses."); process.exitCode = 1; }).finally(() => pool.end());
}
