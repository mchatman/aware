/**
 * Database connection pool for the Aware API.
 * Uses `pg` Pool and reads DATABASE_URL from environment.
 * @module
 */

import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema.js";

const { Pool } = pg;

let pool: pg.Pool | undefined;

/**
 * Returns (and lazily creates) the shared Postgres connection pool.
 * Reads `DATABASE_URL` from `process.env`.
 */
export function getPool(): pg.Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL environment variable is required");
    }
    pool = new Pool({ connectionString });
  }
  return pool;
}

/**
 * Returns a Drizzle ORM instance backed by the shared pool.
 */
export function getDb() {
  return drizzle(getPool(), { schema });
}

/**
 * Gracefully shuts down the connection pool.
 */
export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}
