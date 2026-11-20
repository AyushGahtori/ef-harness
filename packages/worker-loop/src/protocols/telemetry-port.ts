/**
 * Local ports for Task 011 `SecretRedactor` and `LocalTracer`.
 * Adapters depend only on these interfaces. Replace the factories with the
 * shared-contracts implementations when Task 011 is wired into the base.
 */

export interface SecretFinding {
  readonly start: number;
  readonly end: number;
  readonly label: string;
}

export interface SecretRedactorPort {
  registerVaultSecret(secret: string, label: string): void;
  redact(text: string): string;
  redactValue(value: unknown): unknown;
  scanForSecrets(text: string): readonly SecretFinding[];
}

export interface LocalSpan {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId: string | null;
  readonly name: string;
  readonly startMs: number;
  readonly endMs: number | null;
  readonly status: "ok" | "error" | "unset";
  readonly attributes: Readonly<Record<string, string | number | boolean | null>>;
}

export interface LocalTracerPort {
  startSpan(input: {
    readonly name: string;
    readonly parentSpanId?: string;
    readonly attributes?: Readonly<Record<string, string | number | boolean | null>>;
  }): LocalSpan;
  endSpan(
    spanId: string,
    end: {
      readonly status: "ok" | "error";
      readonly attributes?: Readonly<Record<string, string | number | boolean | null>>;
    },
  ): LocalSpan;
  getSpan(spanId: string): LocalSpan | null;
}

const MIN_VAULT_SECRET_LENGTH = 8;

interface VaultSecret {
  readonly secret: string;
  readonly label: string;
  readonly variants: readonly string[];
}

export function createLocalSecretRedactor(): SecretRedactorPort {
  const vault: VaultSecret[] = [];
  const redactor: SecretRedactorPort = {
    registerVaultSecret(secret, label) {
      if (secret.length < MIN_VAULT_SECRET_LENGTH) return;
      vault.push({ secret, label, variants: encodeVariants(secret) });
      vault.sort((left, right) => right.secret.length - left.secret.length);
    },
    redact(text) {
      return applyRedactions(text, vault);
    },
    redactValue(value) {
      return redactUnknown(value, redactor);
    },
    scanForSecrets(text) {
      return findSecrets(text, vault);
    },
  };
  return redactor;
}

function encodeVariants(secret: string): string[] {
  const variants = new Set<string>([secret]);
  variants.add(encodeURIComponent(secret));
  variants.add(Buffer.from(secret, "utf8").toString("base64"));
  variants.add(Buffer.from(secret, "utf8").toString("base64url"));
  variants.add(JSON.stringify(secret).slice(1, -1));
  return [...variants].filter((variant) => variant.length >= MIN_VAULT_SECRET_LENGTH);
}

function applyRedactions(text: string, vault: readonly VaultSecret[]): string {
  let next = text;
  const needles = vault
    .flatMap((entry) => entry.variants.map((variant) => ({ variant, label: entry.label })))
    .sort((left, right) => right.variant.length - left.variant.length);
  for (const needle of needles) {
    next = replaceLiteral(next, needle.variant, `[REDACTED:${needle.label}]`);
  }
  for (const pattern of builtinPatterns()) {
    next = next.replace(pattern.expression, `[REDACTED:${pattern.label}]`);
  }
  return next;
}

function findSecrets(text: string, vault: readonly VaultSecret[]): SecretFinding[] {
  const findings: SecretFinding[] = [];
  for (const entry of vault) {
    for (const variant of entry.variants) {
      let from = 0;
      for (;;) {
        const at = text.indexOf(variant, from);
        if (at < 0) break;
        findings.push({ start: at, end: at + variant.length, label: entry.label });
        from = at + variant.length;
      }
    }
  }
  for (const pattern of builtinPatterns()) {
    pattern.expression.lastIndex = 0;
    for (;;) {
      const match = pattern.expression.exec(text);
      if (!match) break;
      findings.push({
        start: match.index,
        end: match.index + match[0].length,
        label: pattern.label,
      });
      if (match[0].length === 0) pattern.expression.lastIndex += 1;
    }
  }
  findings.sort((left, right) => left.start - right.start || right.end - left.end);
  return findings;
}

