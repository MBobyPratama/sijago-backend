import assert from "node:assert/strict";
import { db } from "../src/db/index.js";
import { addReportConditionTag } from "../src/services/moderation.service.js";
import { presentConditionTags } from "../src/utils/conditionTags.js";

const originalSelect = db.select, originalInsert = db.insert;
let inserted: any, calls = 0;
(db as any).select = () => {
  calls++;
  const query: any = { from: () => query, where: () => query, limit: async () => [{ id: "report-test" }], groupBy: async () => [{ tagCode: "MAKIN_DALAM", count: 2 }, { tagCode: "TERTUTUP_AIR", count: 1 }] };
  return query;
};
(db as any).insert = () => ({ values: (value: any) => { inserted = value; return { onConflictDoNothing: async () => {} }; } });
try {
  const result = await addReportConditionTag({ reportIdOrCode: "SJG-TEST", tagCode: "MAKIN_DALAM", deviceId: "browser-test", verifiedEmailHash: "verified-test" });
  assert.equal(calls, 2);
  assert.equal(inserted.reportId, "report-test");
  assert.equal(result.reportId, "report-test");
  assert.deepEqual(result.conditionTags, [{ code: "MAKIN_DALAM", label: "Makin dalam", count: 2 }, { code: "TERTUTUP_AIR", label: "Tertutup genangan air", count: 1 }]);
  assert.deepEqual(presentConditionTags([]), []);
  assert.equal(presentConditionTags([{ tagCode: "NEW_TAG", count: 1 }])[0].label, "new tag");
  console.log("PASS: tag mutation response includes aggregated conditionTags with consistent labels/counts; no database writes.");
} finally { db.select = originalSelect; db.insert = originalInsert; }
