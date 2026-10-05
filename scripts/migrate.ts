/**
 * Applies database migrations from ./drizzle. Run before starting a new version:
 *   DATABASE_URL=postgres://… pnpm db:migrate
 * Safe to run repeatedly; applied migrations are tracked by Drizzle.
 */
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

const sql = postgres(url, { max: 1, onnotice: () => {} });
try {
  await migrate(drizzle(sql), { migrationsFolder: "drizzle" });
  console.log("Migrations applied.");
} catch (e) {
  console.error("Migration failed:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  await sql.end();
}
