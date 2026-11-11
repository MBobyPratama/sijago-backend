import { desc, eq } from "drizzle-orm";
import { env } from "../config/env.js";
import { db } from "../db/index.js";
import {
  reports,
  systemConfig,
  weatherObservations,
} from "../db/schema.js";

export interface BogorDistrictWeatherConfig {
  code: string;
  districtName: string;
  centerLat: number;
  centerLng: number;
  corridorHint: string;
}

export const BOGOR_DISTRICTS_META: BogorDistrictWeatherConfig[] = [
  {
    code: "32.71.04",
    districtName: "Bogor Tengah",
    centerLat: -6.5971469,
    centerLng: 106.8060388,
    corridorHint: "Jl. Ir. H. Juanda & Jl. Kapten Muslihat",
  },
  {
    code: "32.71.06",
    districtName: "Tanah Sareal",
    centerLat: -6.5612,
    centerLng: 106.7815,
    corridorHint: "Jl. Sholeh Iskandar (Sholis) & Jl. KH Abdullah Bin Nuh",
  },
  {
    code: "32.71.05",
    districtName: "Bogor Utara",
    centerLat: -6.5689,
    centerLng: 106.8152,
    corridorHint: "Jl. Pajajaran Utara & Jl. KS Tubun",
  },
  {
    code: "32.71.01",
    districtName: "Bogor Selatan",
    centerLat: -6.6385,
    centerLng: 106.8031,
    corridorHint: "Jl. Raya Tajur & Jl. Pahlawan",
  },
  {
    code: "32.71.02",
    districtName: "Bogor Timur",
    centerLat: -6.6152,
    centerLng: 106.8265,
    corridorHint: "Jl. Raya Pajajaran Timur & Jl. Sukasari",
  },
  {
    code: "32.71.03",
    districtName: "Bogor Barat",
    centerLat: -6.5795,
    centerLng: 106.7592,
    corridorHint: "Jl. Raya Dramaga - Bubulak & Jl. Semeru",
  },
];

const PUBLIC_STATUSES = new Set(["TERVERIFIKASI", "DITERUSKAN", "DIPROSES", "SELESAI", "DIBUKA_KEMBALI", "DITUTUP"]);

export function buildRuleBasedRecommendation(params: {
  districtName: string; corridorHint: string; rainfallMm: number; verifiedReports: number; recurrentHotspots: number; threshold?: number;
}) {
  const isRedZone = params.rainfallMm >= (params.threshold ?? 50) && (params.verifiedReports >= 2 || params.recurrentHotspots >= 1);
  return { isRedZone, recommendation: isRedZone ? `Prioritaskan pemeriksaan drainase dan kondisi jalan pada lokasi laporan di ${params.districtName}. Tentukan tindakan berdasarkan survei lapangan.` : "Belum ada rekomendasi zona merah berdasarkan data yang tersedia." };
}

interface OpenMeteoDailyPayload {
  daily?: {
    precipitation_sum?: Array<number | null>;
    time?: string[];
  };
}

interface DistrictWeatherSnapshot {
  district: BogorDistrictWeatherConfig;
  rainfall: number;
  date: string;
  source: string;
  description: string;
  raw: unknown;
}

const WEATHER_HEADERS = {
  "User-Agent": env.APP_USER_AGENT,
  Accept: "application/json",
};

