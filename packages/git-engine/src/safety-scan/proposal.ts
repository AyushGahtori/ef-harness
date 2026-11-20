import type { GitignoreProposal, StackId } from "./types.js";
import { REVIEW_BANNER } from "./types.js";
import { normalizeIgnoreLine, unifiedDiff } from "./gitignore.js";

export interface ProposalFacts {
  readonly existingGitignore: string;
  readonly stacks: readonly StackId[];
  readonly foundEnv: boolean;
  readonly foundKeys: boolean;
  readonly junkNames: readonly string[];
  readonly buildDirs: readonly string[];
  readonly largeFiles: readonly string[];
  readonly secretPaths: readonly string[];
  readonly suppressedLines?: readonly string[];
}

const STACK_LINES: Readonly<Record<StackId, readonly string[]>> = {
  node: ["node_modules/", "dist/", "build/", ".next/", "coverage/"],
  python: [".venv/", "venv/", "__pycache__/", "*.pyc", ".pytest_cache/", "dist/", "build/"],
  rust: ["target/"],
  go: ["vendor/", "bin/"],
};

const JUNK_ORDER = [".DS_Store", "Thumbs.db", "desktop.ini"] as const;

function unique(lines: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const line of lines) {
    const key = normalizeIgnoreLine(line);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(line);
  }
  return result;
}

function existingKeys(text: string): Set<string> {
  const keys = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const key = normalizeIgnoreLine(line);
    if (key) keys.add(key);
  }
  return keys;
}

export function buildGitignoreProposal(facts: ProposalFacts): GitignoreProposal {
  const desired: string[] = [];
  for (const stack of facts.stacks) {
    desired.push(...STACK_LINES[stack]);
  }
  if (facts.foundEnv) {
    desired.push(".env", ".env.*", "!.env.example", "!.env.sample", "!.env.template");
  }
  if (facts.foundKeys) {
    desired.push("*.pem", "*.key", "*.p12", "*.pfx", "id_rsa", "id_ed25519");
  }
  for (const name of JUNK_ORDER) {
    if (facts.junkNames.includes(name)) desired.push(name);
  }
  for (const directory of facts.buildDirs) {
    desired.push(directory.endsWith("/") ? directory : `${directory}/`);
  }
  for (const file of facts.largeFiles) {
    desired.push(file);
  }
  const present = existingKeys(facts.existingGitignore);
  const suppressed = new Set((facts.suppressedLines ?? []).map((line) => normalizeIgnoreLine(line)));
  const additions = unique(desired).filter((line) => {
    const key = normalizeIgnoreLine(line);
    if (present.has(key)) return false;
    if (suppressed.has(key)) return false;
    return true;
  });
  const proposedText = composeGitignore(facts.existingGitignore, additions);
  return {
    stack: [...facts.stacks],
    existingText: facts.existingGitignore,
    additions,
    proposedText,
    proposedGitignoreDiff: unifiedDiff(facts.existingGitignore, proposedText),
    secretsNotCommitted: [...facts.secretPaths],
    reviewBanner: REVIEW_BANNER,
  };
}

export function composeGitignore(existing: string, additions: readonly string[]): string {
  const normalized = existing.replaceAll("\r\n", "\n");
  if (additions.length === 0) {
    if (normalized.length === 0) return "";
    return normalized.endsWith("\n") ? normalized : `${normalized}\n`;
  }
  if (normalized.trim().length === 0) {
    return `${additions.join("\n")}\n`;
  }
  const base = normalized.endsWith("\n") ? normalized : `${normalized}\n`;
  const gap = base.endsWith("\n\n") ? "" : "\n";
  return `${base}${gap}${additions.join("\n")}\n`;
}

export function omittedIgnoreLines(proposedText: string, editedText: string): string[] {
  const kept = new Set(
    editedText
      .split(/\r?\n/)
      .map((line) => normalizeIgnoreLine(line))
      .filter((line) => line.length > 0),
  );
  const omitted: string[] = [];
  const seen = new Set<string>();
  for (const line of proposedText.split(/\r?\n/)) {
    const key = normalizeIgnoreLine(line);
    if (!key || key.startsWith("#") || seen.has(key) || kept.has(key)) continue;
    seen.add(key);
    omitted.push(line.trim());
  }
  return omitted;
}

export function splitRejectedAdditions(
  additions: readonly string[],
  editedText: string,
): { readonly accepted: string[]; readonly rejected: string[] } {
  const kept = new Set(
    editedText
      .split(/\r?\n/)
      .map((line) => normalizeIgnoreLine(line))
      .filter((line) => line.length > 0),
  );
  const accepted: string[] = [];
  const rejected: string[] = [];
  for (const addition of additions) {
    if (kept.has(normalizeIgnoreLine(addition))) accepted.push(addition);
    else rejected.push(addition);
  }
  return { accepted, rejected };
}
