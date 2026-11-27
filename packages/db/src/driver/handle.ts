import type { ReaderPool } from "./reader-pool.js";
import type { SqliteConnection } from "./types.js";

export interface DbHandle {
  readonly writer: SqliteConnection;
  readonly readers: ReaderPool;
  query(name: string): string;
}
