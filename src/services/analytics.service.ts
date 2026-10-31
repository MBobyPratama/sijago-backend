import { renderReportDocument } from "./reportDocument.js";
import { env } from "../config/env.js";
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
 * Merender fakta warga dan status pada saat dokumen dicetak.
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

  return renderReportDocument(rep, env.FRONTEND_URL);
}
