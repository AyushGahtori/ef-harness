export type TurnLogStream = "stdout" | "stderr" | "event";

export interface TurnLogEntry {
  readonly sessionId: string;
  readonly stream: TurnLogStream;
  readonly text: string;
}

/** In-memory stand-in for Task 029 `turn_log`. Entries are redacted before append. */
export class MemoryTurnLog {
  readonly entries: TurnLogEntry[] = [];

  append(entry: TurnLogEntry): void {
    this.entries.push(entry);
  }

  text(sessionId: string, stream?: TurnLogStream): string {
    return this.entries
      .filter((entry) => entry.sessionId === sessionId && (stream === undefined || entry.stream === stream))
      .map((entry) => entry.text)
      .join("\n");
  }
}
