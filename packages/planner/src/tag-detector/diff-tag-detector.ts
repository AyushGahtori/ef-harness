import {
  normalizeTouchTag,
  sortTouchTags,
  type TouchTag,
} from "./closed-tags.js";
import { RulesSeamsCatalogLoader } from "./catalog.js";
import { blankStringLiterals, isTestOrFixturePath, parseUnifiedDiff, stripComments } from "./diff-text.js";
import { matchingRuleIds, type CrossCuttingRule, type RuleId } from "./rules.js";

export interface DiffSignal {
  readonly path: string;
  readonly tag: TouchTag | null;
  readonly informal: string;
  readonly reason: string;
}

export interface ScopeCreepReport {
  readonly plannedTags: readonly string[];
  readonly normalizedPlannedTags: readonly TouchTag[];
  readonly unrecognizedPlannedTags: readonly string[];
  readonly unexpectedTags: readonly TouchTag[];
  readonly extraRuleIds: readonly RuleId[];
  readonly warning: string;
}

export interface DiffTagReport {
  readonly tags: readonly TouchTag[];
  readonly signals: readonly DiffSignal[];
  readonly scopeCreep: ScopeCreepReport | null;
}

export interface DiffDetectOptions {
  readonly plannedTags?: readonly string[];
  readonly rules?: readonly CrossCuttingRule[];
}

interface MutableSignal {
  path: string;
  tag: TouchTag | null;
  informal: string;
  reason: string;
}

function pathSegments(filePath: string): string[] {
  return filePath.replaceAll("\\", "/").toLowerCase().split("/");
}

function hasSegment(filePath: string, segment: string): boolean {
  return pathSegments(filePath).includes(segment);
}

function collectImports(source: string): string[] {
  const specs: string[] = [];
  for (const match of source.matchAll(/\bfrom\s+["']([^"']+)["']/g)) {
    if (match[1]) specs.push(match[1]);
  }
  for (const match of source.matchAll(/\bimport\s+["']([^"']+)["']/g)) {
    if (match[1]) specs.push(match[1]);
  }
  for (const match of source.matchAll(/\brequire\(\s*["']([^"']+)["']\s*\)/g)) {
    if (match[1]) specs.push(match[1]);
  }
  return specs;
}

function tagsForModule(spec: string): { tag: TouchTag; informal: string; reason: string }[] {
  const name = spec.toLowerCase();
  const found: { tag: TouchTag; informal: string; reason: string }[] = [];
  const add = (tag: TouchTag, informal: string) => {
    found.push({ tag, informal, reason: `import ${spec}` });
  };
  if (name === "stripe" || name.startsWith("@stripe/") || name.includes("paypal") || name.includes("braintree")) {
    add("money", "payments");
  }
  if (
    name.includes("next-auth") ||
    name.includes("@clerk/") ||
    name === "passport" ||
    name.startsWith("passport-") ||
    name.includes("lucia") ||
    name.includes("@auth/")
  ) {
    add("authn", "auth_guard");
    add("authz", "auth_guard");
    add("session", "auth_guard");
  }
  if (name === "multer" || name === "formidable" || name === "busboy" || name.includes("s3-request-presigner")) {
    add("file_upload", "file_upload");
  }
  if (name === "node-cron" || name === "node-schedule" || name === "cron") {
    add("scheduling", "cron");
    add("background_job", "cron");
  }
  if (
    name === "nodemailer" ||
    name.includes("sendgrid") ||
    name === "resend" ||
    name.includes("postmark") ||
    name.includes("mailpit")
  ) {
    add("outbound_message", "email");
  }
  if (name === "ioredis" || name === "redis" || name.includes("lru-cache")) {
    add("caching", "cache");
  }
  if (name === "ws" || name.includes("socket.io")) {
    add("realtime", "realtime");
  }
  if (name.includes("express-rate-limit") || name.includes("rate-limiter")) {
    add("rate_limited", "rate_limit");
  }
  if (name === "pino" || name === "winston" || name === "bunyan") {
    add("logging", "logging");
  }
  if (name.includes("date-fns-tz") || name === "luxon") {
    add("time_display", "time_display");
  }
  return found;
}

