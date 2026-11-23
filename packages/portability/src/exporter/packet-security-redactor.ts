import type { PacketSecurityRedactorPort } from "./types.js";
import { exportSecretPatterns } from "./secret-patterns.js";

const PATTERNS = exportSecretPatterns();

export class PacketSecurityRedactor implements PacketSecurityRedactorPort {
  scan(text: string): { readonly clean: boolean; readonly preview: string } {
    for (const pattern of PATTERNS) {
      pattern.lastIndex = 0;
      const match = pattern.exec(text);
      if (match) {
        const idx = match.index;
        const start = Math.max(0, idx - 12);
        const end = Math.min(text.length, idx + match[0].length + 12);
        return { clean: false, preview: text.slice(start, end).replace(/\s+/g, " ").trim() };
      }
    }
    return { clean: true, preview: "" };
  }
}