/**
 * Local port of Task 011 `PacketSecurityRedactor` for brownfield code egress only.
 */
import { legacySecretPatterns } from "./secret-patterns.js";

const SECRET_PATTERNS = legacySecretPatterns();

const HIGH_ENTROPY =
  /\b[A-Za-z0-9+/]{32,}={0,2}\b|\b[xX][0-9a-fA-F]{40,}\b|\b[0-9a-fA-F]{40,}\b/g;

export interface RedactionHit {
  readonly line: number;
  readonly preview: string;
}

export class PacketSecurityRedactor {
  redact(source: string): { readonly text: string; readonly hits: readonly RedactionHit[] } {
    const hits: RedactionHit[] = [];
    const lines = source.split("\n");
    const redactedLines = lines.map((line, index) => {
      let next = line;
      for (const pattern of SECRET_PATTERNS) {
        pattern.lastIndex = 0;
        if (pattern.test(next)) {
          hits.push({ line: index + 1, preview: line.trim().slice(0, 80) });
          next = next.replace(pattern, "[REDACTED_LEGACY_SECRET]");
        }
      }
      for (const match of next.matchAll(HIGH_ENTROPY)) {
        const token = match[0];
        if (token.length >= 40 && /[A-Za-z]/.test(token) && /[0-9]/.test(token)) {
          hits.push({ line: index + 1, preview: line.trim().slice(0, 80) });
          next = next.replace(token, "[REDACTED_LEGACY_SECRET]");
        }
      }
      return next;
    });
    return { text: redactedLines.join("\n"), hits };
  }
}