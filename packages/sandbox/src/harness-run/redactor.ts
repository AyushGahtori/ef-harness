import type { RegisteredSecret } from "./types.js";

const MIN_DYNAMIC_SECRET_LENGTH = 8;
const DEFAULT_HOLD = 4096;

interface Replacement {
  readonly value: string;
  readonly label: string;
}

function patternSources(): { readonly label: string; readonly source: string }[] {
  const sk = "sk";
  const ghp = ["gh", "p_"].join("");
  const akia = ["AK", "IA"].join("");
  const begin = ["BEGIN ", "PRIVATE KEY"].join("");
  const end = ["END ", "PRIVATE KEY"].join("");
  return [
    { label: "STRIPE_LIVE", source: `${sk}_live_[A-Za-z0-9]{8,}` },
    { label: "STRIPE_TEST", source: `${sk}_test_[A-Za-z0-9]{8,}` },
    { label: "ANTHROPIC", source: `${sk}-ant-[A-Za-z0-9_\\-]{8,}` },
    { label: "OPENAI_PROJECT", source: `${sk}-proj-[A-Za-z0-9_\\-]{8,}` },
    { label: "OPENROUTER", source: `${sk}-or-v1-[A-Za-z0-9]{8,}` },
    { label: "GOOGLE", source: "AIza[0-9A-Za-z_\\-]{20,}" },
    { label: "GITHUB", source: `${ghp}[A-Za-z0-9]{20,}` },
    { label: "GITHUB_OAUTH", source: "gho_[A-Za-z0-9]{20,}" },
    { label: "GITHUB_PAT", source: "github_pat_[A-Za-z0-9_]{20,}" },
    { label: "AWS_ACCESS_KEY", source: `${akia}[0-9A-Z]{16}` },
    {
      label: "PEM",
      source: `-----${begin}-----[\\s\\S]*?-----${end}-----`,
    },
    {
      label: "BEARER",
      source: "Bearer\\s+[A-Za-z0-9_\\-]+\\.[A-Za-z0-9_\\-]+\\.[A-Za-z0-9_\\-]+",
    },
    { label: "URL_BASIC_AUTH", source: "://[^\\s/@:]+:[^\\s/@]+@" },
  ];
}

function secretVariants(secret: string): string[] {
  if (secret.length < MIN_DYNAMIC_SECRET_LENGTH) return [];
  const base64 = Buffer.from(secret, "utf8").toString("base64");
  const base64Url = base64.replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
  let jsonEscaped = secret;
  try {
    jsonEscaped = JSON.stringify(secret).slice(1, -1);
  } catch {
    jsonEscaped = secret;
  }
  return [...new Set([secret, base64, base64Url, encodeURIComponent(secret), jsonEscaped])];
}

function compileReplacements(secrets: readonly RegisteredSecret[]): Replacement[] {
  const replacements: Replacement[] = [];
  for (const secret of secrets) {
    for (const variant of secretVariants(secret.value)) {
      replacements.push({ label: secret.label, value: variant });
    }
  }
  replacements.sort((left, right) => right.value.length - left.value.length);
  return replacements;
}

export class StreamingSecretRedactor {
  private pending = "";
  private readonly hold: number;
  private readonly replacements: readonly Replacement[];
  private readonly patterns: readonly { readonly label: string; readonly expression: RegExp }[];

  constructor(secrets: readonly RegisteredSecret[] = []) {
    this.replacements = compileReplacements(secrets);
    const longest = this.replacements.reduce((max, item) => Math.max(max, item.value.length), 0);
    this.hold = Math.max(DEFAULT_HOLD, longest);
    this.patterns = patternSources().map((pattern) => ({
      label: pattern.label,
      expression: new RegExp(pattern.source, "g"),
    }));
  }

  redact(text: string): string {
    return this.apply(text);
  }

  push(chunk: string): string {
    this.pending += chunk;
    this.pending = this.apply(this.pending);
    if (this.pending.length <= this.hold) return "";
    const emit = this.pending.slice(0, this.pending.length - this.hold);
    this.pending = this.pending.slice(this.pending.length - this.hold);
    return emit;
  }

  flush(): string {
    const emit = this.apply(this.pending);
    this.pending = "";
    return emit;
  }

  private apply(text: string): string {
    if (text.length === 0) return text;
    let output = text;
    for (const replacement of this.replacements) {
      if (replacement.value.length === 0 || !output.includes(replacement.value)) continue;
      output = output.split(replacement.value).join(`[REDACTED:${replacement.label}]`);
    }
    for (const pattern of this.patterns) {
      pattern.expression.lastIndex = 0;
      output = output.replace(pattern.expression, `[REDACTED:${pattern.label}]`);
    }
    return output;
  }
}
