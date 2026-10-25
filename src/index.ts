import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import { env } from "./config/env.js";
import { computeFactsHash } from "./utils/hash.js";
import { generateReportDraft } from "./services/aiDraft.service.js";

const app = express();

// 1. Middleware Keamanan & Parsing
app.use(helmet());
app.use(
  cors({
    origin: [env.FRONTEND_URL, "http://localhost:3000"],
    credentials: true,
  })
);
app.use(express.json({ limit: "2mb" }));
app.use(cookieParser());

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(env.API_PREFIX, apiLimiter);

// 2. Router /v1
const v1Router = express.Router();

/**
 * GET /v1/health
 * Endpoint ringan untuk health check & mencegah cold start di Render Free Tier.
 */
v1Router.get("/health", (_req, res) => {
  res.json({
    success: true,
    data: {
      service: "sijago-backend",
      version: "1.0.0-mia2026",
      status: "ok",
      aiModel: env.OPENAI_MODEL,
      aiReasoningEffort: env.OPENAI_REASONING_EFFORT,
      weatherProvider: env.WEATHER_PRIMARY_PROVIDER,
      timestamp: new Date().toISOString(),
    },
  });
});

/**
 * POST /v1/geo/validate-point
 * Validasi koordinat di dalam batas Kota Bogor & reverse geocoding Nominatim OSM (FR-1.4, FR-1.7).
 */
v1Router.post("/geo/validate-point", async (req, res) => {
  const { lat, lng } = req.body as { lat?: number; lng?: number };
  if (typeof lat !== "number" || typeof lng !== "number") {
    res.status(400).json({
      success: false,
      error: {
        title: "Koordinat Tidak Valid",
        status: 400,
        code: "INVALID_COORDINATES",
        detail: "Nilai lat dan lng wajib berupa angka.",
      },
    });
    return;
  }

  // Bounding box administratif Kota Bogor: Lat [-6.685 s/d -6.505], Lng [106.725 s/d 106.865]
  const isInsideBogorCity =
    lat >= -6.685 && lat <= -6.505 && lng >= 106.725 && lng <= 106.865;

  let suggestedStreetName = "Area Kota Bogor";
  try {
    const nominatimUrl = `${env.OSM_NOMINATIM_BASE_URL}/reverse?format=jsonv2&lat=${lat}&lon=${lng}`;
    const geoRes = await fetch(nominatimUrl, {
      headers: { "User-Agent": env.APP_USER_AGENT },
    });
    if (geoRes.ok) {
      const geoData = (await geoRes.json()) as { display_name?: string };
      if (geoData.display_name) {
        suggestedStreetName = geoData.display_name;
      }
    }
  } catch {
    // Tetap jalan meskipun Nominatim sedang lambat (graceful degradation)
  }

  res.json({
    success: true,
    data: {
      isInsideBogorCity,
      lat,
      lng,
      suggestedStreetName,
      nearbyActiveReports: [],
    },
  });
});

/**
 * POST /v1/drafts/preview
 * Endpoint untuk menguji langsung pembuatan draf AI (`gpt-6-luna`) / Fallback Template + `facts_hash`.
 */
v1Router.post("/drafts/preview", async (req, res) => {
  const facts = req.body;
  const factsHash = computeFactsHash({
    category: facts.category ?? "LUBANG",
    sizeClass: facts.sizeClass ?? "SEDANG",
    sizeLengthCm: facts.sizeLengthCm ?? null,
    sizeWidthCm: facts.sizeWidthCm ?? null,
    sizeDepthCm: facts.sizeDepthCm ?? null,
    landmark: facts.landmark ?? "Jl. Ir. H. Juanda, Kota Bogor",
    observedAt: facts.observedAt ?? new Date().toISOString(),
    impactTags: Array.isArray(facts.impactTags) ? facts.impactTags : ["MEMBAHAYAKAN_RODA_DUA"],
    freeText: facts.freeText ?? "",
    lat: facts.lat ?? -6.5971469,
    lng: facts.lng ?? 106.8060388,
    photoIds: Array.isArray(facts.photoIds) ? facts.photoIds : ["demo-photo-1"],
  });

  const draft = await generateReportDraft({
    category: facts.category ?? "LUBANG",
    sizeClass: facts.sizeClass ?? "SEDANG",
    sizeLengthCm: facts.sizeLengthCm ?? null,
    sizeWidthCm: facts.sizeWidthCm ?? null,
    sizeDepthCm: facts.sizeDepthCm ?? null,
    landmark: facts.landmark ?? "Jl. Ir. H. Juanda, Kota Bogor",
    observedAt: facts.observedAt ?? new Date().toISOString(),
    impactTags: Array.isArray(facts.impactTags) ? facts.impactTags : ["MEMBAHAYAKAN_RODA_DUA"],
    freeText: facts.freeText ?? "",
    lat: facts.lat ?? -6.5971469,
    lng: facts.lng ?? 106.8060388,
    photoIds: Array.isArray(facts.photoIds) ? facts.photoIds : ["demo-photo-1"],
  });

  res.json({
    success: true,
    data: {
      factsHash,
      ...draft,
    },
  });
});

app.use(env.API_PREFIX, v1Router);

// 3. Jalankan Server
app.listen(env.PORT, () => {
  console.log(
    `🚀 [SIJAGO BACKEND] Berjalan di http://localhost:${env.PORT}${env.API_PREFIX}/health`
  );
});
