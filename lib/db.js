import { Pool } from "pg";
import { readFile } from "node:fs/promises";
import path from "node:path";

let pool;
let schemaPromise;

export function getPool() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not configured. Attach the NOVA PostgreSQL database in Render.");
  }
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 8,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      application_name: "nova-web",
    });
    pool.on("error", (error) => {
      console.error("Unexpected PostgreSQL pool error:", error.message);
    });
  }
  return pool;
}

export async function ensureDatabase() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      const sql = await readFile(path.join(process.cwd(), "database.sql"), "utf8");
      await getPool().query(sql);
    })().catch((error) => {
      schemaPromise = undefined;
      throw error;
    });
  }
  return schemaPromise;
}

export async function query(text, values = []) {
  await ensureDatabase();
  return getPool().query(text, values);
}
