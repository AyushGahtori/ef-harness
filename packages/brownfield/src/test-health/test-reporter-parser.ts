import { createHash } from "node:crypto";
import type { ParsedTestCase, TestOutcomeStatus } from "./types.js";

export interface ReporterParseResult {
  readonly format: "vitest" | "jest" | "playwright" | "junit" | "node-tap" | "go-json" | "cargo" | "empty";
  readonly cases: readonly ParsedTestCase[];
}

/**
 * Parse structured test reporter output from common ecosystems.
 */
export function parseTestReporterOutput(text: string): ReporterParseResult {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return { format: "empty", cases: [] };
  }
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return parseJsonLines(trimmed);
  }
  if (trimmed.startsWith("<")) {
    return { format: "junit", cases: parseJUnit(trimmed) };
  }
  if (/^TAP version\b/m.test(trimmed) || /^(not )?ok\b/m.test(trimmed)) {
    return { format: "node-tap", cases: parseTap(trimmed) };
  }
  return { format: "empty", cases: [] };
}

function parseJsonLines(text: string): ReporterParseResult {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length > 1 && lines.every((line) => line.trim().startsWith("{"))) {
    const goCases: ParsedTestCase[] = [];
    for (const line of lines) {
      try {
        const row = JSON.parse(line) as Record<string, unknown>;
        if (row.Action === "pass" || row.Action === "fail" || row.Action === "skip") {
          const testId = typeof row.Test === "string" ? row.Test : "go.test";
          goCases.push({
            testId,
            filePath: typeof row.Package === "string" ? row.Package : null,
            status: mapGoAction(String(row.Action)),
            errorMessage: typeof row.Output === "string" ? row.Output : null,
            durationMs: null,
          });
        }
      } catch {
        // skip malformed line
      }
    }
    if (goCases.length > 0) {
      return { format: "go-json", cases: goCases };
    }
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return { format: "empty", cases: [] };
  }
  if (!parsed || typeof parsed !== "object") {
    return { format: "empty", cases: [] };
  }
  const record = parsed as Record<string, unknown>;
  if (Array.isArray(record.testResults)) {
    const first = record.testResults[0] as Record<string, unknown> | undefined;
    const format = first && typeof first.name === "string" && record.numTotalTestSuites !== undefined ? "jest" : "vitest";
    return { format, cases: parseVitestJest(record.testResults) };
  }
  if (Array.isArray(record.suites)) {
    return { format: "playwright", cases: parsePlaywright(record.suites) };
  }
  return { format: "empty", cases: [] };
}

function parseVitestJest(testResults: readonly unknown[]): ParsedTestCase[] {
  const cases: ParsedTestCase[] = [];
  for (const file of testResults) {
    if (!file || typeof file !== "object") continue;
    const record = file as Record<string, unknown>;
    const filePath = typeof record.name === "string" ? record.name : null;
    const assertions = record.assertionResults;
    if (!Array.isArray(assertions)) continue;
    for (const assertion of assertions) {
      if (!assertion || typeof assertion !== "object") continue;
      const a = assertion as Record<string, unknown>;
      const title =
        typeof a.fullName === "string" ? a.fullName : typeof a.title === "string" ? a.title : "anonymous";
      const testId = stableTestId(filePath ?? null, title);
      const failureMessages = Array.isArray(a.failureMessages) ? a.failureMessages : [];
      const errorMessage =
        typeof a.failureMessage === "string"
          ? a.failureMessage
          : typeof failureMessages[0] === "string"
            ? failureMessages[0]
            : null;
      cases.push({
        testId,
        filePath,
        status: mapStatus(a.status),
        errorMessage,
        durationMs: typeof a.duration === "number" ? a.duration : null,
      });
    }
  }
  return cases;
}

function parsePlaywright(suites: readonly unknown[]): ParsedTestCase[] {
  const cases: ParsedTestCase[] = [];
  const walk = (suite: unknown): void => {
    if (!suite || typeof suite !== "object") return;
    const record = suite as Record<string, unknown>;
    if (Array.isArray(record.specs)) {
      for (const spec of record.specs) collectPlaywrightSpec(spec, cases);
    }
    if (Array.isArray(record.suites)) {
      for (const child of record.suites) walk(child);
    }
  };
  for (const suite of suites) walk(suite);
  return cases;
}

