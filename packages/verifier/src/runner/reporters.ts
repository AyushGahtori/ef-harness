import type { CollectedStatus } from "./types.js";

export interface CollectedCase {
  readonly checkId: string;
  readonly reporterStatus: CollectedStatus | null;
  readonly hasObserved: boolean;
  readonly observed: unknown;
}

export interface CollectedCaseReport {
  readonly format: "ef-oracle" | "vitest" | "playwright" | "junit" | "tap" | "empty";
  readonly cases: readonly CollectedCase[];
}

/**
 * Parse structured reporter output. Status strings are advisory.
 * Pass/fail authority stays in the host comparison. Skip is fail-closed.
 * This parser does not accept attribution signals from candidate stdout.
 */
export function parseCollectedCaseIds(reporter: string): CollectedCaseReport {
  const trimmed = reporter.trim();
  if (trimmed.length === 0) {
    return { format: "empty", cases: [] };
  }
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return parseJsonReporter(trimmed);
  }
  if (trimmed.startsWith("<")) {
    return { format: "junit", cases: parseJUnit(trimmed) };
  }
  if (/^TAP version\b/m.test(trimmed) || /^(not )?ok\b/m.test(trimmed)) {
    return { format: "tap", cases: parseTap(trimmed) };
  }
  return { format: "empty", cases: [] };
}

function parseJsonReporter(text: string): CollectedCaseReport {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "invalid json";
    void reason;
    return { format: "empty", cases: [] };
  }
  if (!parsed || typeof parsed !== "object") {
    return { format: "empty", cases: [] };
  }
  const record = parsed as Record<string, unknown>;
  if (Array.isArray(record.cases) || record.format === "ef-oracle@1") {
    return { format: "ef-oracle", cases: parseOracleCases(record.cases) };
  }
  if (Array.isArray(record.testResults)) {
    return { format: "vitest", cases: parseVitest(record.testResults) };
  }
  if (Array.isArray(record.suites)) {
    return { format: "playwright", cases: parsePlaywrightSuites(record.suites) };
  }
  return { format: "empty", cases: [] };
}

function parseOracleCases(value: unknown): CollectedCase[] {
  if (!Array.isArray(value)) return [];
  const cases: CollectedCase[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const checkId = readExplicitId(record) ?? readTitleId(typeof record.title === "string" ? record.title : undefined);
    if (!checkId) continue;
    const hasObserved = Object.prototype.hasOwnProperty.call(record, "observed");
    cases.push({
      checkId,
      reporterStatus: mapStatus(record.status),
      hasObserved,
      observed: hasObserved ? record.observed : null,
    });
  }
  return cases;
}

function parseVitest(testResults: readonly unknown[]): CollectedCase[] {
  const cases: CollectedCase[] = [];
  for (const file of testResults) {
    if (!file || typeof file !== "object") continue;
    const assertions = (file as Record<string, unknown>).assertionResults;
    if (!Array.isArray(assertions)) continue;
    for (const assertion of assertions) {
      if (!assertion || typeof assertion !== "object") continue;
      const record = assertion as Record<string, unknown>;
      const title = typeof record.fullName === "string"
        ? record.fullName
        : typeof record.title === "string"
          ? record.title
          : undefined;
      const checkId = readExplicitId(record) ?? readTitleId(title);
      if (!checkId) continue;
      const hasObserved = Object.prototype.hasOwnProperty.call(record, "observed");
      cases.push({
        checkId,
        reporterStatus: mapStatus(record.status),
        hasObserved,
        observed: hasObserved ? record.observed : null,
      });
    }
  }
  return cases;
}

function parsePlaywrightSuites(suites: readonly unknown[]): CollectedCase[] {
  const cases: CollectedCase[] = [];
  for (const suite of suites) walkSuite(suite, cases);
  return cases;
}

function walkSuite(suite: unknown, cases: CollectedCase[]): void {
  if (!suite || typeof suite !== "object") return;
  const record = suite as Record<string, unknown>;
  if (Array.isArray(record.specs)) {
    for (const spec of record.specs) collectPlaywrightSpec(spec, cases);
  }
  if (Array.isArray(record.suites)) {
    for (const child of record.suites) walkSuite(child, cases);
  }
}

function collectPlaywrightSpec(spec: unknown, cases: CollectedCase[]): void {
  if (!spec || typeof spec !== "object") return;
  const record = spec as Record<string, unknown>;
  const title = typeof record.title === "string" ? record.title : undefined;
  const tests = Array.isArray(record.tests) ? record.tests : [];
  const first = tests[0];
  const testRecord = first && typeof first === "object" ? (first as Record<string, unknown>) : record;
  const checkId = readExplicitId(testRecord) ?? readAnnotationId(testRecord) ?? readExplicitId(record) ?? readTitleId(title);
  if (!checkId) return;
  const hasObserved = Object.prototype.hasOwnProperty.call(testRecord, "observed");
  cases.push({
    checkId,
    reporterStatus: mapStatus(testRecord.status ?? record.status),
    hasObserved,
    observed: hasObserved ? testRecord.observed : null,
  });
}

