/**
 * Delegates code-egress redaction to Task 011 `StreamingRedactor`.
 */
import { getSharedSecretRedactor, StreamingRedactor } from "@ef-harness/shared-observability";
import { legacySecretPatterns } from "./secret-patterns.js";

const STREAM_OVERLAP = 64;

export interface RedactionHit {
  readonly line: number;
  readonly preview: string;
}

export class PacketSecurityRedactor {
  redact(source: string): { readonly text: string; readonly hits: readonly RedactionHit[] } {
    const stream = new StreamingRedactor(getSharedSecretRedactor(), STREAM_OVERLAP);
    const streamed = `${stream.push(source)}${stream.flush()}`;
    const sourceLines = source.split("\n");
    const hits: RedactionHit[] = [];
    const redactedLines = streamed.split("\n").map((line, index) => {
      let next = line;
      for (const pattern of legacySecretPatterns()) {
        pattern.lastIndex = 0;
        if (pattern.test(next)) next = next.replace(pattern, "[REDACTED_LEGACY_SECRET]");
      }
      const original = sourceLines[index] ?? "";
      if (next !== original) {
        hits.push({ line: index + 1, preview: original.trim().slice(0, 80) });
      }
      return next;
    });
    return { text: redactedLines.join("\n"), hits };
  }
}
