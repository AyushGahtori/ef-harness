import { capsForProfile, type ReadModelProfile } from "./model-profile.js";
import { oneLineSummary } from "./one-line-summary.js";
import { wrapData } from "./provenance.js";
import type { SecretRedactorPort } from "./secret-redactor.js";
import { createDefaultRedactor } from "./secret-redactor.js";
import { longestConsecutiveRun, splitLines, stripAnsi } from "./text-util.js";

export interface TestFailureSummary {
  readonly name: string;
  readonly assertion: string;
  readonly projectFrames: readonly string[];
  readonly frameworkFramesOmitted: number;
}

export interface ShrunkTestOutput {
  readonly recognized: boolean;
  readonly passed: number;
  readonly failed: number;
  readonly skipped: number;
  readonly failures: readonly TestFailureSummary[];
  readonly failuresOmitted: number;
  readonly artifactId: string;
  readonly oneLine: string;
  readonly text: string;
  readonly lineCount: number;
}

interface ParsedTest {
  readonly recognized: boolean;
  readonly passed: number;
  readonly failed: number;
  readonly skipped: number;
  readonly failures: readonly TestFailureSummary[];
}

type Runner = "vitest" | "jest" | "playwright" | "pytest" | "go" | "cargo" | "unknown";

export function shrinkTestOutput(
  rawInput: string,
  options: {
    readonly artifactId: string;
    readonly modelProfile: ReadModelProfile;
    readonly redactor?: SecretRedactorPort;
  },
): ShrunkTestOutput {
  const redactor = options.redactor ?? createDefaultRedactor();
  const raw = stripAnsi(rawInput);
  const parsed = parseTestOutput(raw);
  const cap = capsForProfile(options.modelProfile).testFailures;
  const repeated = longestConsecutiveRun(splitLines(raw), isFrameLine);
  const inner = parsed.recognized
    ? renderRecognized(parsed, cap, options.artifactId, raw, repeated)
    : renderUnrecognized(raw, options.artifactId);
  const failureLabel = parsed.failures[0]?.name;
  const oneLine = oneLineSummary({
    kind: "test",
    passed: parsed.passed,
    failed: parsed.failed,
    artifactId: options.artifactId,
    ...(failureLabel !== undefined && parsed.failed > 0 ? { failureLabel } : {}),
  });
  const text = wrapData({
    source: `test:${options.artifactId}`,
    trust: "untrusted",
    body: inner,
    redactor,
  });
  const shown = parsed.failures.slice(0, cap);
  return {
    recognized: parsed.recognized,
    passed: parsed.passed,
    failed: parsed.failed,
    skipped: parsed.skipped,
    failures: shown,
    failuresOmitted: Math.max(0, parsed.failures.length - shown.length),
    artifactId: options.artifactId,
    oneLine,
    text,
    lineCount: splitLines(text).length,
  };
}

function renderRecognized(
  parsed: ParsedTest,
  cap: number,
  artifactId: string,
  raw: string,
  repeated: { readonly text: string; readonly count: number } | null,
): string {
  const lines: string[] = [
    `test: ${parsed.passed} passed, ${parsed.failed} failed, ${parsed.skipped} skipped [${artifactId}]`,
  ];
  const shown = parsed.failures.slice(0, cap);
  for (const failure of shown) {
    lines.push(`FAIL ${failure.name}`);
    if (failure.assertion.length > 0) lines.push(`  ${failure.assertion}`);
    for (const frame of failure.projectFrames) lines.push(`  ${frame}`);
    if (failure.frameworkFramesOmitted > 0) {
      lines.push(`  ${failure.frameworkFramesOmitted} framework frames omitted`);
    }
  }
  const omittedFailures = parsed.failures.length - shown.length;
  if (omittedFailures > 0) {
    lines.push(`${omittedFailures} more failures omitted; use harness.read_log('${artifactId}')`);
  }
  if (repeated) lines.push(`${repeated.text} [repeated ${repeated.count} times]`);
  const omitted = Math.max(0, splitLines(raw).length - lines.length);
  if (omitted > 0) lines.push(`${omitted} lines omitted; use harness.read_log('${artifactId}')`);
  return lines.join("\n");
}

function renderUnrecognized(raw: string, artifactId: string): string {
  const collapsed = collapseRuns(splitLines(raw));
  if (collapsed.length === 0) {
    return [`unrecognized test output [${artifactId}]`, "(empty output)"].join("\n");
  }
  if (collapsed.length <= 100) {
    return [`unrecognized test output [${artifactId}]`, ...collapsed.map(formatRun)].join("\n");
  }
  const head = collapsed.slice(0, 40);
  const tail = collapsed.slice(-60);
  const shownRaw = [...head, ...tail].reduce((sum, run) => sum + run.count, 0);
  const omitted = Math.max(0, splitLines(raw).length - shownRaw);
  return [
    `unrecognized test output [${artifactId}]`,
    ...head.map(formatRun),
    `${omitted} lines omitted; use harness.read_log('${artifactId}')`,
    ...tail.map(formatRun),
  ].join("\n");
}

