import { Router, type Request, type Response, type RequestHandler } from "express";
import rateLimit from "express-rate-limit";
import { env } from "./config/env.js";
import { buildCorsOptions } from "./config/cors.js";
import { authService, AuthError, type AuthUser, type AuthRole, type createAuthService } from "./services/auth.service.js";
import { findReportByIdOrCode } from "./services/moderation.service.js";
import { authContext } from "./auth-context.js";

declare global { namespace Express { interface Request { authUser?: AuthUser } } }
export { AuthError };
export const AUTH_COOKIE = "sijago_session";
const cookieOptions = { httpOnly: true, secure: env.NODE_ENV === "production", sameSite: "lax" as const, path: "/" };
export function authFailure(res: Response, error: unknown) {
  const status = error instanceof AuthError ? error.status : 503;
  res.status(status).json({ success: false, error: { code: error instanceof AuthError ? error.code : "AUTH_UNAVAILABLE", title: "Akses akun", detail: error instanceof AuthError ? error.message : "Layanan akun belum dapat dihubungi. Silakan coba lagi." } });
}
export const requireTrustedOrigin: RequestHandler = (req, res, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) { next(); return; }
  const origin = req.get("origin");
  if (!origin) { authFailure(res, new AuthError(403, "INVALID_ORIGIN", "Asal permintaan tidak diizinkan.")); return; }
  const check = buildCorsOptions(env).origin;
  if (typeof check !== "function") { res.sendStatus(403); return; }
  check(origin, (_error, allowed) => { if (allowed) next(); else authFailure(res, new AuthError(403, "INVALID_ORIGIN", "Asal permintaan tidak diizinkan.")); });
};
export function requireRoles(...roles: AuthRole[]): RequestHandler {
  return authorizeRoles(authService, ...roles);
}
export function authorizeRoles(service: ReturnType<typeof createAuthService>, ...roles: AuthRole[]): RequestHandler {
  return async (req, res, next) => {
    try {
      const user = await service.getUser(req.cookies?.[AUTH_COOKIE]);
      if (!user) throw new AuthError(401, "AUTH_REQUIRED", "Silakan masuk untuk melanjutkan.");
      if (!roles.includes(user.role)) throw new AuthError(403, "FORBIDDEN", "Akun Anda tidak memiliki akses ke halaman ini.");
      req.authUser = user;
      authContext.run(user, () => next());
    } catch (error) { authFailure(res, error); }
  };
}
export async function assertAgencyReportAccess(user: AuthUser, reportId: string) {
  if (user.role !== "PETUGAS_INSTANSI") return;
  const report = await findReportByIdOrCode(reportId);
  if (!report || report.assignedAgencyId !== user.agencyId) throw new AuthError(403, "AGENCY_SCOPE", "Laporan ini bukan kewenangan instansi akun Anda.");
}
export const agencyReportAccess: RequestHandler = async (req, res, next) => {
  try {
    if (!req.authUser) throw new AuthError(401, "AUTH_REQUIRED", "Silakan masuk.");
    await assertAgencyReportAccess(req.authUser, String(req.params.id));
    next();
  } catch (error) { authFailure(res, error); }
};
export const agencyScope: RequestHandler = (req, res, next) => {
  const user = req.authUser;
  if (user?.role === "PETUGAS_INSTANSI") {
    const requested = req.body?.agencyCode ?? req.query.agencyCode;
    if (requested && requested !== user.agencyCode) { authFailure(res, new AuthError(403, "AGENCY_SCOPE", "Instansi harus sesuai dengan akun yang masuk.")); return; }
    if (req.body) req.body.agencyCode = user.agencyCode;
  }
  next();
};

export function createAuthRouter(service: ReturnType<typeof createAuthService> = authService) {
  const router = Router();
  router.use((_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
  router.post("/login", requireTrustedOrigin, rateLimit({ windowMs: 15 * 60 * 1000, max: 15, skipSuccessfulRequests: true, message: { success: false, error: { code: "LOGIN_RATE_LIMIT", detail: "Terlalu banyak percobaan masuk. Coba kembali dalam 15 menit." } } }), async (req, res) => {
    try {
      const result = await service.login(req.body?.email, req.body?.password, req.cookies?.[AUTH_COOKIE]);
      res.cookie(AUTH_COOKIE, result.token, { ...cookieOptions, expires: result.expiresAt });
      res.json({ success: true, data: { user: result.user, homePath: result.homePath } });
    } catch (error) { authFailure(res, error); }
  });
  router.get("/me", async (req, res) => {
    try {
      const user = await service.getUser(req.cookies?.[AUTH_COOKIE]);
      if (!user) throw new AuthError(401, "AUTH_REQUIRED", "Silakan masuk untuk melanjutkan.");
      res.json({ success: true, data: { user } });
    } catch (error) { authFailure(res, error); }
  });
  router.post("/logout", requireTrustedOrigin, async (req, res) => {
    try {
      await service.logout(req.cookies?.[AUTH_COOKIE]);
      res.clearCookie(AUTH_COOKIE, cookieOptions);
      res.json({ success: true });
    } catch (error) { authFailure(res, error); }
  });
  return router;
}
