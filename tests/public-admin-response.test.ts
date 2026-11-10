import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { toPublicReport, parsePublicAdminResponse } from "../src/utils/publicReport.js";

const internal = { id: "report", adminNotes: ["Internal only"], publicAdminResponse: "Sedang ditindaklanjuti." };
const citizen = toPublicReport(internal);
assert.equal("adminNotes" in citizen, false);
assert.equal(JSON.stringify(citizen).includes("Internal only"), false);
assert.equal(citizen.publicAdminResponse, internal.publicAdminResponse);
assert.equal(internal.adminNotes.length, 1);
assert.equal(parsePublicAdminResponse("  Tanggapan\nuntuk warga  "), "Tanggapan\nuntuk warga");
assert.equal(parsePublicAdminResponse("  "), null);
assert.throws(() => parsePublicAdminResponse({ adminNotes: "secret" }));
assert.throws(() => parsePublicAdminResponse("a".repeat(2001)));
// Protect both public report routes and prevent audit snapshots leaking via tracking.
const routes = readFileSync("src/index.ts", "utf8");
assert.ok(routes.includes("data: rows.map(toPublicReport)"));
assert.ok(routes.includes("data: toPublicReport(found)"));
const tracking = routes.slice(routes.indexOf('v1Router.get("/track/'), routes.indexOf('v1Router.get("/admin/reports"'));
assert.equal(tracking.includes("auditLogs"), false);
console.log("PASS internal notes omitted, public response preserved, blank removal/length validation, and public-route leakage checks.");
