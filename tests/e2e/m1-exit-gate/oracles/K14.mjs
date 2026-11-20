import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
export function migratePostgres(db) {
  const sqlPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "postgres-orders-v2.sql");
  const sql = fs.readFileSync(sqlPath, "utf8").replaceAll("\r\n", "\n");
  if (!sql.includes("ADD COLUMN IF NOT EXISTS notes text")) {
    throw new Error("postgres migration must add nullable notes text");
  }
  const cols = db.prepare("PRAGMA table_info(orders)").all();
  if (!cols.some((col) => col.name === "notes")) db.exec("ALTER TABLE orders ADD COLUMN notes TEXT");
  return { dialect: "postgres", sql };
}
