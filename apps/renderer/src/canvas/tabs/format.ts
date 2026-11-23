import type { CrewLevel, MatrixFillStatus, OutlineNode, TierChip } from "./types.js";

export const STATUS_PRESENTATION: Readonly<
  Record<MatrixFillStatus, { readonly label: string; readonly symbol: string }>
> = {
  pass1: { label: "Pass 1 Decision", symbol: "●" },
  pass2: { label: "Pass 2 Elaboration/UP", symbol: "■" },
  pass3: { label: "Pass 3 Spec-Expander", symbol: "▲" },
  proposed: { label: "Proposed", symbol: "◆" },
  conflict: { label: "Conflict", symbol: "✕" },
  na: { label: "N/A", symbol: "—" },
};

export const PAPERWORK_COMPACT = "3/5/6/4/2%";

export const PAPERWORK_LINE = "Research 3% · Arch 5% · Plan/Oracles 6% · Integration/Review 4% · Audit 2%";

export const WAVE_LATER_NOTE = "Detailed tasks compiled after Wave 1 finishes";

export const PAPERWORK_SEGMENTS = [
  { label: "Research", percent: 3 },
  { label: "Arch", percent: 5 },
  { label: "Plan/Oracles", percent: 6 },
  { label: "Integration/Review", percent: 4 },
  { label: "Audit", percent: 2 },
] as const;

const LEVELS: readonly CrewLevel[] = ["Junior", "Mid", "Senior"];

const COST_NUMERATOR: Readonly<Record<CrewLevel, number>> = {
  Junior: 100,
  Mid: 180,
  Senior: 320,
};

