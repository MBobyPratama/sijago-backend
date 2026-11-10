import { Router, type RequestHandler, type Response } from "express";
import { communityVerification, CommunityVerificationError, type createCommunityVerificationService } from "./services/communityVerification.service.js";
declare global { namespace Express { interface Request { communityIdentity?: { emailHash: string; deviceHash: string; reportId: string } } } }
const errorResponse = (res: Response, error: unknown) => res.status(error instanceof CommunityVerificationError ? error.status : 503).json({ success: false, error: { code: error instanceof CommunityVerificationError ? error.code : "OTP_UNAVAILABLE", detail: error instanceof CommunityVerificationError ? error.message : "Layanan verifikasi belum dapat dihubungi. Coba kembali nanti.", title: "Verifikasi email" } });

export function createCommunityOtpRouter(service: ReturnType<typeof createCommunityVerificationService> = communityVerification) {
  const router = Router();
  router.use((_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
  router.post("/request", async (req, res) => {
    try { res.json({ success: true, data: await service.request({ email: req.body?.email, reportId: req.body?.reportId, deviceId: req.get("x-device-id") }) }); }
    catch (error) { errorResponse(res, error); }
  });
  router.post("/verify", async (req, res) => {
    try { res.json({ success: true, data: await service.verify({ email: req.body?.email, code: req.body?.code, challengeId: req.body?.challengeId, reportId: req.body?.reportId, deviceId: req.get("x-device-id") }) }); }
    catch (error) { errorResponse(res, error); }
  });
  return router;
}
export function authorizeCommunity(service: ReturnType<typeof createCommunityVerificationService> = communityVerification): RequestHandler {
  return async (req, res, next) => {
    try {
      req.communityIdentity = await service.authorize({ token: req.body?.otpToken, email: req.body?.email, deviceId: req.get("x-device-id"), reportIdOrCode: String(req.params.id) });
      next();
    } catch (error) { errorResponse(res, error); }
  };
}