function parseTestOutput(raw: string): ParsedTest {
  const runner = detectRunner(raw);
  switch (runner) {
    case "cargo":
      return parseCargo(raw);
    case "go":
      return parseGo(raw);
    case "pytest":
      return parsePytest(raw);
    case "playwright":
      return parsePlaywright(raw);
    case "vitest":
      return parseVitest(raw);
    case "jest":
      return parseJest(raw);
    default:
      return { recognized: false, passed: 0, failed: 0, skipped: 0, failures: [] };
  }
}

function detectRunner(text: string): Runner {
  if (/^test result:/m.test(text) || /^test\s+\S+\s+\.\.\.\s+(?:ok|FAILED|ignored)\s*$/m.test(text)) {
    return "cargo";
  }
  if (/^--- (?:FAIL|PASS|SKIP):/m.test(text)) return "go";
  if (/^FAILED\s+\S+::/m.test(text) || /^={10,}.*\b(?:passed|failed|error)\b/m.test(text)) return "pytest";
  if (/^\s*\d+\)\s+\[[^\]]+\]\s+›/m.test(text)) return "playwright";
  if (/^\s*●\s+/m.test(text) || /^Tests:\s+/m.test(text)) return "jest";
  if (/^\s*FAIL\s+/m.test(text) || /^\s*Test Files\s+/m.test(text) || /^\s*Tests\s+\d+/m.test(text)) {
    return "vitest";
  }
  return "unknown";
}

function parseVitest(text: string): ParsedTest {
  const testsLine = splitLines(text).find((line) => /^\s*Tests\s+/.test(line)) ?? "";
  const counts = parseCountPhrase(testsLine);
  const failures = text
    .split(/^\s*FAIL\s+/m)
    .slice(1)
    .map((block) => {
      const blockLines = splitLines(block);
      const title = blockLines[0] ?? "failed";
      const name = title.split(">").at(-1)?.trim() || title.trim();
      return failureFromLines(name, blockLines.slice(1));
    });
  return { recognized: true, ...counts, failures };
}

function parsePlaywright(text: string): ParsedTest {
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  for (const line of splitLines(text)) {
    const fail = /^\s*(\d+)\s+failed\s*$/.exec(line);
    const pass = /^\s*(\d+)\s+passed\b/.exec(line);
    const skip = /^\s*(\d+)\s+(?:skipped|flaky)\s*$/.exec(line);
    if (fail?.[1] !== undefined) failed = Number(fail[1]);
    if (pass?.[1] !== undefined) passed = Number(pass[1]);
    if (skip?.[1] !== undefined) skipped = Number(skip[1]);
  }
  const failures = text
    .split(/^\s*\d+\)\s+/m)
    .slice(1)
    .map((block) => {
      const blockLines = splitLines(block);
      const title = blockLines[0] ?? "failed";
      const name = title.split("›").at(-1)?.trim() || title.trim();
      return failureFromLines(name, blockLines.slice(1));
    });
  return { recognized: true, passed, failed, skipped, failures };
}

function parseJest(text: string): ParsedTest {
  const testsLine = splitLines(text).find((line) => /^Tests:/.test(line.trim())) ?? "";
  const counts = parseCountPhrase(testsLine);
  const failures = text
    .split(/^\s*●\s+/m)
    .slice(1)
    .map((block) => {
      const blockLines = splitLines(block);
      const title = (blockLines[0] ?? "failed").trim();
      const name = title.split("›").at(-1)?.trim() || title;
      return failureFromLines(name, blockLines.slice(1));
    });
  return { recognized: true, ...counts, failures };
}

function parsePytest(text: string): ParsedTest {
  const summary =
    splitLines(text).find((line) => /={5,}/.test(line) && /\b(?:passed|failed|skipped|error)\b/.test(line)) ?? "";
  const counts = parseCountPhrase(summary);
  const failures: TestFailureSummary[] = [];
  for (const line of splitLines(text)) {
    const match = /^FAILED\s+(\S+::\S+)\s+-\s+(.+)$/.exec(line.trim());
    if (!match) continue;
    const fullName = match[1] ?? "failed";
    failures.push({
      name: fullName.split("::").at(-1) ?? fullName,
      assertion: (match[2] ?? "").trim(),
      projectFrames: [],
      frameworkFramesOmitted: 0,
    });
  }
  return { recognized: true, ...counts, failures };
}