function collectPlaywrightSpec(spec: unknown, cases: ParsedTestCase[]): void {
  if (!spec || typeof spec !== "object") return;
  const record = spec as Record<string, unknown>;
  const title = typeof record.title === "string" ? record.title : "anonymous";
  const tests = Array.isArray(record.tests) ? record.tests : [];
  const first = tests[0];
  const testRecord = first && typeof first === "object" ? (first as Record<string, unknown>) : record;
  const filePath = typeof record.file === "string" ? record.file : null;
  cases.push({
    testId: stableTestId(filePath ?? null, title),
    filePath,
    status: mapStatus(testRecord.status ?? record.status),
    errorMessage: null,
    durationMs: typeof testRecord.duration === "number" ? testRecord.duration : null,
  });
}

function parseJUnit(xml: string): ParsedTestCase[] {
  const cases: ParsedTestCase[] = [];
  const pattern = /<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g;
  for (const match of xml.matchAll(pattern)) {
    const attrs = match[1] ?? "";
    const body = match[2] ?? "";
    const name = readAttr(attrs, "classname");
    const filePath = readAttr(attrs, "file") ?? name;
    const title = readAttr(attrs, "name") ?? "anonymous";
    const testId = stableTestId(filePath ?? null, title);
    let status: TestOutcomeStatus = "pass";
    if (/<\s*skipped\b/i.test(body)) status = "skip";
    else if (/<\s*failure\b/i.test(body) || /<\s*error\b/i.test(body)) status = "fail";
    const errorBody = (/<failure[^>]*>([\s\S]*?)<\/failure>/i.exec(body) ?? /<error[^>]*>([\s\S]*?)<\/error>/i.exec(body))?.[1];
    cases.push({
      testId,
      filePath: filePath ?? null,
      status,
      errorMessage: errorBody?.trim() ?? null,
      durationMs: null,
    });
  }
  return cases;
}

function parseTap(text: string): ParsedTestCase[] {
  const cases: ParsedTestCase[] = [];
  const pattern = /^(not )?ok\b(.*)$/gm;
  for (const match of text.matchAll(pattern)) {
    const full = match[0] ?? "";
    const title = full.replace(/^(not )?ok\s+\d*\s*-?\s*/, "").replace(/\s+#.*$/, "").trim();
    if (!title) continue;
    cases.push({
      testId: stableTestId(null, title),
      filePath: null,
      status: match[1] ? "fail" : "pass",
      errorMessage: null,
      durationMs: null,
    });
  }
  return cases;
}

function mapStatus(value: unknown): TestOutcomeStatus {
  if (typeof value !== "string") return "error";
  const normalized = value.toLowerCase();
  if (normalized === "pass" || normalized === "passed" || normalized === "expected") return "pass";
  if (normalized === "fail" || normalized === "failed" || normalized === "unexpected") return "fail";
  if (normalized === "skip" || normalized === "skipped" || normalized === "pending") return "skip";
  return "error";
}

function mapGoAction(action: string): TestOutcomeStatus {
  if (action === "pass") return "pass";
  if (action === "fail") return "fail";
  if (action === "skip") return "skip";
  return "error";
}

function readAttr(attrs: string, name: string): string | undefined {
  return new RegExp(`${name}="([^"]*)"`).exec(attrs)?.[1];
}

export function stableTestId(filePath: string | null, title: string): string {
  const raw = `${filePath ?? ""}::${title}`;
  return createHash("sha256").update(raw).digest("hex").slice(0, 16);
}

export function errorFingerprint(message: string | null): string | null {
  if (!message) return null;
  const normalized = message.replace(/\d+/g, "N").replace(/\s+/g, " ").trim().slice(0, 240);
  return createHash("sha256").update(normalized).digest("hex").slice(0, 16);
}