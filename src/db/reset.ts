import { sql } from "drizzle-orm";
import { db, pool } from "./index.js";
import { env } from "../config/env.js";

// Only this application's operational tables are reset. Master data and schema survive.
const tables = [
  "auth_sessions",
  "report_audit_logs", "agency_updates", "escalations", "admin_notes", "signoffs",
  "report_condition_tags", "report_upvotes", "report_approvals", "report_drafts",
  "report_photos", "report_fact_versions", "reports", "reporters", "users",
  "weather_observations", "hotspot_zones",
];

async function reset() {
  if (!process.argv.includes("--confirm-reset")) throw new Error("Use --confirm-reset to explicitly erase operational data.");
  if (env.NODE_ENV === "production") throw new Error("This reset command is disabled in production.");
  await db.transaction(async tx => {
    const target = await tx.execute(sql`select current_database() as database, current_schema() as schema`);
    if (target.rows[0]?.schema !== "public") throw new Error("Unexpected database schema.");
    console.log("Reset target:", target.rows[0]);
    // users is referenced by retained configuration; delete it after clearing that reference.
    await tx.execute(sql.raw(`TRUNCATE TABLE ${tables.filter(name => name !== "users").map(name => `"public"."${name}"`).join(", ")} RESTART IDENTITY`));
    await tx.execute(sql`UPDATE system_config SET updated_by = NULL`);
    await tx.execute(sql`DELETE FROM users`);
    // Remove only the old seed's simulated agency contacts, never replace real contacts.
    await tx.execute(sql.raw(`UPDATE agencies SET name = replace(name, ' (Simulasi)', ''), official_emails = '[]'::jsonb, is_active = false WHERE official_emails::text LIKE '%sijago.simulasi.id%'`));
    for (const name of tables) {
      const result = await tx.execute(sql.raw(`SELECT count(*)::int AS count FROM "public"."${name}"`));
      if (Number(result.rows[0]?.count) !== 0) throw new Error(`Table ${name} is not empty.`);
    }
    console.log(`Reset verified: ${tables.length} operational tables empty; master data and schema preserved.`);
  });
}

reset().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => pool.end());
