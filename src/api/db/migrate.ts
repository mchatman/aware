/**
 * Drizzle migration runner for the Aware API.
 * Run with: `npx tsx src/api/db/migrate.ts`
 * @module
 */

import { migrate } from "drizzle-orm/node-postgres/migrator";
import { getDb, closePool } from "./connection.js";

async function runMigrations() {
  const db = getDb();
  console.log("Running migrations…");
  await migrate(db, { migrationsFolder: "./src/api/db/migrations" });
  console.log("Migrations complete.");
  await closePool();
}

runMigrations().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
