import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { BrokerLockHeldError } from "./errors.js";
import { isSqliteBusy, isSqliteCorruption } from "./sqlite-connection.js";

export interface BrokerLock {
  release(): void;
}

export function acquireBrokerLock(lockPath: string): BrokerLock {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  try {
    return openExclusive(lockPath);
  } catch (error) {
    if (!isSqliteCorruption(error)) throw error;
    try {
      fs.rmSync(lockPath, { force: true });
    } catch (removeError) {
      const code =
        typeof removeError === "object" && removeError !== null && "code" in removeError
          ? (removeError as { code: unknown }).code
          : undefined;
      if (code === "EPERM" || code === "EBUSY" || code === "EACCES") {
        throw new BrokerLockHeldError(lockPath);
      }
      throw removeError;
    }
    return openExclusive(lockPath);
  }
}

function openExclusive(lockPath: string): BrokerLock {
  const db = new DatabaseSync(lockPath, { timeout: 0 });
  let released = false;
  try {
    db.exec("PRAGMA busy_timeout = 0");
    db.exec("BEGIN EXCLUSIVE");
  } catch (error) {
    db.close();
    if (isSqliteBusy(error)) throw new BrokerLockHeldError(lockPath);
    throw error;
  }
  return {
    release() {
      if (released) return;
      released = true;
      try {
        if (db.isOpen && db.isTransaction) db.exec("ROLLBACK");
      } finally {
        if (db.isOpen) db.close();
      }
    },
  };
}
