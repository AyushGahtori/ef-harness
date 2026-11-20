import type { SecretFinding } from "./types.js";

/**
 * Independent second scanner. Patterns are written separately from the redactor
 * so a missed replacement cannot grade its own homework.
 */
function joined(...parts: readonly string[]): string {
  return parts.join("");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export class SafetyScanner {
  scan(text: string): SecretFinding[] {
    if (text.length === 0) return [];
    const findings: SecretFinding[] = [];
    const live = joined("sk", "_live_");
    const github = joined("ghp", "_");
    const aws = joined("AK", "IA");
    const begin = joined("-----", "BEGIN", " ", "PRIVATE KEY-----");
    const rules: readonly { readonly ruleId: string; readonly label: string; readonly source: RegExp }[] = [
      {
        ruleId: "stripe-live",
        label: "API_KEY",
        source: new RegExp(`${escapeRegExp(live)}[A-Za-z0-9_]{4,}`, "i"),
      },
      {
        ruleId: "github-token",
        label: "API_KEY",
        source: new RegExp(`${escapeRegExp(github)}[A-Za-z0-9]{8,}`),
      },
      {
        ruleId: "aws-access-key",
        label: "API_KEY",
        source: new RegExp(`${escapeRegExp(aws)}[0-9A-Z]{16}`),
      },
      {
        ruleId: "jwt",
        label: "JWT",
        source: /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/,
      },
      {
        ruleId: "pem",
        label: "PEM_PRIVATE_KEY",
        source: new RegExp(escapeRegExp(begin)),
      },
      {
        ruleId: "postgres-credentials",
        label: "POSTGRES_URL",
        source: /\bpostgres(?:ql)?:\/\/(?!\[REDACTED_CREDENTIALS\]@)[^/\s:@]+:[^/\s@]+@/i,
      },
      {
        ruleId: "url-credentials",
        label: "URL_CREDENTIALS",
        source: /\b(?:mysql|mongodb(?:\+srv)?|redis|amqp|amqps):\/\/(?!\[REDACTED_CREDENTIALS\]@)[^/\s:@]+:[^/\s@]+@/i,
      },
      {
        ruleId: "raw-auth-header",
        label: "AUTH_HEADER",
        source:
          /(?:authorization|cookie|set-cookie|x-api-key|x-auth-token|x-csrf-token|proxy-authorization)\s*:\s*(?!\[REDACTED:)\S/i,
      },
      {
        ruleId: "sensitive-assignment",
        label: "SENSITIVE_FIELD",
        source:
          /["']?(?:password|passwd|secret|token|access_token|refresh_token|api_key|ssn|credit_card|cvv|private_key)["']?\s*[:=]\s*(?!["']?\[REDACTED:)\S/i,
      },
    ];
    for (const rule of rules) {
      if (rule.source.test(text)) findings.push({ ruleId: rule.ruleId, label: rule.label });
    }
    return findings;
  }
}
