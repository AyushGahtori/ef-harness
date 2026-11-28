import { errorMessage } from "./errors.js";
import type { SqlSession } from "./types.js";
import { LIVE_LOCK_TIMEOUT_MS, LIVE_LOCK_TIMEOUT_SQL } from "./types.js";

export const MAX_LOCK_RETRIES = 3;
export const LIVE_STATEMENT_TIMEOUT_SQL = "SET LOCAL statement_timeout = '30000ms'";

export interface LiveDdlReceipt {
  attempts: number;
  retries: number;
  lockTimeoutMs: typeof LIVE_LOCK_TIMEOUT_MS;
  statement: string;
}

export function isLockTimeoutError(error: unknown): boolean {
  return /lock timeout|canceling statement due to lock timeout|SQLITE_BUSY|database is locked/i.test(
    errorMessage(error),
  );
}

export function jitterDelayMs(retry: number, random: () => number): number {
  const unit = random();
  const spread = Math.floor(unit * 100);
  return 100 * retry + spread;
}

export async function executeLiveDdl(input: {
  session: SqlSession;
  statement: string;
  sleep: (ms: number) => Promise<void>;
  random?: () => number;
}): Promise<LiveDdlReceipt> {
  const random = input.random ?? Math.random;
  const concurrent = /\bINDEX\s+CONCURRENTLY\b/i.test(input.statement);
  let retries = 0;
  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_LOCK_RETRIES; attempt += 1) {
    try {
      if (input.session.dialect === "postgres") {
        executePostgres(input.session, input.statement, concurrent);
      } else {
        input.session.exec(`PRAGMA busy_timeout = ${LIVE_LOCK_TIMEOUT_MS}`);
        input.session.exec(input.statement);
      }
      return {
        attempts: attempt + 1,
        retries,
        lockTimeoutMs: LIVE_LOCK_TIMEOUT_MS,
        statement: input.statement,
      };
    } catch (error) {
      lastError = error;
      if (!isLockTimeoutError(error) || attempt === MAX_LOCK_RETRIES) throw error;
      retries += 1;
      await input.sleep(jitterDelayMs(retries, random));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(errorMessage(lastError));
}

function executePostgres(session: SqlSession, statement: string, concurrent: boolean): void {
  if (concurrent) {
    session.exec("SET lock_timeout = '3000ms'");
    session.exec(statement);
    return;
  }
  session.exec("BEGIN");
  try {
    session.exec(LIVE_LOCK_TIMEOUT_SQL);
    session.exec(LIVE_STATEMENT_TIMEOUT_SQL);
    session.exec(statement);
    session.exec("COMMIT");
  } catch (error) {
    rollback(session);
    throw error;
  }
}

function rollback(session: SqlSession): void {
  try {
    session.exec("ROLLBACK");
  } catch (error) {
    if (!/no transaction/i.test(errorMessage(error))) throw error;
  }
}
