import type { CorsOptions } from "cors";

export function buildCorsOptions(config: { NODE_ENV: string; FRONTEND_URL: string; CORS_ALLOWED_ORIGINS?: string }): CorsOptions {
  const allowedOrigins = new Set([
    new URL(config.FRONTEND_URL).origin,
    ...(config.CORS_ALLOWED_ORIGINS || "").split(",").map(origin => origin.trim()).filter(Boolean).map(origin => new URL(origin).origin),
    ...(config.NODE_ENV === "development" ? ["http://localhost:3000", "http://localhost:3001", "http://127.0.0.1:3000", "http://127.0.0.1:3001"] : []),
  ]);
  return {
    origin: (origin, callback) => callback(null, !origin || allowedOrigins.has(origin)),
    credentials: true,
  };
}
