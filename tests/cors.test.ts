import assert from "node:assert/strict";
import { buildCorsOptions } from "../src/config/cors.js";

for (const url of ["", "   ", "sijago.vercel.app", "ftp://example.com", "https://user:password@example.com"]) {
  assert.throws(() => buildCorsOptions({ NODE_ENV: "production", FRONTEND_URL: url }), /FRONTEND_URL harus berisi URL HTTP\/HTTPS/);
}
assert.throws(() => buildCorsOptions({ NODE_ENV: "production", FRONTEND_URL: "https://sijago.vercel.app", CORS_ALLOWED_ORIGINS: "invalid" }), /CORS_ALLOWED_ORIGINS/);
const options = buildCorsOptions({ NODE_ENV: "production", FRONTEND_URL: " https://sijago.vercel.app/ ", CORS_ALLOWED_ORIGINS: " ,https://sijago.example.com, " });
assert.equal(typeof options.origin, "function");
if (typeof options.origin === "function") {
  for (const [origin, expected] of [["https://sijago.vercel.app", true], ["https://sijago.example.com", true], ["https://untrusted.example.com", false], ["http://localhost:3000", false]] as const) {
    options.origin(origin, (error, allowed) => { assert.equal(error, null); assert.equal(allowed, expected); });
  }
}
console.log("PASS: clear URL configuration errors, whitespace handling and strict production origin allowlist.");
