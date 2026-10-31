import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { sql } from "drizzle-orm";
import { db, pool } from "../src/db/index.js";
import { authRepository } from "../src/services/auth.service.js";

// Optional integration check. Uses only SELECT and a rolled-back placeholder DO block.
try {
  const password = "Temporary-test-only-42";
  const result = await db.execute(sql`SELECT crypt(${password}, gen_salt('bf', 12)) AS hash`);
  const hash = String(result.rows[0].hash);
  assert.equal(await authRepository.verifyPassword(password, hash), true);
  assert.equal(await authRepository.verifyPassword("wrong", hash), false);
  assert.equal(await authRepository.verifyPassword(password, ""), false);
  assert.equal(await authRepository.verifyPassword("a".repeat(73), hash), false);
  const client = await pool.connect();
  try {
    const template = await readFile(new URL("../sql/create-portal-account.sql", import.meta.url), "utf8");
    const block = template.match(/DO \$create_account\$[\s\S]*?\$create_account\$;/)?.[0];
    assert(block);
    await client.query("BEGIN");
    await assert.rejects(client.query(block), /Ganti email/);
  } finally { await client.query("ROLLBACK"); client.release(); }
  console.log("PASS: Neon pgcrypto hash matches login verification; unchanged SQL placeholders are rejected; no accounts created.");
} finally { await pool.end(); }