function parseGo(text: string): ParsedTest {
  const lines = splitLines(text);
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  const failures: TestFailureSummary[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^--- (FAIL|PASS|SKIP):\s+(\S+)/.exec(lines[index] ?? "");
    if (!match) continue;
    const status = match[1];
    const name = match[2] ?? "test";
    if (status === "PASS") passed += 1;
    else if (status === "SKIP") skipped += 1;
    else {
      failed += 1;
      failures.push({
        name,
        assertion: (lines[index + 1] ?? "").trim(),
        projectFrames: [],
        frameworkFramesOmitted: 0,
      });
    }
  }
  return { recognized: true, passed, failed, skipped, failures };
}

function parseCargo(text: string): ParsedTest {
  const lines = splitLines(text);
  const summary = lines.find((line) => line.startsWith("test result:")) ?? "";
  const counts = parseCountPhrase(summary.replaceAll(";", ","));
  const failures: TestFailureSummary[] = [];
  for (const line of lines) {
    const match = /^test\s+(\S+)\s+\.\.\.\s+FAILED\s*$/.exec(line.trim());
    if (!match) continue;
    failures.push({
      name: match[1] ?? "failed",
      assertion: "",
      projectFrames: [],
      frameworkFramesOmitted: 0,
    });
  }
  const panic = lines.find((line) => /assertion|panicked at/.test(line));
  if (failures.length > 0 && panic && failures[0]?.assertion === "") {
    const first = failures[0];
    failures[0] = {
      name: first?.name ?? "failed",
      assertion: panic.trim(),
      projectFrames: first?.projectFrames ?? [],
      frameworkFramesOmitted: first?.frameworkFramesOmitted ?? 0,
    };
  }
  return { recognized: true, ...counts, failures };
}

function failureFromLines(name: string, lines: readonly string[]): TestFailureSummary {
  const assertion =
    lines.find((line) => /AssertionError|^\s*Error:|^\s*Expected:|panicked at|\bassert(?:ion)?\b/i.test(line)) ?? "";
  const frames = lines.filter((line) => isFrameLine(line));
  const collapsed = collapseFrames(frames);
  return {
    name,
    assertion: assertion.trim(),
    projectFrames: collapsed.project.slice(0, 4),
    frameworkFramesOmitted: collapsed.framework,
  };
}

function parseCountPhrase(segment: string): { passed: number; failed: number; skipped: number } {
  return {
    failed: numberGroup(/(\d+)\s+failed/, segment),
    passed: numberGroup(/(\d+)\s+passed/, segment),
    skipped: numberGroup(/(\d+)\s+(?:skipped|ignored)/, segment),
  };
}

function numberGroup(expression: RegExp, segment: string): number {
  const match = expression.exec(segment);
  return match?.[1] !== undefined ? Number(match[1]) : 0;
}

function collapseFrames(frameLines: readonly string[]): { project: string[]; framework: number } {
  const project: string[] = [];
  let framework = 0;
  let index = 0;
  while (index < frameLines.length) {
    const current = normalizeSpace(frameLines[index] ?? "");
    let next = index + 1;
    while (next < frameLines.length && normalizeSpace(frameLines[next] ?? "") === current) next += 1;
    const count = next - index;
    if (isFrameworkFrame(current)) framework += count;
    else project.push(count > 1 ? `${current} × ${count}` : current);
    index = next;
  }
  return { project, framework };
}

function isFrameLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith("❯") || /^at\s+/.test(trimmed) || trimmed.startsWith("-->");
}

function isFrameworkFrame(line: string): boolean {
  const normalized = line.replaceAll("\\", "/");
  return (
    normalized.includes("node_modules/") ||
    normalized.includes("node:internal") ||
    normalized.includes("(node:") ||
    normalized.includes("react-dom/") ||
    normalized.includes("react-test-renderer/") ||
    normalized.includes("jest-circus/") ||
    normalized.includes("/vitest/") ||
    normalized.includes("@vitest/") ||
    normalized.includes("playwright/lib/") ||
    normalized.includes("playwright/test/") ||
    normalized.includes("/pkg/mod/") ||
    normalized.includes("/cargo/registry/") ||
    normalized.includes(".cargo/registry/") ||
    normalized.includes("/go/pkg/mod/")
  );
}

function normalizeSpace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

interface CollapsedRun {
  readonly text: string;
  readonly count: number;
}

function collapseRuns(lines: readonly string[]): CollapsedRun[] {
  const runs: CollapsedRun[] = [];
  let index = 0;
  while (index < lines.length) {
    const current = lines[index] ?? "";
    let next = index + 1;
    while (next < lines.length && lines[next] === current) next += 1;
    runs.push({ text: current, count: next - index });
    index = next;
  }
  return runs;
}

function formatRun(run: CollapsedRun): string {
  if (run.count > 1) return `${run.text} [repeated ${run.count} times]`;
  return run.text;
}
