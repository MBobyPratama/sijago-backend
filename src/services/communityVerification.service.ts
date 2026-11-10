import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { hashWithSalt } from "../utils/hash.js";
import { sendCommunityOtpCode } from "./email.service.js";

export class CommunityVerificationError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
export const communityTokenHash = (token: string) => createHash("sha256").update(token).digest("hex");
const fail = () => new CommunityVerificationError(400, "OTP_INVALID", "Kode verifikasi salah, kedaluwarsa, sudah digunakan, atau tidak sesuai dengan permintaan ini.");
function emailHash(value: unknown) {
  if (typeof value !== "string" || value.trim().length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) throw new CommunityVerificationError(400, "INVALID_EMAIL", "Masukkan alamat email yang valid.");
  const email = value.trim().toLowerCase();
  return { email, hash: hashWithSalt(`community-email:${email}`) };
}
function deviceHash(value: unknown) {
  if (typeof value !== "string" || value.length < 8 || value.length > 200) throw new CommunityVerificationError(400, "DEVICE_REQUIRED", "Identitas browser tidak tersedia. Muat ulang halaman lalu coba kembali.");
  return hashWithSalt(`community-device:${value}`);
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Database = Pick<typeof db, "execute" | "transaction">;

export function createCommunityVerificationService(database: Database = db, sender = sendCommunityOtpCode) {
  return {
    async request(input: { email: unknown; deviceId: unknown; reportId: unknown }) {
      const address = emailHash(input.email), device = deviceHash(input.deviceId);
      if (typeof input.reportId !== "string" || !uuid.test(input.reportId)) throw new CommunityVerificationError(400, "REPORT_REQUIRED", "Buka laporan yang ingin Anda beri tag atau penilaian.");
      const exists = await database.execute(sql`SELECT id FROM reports WHERE id = ${input.reportId}::uuid`);
      if (!exists.rows.length) throw new CommunityVerificationError(404, "REPORT_NOT_FOUND", "Laporan tidak ditemukan.");
      const id = randomUUID(), code = String(randomInt(100000, 1000000));
      const digest = hashWithSalt(`community-code:${id}:${code}`);
      const reservation = await database.execute(sql`
        INSERT INTO community_otp_challenges(id,email_hash,report_id,device_hash,code_hash,requested_at,expires_at,window_started_at)
        VALUES(${id}::uuid,${address.hash},${input.reportId}::uuid,${device},${digest},now(),now()+interval '10 minutes',now())
        ON CONFLICT(email_hash) DO UPDATE SET id=EXCLUDED.id,report_id=EXCLUDED.report_id,device_hash=EXCLUDED.device_hash,code_hash=EXCLUDED.code_hash,
          requested_at=now(),expires_at=now()+interval '10 minutes',attempts=0,delivered_at=NULL,consumed_at=NULL,
          request_count=CASE WHEN community_otp_challenges.window_started_at <= now()-interval '15 minutes' THEN 1 ELSE community_otp_challenges.request_count+1 END,
          window_started_at=CASE WHEN community_otp_challenges.window_started_at <= now()-interval '15 minutes' THEN now() ELSE community_otp_challenges.window_started_at END
        WHERE community_otp_challenges.requested_at <= now()-interval '60 seconds'
          AND (community_otp_challenges.window_started_at <= now()-interval '15 minutes' OR community_otp_challenges.request_count < 5)
        RETURNING id`);
      if (!reservation.rows.length) throw new CommunityVerificationError(429, "OTP_RATE_LIMIT", "Tunggu 60 detik sebelum meminta kode lagi. Maksimal 5 pengiriman per email dalam 15 menit.");
      let sent = false;
      try { sent = await sender(address.email, code); } catch { /* Invalidate an undelivered challenge. */ }
      if (!sent) {
        await database.execute(sql`UPDATE community_otp_challenges SET consumed_at=now() WHERE id=${id}::uuid`);
        throw new CommunityVerificationError(503, "OTP_SEND_FAILED", "Kode verifikasi belum berhasil dikirim. Coba kembali setelah satu menit.");
      }
      await database.execute(sql`UPDATE community_otp_challenges SET delivered_at=now() WHERE id=${id}::uuid`);
      return { challengeId: id, sentViaResend: true, expiresInSeconds: 600 };
    },
    async verify(input: { email: unknown; deviceId: unknown; reportId: unknown; challengeId: unknown; code: unknown }) {
      const address = emailHash(input.email), device = deviceHash(input.deviceId);
      if (typeof input.challengeId !== "string" || !uuid.test(input.challengeId) || typeof input.reportId !== "string" || !uuid.test(input.reportId) || typeof input.code !== "string" || !/^\d{6}$/.test(input.code)) throw fail();
      const { challengeId, reportId, code } = input;
      const token = randomBytes(32).toString("hex");
      const result = await database.transaction(async tx => {
        const selected = await tx.execute(sql`SELECT * FROM community_otp_challenges WHERE id=${challengeId}::uuid FOR UPDATE`);
        const row = selected.rows[0];
        if (!row || row.email_hash !== address.hash || row.device_hash !== device || row.report_id !== reportId || !row.delivered_at || row.consumed_at || new Date(String(row.expires_at)).getTime() <= Date.now() || Number(row.attempts) >= 5) return null;
        const expected = hashWithSalt(`community-code:${challengeId}:${code}`);
        if (!timingSafeEqual(Buffer.from(String(row.code_hash)), Buffer.from(expected))) {
          await tx.execute(sql`UPDATE community_otp_challenges SET attempts=attempts+1 WHERE id=${challengeId}::uuid`);
          return null;
        }
        await tx.execute(sql`UPDATE community_otp_challenges SET consumed_at=now() WHERE id=${challengeId}::uuid`);
        await tx.execute(sql`UPDATE community_verification_tokens SET revoked_at=now() WHERE email_hash=${address.hash} AND report_id=${reportId}::uuid AND device_hash=${device} AND revoked_at IS NULL`);
        const grant = await tx.execute(sql`INSERT INTO community_verification_tokens(token_hash,email_hash,report_id,device_hash,expires_at) VALUES(${communityTokenHash(token)},${address.hash},${reportId}::uuid,${device},now()+interval '30 minutes') RETURNING expires_at`);
        return { verified: true, otpToken: token, expiresAt: grant.rows[0].expires_at };
      });
      // Wrong attempts commit before returning an error; never roll the attempt counter back.
      if (!result) throw fail();
      return result;
    },
    async authorize(input: { token: unknown; email: unknown; deviceId: unknown; reportIdOrCode: string }) {
      if (typeof input.token !== "string" || !/^[a-f0-9]{64}$/.test(input.token)) throw new CommunityVerificationError(401, "OTP_REQUIRED", "Verifikasi email terlebih dahulu untuk melanjutkan.");
      const address = emailHash(input.email), device = deviceHash(input.deviceId);
      const selected = await database.execute(sql`SELECT t.*,r.ticket_code FROM community_verification_tokens t JOIN reports r ON r.id=t.report_id WHERE t.token_hash=${communityTokenHash(input.token)}`);
      const row = selected.rows[0];
      if (!row || row.revoked_at || row.purpose !== "PUBLIC_COMMUNITY_ACTION") throw new CommunityVerificationError(401, "OTP_REQUIRED", "Verifikasi email kembali untuk melanjutkan.");
      if (new Date(String(row.expires_at)).getTime() <= Date.now()) throw new CommunityVerificationError(401, "OTP_EXPIRED", "Verifikasi email sudah kedaluwarsa. Minta kode baru untuk melanjutkan.");
      if (row.email_hash !== address.hash || row.device_hash !== device || (row.report_id !== input.reportIdOrCode && row.ticket_code !== input.reportIdOrCode.toUpperCase())) throw new CommunityVerificationError(403, "OTP_SCOPE_MISMATCH", "Verifikasi email ini tidak sesuai dengan perangkat atau laporan yang dibuka.");
      return { emailHash: String(row.email_hash), deviceHash: device, reportId: String(row.report_id) };
    },
  };
}
export const communityVerification = createCommunityVerificationService();
