import { createRequire } from "node:module";
import { openNodeSqliteDriver } from "./driver.ts";

const driver = openNodeSqliteDriver(":memory:");
driver.prepare("SELECT 1 AS ok").get();
driver.close();

const loaded = "moduleLoadList" in process && Array.isArray(process.moduleLoadList) ? process.moduleLoadList : [];
const native = loaded.filter(
  (entry) => entry.includes(".node") || entry.toLowerCase().includes("better-sqlite3"),
);

let betterSqliteResolved = true;
try {
  createRequire(import.meta.url).resolve("better-sqlite3");
} catch {
  betterSqliteResolved = false;
}

process.stdout.write(`${JSON.stringify({ native, betterSqliteResolved })}\n`);
