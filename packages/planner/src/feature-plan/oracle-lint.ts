import { FeaturePlanError } from "./errors.js";
import type { CheckKind, Diversity, HeldBackCase } from "./types.js";

export interface LintIssue {
  readonly code:
    | "tautology"
    | "zero_assertions"
    | "flaky_clock"
    | "flaky_sleep"
    | "flaky_timer"
    | "live_network"
    | "private_path"
    | "tailwind_selector"
    | "public_contract";
  readonly message: string;
}

const TAUTOLOGIES = [
  /expect\(\s*true\s*\)\s*\.toBe\(\s*true\s*\)/,
  /expect\(\s*false\s*\)\s*\.toBe\(\s*false\s*\)/,
  /expect\([^)\n]*\)\s*\.toBeDefined\(\s*\)/,
  /expect\([^)\n]*\)\s*\.toBeTruthy\(\s*\)/,
  /expect\([^)\n]*\)\s*\.toBeFalsy\(\s*\)/,
  /expect\([^)\n]*\)\s*\.toBeUndefined\(\s*\)/,
];

const PRIVATE_PATH = /(?:^|[\s"'`(])((?:src|app|packages)\/[A-Za-z0-9_./-]+\.(?:ts|tsx|js|jsx))/g;
const TAILWIND =
  /className\s*[:=]|tailwind|\b(?:bg|text|flex|grid|px|py|pt|pb|pl|pr|rounded|shadow|w|h)-[A-Za-z0-9[\]/-]+/;
const UI_HOOK = /getByRole\s*\(|getByLabelText\s*\(|getByTestId\s*\(|\brole\s*[:=]|aria-label|data-testid/;
const STATUS = /\b[1-5]\d{2}\b/;
const ROUTE = /\/[A-Za-z0-9_./{}:-]+/;

export function caseText(parts: {
  readonly assertion: string;
  readonly input: string;
  readonly expected: string;
  readonly entryPoint: string;
}): string {
  return [parts.assertion, parts.input, parts.expected, parts.entryPoint].join("\n");
}

export function lintOracleCase(
  parts: {
    readonly assertion: string;
    readonly input: string;
    readonly expected: string;
    readonly entryPoint: string;
    readonly kind: CheckKind;
  },
  publicPaths: readonly string[] = [],
): LintIssue[] {
  const text = caseText(parts);
  const issues: LintIssue[] = [];
  if (TAUTOLOGIES.some((pattern) => pattern.test(text))) {
    issues.push({
      code: "tautology",
      message: "Demand concrete value assertions; reject tautologies such as expect(true).toBe(true) or toBeDefined()",
    });
  }
  const assertions = text.match(/\bexpect\s*\(|\bassert\s*\(/g)?.length ?? 0;
  if (assertions === 0) {
    issues.push({ code: "zero_assertions", message: "Demand at least one concrete assertion" });
  }
  if (/Date\.now\s*\(/.test(text)) {
    issues.push({
      code: "flaky_clock",
      message: "Demand deterministic clock or event awaits; reject Date.now()",
    });
  }
  if (/\bsleep\s*\(/.test(text)) {
    issues.push({
      code: "flaky_sleep",
      message: "Demand deterministic clock or event awaits; reject sleep()",
    });
  }
  if (/\bsetTimeout\s*\(|\bsetInterval\s*\(/.test(text)) {
    issues.push({
      code: "flaky_timer",
      message: "Demand deterministic clock or event awaits; reject setTimeout()",
    });
  }
  for (const url of text.match(/https?:\/\/[^\s"'`)]+/gi) ?? []) {
    if (!isLoopback(url)) {
      issues.push({
        code: "live_network",
        message: `Reject live external URL ${url}; use a loopback mock endpoint`,
      });
    }
  }
  for (const match of text.matchAll(PRIVATE_PATH)) {
    const found = match[1];
    if (!found) continue;
    const allowed = publicPaths.some((path) => path.replaceAll("\\", "/") === found);
    if (!allowed || found.includes("/internal/") || found.includes("/private/")) {
      issues.push({
        code: "private_path",
        message: `Assertion references private path ${found} instead of a public contract`,
      });
    }
  }
  if (TAILWIND.test(text)) {
    issues.push({
      code: "tailwind_selector",
      message: "Target a semantic role, label, or test-contract hook instead of a Tailwind class",
    });
  }
  issues.push(...addressingIssues(parts.kind, text));
  return issues;
}

export function lintHeldBack(check: HeldBackCase, publicPaths: readonly string[] = []): LintIssue[] {
  return lintOracleCase(
    {
      assertion: check.assertion,
      input: check.input,
      expected: check.expected,
      entryPoint: check.entryPoint,
      kind: check.kind,
    },
    publicPaths,
  );
}

function addressingIssues(kind: CheckKind, text: string): LintIssue[] {
  if (kind === "ui" && !UI_HOOK.test(text)) {
    return [
      {
        code: "public_contract",
        message: "UI checks must target an accessible role, label, or data-testid hook",
      },
    ];
  }
  if (kind === "api" && (!ROUTE.test(text) || !STATUS.test(text))) {
    return [
      {
        code: "public_contract",
        message: "API checks must target a canonical route and an HTTP status code",
      },
    ];
  }
  if (kind === "unit" && text.trim().length === 0) {
    return [{ code: "public_contract", message: "Unit checks must target the public entry point" }];
  }
  return [];
}

export function isLoopback(raw: string): boolean {
  let host = "";
  try {
    host = new URL(raw).hostname.toLowerCase();
  } catch {
    return false;
  }
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
}

export function repairReasons(issues: readonly LintIssue[]): string[] {
  const reasons: string[] = [];
  if (issues.some((issue) => issue.code === "tautology" || issue.code === "zero_assertions")) {
    reasons.push("Demand concrete value assertions and deterministic clock or event awaits");
  }
  if (issues.some((issue) => issue.code === "flaky_clock" || issue.code === "flaky_sleep" || issue.code === "flaky_timer")) {
    reasons.push("Demand deterministic clock or event awaits");
  }
  if (issues.some((issue) => issue.code === "live_network")) {
    reasons.push("Use local loopback test env or mocks; reject live external URLs");
  }
  if (issues.some((issue) => issue.code === "public_contract" || issue.code === "tailwind_selector" || issue.code === "private_path")) {
    reasons.push("Target semantic accessible roles or canonical routes and JSON schemas");
  }
  if (reasons.length === 0) {
    reasons.push("Demand concrete value assertions and deterministic clock or event awaits");
  }
  return reasons;
}

export function assertLintClean(issues: readonly LintIssue[], checkId: string): void {
  if (issues.length === 0) return;
  throw new FeaturePlanError("oracle_lint", `Hidden check ${checkId} failed oracle lint`, {
    checkId,
    issues: issues.map((issue) => ({ code: issue.code, message: issue.message })),
  });
}

export function diversityGap(present: ReadonlySet<Diversity>): string[] {
  const missing: string[] = [];
  if (!present.has("happy")) missing.push("happy");
  if (!present.has("boundary")) missing.push("boundary");
  if (!present.has("negative") && !present.has("adversarial")) missing.push("negative");
  return missing;
}
