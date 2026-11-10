export interface ReportDescriptionData { items: { label: string; value: string }[]; condition: string | null }
export interface DescriptionFacts { category: string; sizeClass: string; landmark: string; observedAt?: string | Date | null; freeText?: string | null; impactTags?: string[] }
const CATEGORIES: Record<string, string> = { LUBANG: "Lubang", RETAK: "Retak", AMBLAS: "Amblas", BERGELOMBANG: "Bergelombang", GENANGAN_DRAINASE: "Genangan / drainase", LAINNYA: "Lainnya" };
const SIZES: Record<string, string> = { KECIL: "Kecil", SEDANG: "Sedang", BESAR: "Besar" };
export function buildReportDescription(facts: DescriptionFacts): ReportDescriptionData {
  const observed = facts.observedAt ? new Date(facts.observedAt) : null;
  return { items: [
    { label: "Lokasi", value: facts.landmark.trim() || "Belum diisi" },
    { label: "Kategori kerusakan", value: CATEGORIES[facts.category] || facts.category.replaceAll("_", " ") },
    { label: "Kelas ukuran", value: `${SIZES[facts.sizeClass] || facts.sizeClass} — perkiraan warga` },
    { label: "Waktu pengamatan", value: observed && Number.isFinite(observed.getTime()) ? new Intl.DateTimeFormat("id-ID", { timeZone: "Asia/Jakarta", day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(observed) + " WIB" : "Tidak diisi" },
    ...(facts.impactTags?.length ? [{ label: "Dampak yang dilaporkan", value: facts.impactTags.map(tag => tag.replaceAll("_", " ").toLowerCase()).join(", ") }] : []),
  ], condition: facts.freeText?.trim() || null };
}
export function descriptionToText(description: ReportDescriptionData) {
  return description.items.map(item => `- ${item.label}: ${item.value}`).join("\n") + (description.condition ? `\n\nKondisi di lapangan:\n${description.condition}` : "");
}
const escape = (value: string) => value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
export function descriptionToHtml(description: ReportDescriptionData) {
  return `<ul style="padding-left:20px;line-height:1.7;overflow-wrap:anywhere;">${description.items.map(item => `<li><strong>${escape(item.label)}:</strong> ${escape(item.value).replaceAll("\n", "<br/>")}</li>`).join("")}</ul>` + (description.condition ? `<p><strong>Kondisi di lapangan:</strong></p><p style="white-space:pre-wrap;overflow-wrap:anywhere;">${escape(description.condition)}</p>` : "");
}
