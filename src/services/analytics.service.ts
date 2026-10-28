import { listEnrichedReports } from "./moderation.service.js";
import { getWeatherRoadIntelligenceSummary } from "./weather.service.js";

/**
 * Ekspor CSV Anonim Laporan Terverifikasi & Indikator Weather-Road Intelligence (US-17 / FR-7.4)
 * Dijamin tanpa data PII pelapor (email/telepon pelapor tidak pernah disertakan sesuai BRL-14).
 */
export async function generatePublicReportsCsv(): Promise<string> {
  const reports = await listEnrichedReports({ publicOnly: true });
  const weather = await getWeatherRoadIntelligenceSummary();
  const rainMap = new Map(weather.districtStats.map((d) => [d.district, d]));

  const headers = [
    "ticket_code",
    "status",
    "draft_source_label",
    "category",
    "dimensions_cm",
    "district_name",
    "subdistrict_name",
    "latitude",
    "longitude",
    "landmark",
    "upvotes_count",
    "priority_score",
    "assigned_agency",
    "is_recurrent_hotspot",
    "district_rainfall_mm",
    "district_is_red_zone",
    "created_at",
  ];

  const escapeCsv = (val: unknown): string => {
    const str = val === null || val === undefined ? "" : String(val);
    if (str.includes(",") || str.includes('"') || str.includes("\n")) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const rows = reports.map((r) => {
    const distWeather = rainMap.get(r.districtName);
    return [
      r.ticketCode,
      r.status,
      r.permanentLabel,
      r.category,
      r.dimensionsCm,
      r.districtName,
      r.subdistrictName,
      r.lat,
      r.lng,
      r.landmark,
      r.upvotes,
      r.priorityScore,
      r.assignedAgency || "BELUM_DIROUTING",
      r.isRecurrentHotspot ? "YA" : "TIDAK",
      distWeather?.rainfallMm ?? 0,
      distWeather?.isRedZone ? "ZONA_MERAH" : "NORMAL",
      r.createdAt,
    ]
      .map(escapeCsv)
      .join(",");
  });

  return [headers.join(","), ...rows].join("\n");
}

/**
 * Menghasilkan Dokumen Lembar Laporan Resmi Siap Cetak / Simpan PDF (Fitur F2 • FR-2.10)
 * Mempertahankan Label Permanen Sumber Draf ([Draf Dibantu AI] / [Draf Template]) dan Fakta Asal Terkunci.
 */
export async function generateOfficialReportDocumentHtml(
  reportIdOrCode: string
): Promise<string | null> {
  const all = await listEnrichedReports({ publicOnly: false });
  const rep = all.find(
    (r) =>
      r.id === reportIdOrCode ||
      r.ticketCode.toUpperCase() === reportIdOrCode.toUpperCase()
  );

  if (!rep) return null;

  const printedAt = new Date().toLocaleString("id-ID", {
    dateStyle: "full",
    timeStyle: "short",
  });

  return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8" />
  <title>Lembar Laporan Resmi SIJAGO — ${rep.ticketCode}</title>
  <style>
    body {
      font-family: "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: #0f172a;
      max-width: 800px;
      margin: 24px auto;
      padding: 24px 32px;
      border: 1px solid #cbd5e1;
      border-radius: 12px;
      background: #ffffff;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 3px solid #1e3a8a;
      padding-bottom: 16px;
      margin-bottom: 20px;
    }
    .brand {
      font-size: 20px;
      font-weight: 800;
      color: #1e3a8a;
    }
    .subtitle {
      font-size: 12px;
      color: #475569;
      margin-top: 4px;
    }
    .badge {
      display: inline-block;
      padding: 4px 10px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 700;
      background: #eef2ff;
      color: #3730a3;
      border: 1px solid #c7d2fe;
    }
    .section {
      margin-bottom: 18px;
    }
    .section-title {
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #475569;
      margin-bottom: 8px;
      border-bottom: 1px solid #e2e8f0;
      padding-bottom: 4px;
    }
    .grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
      font-size: 13px;
    }
    .box {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 12px;
    }
    .footer {
      margin-top: 28px;
      padding-top: 12px;
      border-top: 1px dashed #cbd5e1;
      font-size: 11px;
      color: #64748b;
    }
    .no-print {
      margin-bottom: 16px;
      display: flex;
      justify-content: flex-end;
      gap: 8px;
    }
    .btn {
      background: #1e3a8a;
      color: white;
      border: none;
      padding: 8px 16px;
      border-radius: 8px;
      font-weight: 700;
      cursor: pointer;
      font-size: 13px;
    }
    @media print {
      .no-print { display: none; }
      body { border: none; margin: 0; padding: 0; }
    }
  </style>
</head>
<body>
  <div class="no-print">
    <button class="btn" onclick="window.print()">🖨️ Cetak / Simpan sebagai PDF (FR-2.10)</button>
  </div>

  <div class="header">
    <div>
      <div class="brand">SIJAGO — SISTEM JALAN BOGOR</div>
      <div class="subtitle">Dokumen Lembar Laporan Masyarakat & Pengantar Eskalasi Instansi (MIA2026)</div>
    </div>
    <div style="text-align: right;">
      <div style="font-family: monospace; font-size: 16px; font-weight: 800;">${rep.ticketCode}</div>
      <div style="margin-top: 6px;"><span class="badge">${rep.permanentLabel}</span></div>
    </div>
  </div>

  <div class="section">
    <div class="section-title">1. Ringkasan Laporan Resmi (Disetujui Pelapor • Human-in-the-Loop)</div>
    <div class="box">
      <div style="font-size: 15px; font-weight: 700; margin-bottom: 8px;">${rep.title}</div>
      <div style="font-size: 13px; line-height: 1.6;">${rep.body}</div>
    </div>
  </div>

  <div class="section">
    <div class="section-title">2. Fakta Asal Lapangan Terkunci (Origin Facts • BRL-08)</div>
    <div class="grid">
      <div class="box"><strong>Kecamatan / Kelurahan:</strong><br/>${rep.districtName} / ${rep.subdistrictName}</div>
      <div class="box"><strong>Kategori & Dimensi Fisik:</strong><br/>${rep.category} (${rep.dimensionsCm})</div>
      <div class="box"><strong>Koordinat Geospasial (WGS84):</strong><br/>${rep.lat}, ${rep.lng} (${rep.locationSource})</div>
      <div class="box"><strong>Patokan Lokasi:</strong><br/>${rep.landmark}</div>
      <div class="box"><strong>Instansi Tujuan Routing:</strong><br/>${rep.assignedAgency || "Menunggu Routing Admin SIJAGO"}</div>
      <div class="box"><strong>Status & Skor Prioritas:</strong><br/>${rep.status} • Skor ${rep.priorityScore}/100 (+${rep.upvotes} warga)</div>
    </div>
  </div>

  <div class="section">
    <div class="section-title">3. Pernyataan Kepatuhan Privasi & Audit (BRL-12 & BRL-14)</div>
    <div class="box" style="font-size: 12px; line-height: 1.5;">
      • <strong>Perlindungan Identitas Pelapor (BRL-14):</strong> Data kontak pribadi pelapor dienkripsi dan tidak dicantumkan dalam dokumen publik maupun surat pengantar eskalasi.<br/>
      • <strong>Integritas Draf & Fakta Asal (BRL-01 / FR-3.5):</strong> Draf laporan ini telah melalui persetujuan eksplisit pelapor pada Panel Sanding Fakta Asal vs Draf.<br/>
      • <strong>Disclaimer Kewenangan (BRL-13):</strong> Waktu pelaksanaan perbaikan fisik sepenuhnya menjadi kewenangan instansi pemerintah terkait.
    </div>
  </div>

  <div class="footer">
    Dicetak dari Platform SIJAGO (Sistem Jalan Bogor) pada ${printedAt} • Kode Tiket: ${rep.ticketCode}
  </div>
</body>
</html>`;
}
