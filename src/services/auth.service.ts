import { createHash, randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { users, agencies, authSessions } from "../db/schema.js";
import { env } from "../config/env.js";

export type AuthRole = "ADMIN" | "SUPER_ADMIN" | "AUDITOR" | "PETUGAS_INSTANSI";
export interface AuthUser {
  id: string; email: string; fullName: string; role: AuthRole;
  agencyId: string | null; agencyCode: string | null; agencyName: string | null;
}
export interface LoginRecord extends AuthUser { passwordHash: string; isActive: boolean; mfaEnabled: boolean; agencyActive: boolean | null }
export interface SessionRecord { tokenHash: string; credentialFingerprint: string; expiresAt: Date; revokedAt: Date | null; user: LoginRecord }
export interface AuthRepository {
  findUser(email: string): Promise<LoginRecord | null>;
  verifyPassword(password: string, hash: string): Promise<boolean>;
  createSession(userId: string, tokenHash: string, credentialFingerprint: string, expiresAt: Date): Promise<void>;
  findSession(tokenHash: string): Promise<SessionRecord | null>;
  revokeSession(tokenHash: string): Promise<void>;
}
export class AuthError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
export const hashSessionToken = (token: string) => createHash("sha256").update(token).digest("hex");
const userFields = { id: users.id, email: users.email, fullName: users.fullName, role: users.role, passwordHash: users.passwordHash, isActive: users.isActive, mfaEnabled: users.mfaEnabled, agencyId: users.agencyId, agencyCode: agencies.code, agencyName: agencies.name, agencyActive: agencies.isActive };
export const authRepository: AuthRepository = {
  async findUser(email) {
    const [record] = await db.select(userFields).from(users).leftJoin(agencies, eq(users.agencyId, agencies.id)).where(sql`lower(${users.email}) = ${email}`).limit(1);
    return record ?? null;
  },
  async verifyPassword(password, hash) {
    // pgcrypto bcrypt (bf) matches the Neon account-creation SQL. Never truncate long inputs.
    if (Buffer.byteLength(password, "utf8") > 72 || password.includes("\0")) return false;
    const validHash = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(hash);
    const salt = validHash ? hash : "$2a$12$......................";
    const result = await db.execute(sql`SELECT crypt(${password}, ${salt}) = ${hash} AS valid`);
    return validHash && result.rows[0]?.valid === true;
  },
  async createSession(userId, tokenHash, credentialFingerprint, expiresAt) { await db.insert(authSessions).values({ userId, tokenHash, credentialFingerprint, expiresAt }); },
  async findSession(tokenHash) {
    const [record] = await db.select({ tokenHash: authSessions.tokenHash, credentialFingerprint: authSessions.credentialFingerprint, expiresAt: authSessions.expiresAt, revokedAt: authSessions.revokedAt, user: userFields }).from(authSessions).innerJoin(users, eq(authSessions.userId, users.id)).leftJoin(agencies, eq(users.agencyId, agencies.id)).where(eq(authSessions.tokenHash, tokenHash)).limit(1);
    return record ?? null;
  },
  async revokeSession(tokenHash) { await db.update(authSessions).set({ revokedAt: new Date() }).where(eq(authSessions.tokenHash, tokenHash)); },
};
const usableUser = (user: LoginRecord) => user.isActive && !user.mfaEnabled && (user.role !== "PETUGAS_INSTANSI" || Boolean(user.agencyId && user.agencyCode && user.agencyActive));
const publicUser = (user: LoginRecord): AuthUser => ({ id: user.id, email: user.email, fullName: user.fullName, role: user.role, agencyId: user.agencyId, agencyCode: user.agencyCode, agencyName: user.agencyName });
export const homeForRole = (role: AuthRole) => role === "PETUGAS_INSTANSI" ? "/instansi/laporan" : role === "AUDITOR" ? "/admin/audit" : "/admin/moderasi";

export function createAuthService(repository: AuthRepository = authRepository) {
  return {
    async login(email: unknown, password: unknown, previousToken?: string) {
      if (typeof email !== "string" || typeof password !== "string" || !email.trim() || !password || email.length > 255 || password.length > 256) throw new AuthError(400, "INVALID_LOGIN", "Masukkan email dan kata sandi Anda.");
      const record = await repository.findUser(email.trim().toLowerCase());
      const matches = await repository.verifyPassword(password, record?.passwordHash ?? "");
      if (!record || !matches || !usableUser(record)) throw new AuthError(401, "INVALID_CREDENTIALS", "Email atau kata sandi tidak sesuai, atau akun belum aktif.");
      const token = randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + env.SESSION_TTL_HOURS * 3600000);
      await repository.createSession(record.id, hashSessionToken(token), hashSessionToken(record.passwordHash), expiresAt);
      if (previousToken && /^[a-f0-9]{64}$/.test(previousToken)) await repository.revokeSession(hashSessionToken(previousToken));
      return { token, expiresAt, user: publicUser(record), homePath: homeForRole(record.role) };
    },
    async getUser(token: unknown) {
      if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token)) return null;
      const session = await repository.findSession(hashSessionToken(token));
      if (!session || session.revokedAt || session.expiresAt.getTime() <= Date.now() || !usableUser(session.user) || session.credentialFingerprint !== hashSessionToken(session.user.passwordHash)) return null;
      return publicUser(session.user);
    },
    async logout(token: unknown) { if (typeof token === "string" && /^[a-f0-9]{64}$/.test(token)) await repository.revokeSession(hashSessionToken(token)); },
  };
}
export const authService = createAuthService();
