import type { CorsOptions } from "cors";

function parseOrigin(value: string, variable: string): string {
  try {
    const url = new URL(value.trim());
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error();
    return url.origin;
  } catch {
    throw new Error(`${variable} harus berisi URL HTTP/HTTPS lengkap dan tidak boleh kosong. Contoh: https://nama-project.vercel.app`);
  }
}

export function buildCorsOptions(config: { NODE_ENV: string; FRONTEND_URL: string; CORS_ALLOWED_ORIGINS?: string }): CorsOptions {
  const allowedOrigins = new Set([
    parseOrigin(config.FRONTEND_URL, "FRONTEND_URL"),
    ...(config.CORS_ALLOWED_ORIGINS || "").split(",").map(origin => origin.trim()).filter(Boolean).map(origin => parseOrigin(origin, "CORS_ALLOWED_ORIGINS")),
    ...(config.NODE_ENV === "development" ? ["http://localhost:3000", "http://localhost:3001", "http://127.0.0.1:3000", "http://127.0.0.1:3001"] : []),
  ]);
  return {
    origin: (origin, callback) => callback(null, !origin || allowedOrigins.has(origin)),
    credentials: true,
  };
}