async function fetchOpenMeteoBatch(baseUrl: string): Promise<DistrictWeatherSnapshot[]> {
  const lats = BOGOR_DISTRICTS_META.map((d) => d.centerLat).join(",");
  const lngs = BOGOR_DISTRICTS_META.map((d) => d.centerLng).join(",");
  const cleanBase = baseUrl.replace(/\/$/, "");
  const url = `${cleanBase}/forecast?latitude=${lats}&longitude=${lngs}&daily=precipitation_sum&timezone=Asia%2FJakarta&forecast_days=1`;

  const response = await fetch(url, {
    headers: WEATHER_HEADERS,
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) {
    throw new Error(`Open-Meteo HTTP ${response.status}`);
  }

  const payload = (await response.json()) as OpenMeteoDailyPayload | OpenMeteoDailyPayload[];
  const items = Array.isArray(payload) ? payload : [payload];
  if (items.length !== BOGOR_DISTRICTS_META.length) {
    throw new Error("Jumlah wilayah pada respons batch Open-Meteo tidak sesuai.");
  }

  return BOGOR_DISTRICTS_META.map((district, idx) => {
    const raw = items[idx];
    const rainfall = raw?.daily?.precipitation_sum?.[0];
    const date = raw?.daily?.time?.[0];
    if (typeof rainfall !== "number" || !Number.isFinite(rainfall) || rainfall < 0 || !date) {
      throw new Error(`Respons curah hujan Open-Meteo tidak lengkap untuk ${district.districtName}.`);
    }
    return {
      district,
      rainfall: Number(rainfall.toFixed(2)),
      date,
      source: "OPEN_METEO_FORECAST",
      description: "Prakiraan jumlah curah hujan harian Open-Meteo",
      raw,
    };
  });
}

async function fetchMetNorwayFallback(): Promise<DistrictWeatherSnapshot[]> {
  const todayJakarta = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  const snapshots: DistrictWeatherSnapshot[] = [];
  for (const district of BOGOR_DISTRICTS_META) {
    const url = `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${district.centerLat}&lon=${district.centerLng}`;
    const response = await fetch(url, {
      headers: WEATHER_HEADERS,
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      throw new Error(`MET Norway HTTP ${response.status}`);
    }
    const raw = (await response.json()) as {
      properties?: {
        timeseries?: Array<{
          time?: string;
          data?: {
            next_1_hours?: { details?: { precipitation_amount?: number } };
            next_6_hours?: { details?: { precipitation_amount?: number } };
          };
        }>;
      };
    };
    const series = raw.properties?.timeseries?.slice(0, 24) ?? [];
    if (series.length === 0) {
      throw new Error(`Data prakiraan cuaca cadangan kosong untuk ${district.districtName}.`);
    }
    const totalRain = series.reduce((sum, entry) => {
      const next1h = entry.data?.next_1_hours?.details?.precipitation_amount;
      if (typeof next1h === "number" && Number.isFinite(next1h)) return sum + next1h;
      const next6h = entry.data?.next_6_hours?.details?.precipitation_amount;
      if (typeof next6h === "number" && Number.isFinite(next6h)) return sum + next6h / 6;
      return sum;
    }, 0);

    snapshots.push({
      district,
      rainfall: Number(Math.max(0, totalRain).toFixed(2)),
      date: todayJakarta,
      source: "OPEN_METEO_FORECAST",
      description: "Prakiraan akumulasi curah hujan harian (MET Global Forecast)",
      raw: { provider: "MET_NORWAY_FALLBACK", date: todayJakarta, sampleSize: series.length },
    });
  }
  return snapshots;
}

export async function syncBogorWeatherAndHotspots() {
  let snapshots: DistrictWeatherSnapshot[] | null = null;
  const openMeteoEndpoints = [
    env.OPEN_METEO_BASE_URL,
    "https://historical-forecast-api.open-meteo.com/v1",
  ];

  for (const endpoint of openMeteoEndpoints) {
    try {
      snapshots = await fetchOpenMeteoBatch(endpoint);
      break;
    } catch {
      // Lanjut ke endpoint cadangan berikutnya
    }
  }

  if (!snapshots) {
    try {
      snapshots = await fetchMetNorwayFallback();
    } catch {
      // Jika seluruh API eksternal sedang dibatasi (rate-limit IP cloud), cek apakah sudah ada observasi tersimpan
      const existing = await db
        .select()
        .from(weatherObservations)
        .orderBy(desc(weatherObservations.fetchedAt))
        .limit(BOGOR_DISTRICTS_META.length);
      if (existing.length > 0) {
        return {
          syncedAt: existing[0].fetchedAt.toISOString(),
          districts: existing.map((row) => ({
            district: row.districtName,
            rainfallMm: Number(row.rainfallMm),
          })),
        };
      }
      throw new Error("Data Open-Meteo belum dapat diambil. Tidak ada nilai simulasi yang disimpan.");
    }
  }

  await db.transaction(async (tx) => {
    for (const { district, rainfall, date, source, description, raw } of snapshots) {
      await tx.insert(weatherObservations).values({
        source,
        areaCode: district.code,
        districtName: district.districtName,
        observationDate: date,
        rainfallMm: String(rainfall),
        weatherDescription: description,
        hasEarlyWarning: false,
        earlyWarningText: null,
        isForecast: true,
        rawPayload: raw,
      });
    }
  });
  return {
    syncedAt: new Date().toISOString(),
    districts: snapshots.map((row) => ({
      district: row.district.districtName,
      rainfallMm: row.rainfall,
    })),
  };
}

export async function getWeatherRoadIntelligenceSummary() {
  const allReports = (await db.select().from(reports)).filter(row => PUBLIC_STATUSES.has(row.status));
  const [config] = await db.select().from(systemConfig).where(eq(systemConfig.key, "red_zone_rainfall_threshold_mm")).limit(1);
  const threshold = Number(config?.value) > 0 ? Number(config.value) : 50;
  // A read never creates weather snapshots. Only an explicit sync fetches provider data.
  const observations = await db.select().from(weatherObservations).orderBy(desc(weatherObservations.fetchedAt));
  const latest = new Map<string, typeof observations[number]>();
  for (const observation of observations) if (!latest.has(observation.districtName)) latest.set(observation.districtName, observation);
  const districtStats = BOGOR_DISTRICTS_META.flatMap(district => {
    const observation = latest.get(district.districtName);
    if (!observation) return [];
    const rainfallMm = Number(observation.rainfallMm);
    const districtReports = allReports.filter(row => row.districtName === district.districtName);
    const recurrentHotspots = districtReports.filter(row => row.isRecurrentHotspot || row.status === "DIBUKA_KEMBALI").length;
    return [{ district: district.districtName, centerLat: district.centerLat, centerLng: district.centerLng, rainfallMm, verifiedReports: districtReports.length, recurrentHotspots, ...buildRuleBasedRecommendation({ ...district, rainfallMm, verifiedReports: districtReports.length, recurrentHotspots, threshold }) }];
  });
  const zones = districtStats.filter(row => row.isRedZone);
  return {
    lastSyncedAt: observations[0]?.fetchedAt.toISOString() ?? null,
    rainThresholdMm: threshold,
    kpis: { totalVerifiedReports: allReports.length, avgRainfallMm: districtStats.length ? Number((districtStats.reduce((sum, row) => sum + row.rainfallMm, 0) / districtStats.length).toFixed(1)) : null, activeRedZonesCount: zones.length, activeRedZoneNames: zones.map(row => row.district), totalRecurrentHotspots: allReports.filter(row => row.isRecurrentHotspot || row.status === "DIBUKA_KEMBALI").length },
    earlyWarning: { active: zones.length > 0, affectedDistricts: zones.map(row => row.district), message: zones.length ? `Prakiraan hujan dan laporan yang tersedia menunjukkan perlunya pemeriksaan di ${zones.map(row => row.district).join(", ")}.` : observations.length ? "Belum ada zona merah berdasarkan data yang tersedia." : "Belum ada data cuaca. Jalankan sinkronisasi Open-Meteo." },
    districtStats,
  };
}