export function stringField(fields: Readonly<Record<string, unknown>>, key: string): string | null {
  const value = fields[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function numberField(fields: Readonly<Record<string, unknown>>, key: string): number | null {
  const value = fields[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function boolField(fields: Readonly<Record<string, unknown>>, key: string): boolean {
  const value = fields[key];
  return value === true || value === 1;
}

export function stringList(fields: Readonly<Record<string, unknown>>, key: string): readonly string[] {
  const value = fields[key];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

export function normalizeLevel(value: string | null): CrewLevel {
  if (value === "Junior" || value === "Jr") return "Junior";
  if (value === "Senior" || value === "Sr") return "Senior";
  return "Mid";
}

export function tierChip(level: CrewLevel): TierChip {
  if (level === "Junior") return "Jr";
  if (level === "Senior") return "Sr";
  return "Mid";
}

export function raiseLevel(level: CrewLevel): CrewLevel {
  const index = LEVELS.indexOf(level);
  return LEVELS[Math.min(LEVELS.length - 1, index + 1)] ?? "Senior";
}

export function higherLevel(left: CrewLevel, right: CrewLevel): CrewLevel {
  return LEVELS.indexOf(left) >= LEVELS.indexOf(right) ? left : right;
}

export function priceLeaf(
  juniorCostMicroUsd: number,
  midMinutes: number,
  level: CrewLevel,
): { readonly costMicroUsd: number; readonly minutes: number } {
  const costMicroUsd = Math.round((juniorCostMicroUsd * COST_NUMERATOR[level]) / 100);
  const minutes =
    level === "Junior"
      ? Math.round((midMinutes * 3) / 2)
      : level === "Senior"
        ? Math.round((midMinutes * 7) / 10)
        : midMinutes;
  return { costMicroUsd, minutes };
}

export function formatUsd(microUsd: number): string {
  const negative = microUsd < 0;
  const cents = Math.round(Math.abs(microUsd) / 10_000);
  const dollars = Math.floor(cents / 100);
  const remainder = cents % 100;
  return `${negative ? "-" : ""}$${dollars}.${String(remainder).padStart(2, "0")}`;
}

export function formatRangeUsd(minMicro: number, maxMicro: number): string {
  return `~${formatUsd(minMicro)}–${formatUsd(maxMicro)}`;
}

export function formatElapsed(elapsedMs: number): string {
  if (elapsedMs < 1000) return `${elapsedMs} ms`;
  const totalSeconds = Math.floor(elapsedMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

export function formatWindow(units: number): string {
  if (units <= 0) return "";
  const ppm = units / 10_000;
  const whole = Math.floor(ppm);
  const fraction = Math.round((ppm - whole) * 10);
  return fraction === 0 ? `${whole}% window` : `${whole}.${fraction}% window`;
}

export function provenancePill(node: Pick<OutlineNode, "basis" | "fields">): string {
  const basis = node.basis;
  if (basis === "explicit") {
    const turn = numberField(node.fields, "turn");
    return turn === null ? "Explicit" : `Explicit · Turn ${turn}`;
  }
  if (basis === "derived") {
    const from = stringField(node.fields, "derived_from");
    return from === null ? "Derived" : `Derived ← ${from}`;
  }
  if (basis === "delegated") return "Delegated";
  if (basis === "proposed") return "Proposed";
  if (basis === "observed") return "Observed";
  if (basis === "defaulted") return "Defaulted";
  return "Unset";
}

export function parseFillStatus(value: string | null): MatrixFillStatus {
  if (
    value === "pass1" ||
    value === "pass2" ||
    value === "pass3" ||
    value === "proposed" ||
    value === "conflict" ||
    value === "na"
  ) {
    return value;
  }
  return "na";
}

export function conflictStripText(count: number): string {
  if (count === 1) return "1 contradiction blocks build start — Jump to Conflict";
  return `${count} contradictions block build start — Jump to Conflict`;
}

export function startBuildBlockReason(conflicts: number, mustAsk: number): string | null {
  if (conflicts === 1) return "Resolve 1 conflict first";
  if (conflicts > 1) return `Resolve ${conflicts} conflicts first`;
  if (mustAsk === 1) return "Resolve 1 must-ask first";
  if (mustAsk > 1) return `Resolve ${mustAsk} must-ask items first`;
  return null;
}

export function featureSlug(featureId: string, fields: Readonly<Record<string, unknown>>): string {
  const explicit = stringField(fields, "slug");
  if (explicit) return explicit;
  const prefixed = /^F-(.+)$/.exec(featureId);
  return (prefixed?.[1] ?? featureId).toLowerCase();
}

export function viewFilePath(repoRoot: string, slug: string, fields: Readonly<Record<string, unknown>>): string {
  const override = stringField(fields, "view_path");
  if (override) return override.replaceAll("\\", "/");
  const root = repoRoot.replaceAll("\\", "/").replace(/\/$/, "");
  return `${root}/.harness/views/features/${slug}.md`;
}

export function matrixTitle(matrixId: string): string {
  if (matrixId === "M01") return "Role × Action Permissions Matrix";
  if (matrixId === "M02") return "Entity × CRUD & Lifecycle Matrix";
  if (matrixId === "M03") return "Screen × UI State Matrix";
  if (matrixId === "M04") return "API Endpoint × Status & Error Matrix";
  if (matrixId === "M05") return "Form Field × Validation & Boundary Matrix";
  if (matrixId === "M06") return "State Machine × Transition Matrix";
  if (matrixId === "M07") return "External Integration × Failure Matrix";
  if (matrixId === "M08") return "Notification × Trigger, Channel & Opt-Out Matrix";
  if (matrixId === "M09") return "Concurrency & Race × Shared Resource Matrix";
  if (matrixId === "M10") return "Data Retention, Privacy & Export Matrix";
  if (matrixId === "M11") return "Viewport / Device / Accessibility Matrix";
  if (matrixId === "M12") return "Migration, Seed & Upgrade Matrix";
  return matrixId;
}

export function waveLabel(wave: number): string {
  if (wave <= 0) return "Phase 0";
  return `Wave ${wave}`;
}
