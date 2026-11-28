import type { RepoFileReaderPort } from "./contracts.js";
import type { ContributorDocHint } from "./types.js";

const INJECTION_PATTERNS: readonly RegExp[] = [
  /\bsystem\s+override\b/gi,
  /\bignore\s+(all|previous)\s+instructions\b/gi,
  /\bdisable\s+auth\b/gi,
  /\bcurl\s+[^\s]+\s*\|\s*sh\b/gi,
  /\brun\s+curl\b/gi,
  /\balways\s+disable\b/gi,
];

export interface ContributorDocIngestionOptions {
  readonly paths?: readonly string[];
  readonly maxBytesPerDoc?: number;
}

export class ContributorDocIngestion {
  constructor(private readonly files: RepoFileReaderPort) {}

  ingest(options: ContributorDocIngestionOptions = {}): readonly ContributorDocHint[] {
    const paths =
      options.paths ??
      ["AGENTS.md", "CONTRIBUTING.md", "docs/AGENTS.md", "docs/CONTRIBUTING.md"];
    const maxBytes = options.maxBytesPerDoc ?? 8_000;
    const hints: ContributorDocHint[] = [];

    for (const rel of paths) {
      const raw = this.files.readText(rel);
      if (!raw) continue;
      const clipped = raw.slice(0, maxBytes);
      let sanitized = clipped;
      let stripped = 0;
      for (const pattern of INJECTION_PATTERNS) {
        const before = sanitized;
        sanitized = sanitized.replace(pattern, "[UNTRUSTED_POLICY_HINT_REMOVED]");
        if (sanitized !== before) stripped += 1;
      }
      hints.push({
        path: rel,
        sanitizedExcerpt: sanitized.trim(),
        trusted: false,
        injectionPatternsStripped: stripped,
      });
    }

    return hints;
  }
}

export function isHostileContributorDoc(hints: readonly ContributorDocHint[]): boolean {
  return hints.some((h) => h.injectionPatternsStripped > 0);
}