import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";

interface DocumentReport {
  ticketCode: string; title: string; body: string; status: string;
  category: string; sizeClass: string; dimensionsCm: string;
  districtName: string; subdistrictName: string; landmark: string;
  lat: number; lng: number; locationSource: string;
  assignedAgency: string | null; upvotes: number; priorityScore: number;
  createdAtIso: string; submittedAt: string | null; observedAt: string | null;
  freeText: string | null;
}

const escapeHtml = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
const PRINT_SCRIPT = 'document.getElementById("print-document").addEventListener("click",function(){window.print()});';
export const REPORT_DOCUMENT_CSP = `default-src 'none'; style-src 'unsafe-inline'; font-src data:; script-src 'sha256-${createHash("sha256").update(PRINT_SCRIPT).digest("base64")}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`;
let embeddedFont: string | undefined;
const dateWib = (value: string | null) => {
  if (!value || !Number.isFinite(Date.parse(value))) return "Tidak diisi";
  return new Intl.DateTimeFormat("id-ID", { timeZone: "Asia/Jakarta", day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(value)) + " WIB";
};
const STATUS: Record<string, string> = { DRAFT: "Draf belum dikirim", MENUNGGU_VERIFIKASI: "Menunggu verifikasi", TERVERIFIKASI: "Terverifikasi", DITERUSKAN: "Diteruskan", DIPROSES: "Diproses", SELESAI: "Selesai", DIBUKA_KEMBALI: "Dibuka kembali", DITUTUP: "Ditutup", DITOLAK: "Ditolak", DUPLIKAT: "Duplikat" };
const CATEGORY: Record<string, string> = { LUBANG: "Lubang jalan", RETAK: "Retak", AMBLAS: "Jalan amblas", BERGELOMBANG: "Permukaan bergelombang", GENANGAN_DRAINASE: "Genangan / drainase", LAINNYA: "Lainnya" };

/** A public report record, not a signed government letter. Every report value is escaped. */
export function renderReportDocument(rep: DocumentReport, frontendUrl: string, printedAt = new Date()): string {
  embeddedFont ??= readFileSync(resolve(process.cwd(), "assets/fonts/plus-jakarta-sans-latin.woff2")).toString("base64");
  const track = new URL(`/lacak?kode=${encodeURIComponent(rep.ticketCode)}`, frontendUrl).href;
  const row = (label: string, value: unknown) => `<tr><th scope="row">${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`;
  return `<!DOCTYPE html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Lembar Laporan SIJAGO - ${escapeHtml(rep.ticketCode)}</title>
<style>
@font-face{font-family:Jakarta;src:url(data:font/woff2;base64,${embeddedFont}) format('woff2');font-weight:200 800;font-display:block}
@page{size:A4;margin:15mm 17mm 17mm;@bottom-right{content:"Halaman " counter(page) " / " counter(pages);font:8pt Arial;color:#52667b}}
*{box-sizing:border-box}body{margin:0;background:#f5f7fa;color:#172c43;font-family:Jakarta,Arial,sans-serif;font-size:9.5pt;line-height:1.5}
.toolbar{max-width:210mm;margin:20px auto;display:flex;gap:16px;align-items:center;justify-content:space-between;padding:0 18mm}.toolbar p{font-size:9pt;color:#52667b;margin:0}button{font:inherit;font-weight:600;background:#1e40af;color:white;border:0;border-radius:8px;padding:12px 18px;cursor:pointer;white-space:nowrap}button:focus-visible,a:focus-visible{outline:3px solid #059669;outline-offset:3px}
main{max-width:210mm;margin:0 auto 24px;background:white;padding:17mm 18mm 18mm}header{border-bottom:2px solid #1e40af;padding-bottom:12px;margin-bottom:16px}.brand{font-size:21pt;font-weight:800;letter-spacing:-.04em;color:#1e40af}.brand small{display:block;font-size:9pt;font-weight:500;letter-spacing:0;color:#52667b}h1{font-size:17pt;line-height:1.3;margin:16px 0 7px;letter-spacing:-.02em}.ticket{display:flex;flex-wrap:wrap;justify-content:space-between;gap:8px;font-size:10pt}.ticket strong{font-variant-numeric:tabular-nums}h2{font-size:10pt;letter-spacing:.04em;text-transform:uppercase;margin:16px 0 8px;padding-bottom:6px;border-bottom:1px solid #d6dfe8;break-after:avoid-page}h3{font-size:12pt;line-height:1.5;margin:0 0 8px;break-after:avoid-page}p{margin:0 0 10px;orphans:3;widows:3}.narrative{white-space:pre-wrap;overflow-wrap:anywhere}table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:9pt}th,td{text-align:left;vertical-align:top;padding:4px 0;border-bottom:1px solid #d6dfe8;overflow-wrap:anywhere;white-space:pre-wrap}th{width:35%;padding-right:18px;font-weight:500;color:#52667b}tr{break-inside:avoid-page}a{color:#1e40af;overflow-wrap:anywhere}.note{font-size:9pt;color:#52667b}footer{margin-top:12px;padding-top:8px;border-top:1px solid #d6dfe8;font-size:7.5pt;color:#52667b;break-inside:avoid-page}footer p{margin-bottom:6px}
@media print{body{background:white}main{max-width:none;margin:0;padding:0}.toolbar{display:none}header{break-inside:avoid-page}a{color:inherit;text-decoration:none}}
@media screen and (max-width:640px){main{padding:24px 20px}.toolbar{padding:0 20px;align-items:flex-start;flex-direction:column}th{width:39%;padding-right:12px}}
</style></head><body>
<div class="toolbar"><p>Pilih ukuran kertas A4 dan skala 100% saat mencetak.</p><button id="print-document" type="button">Cetak / Simpan PDF</button></div>
<main><header><div class="brand">SIJAGO<small>Sistem Jalan Bogor</small></div><h1>Lembar laporan kerusakan jalan</h1><div class="ticket"><strong>${escapeHtml(rep.ticketCode)}</strong><span>Status: ${escapeHtml(STATUS[rep.status] ?? rep.status)}</span></div></header>
<section aria-labelledby="summary"><h2 id="summary">01 / Ringkasan laporan</h2><h3>${escapeHtml(rep.title)}</h3><p class="narrative">${escapeHtml(rep.body || "Ringkasan belum tersedia.")}</p></section>
<section aria-labelledby="facts"><h2 id="facts">02 / Data dan lokasi pengamatan</h2><table><tbody>
${row("Kategori kerusakan", CATEGORY[rep.category] ?? rep.category)}
${row("Kelas ukuran", `${rep.sizeClass.toLowerCase()} (perkiraan warga)`)}
${/^Kelas /i.test(rep.dimensionsCm) ? "" : row("Ukuran yang dilaporkan", rep.dimensionsCm)}
${row("Kecamatan / kelurahan", `${rep.districtName} / ${rep.subdistrictName}`)}
${row("Patokan lokasi", rep.landmark)}
${row("Koordinat (WGS84)", `${rep.lat}, ${rep.lng}`)}
${row("Penentuan lokasi", rep.locationSource === "GPS" ? "Lokasi perangkat (GPS)" : rep.locationSource === "MANUAL_PIN" ? "Titik dipilih warga pada peta" : rep.locationSource)}
${row("Waktu pengamatan", dateWib(rep.observedAt))}
</tbody></table><h3 style="margin-top:16px">Kondisi yang disampaikan warga</h3><p class="narrative">${escapeHtml(rep.freeText?.trim() || "Tidak diisi.")}</p><p class="note">Rincian di atas bersumber dari isian warga. Kelas ukuran merupakan perkiraan, bukan hasil pengukuran teknis.</p></section>
<section aria-labelledby="handling"><h2 id="handling">03 / Pencatatan dan penanganan</h2><table><tbody>
${row("Dibuat di sistem", dateWib(rep.createdAtIso))}
${row("Dikirim warga", rep.submittedAt ? dateWib(rep.submittedAt) : "Belum tercatat dikirim")}
${row("Status saat dicetak", STATUS[rep.status] ?? rep.status)}
${row("Instansi tujuan", rep.assignedAgency || "Belum ditetapkan")}
${row("Dukungan warga", `${rep.upvotes} dukungan`)}
</tbody></table></section>
<footer><p>Dicetak pada ${escapeHtml(dateWib(printedAt.toISOString()))}. Status dapat berubah setelah dokumen dicetak.</p><p>Pantau laporan: <a href="${escapeHtml(track)}">${escapeHtml(track)}</a></p><p>Identitas dan kontak pribadi pelapor tidak ditampilkan. Dokumen ini merupakan salinan informasi dari SIJAGO, bukan surat penetapan atau dokumen bertanda tangan instansi. Penanganan fisik mengikuti kewenangan instansi terkait.</p></footer></main>
<script>${PRINT_SCRIPT}</script></body></html>`;
}
