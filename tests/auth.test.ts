import assert from "node:assert/strict";
import express from "express";
import cookieParser from "cookie-parser";
import { createAuthService, hashSessionToken, type AuthRepository, type LoginRecord, type SessionRecord } from "../src/services/auth.service.js";
import { authorizeRoles, createAuthRouter, agencyScope } from "../src/auth.js";
import { authContext } from "../src/auth-context.js";

// Entirely in memory: never creates accounts, sessions, or reports in Neon.
const user: LoginRecord = { id: "test-admin", email: "admin@example.test", fullName: "Test Admin", role: "ADMIN", passwordHash: "test-hash", isActive: true, mfaEnabled: false, agencyId: null, agencyCode: null, agencyName: null, agencyActive: null };
const sessions = new Map<string, SessionRecord>();
const repository: AuthRepository = {
  async findUser(email) { return email === user.email ? user : null; },
  async verifyPassword(password, hash) { return password === "test-password" && hash === user.passwordHash; },
  async createSession(_id, tokenHash, credentialFingerprint, expiresAt) { sessions.set(tokenHash, { tokenHash, credentialFingerprint, expiresAt, revokedAt: null, user }); },
  async findSession(hash) { return sessions.get(hash) ?? null; },
  async revokeSession(hash) { const session = sessions.get(hash); if (session) session.revokedAt = new Date(); },
};
const service = createAuthService(repository);
for (const [email, password] of [[user.email, "wrong"], ["unknown@example.test", "test-password"]]) await assert.rejects(service.login(email, password), { status: 401, code: "INVALID_CREDENTIALS" });
for (const field of ["isActive", "mfaEnabled"] as const) {
  user[field] = field === "mfaEnabled";
  await assert.rejects(service.login(user.email, "test-password"), { status: 401 });
  user[field] = field === "isActive";
}
const first = await service.login(" ADMIN@EXAMPLE.TEST ", "test-password");
assert.equal(first.homePath, "/admin/moderasi");
assert.equal("passwordHash" in first.user, false);
assert.equal(sessions.has(first.token), false);
assert.equal((await service.getUser(first.token))?.id, user.id);
const second = await service.login(user.email, "test-password", first.token);
assert.equal(await service.getUser(first.token), null);
user.passwordHash = "changed";
assert.equal(await service.getUser(second.token), null);
user.passwordHash = "test-hash";
const expired = await service.login(user.email, "test-password");
sessions.get(hashSessionToken(expired.token))!.expiresAt = new Date(0);
assert.equal(await service.getUser(expired.token), null);
user.role = "PETUGAS_INSTANSI";
await assert.rejects(service.login(user.email, "test-password"), { status: 401 });
Object.assign(user, { agencyId: "agency-a", agencyCode: "AGENCY_A", agencyName: "Agency A", agencyActive: true });
const agency = await service.login(user.email, "test-password");
assert.equal(agency.homePath, "/instansi/laporan");
user.agencyActive = false;
assert.equal(await service.getUser(agency.token), null);
user.agencyActive = true;

const app = express();
app.use(express.json(), cookieParser());
app.use("/auth", createAuthRouter(service));
app.get("/admin", authorizeRoles(service, "ADMIN"), (_req, res) => res.json({ actor: authContext.getStore()?.id }));
app.post("/agency", authorizeRoles(service, "PETUGAS_INSTANSI"), agencyScope, (req, res) => res.json(req.body));
const server = app.listen(0, "127.0.0.1");
await new Promise<void>(resolve => server.once("listening", resolve));
const address = server.address();
assert(address && typeof address !== "string");
const base = `http://127.0.0.1:${address.port}`;
try {
  const login = (origin: string) => fetch(`${base}/auth/login`, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ email: user.email, password: "test-password" }) });
  assert.equal((await login("https://untrusted.example")).status, 403);
  const response = await login("http://localhost:3001");
  assert.equal(response.status, 200);
  const cookieHeader = response.headers.get("set-cookie")!;
  assert.match(cookieHeader, /HttpOnly/i);
  assert.match(cookieHeader, /SameSite=Lax/i);
  const cookie = cookieHeader.split(";")[0];
  const headers = { Cookie: cookie, Origin: "http://localhost:3001", "Content-Type": "application/json" };
  assert.equal((await fetch(`${base}/auth/me`, { headers })).status, 200);
  assert.equal((await fetch(`${base}/admin`)).status, 401);
  assert.equal((await fetch(`${base}/admin`, { headers })).status, 403);
  assert.equal((await fetch(`${base}/agency`, { method: "POST", headers, body: JSON.stringify({ agencyCode: "OTHER" }) })).status, 403);
  const scoped = await fetch(`${base}/agency`, { method: "POST", headers, body: "{}" });
  assert.equal((await scoped.json()).agencyCode, user.agencyCode);
  user.role = "ADMIN";
  const adminResponse = await fetch(`${base}/admin`, { headers });
  assert.equal((await adminResponse.json()).actor, user.id);
  assert.equal((await fetch(`${base}/auth/logout`, { method: "POST", headers })).status, 200);
  assert.equal((await fetch(`${base}/auth/me`, { headers })).status, 401);
  console.log("PASS: credentials, account state, session rotation/expiry/revocation, roles, agency scope, CSRF origin, cookies and audit actor.");
} finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
