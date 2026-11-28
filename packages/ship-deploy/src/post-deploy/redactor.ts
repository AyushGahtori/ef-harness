import { createHash } from "node:crypto";
import type { PacketSecurityRedactor } from "./types.js";

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

interface SecretPattern {
  readonly label: string;
  readonly expression: RegExp;
}

function pattern(label: string, source: string): SecretPattern {
  return { label, expression: new RegExp(source, "g") };
}

function builtInPatterns(): readonly SecretPattern[] {
  const live = ["sk", "_live_"].join("");
  const test = ["sk", "_test_"].join("");
  const ant = ["sk-ant", "-"].join("");
  const proj = ["sk-proj", "-"].join("");
  const or = ["sk-or", "-v1-"].join("");
  const aiza = ["AI", "za"].join("");
  const ghp = ["ghp", "_"].join("");
  const gho = ["gho", "_"].join("");
  const pat = ["github", "_pat_"].join("");
  const akia = ["AK", "IA"].join("");
  const token = "[A-Za-z0-9]{8,}";
  return [
    pattern("STRIPE_LIVE_KEY", `${live}${token}`),
    pattern("STRIPE_TEST_KEY", `${test}${token}`),
    pattern("ANTHROPIC_KEY", `${ant}${token}`),
    pattern("OPENAI_KEY", `${proj}${token}`),
    pattern("OPENROUTER_KEY", `${or}${token}`),
    pattern("GOOGLE_API_KEY", `${aiza}[0-9A-Za-z_\\-]{8,}`),
    pattern("GITHUB_TOKEN", `${ghp}${token}`),
    pattern("GITHUB_TOKEN", `${gho}${token}`),
    pattern("GITHUB_TOKEN", `${pat}${token}`),
    pattern("AWS_ACCESS_KEY", `${akia}[A-Z0-9]{16}`),
    pattern("BEARER", "Bearer\\s+[A-Za-z0-9._~+/=\\-]{8,}"),
    pattern("URL_USERINFO", "([a-z][a-z0-9+.-]*:\\/\\/)[^\\s:@/]+:[^\\s@/]+@"),
  ];
}

function redactPem(text: string): string {
  const begin = ["-----BEGIN ", "PRIVATE KEY-----"].join("");
  const end = ["-----END ", "PRIVATE KEY-----"].join("");
  const expression = new RegExp(`${begin}[\\s\\S]*?${end}`, "g");
  return text.replace(expression, "[REDACTED:PRIVATE_KEY]");
}

/**
 * Stand-in for Task 011 `PacketSecurityRedactor` until that package is wired.
 * Known key prefixes, bearer tokens, URL userinfo, PEM blocks, and registered values.
 */
export class FallbackPacketSecurityRedactor implements PacketSecurityRedactor {
  private readonly registered: { readonly value: string; readonly label: string }[] = [];

  registerSecret(value: string, label: string): void {
    if (value.length < 8) return;
    this.registered.push({ value, label });
  }

  redact(text: string): string {
    let next = text;
    for (const secret of this.registered) {
      if (next.includes(secret.value)) {
        next = next.split(secret.value).join(`[REDACTED:${secret.label}]`);
      }
    }
    for (const item of builtInPatterns()) {
      next = next.replace(item.expression, (match: string, userinfoPrefix?: string) => {
        if (item.label === "URL_USERINFO" && userinfoPrefix) {
          return `${userinfoPrefix}[REDACTED:URL_USERINFO]@`;
        }
        return `[REDACTED:${item.label}]`;
      });
    }
    return redactPem(next);
  }
}

export function createFallbackPacketSecurityRedactor(): PacketSecurityRedactor {
  return new FallbackPacketSecurityRedactor();
}
