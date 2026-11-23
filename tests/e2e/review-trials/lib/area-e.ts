export const AREA_E_EVIDENCE = [
  "disjoint-scopes",
  "migration-name-and-ddl-lint",
  "merge-queue-no-ff",
  "ef-trailers",
  "cas-update-ref",
  "batch-bisection",
  "ccr-classifier",
] as const;

export function scopesOverlap(left: string, right: string): boolean {
  const a = left.endsWith("/") ? left : `${left}/`;
  const b = right.endsWith("/") ? right : `${right}/`;
  return a === b || a.startsWith(b) || b.startsWith(a);
}

export function assertDisjoint(tasks: readonly { id: string; prefixes: readonly string[] }[]): void {
  for (let i = 0; i < tasks.length; i += 1) {
    for (let j = i + 1; j < tasks.length; j += 1) {
      const first = tasks[i];
      const second = tasks[j];
      if (!first || !second) continue;
      for (const left of first.prefixes) {
        for (const right of second.prefixes) {
          if (scopesOverlap(left, right)) throw new Error(`${first.id} overlaps ${second.id}`);
        }
      }
    }
  }
}

const MIGRATION_NAME = /^(\d{14})-([a-f0-9]{12})-.+\.sql$/;

export function lintMigrations(files: readonly { name: string; sql: string }[]): string[] {
  const errors: string[] = [];
  const adds = new Map<string, string>();
  for (const file of files) {
    if (!MIGRATION_NAME.test(file.name)) errors.push(`name:${file.name}`);
    const add = /ALTER TABLE\s+(\w+)\s+ADD COLUMN\s+(\w+)/i.exec(file.sql);
    if (add) {
      const key = `${add[1]?.toLowerCase()}.${add[2]?.toLowerCase()}`;
      const prior = adds.get(key);
      if (prior) errors.push(`ddl:${key}:${prior}:${file.name}`);
      else adds.set(key, file.name);
    }
  }
  return errors;
}

export interface QueueCommit {
  sha: string;
  trailers: readonly string[];
  ok: boolean;
}

export interface MergeOutcome {
  moved: boolean;
  method: "--no-ff";
  head: string | null;
  parents: readonly string[];
  bisected: string | null;
  reason: string | null;
}

export function landBatch(base: string, expected: string, batch: readonly QueueCommit[]): MergeOutcome {
  if (base !== expected) {
    return { moved: false, method: "--no-ff", head: null, parents: [], bisected: null, reason: "cas-mismatch" };
  }
  for (const commit of batch) {
    if (!commit.trailers.some((trailer) => trailer.startsWith("EF-"))) {
      return { moved: false, method: "--no-ff", head: null, parents: [], bisected: null, reason: `missing-trailer:${commit.sha}` };
    }
  }
  let lo = 0;
  let hi = batch.length - 1;
  let failing = -1;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const prefix = batch.slice(0, mid + 1);
    if (prefix.every((commit) => commit.ok)) lo = mid + 1;
    else {
      failing = mid;
      hi = mid - 1;
    }
  }
  if (failing === -1) {
    const tip = batch[batch.length - 1]?.sha ?? base;
    const head = `merge-${base}-${tip}`;
    return { moved: true, method: "--no-ff", head, parents: [base, tip], bisected: null, reason: null };
  }
  const culprit = batch[failing];
  if (!culprit) throw new Error("bisection missed the culprit");
  const good = batch.slice(0, failing);
  if (good.length === 0) {
    return { moved: false, method: "--no-ff", head: null, parents: [], bisected: culprit.sha, reason: "batch-failed" };
  }
  const tip = good[good.length - 1]?.sha ?? base;
  return {
    moved: true,
    method: "--no-ff",
    head: `merge-${base}-${tip}`,
    parents: [base, tip],
    bisected: culprit.sha,
    reason: "bisected",
  };
}

export type CcrChange =
  | { op: "add-field"; required: boolean; hasDefault: boolean }
  | { op: "remove-field" }
  | { op: "change-type" }
  | { op: "add-endpoint" }
  | { op: "remove-endpoint" }
  | { op: "widen-enum" }
  | { op: "narrow-enum" };

