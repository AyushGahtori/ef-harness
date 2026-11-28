import { stripAnsi } from "./ansi.js";
import type { FailedLogFetcherDeps } from "./contracts.js";
import type { RedactedCiLog } from "./types.js";

const MAX_CONTEXT_LINES = 400;

function sliceAroundFirstError(rawLines: readonly string[]): { readonly lines: readonly string[]; readonly truncated: boolean } {
  const needles = [/error/i, /FAIL/i, /TS\d{4}/, /ERR!/];
  let anchor = 0;
  for (let i = 0; i < rawLines.length; i += 1) {
    const line = rawLines[i] ?? "";
    if (needles.some((pattern) => pattern.test(line))) {
      anchor = i;
      break;
    }
  }
  const half = Math.floor(MAX_CONTEXT_LINES / 2);
  const start = Math.max(0, anchor - half);
  const end = Math.min(rawLines.length, start + MAX_CONTEXT_LINES);
  return { lines: rawLines.slice(start, end), truncated: end - start < rawLines.length };
}

export class FailedCiLogFetcher {
  constructor(private readonly deps: FailedLogFetcherDeps) {}

  async fetchRedacted(runId: string): Promise<RedactedCiLog> {
    const raw = await this.deps.source.fetchFailedStepLogs(runId);
    const cleaned = stripAnsi(raw);
    const redacted = this.deps.redactor.redactSecrets(cleaned);
    const rawLines = redacted.split(/\r?\n/).filter((line) => line.length > 0);
    const sliced = sliceAroundFirstError(rawLines);
    return { lines: sliced.lines, truncated: sliced.truncated };
  }
}