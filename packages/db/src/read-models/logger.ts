import type { DriftBugAlert } from "./types.js";

export interface ReadModelLogger {
  alert(entry: DriftBugAlert): void;
}

export function createReadModelLogger(
  sink: (line: string) => void = (line) => {
    process.stderr.write(`${line}\n`);
  },
): ReadModelLogger {
  return {
    alert(entry: DriftBugAlert): void {
      sink(JSON.stringify(entry));
    },
  };
}

export function createMemoryLogger(): ReadModelLogger & { readonly alerts: DriftBugAlert[] } {
  const alerts: DriftBugAlert[] = [];
  return {
    alerts,
    alert(entry: DriftBugAlert): void {
      alerts.push(entry);
    },
  };
}