function isLocalUrl(url: string): boolean {
  const match = /^https?:\/\/([^/?:]+)/i.exec(url);
  const host = (match?.[1] ?? "").toLowerCase().replace(/^\[|\]$/g, "");
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "0.0.0.0" ||
    host === "::1" ||
    host.endsWith(".local")
  );
}

function propertyHits(source: string, names: readonly string[]): boolean {
  for (const name of names) {
    const pattern = new RegExp(`\\b${name}\\s*[?:]`);
    if (pattern.test(source)) return true;
  }
  return false;
}

function scanFile(filePath: string, addedLines: readonly string[]): MutableSignal[] {
  if (isTestOrFixturePath(filePath)) return [];
  const raw = addedLines.join("\n");
  const code = stripComments(raw, filePath);
  const structural = blankStringLiterals(code);
  const signals: MutableSignal[] = [];
  const add = (tag: TouchTag | null, informal: string, reason: string) => {
    signals.push({ path: filePath, tag, informal, reason });
  };

  if (hasSegment(filePath, "migrations") || hasSegment(filePath, "migration")) {
    add("migration", "migrations", "migration path");
  }
  if (/\b(create|alter|drop)\s+table\b/i.test(structural)) {
    add("migration", "migrations", "sql ddl");
  }
  if (hasSegment(filePath, "routes") || hasSegment(filePath, "route") || /\/api\//i.test(filePath.replaceAll("\\", "/"))) {
    add("route", "route", "route path");
  }
  if (hasSegment(filePath, "auth")) {
    add("authn", "auth_guard", "auth path");
    add("authz", "auth_guard", "auth path");
    add("session", "auth_guard", "auth path");
  }
  if (hasSegment(filePath, "jobs") || hasSegment(filePath, "workers") || hasSegment(filePath, "cron")) {
    add("background_job", "cron", "job path");
    add("scheduling", "cron", "job path");
  }
  if (/\.(css|scss)$/i.test(filePath)) {
    add("interactive_ui", "ui", "stylesheet");
  }

  for (const spec of collectImports(code)) {
    for (const found of tagsForModule(spec)) {
      add(found.tag, found.informal, found.reason);
    }
    if (spec === "commander" || spec === "yargs" || spec === "minimist") {
      add(null, "cli_args", `import ${spec}`);
    }
  }

  if (/\b(requireAuth|requireRole|authMiddleware|withAuth)\b/.test(structural)) {
    add("authn", "auth_guard", "auth guard call");
    add("authz", "auth_guard", "auth guard call");
  }
  if (/\b(getSession|requireSession|req\.session|request\.session)\b/.test(structural)) {
    add("session", "auth_guard", "session access");
  }
  if (/\bdeleteMany\s*\(|\bDELETE\s+FROM\b|\.delete\s*\(/i.test(structural)) {
    add("destructive_write", "destructive_write", "delete operation");
  }
  if (/\b(updateMany|createMany|insertMany)\s*\(/.test(structural)) {
    add("bulk_write", "bulk_write", "bulk write");
  }
  if (/\bprocess\.env\b/.test(structural)) {
    add("config_env", "config_env", "process.env read");
  }
  if (/\b(cron\.schedule|new\s+CronJob)\b/.test(structural)) {
    add("scheduling", "cron", "cron schedule");
    add("background_job", "cron", "cron schedule");
  }
  if (/\b(constructEvent|verifyWebhookSignature|stripe-signature)\b/i.test(code)) {
    add("inbound_webhook", "inbound_webhook", "webhook signature check");
  }
  if (/<form\b|onSubmit\s*=/.test(code)) {
    add("form_input", "form", "jsx form");
    add("interactive_ui", "ui", "jsx form");
  } else if (/\.(jsx|tsx)$/i.test(filePath) && /<[A-Za-z][^>\n]*>/.test(code)) {
    add("interactive_ui", "ui", "jsx element");
  }
  if (/type\s*=\s*["']file["']|getSignedUrl|presign/i.test(code)) {
    add("file_upload", "file_upload", "upload control");
  }
  if (/\bnew\s+WebSocket\b|\bsocket\.io\b/.test(code)) {
    add("realtime", "realtime", "websocket");
  }
  if (/\b(expectedVersion|optimisticLock)\b/.test(structural)) {
    add("concurrent_edit", "locking", "optimistic lock");
  }

  const callsHttp = /(?:\bfetch\s*\(|\baxios\b|\bgot\s*\(|\bhttps?\.request\s*\()/.test(code);
  if (callsHttp) {
    const urls = [...code.matchAll(/https?:\/\/[^\s"'`)]+/g)].map((match) => match[0] ?? "");
    const relative = /\bfetch\s*\(\s*["'`]\/[^"'`]/.test(code);
    const nonLocal = urls.filter((url) => url.length > 0 && !isLocalUrl(url));
    const onlyLocal = urls.length > 0 && nonLocal.length === 0;
    if (nonLocal.length > 0 || (!onlyLocal && !relative)) {
      add("external_api", "external_http", "external http client");
    }
  }

  if (propertyHits(structural, ["email", "phone", "ssn", "dateOfBirth", "date_of_birth", "firstName", "lastName"])) {
    add("personal_data", "pii", "pii field");
  }
  if (propertyHits(structural, ["password", "passwordHash", "apiKey", "api_key", "secret", "tokenHash"])) {
    add("credentials", "credentials", "credential field");
  }

  return signals;
}

function dedupeSignals(signals: readonly MutableSignal[]): DiffSignal[] {
  const seen = new Set<string>();
  const out: DiffSignal[] = [];
  for (const signal of signals) {
    const key = `${signal.path}|${signal.tag ?? ""}|${signal.informal}|${signal.reason}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(signal);
  }
  out.sort((left, right) => {
    const path = left.path.localeCompare(right.path);
    if (path !== 0) return path;
    const informal = left.informal.localeCompare(right.informal);
    if (informal !== 0) return informal;
    return left.reason.localeCompare(right.reason);
  });
  return out;
}

export class DiffAutoTagDetector {
  private loaded: readonly CrossCuttingRule[] | null = null;

  constructor(private readonly rules?: readonly CrossCuttingRule[]) {}

  private resolveRules(override?: readonly CrossCuttingRule[]): readonly CrossCuttingRule[] {
    if (override) return override;
    if (this.rules) return this.rules;
    this.loaded ??= new RulesSeamsCatalogLoader().loadRules();
    return this.loaded;
  }

  detect(diff: string, options?: DiffDetectOptions): DiffTagReport {
    const rules = this.resolveRules(options?.rules);
    const signals = dedupeSignals(
      parseUnifiedDiff(diff).flatMap((file) => scanFile(file.path, file.addedLines)),
    );
    const tags = sortTouchTags(
      signals.flatMap((signal) => (signal.tag ? [signal.tag] : [])),
    );
    const plannedTags = options?.plannedTags;
    if (!plannedTags) return { tags, signals, scopeCreep: null };

    const normalized: TouchTag[] = [];
    const unrecognized: string[] = [];
    for (const tag of plannedTags) {
      const closed = normalizeTouchTag(tag);
      if (closed) normalized.push(closed);
      else unrecognized.push(tag);
    }
    const plannedSet = new Set(normalized);
    const unexpected = tags.filter((tag) => !plannedSet.has(tag));
    if (unexpected.length === 0) {
      return { tags, signals, scopeCreep: null };
    }
    const plannedClosed = sortTouchTags(normalized);
    const union = new Set<TouchTag>([...plannedClosed, ...tags]);
    const already = new Set(matchingRuleIds(rules, new Set(plannedClosed)));
    const extraRuleIds = matchingRuleIds(rules, union).filter((id) => !already.has(id));
    const informal = unexpected.map((tag) => {
      const signal = signals.find((item) => item.tag === tag && item.informal !== tag);
      return signal ? `${signal.informal} (${tag})` : tag;
    });
    const warning =
      `Scope creep: planned [${plannedTags.join(", ")}] but the diff introduced ` +
      `${informal.join(" and ")}. Extra checks: ${extraRuleIds.join(", ") || "none"}.`;
    return {
      tags,
      signals,
      scopeCreep: {
        plannedTags,
        normalizedPlannedTags: plannedClosed,
        unrecognizedPlannedTags: unrecognized,
        unexpectedTags: unexpected,
        extraRuleIds,
        warning,
      },
    };
  }
}
