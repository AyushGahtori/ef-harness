import { GITHUB_RATE_STATE_SQL, openDatabase, type GlobalBrokerDb, type SqliteConnection } from "@ef-harness/db";

export interface GitHubRateSnapshot {
  readonly lastMutationAt: number;
  readonly minuteWindowStart: number;
  readonly hourWindowStart: number;
  readonly mutationsThisMinute: number;
  readonly mutationsThisHour: number;
  readonly pausedUntil: number;
}

export interface GitHubRateStateStore {
  load(accountKey: string): GitHubRateSnapshot | null;
  save(accountKey: string, snapshot: GitHubRateSnapshot): void;
}

export class SqliteGitHubRateStateStore implements GitHubRateStateStore {
  constructor(private readonly db: SqliteConnection) {}

  load(accountKey: string): GitHubRateSnapshot | null {
    const row = this.db.get(
      `SELECT last_mutation_at, minute_window_start, hour_window_start, mutations_this_minute, mutations_this_hour, paused_until
         FROM github_rate_state WHERE account_key = :account_key`,
      { account_key: accountKey },
    );
    if (row === undefined || row === null) return null;
    return {
      lastMutationAt: readInt(row, "last_mutation_at"),
      minuteWindowStart: readInt(row, "minute_window_start"),
      hourWindowStart: readInt(row, "hour_window_start"),
      mutationsThisMinute: readInt(row, "mutations_this_minute"),
      mutationsThisHour: readInt(row, "mutations_this_hour"),
      pausedUntil: readInt(row, "paused_until"),
    };
  }

  save(accountKey: string, snapshot: GitHubRateSnapshot): void {
    this.db.run(
      `INSERT INTO github_rate_state (
         account_key, last_mutation_at, minute_window_start, hour_window_start,
         mutations_this_minute, mutations_this_hour, paused_until
       ) VALUES (
         :account_key, :last_mutation_at, :minute_window_start, :hour_window_start,
         :mutations_this_minute, :mutations_this_hour, :paused_until
       )
       ON CONFLICT(account_key) DO UPDATE SET
         last_mutation_at = excluded.last_mutation_at,
         minute_window_start = excluded.minute_window_start,
         hour_window_start = excluded.hour_window_start,
         mutations_this_minute = excluded.mutations_this_minute,
         mutations_this_hour = excluded.mutations_this_hour,
         paused_until = excluded.paused_until`,
      {
        account_key: accountKey,
        last_mutation_at: snapshot.lastMutationAt,
        minute_window_start: snapshot.minuteWindowStart,
        hour_window_start: snapshot.hourWindowStart,
        mutations_this_minute: snapshot.mutationsThisMinute,
        mutations_this_hour: snapshot.mutationsThisHour,
        paused_until: snapshot.pausedUntil,
      },
    );
  }
}

export function openMemoryGitHubRateStore(): SqliteGitHubRateStateStore {
  const db = openDatabase({ location: ":memory:", role: "global" });
  db.exec(GITHUB_RATE_STATE_SQL);
  return new SqliteGitHubRateStateStore(db);
}

export function githubRateStoreForBroker(globalDb: GlobalBrokerDb): SqliteGitHubRateStateStore {
  return new SqliteGitHubRateStateStore(globalDb.writer);
}

function readInt(row: unknown, key: string): number {
  if (row === null || typeof row !== "object") throw new Error(`github_rate_state row is missing ${key}`);
  const value = Reflect.get(row, key);
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number" && Number.isFinite(value)) return value;
  throw new Error(`github_rate_state.${key} is not an integer`);
}