function replaceLiteral(text: string, needle: string, replacement: string): string {
  if (needle.length === 0) return text;
  let result = "";
  let from = 0;
  for (;;) {
    const at = text.indexOf(needle, from);
    if (at < 0) {
      result += text.slice(from);
      return result;
    }
    result += text.slice(from, at);
    result += replacement;
    from = at + needle.length;
  }
}

function redactUnknown(value: unknown, redactor: SecretRedactorPort): unknown {
  if (typeof value === "string") return redactor.redact(value);
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  if (Array.isArray(value)) return value.map((entry) => redactUnknown(entry, redactor));
  if (typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      output[key] = redactUnknown(entry, redactor);
    }
    return output;
  }
  return value;
}

interface BuiltinPattern {
  readonly label: string;
  readonly expression: RegExp;
}

function builtinPatterns(): BuiltinPattern[] {
  const sources: Array<{ label: string; source: string }> = [
    { label: "OPENAI_LIVE", source: ["sk", "_live_", "[A-Za-z0-9]{8,}"].join("") },
    { label: "OPENAI_TEST", source: ["sk", "_test_", "[A-Za-z0-9]{8,}"].join("") },
    { label: "ANTHROPIC", source: ["sk-ant", "-", "[A-Za-z0-9_\\-]{8,}"].join("") },
    { label: "OPENAI_PROJ", source: ["sk-proj", "-", "[A-Za-z0-9_\\-]{8,}"].join("") },
    { label: "OPENROUTER", source: ["sk-or-v1", "-", "[A-Za-z0-9]{8,}"].join("") },
    { label: "GOOGLE", source: ["AI", "za", "[0-9A-Za-z_\\-]{8,}"].join("") },
    { label: "GITHUB_PAT", source: ["ghp", "_[A-Za-z0-9]{8,}"].join("") },
    { label: "GITHUB_OAUTH", source: ["gho", "_[A-Za-z0-9]{8,}"].join("") },
    { label: "GITHUB_FINE", source: ["github", "_pat_", "[A-Za-z0-9_]{8,}"].join("") },
    { label: "AWS_ACCESS_KEY", source: ["AK", "IA", "[0-9A-Z]{12,}"].join("") },
    {
      label: "PRIVATE_KEY",
      source: [
        "-----",
        "BEGIN ",
        "PRIVATE KEY",
        "-----[\\s\\S]+?-----",
        "END ",
        "PRIVATE KEY",
        "-----",
      ].join(""),
    },
    {
      label: "BEARER",
      source: "Bearer\\s+[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+",
    },
    {
      label: "URL_BASIC_AUTH",
      source: "[a-z][a-z0-9+.-]*:\\/\\/[^\\/\\s:@]+:[^\\/\\s@]{8,}@",
    },
    {
      label: "ASSIGNMENT",
      source: "(?:api[_-]?key|secret|access[_-]?token)\\s*[:=]\\s*[\"']?[A-Za-z0-9_\\-]{20,}",
    },
  ];
  return sources.map((pattern) => ({
    label: pattern.label,
    expression: new RegExp(pattern.source, "g"),
  }));
}

export function createInMemoryTracer(): LocalTracerPort & {
  readonly spans: () => readonly LocalSpan[];
} {
  const spans = new Map<string, LocalSpan>();
  let traceSeq = 0;
  const stamp = (): number => performance.now();
  return {
    spans: () => [...spans.values()],
    startSpan(input) {
      traceSeq += 1;
      const parent = input.parentSpanId ? spans.get(input.parentSpanId) : undefined;
      const span: LocalSpan = {
        traceId: parent?.traceId ?? `trace-${traceSeq}`,
        spanId: `span-${traceSeq}`,
        parentSpanId: input.parentSpanId ?? null,
        name: input.name,
        startMs: stamp(),
        endMs: null,
        status: "unset",
        attributes: { ...(input.attributes ?? {}) },
      };
      spans.set(span.spanId, span);
      return span;
    },
    endSpan(spanId, end) {
      const current = spans.get(spanId);
      if (!current) {
        throw new Error(`unknown span ${spanId}`);
      }
      const endMs = Math.max(stamp(), current.startMs);
      const closed: LocalSpan = {
        ...current,
        endMs,
        status: end.status,
        attributes: { ...current.attributes, ...(end.attributes ?? {}) },
      };
      spans.set(spanId, closed);
      return closed;
    },
    getSpan(spanId) {
      return spans.get(spanId) ?? null;
    },
  };
}
