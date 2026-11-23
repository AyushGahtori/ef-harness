import { DuplicateFalsifiedHypothesisError } from "./errors.js";
import type { HypothesisGuardDecision, HypothesisLedgerEntry } from "./types.js";

type MutableLedgerEntry = HypothesisLedgerEntry & {
  result?: "confirmed" | "falsified";
};

function normalizeStatement(statement: string): string {
  return statement
    .toLowerCase()
    .replace(/[-_]+/g, " ")
    .replace(/[^a-z0-9/.\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function subsystemOf(entry: HypothesisLedgerEntry): string {
  if (entry.subsystem) {
    return entry.subsystem;
  }
  const match = /(?:^|\s)([\w./-]+\.(?:ts|tsx|js|jsx|css|sql))(?:\s|$)/i.exec(entry.statement);
  return match?.[1] ?? entry.statement.slice(0, 48);
}

export class HypothesisLoopGuard {
  private readonly ledger: MutableLedgerEntry[] = [];

  load(entries: readonly HypothesisLedgerEntry[]): void {
    this.ledger.length = 0;
    this.ledger.push(...entries.map((e) => ({ ...e })));
  }

  recordResult(hypothesisId: string, result: "confirmed" | "falsified"): void {
    const entry = this.ledger.find((h) => h.hypothesisId === hypothesisId);
    if (!entry) {
      throw new Error(`unknown hypothesis ${hypothesisId}`);
    }
    entry.result = result;
  }

  propose(entry: HypothesisLedgerEntry): HypothesisGuardDecision {
    const normalized = normalizeStatement(entry.statement);
    const duplicate = this.ledger.find(
      (h) =>
        h.result === "falsified" &&
        (h.hypothesisId === entry.hypothesisId ||
          normalizeStatement(h.statement) === normalized),
    );
    if (duplicate) {
      throw new DuplicateFalsifiedHypothesisError(duplicate.hypothesisId);
    }

    const recentFalsified = [...this.ledger]
      .reverse()
      .filter((h) => h.result === "falsified")
      .slice(0, 3);
    const proposedSubsystem = subsystemOf(entry);
    if (
      recentFalsified.length === 3 &&
      recentFalsified.every((h) => subsystemOf(h) === proposedSubsystem)
    ) {
      return {
        ok: false,
        reason: "tunnel_vision_trigger",
        pivotHint:
          "Broaden search to callers, DB/serialization boundary, middleware, or git bisect before more narrow guesses.",
      };
    }

    this.ledger.push({ ...entry });
    return { ok: true };
  }

  falsifiedCount(): number {
    return this.ledger.filter((h) => h.result === "falsified").length;
  }
}