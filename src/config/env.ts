import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(4000),
  API_PREFIX: z.string().default("/v1"),
  FRONTEND_URL: z.string().default("http://localhost:3000"),

  // Database (Neon PostgreSQL + PostGIS)
  DATABASE_URL: z.string().default("postgresql://postgres:postgres@localhost:5432/sijago"),
  DIRECT_DATABASE_URL: z.string().optional(),

  // Security & Hashing
  JWT_SECRET: z.string().min(16).default("sijago-dev-jwt-secret-key-mia2026-bogor"),
  JWT_EXPIRES_IN: z.string().default("7d"),
  PSEUDONYM_HASH_SALT: z.string().default("sijago-pseudonym-salt-mia2026"),

  // OpenAI (gpt-6-luna with reasoning medium)
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default("gpt-6-luna"),
  OPENAI_REASONING_EFFORT: z.enum(["low", "medium", "high"]).default("medium"),
  AI_TIMEOUT_MS: z.coerce.number().default(9000),
  AI_DRAFT_ENABLED: z
    .string()
    .default("true")
    .transform((v) => v === "true"),

  // Cloudinary
  CLOUDINARY_CLOUD_NAME: z.string().optional(),
  CLOUDINARY_API_KEY: z.string().optional(),
  CLOUDINARY_API_SECRET: z.string().optional(),
  CLOUDINARY_UPLOAD_FOLDER: z.string().default("sijago-mia2026"),

  // Resend
  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM_EMAIL: z.string().default("SIJAGO Kota Bogor <onboarding@resend.dev>"),
  RESEND_WEBHOOK_SECRET: z.string().optional(),
  SIMULATED_AGENCY_DEFAULT_EMAIL: z.string().default("simulasi.pupr@kotabogor.id"),

  // Turnstile Anti-Bot
  TURNSTILE_SECRET_KEY: z.string().default("1x0000000000000000000000000000000AA"),

  // Geocoding & Weather-Road Intelligence
  OSM_NOMINATIM_BASE_URL: z.string().default("https://nominatim.openstreetmap.org"),
  APP_USER_AGENT: z
    .string()
    .default("SIJAGO-MIA2026/1.0 (Sistem Jalan Bogor; contact@sijago.simulasi.id)"),
  WEATHER_PRIMARY_PROVIDER: z.string().default("OPEN_METEO_AND_BMKG"),
  OPEN_METEO_BASE_URL: z.string().default("https://api.open-meteo.com/v1"),
  BMKG_API_BASE_URL: z.string().default("https://api.bmkg.go.id/publik"),
  NASA_POWER_BASE_URL: z.string().default("https://power.larc.nasa.gov/api/temporal/daily/point"),
  OPENWEATHER_API_KEY: z.string().optional(),
  WEATHERAPI_KEY: z.string().optional(),
  VISUALCROSSING_API_KEY: z.string().optional(),
});

export const env = envSchema.parse(process.env);