function parseJUnit(xml: string): CollectedCase[] {
  const cases: CollectedCase[] = [];
  const pattern = /<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g;
  for (const match of xml.matchAll(pattern)) {
    const attrs = match[1] ?? "";
    const body = match[2] ?? "";
    const name = readAttribute(attrs, "name");
    const propertyId = readProperty(body, "check_id");
    const checkId = propertyId ?? readTitleId(name) ?? readBareId(name);
    if (!checkId) continue;
    let reporterStatus: CollectedStatus = "pass";
    if (/<\s*skipped\b/i.test(body)) reporterStatus = "skip";
    else if (/<\s*error\b/i.test(body)) reporterStatus = "error";
    else if (/<\s*failure\b/i.test(body)) reporterStatus = "fail";
    cases.push({
      checkId,
      reporterStatus,
      hasObserved: false,
      observed: null,
    });
  }
  return cases;
}

function parseTap(text: string): CollectedCase[] {
  const cases: CollectedCase[] = [];
  const pattern = /^(not )?ok\b(.*)$/gm;
  for (const match of text.matchAll(pattern)) {
    const line = `${match[1] ?? ""}${match[2] ?? ""}`;
    const full = match[0] ?? "";
    const title = full.replace(/^(not )?ok\s+\d*\s*-?\s*/, "").replace(/\s+#.*$/, "");
    const checkId = readTitleId(title) ?? readBareId(title);
    if (!checkId) continue;
    let reporterStatus: CollectedStatus = match[1] ? "fail" : "pass";
    if (/#\s*skip\b/i.test(line)) reporterStatus = "skip";
    cases.push({
      checkId,
      reporterStatus,
      hasObserved: false,
      observed: null,
    });
  }
  return cases;
}

function mapStatus(value: unknown): CollectedStatus | null {
  if (typeof value !== "string") return null;
  const normalized = value.toLowerCase();
  if (normalized === "pass" || normalized === "passed" || normalized === "expected" || normalized === "success") {
    return "pass";
  }
  if (normalized === "fail" || normalized === "failed" || normalized === "unexpected" || normalized === "failure" || normalized === "flaky") {
    return "fail";
  }
  if (normalized === "skip" || normalized === "skipped" || normalized === "pending" || normalized === "disabled") {
    return "skip";
  }
  if (normalized === "error" || normalized === "timedout" || normalized === "timeout") {
    return "error";
  }
  return null;
}

function readExplicitId(record: Record<string, unknown>): string | null {
  const direct = record.checkId ?? record.check_id;
  if (typeof direct === "string" && direct.length > 0) return direct;
  const meta = record.meta;
  if (meta && typeof meta === "object") {
    const fromMeta = (meta as Record<string, unknown>).checkId ?? (meta as Record<string, unknown>).check_id;
    if (typeof fromMeta === "string" && fromMeta.length > 0) return fromMeta;
  }
  return readAnnotationId(record);
}

function readAnnotationId(record: Record<string, unknown>): string | null {
  const annotations = record.annotations;
  if (!Array.isArray(annotations)) return null;
  for (const annotation of annotations) {
    if (!annotation || typeof annotation !== "object") continue;
    const ann = annotation as Record<string, unknown>;
    if ((ann.type === "check_id" || ann.type === "checkId") && typeof ann.description === "string") {
      return ann.description;
    }
  }
  return null;
}

function readTitleId(title: string | undefined): string | null {
  if (!title) return null;
  const bracket = /\[([A-Za-z][A-Za-z0-9._:-]*)\]/.exec(title);
  if (bracket?.[1]) return bracket[1];
  const explicit = /\bcheck_id[:=]([A-Za-z0-9._:-]+)/.exec(title);
  if (explicit?.[1]) return explicit[1];
  return readBareId(title);
}

function readBareId(title: string | undefined): string | null {
  if (!title) return null;
  const rule = /\b(X-\d{2})\b/.exec(title);
  if (rule?.[1]) return rule[1];
  const ac = /\b(AC-\d+)\b/.exec(title);
  if (ac?.[1]) return ac[1];
  return null;
}

function readAttribute(attrs: string, name: string): string | undefined {
  const pattern = new RegExp(`${name}="([^"]*)"`);
  return pattern.exec(attrs)?.[1];
}

function readProperty(body: string, name: string): string | null {
  const pattern = new RegExp(`<property\\b[^>]*name="${name}"[^>]*value="([^"]*)"`, "i");
  const match = pattern.exec(body);
  return match?.[1] ?? null;
}
