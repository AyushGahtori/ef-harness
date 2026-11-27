import { isCrossCuttingRuleId } from "./constants.js";
import { fileExists, validLineRange } from "./repo-scan.js";
import type { FinalProjectAuditorSuccess, LocatedFinding } from "./schema.js";
import { makeFinding } from "./text.js";
import type { CanonicalCatalog, ConfirmedFinding, RepoFile } from "./types.js";

const COSMETIC = [
  /consider refactoring/i,
  /helper naming/i,
  /\bnit\b/i,
  /could be cleaner/i,
  /rename ['"]?\w+['"]? to/i,
  /subjective/i,
];

const CONCRETE = /\b(404|500|401|403|throw|crash|incorrect|data loss|race|duplicate|exception|fails|failed)\b/i;
const HIGH_EDGE = /\b(404|500|401|403|throw|crash|incorrect|data loss|race|duplicate|exception)\b/i;

export interface ParsedLocation {
  readonly filePath: string;
  readonly lineStart: number;
  readonly lineEnd: number;
}

export function parseLocation(location: string): ParsedLocation | null {
  const match = /^(.+):(\d+)(?::(\d+)|-(\d+))?$/.exec(location.trim());
  if (!match) return null;
  const filePath = match[1]?.replaceAll("\\", "/");
  const lineStart = Number(match[2]);
  const lineEnd = match[4] ? Number(match[4]) : lineStart;
  if (!filePath || !Number.isInteger(lineStart) || !Number.isInteger(lineEnd)) return null;
  return { filePath, lineStart, lineEnd };
}

function cosmetic(detail: string): boolean {
  if (CONCRETE.test(detail)) return false;
  return COSMETIC.some((pattern) => pattern.test(detail));
}

export interface GateResult {
  readonly confirmed: readonly ConfirmedFinding[];
  readonly discarded: number;
}

export function gateAuditorFindings(input: {
  readonly shardId: string;
  readonly output: FinalProjectAuditorSuccess;
  readonly files: readonly RepoFile[];
  readonly catalog: CanonicalCatalog;
  readonly fixCostUnits: bigint;
}): GateResult {
  const requirements = new Set(input.catalog.requirementIds);
  const rules = new Set(input.catalog.ruleIds.filter((id) => isCrossCuttingRuleId(id)));
  const checks = new Set(input.catalog.checkIds);
  const confirmed: ConfirmedFinding[] = [];
  let discarded = 0;

  const acceptLocated = (item: LocatedFinding, kind: ConfirmedFinding["kind"], code: string, severity: ConfirmedFinding["severity"]) => {
    const located = acceptReference(item.requirement, item.location, item.detail, input.files, requirements, rules);
    if (!located) {
      discarded += 1;
      return;
    }
    const advisory = cosmetic(item.detail);
    confirmed.push(
      makeFinding({
        code,
        shardId: input.shardId,
        kind,
        severity: advisory ? "low" : severity,
        advisory,
        filePath: located.filePath,
        lineStart: located.lineStart,
        lineEnd: located.lineEnd,
        requirementId: located.requirementId,
        ruleId: located.ruleId,
        detail: item.detail,
        fixCostUnits: input.fixCostUnits,
      }),
    );
  };

  for (const item of input.output.missing) acceptLocated(item, "missing", "llm-missing", "critical");
  for (const item of input.output.stubbed) acceptLocated(item, "stubbed", "llm-stubbed", "high");
  for (const item of input.output.unhandled_edge_cases) {
    const severity = HIGH_EDGE.test(item.detail) ? "high" : "medium";
    acceptLocated(item, "unhandled_edge_case", "llm-edge", severity);
  }
  for (const item of input.output.weak_checks) {
    if (checks.size > 0 && !checks.has(item.check)) {
      discarded += 1;
      continue;
    }
    const embedded = /([A-Za-z0-9_./-]+\.[A-Za-z0-9]+):\d+(?::\d+|-\d+)?/.exec(item.why);
    const located = embedded?.[0]
      ? acceptReference(item.requirement, embedded[0], item.why, input.files, requirements, rules)
      : null;
    if (!located?.filePath) {
      discarded += 1;
      continue;
    }
    const concrete = /does not observe|false pass|always passes|weaker than/i.test(item.why);
    const advisory = !concrete || cosmetic(item.why);
    confirmed.push(
      makeFinding({
        code: "llm-weak",
        shardId: input.shardId,
        kind: "weak_check",
        severity: advisory ? "low" : "medium",
        advisory,
        filePath: located.filePath,
        lineStart: located.lineStart,
        lineEnd: located.lineEnd,
        requirementId: located.requirementId,
        ruleId: located.ruleId,
        detail: `${item.check}: ${item.why}`,
        fixCostUnits: input.fixCostUnits,
      }),
    );
  }
  return { confirmed, discarded };
}

function acceptReference(
  requirement: string,
  location: string | null,
  detail: string,
  files: readonly RepoFile[],
  requirements: ReadonlySet<string>,
  rules: ReadonlySet<string>,
): { filePath: string | null; lineStart: number | null; lineEnd: number | null; requirementId: string | null; ruleId: string | null } | null {
  void detail;
  const requirementId = requirements.has(requirement) ? requirement : null;
  const ruleId = rules.has(requirement) ? requirement : null;
  if (!requirementId && !ruleId) return null;
  if (location === null) {
    return { filePath: null, lineStart: null, lineEnd: null, requirementId, ruleId };
  }
  const parsed = parseLocation(location);
  if (!parsed) return null;
  const file = fileExists(files, parsed.filePath);
  if (!file) return null;
  if (!validLineRange(file, parsed.lineStart, parsed.lineEnd)) return null;
  return {
    filePath: parsed.filePath,
    lineStart: parsed.lineStart,
    lineEnd: parsed.lineEnd,
    requirementId,
    ruleId,
  };
}