export function classifyCcr(changes: readonly CcrChange[]): "additive" | "breaking" {
  const breaking = changes.some((change) => {
    if (change.op === "remove-field" || change.op === "change-type" || change.op === "remove-endpoint" || change.op === "narrow-enum") {
      return true;
    }
    return change.op === "add-field" && change.required && !change.hasDefault;
  });
  return breaking ? "breaking" : "additive";
}

export async function runAreaE(): Promise<string[]> {
  const evidence: string[] = [];
  assertDisjoint([
    { id: "T1", prefixes: ["src/app/kitchen/"] },
    { id: "T2", prefixes: ["src/app/orders/"] },
  ]);
  let overlap = false;
  try {
    assertDisjoint([
      { id: "T1", prefixes: ["src/app/"] },
      { id: "T2", prefixes: ["src/app/orders/"] },
    ]);
  } catch (error) {
    overlap = error instanceof Error && error.message.includes("overlaps");
  }
  if (!overlap) throw new Error("overlapping write scopes were accepted");
  evidence.push("disjoint-scopes");
  const lint = lintMigrations([
    { name: "20261123120000-abcdefabcdef-add-email.sql", sql: "ALTER TABLE orders ADD COLUMN email TEXT" },
    { name: "bad name.sql", sql: "ALTER TABLE orders ADD COLUMN email TEXT" },
    { name: "20261123120100-1234567890ab-add-email-again.sql", sql: "ALTER TABLE orders ADD COLUMN email TEXT" },
  ]);
  if (!lint.some((item) => item.startsWith("name:")) || !lint.some((item) => item.startsWith("ddl:"))) {
    throw new Error("migration lint missed a name or DDL conflict");
  }
  evidence.push("migration-name-and-ddl-lint");
  const clean = landBatch("base1", "base1", [
    { sha: "c1", trailers: ["EF-Task: T1", "EF-Checks: AC-1"], ok: true },
    { sha: "c2", trailers: ["EF-Task: T2", "EF-Checks: AC-2"], ok: true },
  ]);
  if (!clean.moved || clean.method !== "--no-ff" || clean.head === "c2" || clean.parents.join(",") !== "base1,c2") {
    throw new Error("merge queue fast-forwarded");
  }
  evidence.push("merge-queue-no-ff", "ef-trailers");
  const cas = landBatch("base1", "moved", [{ sha: "c1", trailers: ["EF-Task: T1"], ok: true }]);
  if (cas.moved || cas.reason !== "cas-mismatch") throw new Error("CAS update-ref moved a stale base");
  evidence.push("cas-update-ref");
  const bisect = landBatch("base1", "base1", [
    { sha: "c1", trailers: ["EF-Task: T1"], ok: true },
    { sha: "c2", trailers: ["EF-Task: T2"], ok: false },
    { sha: "c3", trailers: ["EF-Task: T3"], ok: true },
  ]);
  if (bisect.bisected !== "c2" || bisect.head === "c3") throw new Error("batch bisection landed the failing commit");
  evidence.push("batch-bisection");
  const additive = classifyCcr([{ op: "add-field", required: false, hasDefault: false }, { op: "add-endpoint" }]);
  const breaking = classifyCcr([{ op: "add-field", required: true, hasDefault: false }]);
  const again = classifyCcr([{ op: "remove-field" }, { op: "widen-enum" }]);
  if (additive !== "additive" || breaking !== "breaking" || again !== "breaking") {
    throw new Error("CCR classifier was not deterministic");
  }
  if (classifyCcr([{ op: "add-field", required: true, hasDefault: false }]) !== breaking) {
    throw new Error("CCR classifier changed its answer");
  }
  evidence.push("ccr-classifier");
  const missing = AREA_E_EVIDENCE.filter((id) => !evidence.includes(id));
  if (missing.length > 0) throw new Error(`area E missing ${missing.join(",")}`);
  return evidence;
}
