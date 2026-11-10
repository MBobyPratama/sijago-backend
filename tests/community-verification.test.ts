import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import express from "express";
import { eq, sql } from "drizzle-orm";
import { db, pool } from "../src/db/index.js";
import { reporters, reports, systemConfig } from "../src/db/schema.js";
import { createCommunityVerificationService, communityTokenHash } from "../src/services/communityVerification.service.js";
import { authorizeCommunity, createCommunityOtpRouter } from "../src/community-verification.js";
import { addReportConditionTag, submitCommunitySignoff } from "../src/services/moderation.service.js";

// All fixtures are rolled back; the email sender is a stub. No actual messages are sent.
const rollback = new Error("ROLLBACK_COMMUNITY_TEST");
try {
  await assert.rejects(db.transaction(async tx => {
    const suffix = randomUUID().slice(0, 8);
    const [reporter] = await tx.insert(reporters).values({ pseudonymId: `otp-test-${suffix}`, deviceHash: "test" }).returning();
    const [report] = await tx.insert(reports).values({ ticketCode: `OTP-TEST-${suffix}`, trackingToken: randomUUID(), reporterId: reporter.id, location: { lat: -6.59, lng: 106.8 }, lat: "-6.59", lng: "106.8", currentFactsHash: "a".repeat(64) }).returning();
    let capturedCode = "";
    const sender = async (_email: string, code: string) => { capturedCode = code; return true; };
    let service = createCommunityVerificationService(tx, sender);
    const input = { email: `otp-${suffix}@example.test`, deviceId: "browser-device-test", reportId: report.id };
    const challenge = await service.request(input);
    assert.match(capturedCode, /^\d{6}$/);
    const stored = await tx.execute(sql`SELECT code_hash FROM community_otp_challenges WHERE id=${challenge.challengeId}::uuid`);
    assert.notEqual(stored.rows[0].code_hash, capturedCode);
    await assert.rejects(service.request(input), { status: 429 });
    await assert.rejects(service.verify({ ...input, challengeId: challenge.challengeId, code: "000000" }), { code: "OTP_INVALID" });
    const attempts = await tx.execute(sql`SELECT attempts FROM community_otp_challenges WHERE id=${challenge.challengeId}::uuid`);
    assert.equal(attempts.rows[0].attempts, 1);
    // A fresh service instance can verify an existing database challenge.
    service = createCommunityVerificationService(tx, sender);
    const result = await service.verify({ ...input, challengeId: challenge.challengeId, code: capturedCode });
    assert.match(result.otpToken, /^[a-f0-9]{64}$/);
    await assert.rejects(service.verify({ ...input, challengeId: challenge.challengeId, code: capturedCode }), { code: "OTP_INVALID" });
    const authorization = { email: input.email, deviceId: input.deviceId, reportIdOrCode: report.id, token: result.otpToken };
    const identity = await service.authorize(authorization);
    assert.equal(identity.reportId, report.id);
    for (const change of [{ email: "other@example.test" }, { deviceId: "other-browser-device" }, { reportIdOrCode: randomUUID() }]) await assert.rejects(service.authorize({ ...authorization, ...change }), { code: "OTP_SCOPE_MISMATCH" });
    await assert.rejects(service.authorize({ ...authorization, token: "verified_otp_session" }), { status: 401 });

    const tagInput = { reportIdOrCode: report.id, tagCode: "MAKIN_DALAM", deviceId: input.deviceId, verifiedEmailHash: identity.emailHash };
    assert.equal((await addReportConditionTag(tagInput, tx)).conditionTags[0].count, 1);
    assert.equal((await addReportConditionTag({ ...tagInput, deviceId: "new-browser-device" }, tx)).conditionTags[0].count, 1);
    await tx.update(reports).set({ status: "SELESAI", monitoringEndsAt: new Date(Date.now() + 86400000) }).where(eq(reports.id, report.id));
    for (const [key, value] of [["signoff_reopen_min_votes", 3], ["signoff_reopen_bad_ratio", 0.5]] as const) await tx.insert(systemConfig).values({ key, value, description: "Rollback-only test" }).onConflictDoUpdate({ target: systemConfig.key, set: { value } });
    const vote = { reportIdOrCode: report.id, rating: "CEPAT_RUSAK" as const, deviceId: input.deviceId, verifiedEmailHash: identity.emailHash, comment: "Komentar uji" };
    const firstVote = await submitCommunitySignoff(vote, tx);
    assert.equal(firstVote.cepatRusakCount, 1); assert.equal(firstVote.reopenedTriggered, false);
    assert.equal((await submitCommunitySignoff({ ...vote, comment: "Komentar diperbarui" }, tx)).cepatRusakCount, 1);
    assert.equal((await submitCommunitySignoff({ ...vote, verifiedEmailHash: "b".repeat(32) }, tx)).reopenedTriggered, false);
    assert.equal((await submitCommunitySignoff({ ...vote, verifiedEmailHash: "c".repeat(32) }, tx)).reopenedTriggered, true);
    await tx.update(reports).set({ monitoringEndsAt: new Date(0) }).where(eq(reports.id, report.id));
    await assert.rejects(submitCommunitySignoff(vote, tx), /masa pemantauan/);

    const app = express(); app.use(express.json()); app.use("/otp", createCommunityOtpRouter(service));
    let mutations = 0;
    for (const action of ["tags", "signoff"]) app.post(`/reports/:id/${action}`, authorizeCommunity(service), (_req, res) => { mutations++; res.json({ success: true }); });
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>(resolve => server.once("listening", resolve));
    const address = server.address(); assert(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}`;
    const headers = { "Content-Type": "application/json", "X-Device-Id": input.deviceId };
    try {
      for (const action of ["tags", "signoff"]) {
        const url = `${base}/reports/${report.id}/${action}`;
        assert.equal((await fetch(url, { method: "POST", headers, body: JSON.stringify({ email: input.email }) })).status, 401);
        assert.equal((await fetch(url, { method: "POST", headers, body: JSON.stringify({ email: input.email, otpToken: result.otpToken }) })).status, 200);
        assert.equal((await fetch(url, { method: "POST", headers: { ...headers, "X-Device-Id": "wrong-browser-device" }, body: JSON.stringify({ email: input.email, otpToken: result.otpToken }) })).status, 403);
      }
      assert.equal(mutations, 2);
      await tx.execute(sql`UPDATE community_verification_tokens SET expires_at=now()-interval '1 minute' WHERE token_hash=${communityTokenHash(result.otpToken)}`);
      await assert.rejects(service.authorize(authorization), { code: "OTP_EXPIRED" });
      assert.equal((await fetch(`${base}/reports/${report.id}/tags`, { method: "POST", headers, body: JSON.stringify({ email: input.email, otpToken: result.otpToken }) })).status, 401);
      assert.equal(mutations, 2);
    } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }

    const locked = await service.request({ ...input, email: `locked-${suffix}@example.test` });
    const lockedInput = { ...input, email: `locked-${suffix}@example.test`, challengeId: locked.challengeId };
    const correctCode = capturedCode;
    for (let attempt = 0; attempt < 5; attempt++) await assert.rejects(service.verify({ ...lockedInput, code: "000000" }), { code: "OTP_INVALID" });
    await assert.rejects(service.verify({ ...lockedInput, code: correctCode }), { code: "OTP_INVALID" });
    const expired = await service.request({ ...input, email: `expired-${suffix}@example.test` });
    await tx.execute(sql`UPDATE community_otp_challenges SET expires_at=now()-interval '1 minute' WHERE id=${expired.challengeId}::uuid`);
    await assert.rejects(service.verify({ ...input, email: `expired-${suffix}@example.test`, challengeId: expired.challengeId, code: capturedCode }), { code: "OTP_INVALID" });
    const failed = createCommunityVerificationService(tx, async () => false);
    await assert.rejects(failed.request({ ...input, email: `failed-${suffix}@example.test` }), { code: "OTP_SEND_FAILED" });
    const rateInput = { ...input, email: `rate-${suffix}@example.test` };
    let rateChallenge = await service.request(rateInput);
    for (let request = 1; request < 5; request++) {
      await tx.execute(sql`UPDATE community_otp_challenges SET requested_at=now()-interval '61 seconds' WHERE id=${rateChallenge.challengeId}::uuid`);
      rateChallenge = await service.request(rateInput);
    }
    await tx.execute(sql`UPDATE community_otp_challenges SET requested_at=now()-interval '61 seconds' WHERE id=${rateChallenge.challengeId}::uuid`);
    await assert.rejects(service.request(rateInput), { code: "OTP_RATE_LIMIT" });
    throw rollback;
  }), error => error === rollback);
  console.log("PASS: persistent hashed OTP, fresh-instance verification, cooldown, attempt limit, single use, expiry, email/device/report scopes, HTTP enforcement for tags/signoff, failed mail invalidation and full rollback. No emails sent.");
} finally { await pool.end(); }
