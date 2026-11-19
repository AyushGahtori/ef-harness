import fs from "node:fs";
import type { SqliteDriver } from "./driver.ts";
import { quoteSqlPath } from "./runtime.ts";

/** Copy a live database without replacing an existing backup file. */
export function vacuumInto(driver: SqliteDriver, destination: string): number {
  if (fs.existsSync(destination)) {
    throw new Error(`VACUUM INTO destination already exists: ${destination}`);
  }
  const partial = `${destination}.${process.pid}.partial`;
  fs.rmSync(partial, { force: true });
  const started = performance.now();
  try {
    driver.exec(`VACUUM INTO '${quoteSqlPath(partial)}'`);
    fs.renameSync(partial, destination);
  } catch (error) {
    fs.rmSync(partial, { force: true });
    throw error;
  }
  return Math.round(performance.now() - started);
}

export function partialBackupPath(destination: string): string {
  return `${destination}.${process.pid}.partial`;
}
