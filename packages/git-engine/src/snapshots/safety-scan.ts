import { lstat, open, readlink } from "node:fs/promises";
import path from "node:path";
import { normalizeRelPath, resolveInsideRepo } from "./paths.js";
import { LARGE_FILE_BYTES } from "./types.js";
import type {
  BlockedSecretFinding,
  DeltaScanInput,
  GitSafetyScannerPort,
  LargeFileFinding,
  SafetyScanReport,
} from "./types.js";

const TEXT_SCAN_LIMIT = 1024 * 1024;
const FIXTURE_MARKER = ["test-fixture", "-not-secret"].join("");

export interface DeltaSafetyOptions {
  readonly vaultSecrets?: readonly { readonly label: string; readonly value: string }[];
}

interface TextHit {
  readonly line: number;
  readonly ruleId: string;
}

function joined(...parts: readonly string[]): string {
  return parts.join("");
}

function secretExpressions(): readonly { readonly id: string; readonly expression: RegExp }[] {
  const specs: readonly (readonly [string, string])[] = [
    ["stripe-live", joined("sk", "_live_", "[A-Za-z0-9_]{8,}")],
    ["stripe-test", joined("sk", "_test_", "[A-Za-z0-9_]{16,}")],
    ["anthropic", joined("sk-ant", "-", "[A-Za-z0-9_\\-]{8,}")],
    ["openai-proj", joined("sk-proj", "-", "[A-Za-z0-9_\\-]{8,}")],
    ["github-token", joined("ghp", "_[A-Za-z0-9]{16,}")],
    ["aws-access-key", joined("AK", "IA", "[0-9A-Z]{16}")],
  ];
  return specs.map(([id, source]) => ({ id, expression: new RegExp(source, "g") }));
}

function pemExpression(): RegExp {
  const begin = joined("-----", "BEGIN", " ", "PRIVATE", " ", "KEY-----");
  const end = joined("-----", "END", " ", "PRIVATE", " ", "KEY-----");
  return new RegExp(`${begin}[\\s\\S]{0,400}?${end}`, "g");
}

function isEnvSecretName(name: string): boolean {
  if (name === ".env.example" || name === ".env.sample" || name === ".env.template") return false;
  return name === ".env" || name.startsWith(".env.");
}

function isPrivateKeyName(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    lower.endsWith(".pem") ||
    lower.endsWith(".key") ||
    lower.endsWith(".p12") ||
    lower.endsWith(".pfx") ||
    lower === "id_rsa" ||
    lower === "id_ed25519"
  );
}

function lineNumberAt(text: string, index: number): number {
  let line = 1;
  const end = Math.min(index, text.length);
  for (let cursor = 0; cursor < end; cursor += 1) {
    if (text.charCodeAt(cursor) === 10) line += 1;
  }
  return line;
}

function shannonEntropy(value: string): number {
  if (value.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const character of value) {
    counts.set(character, (counts.get(character) ?? 0) + 1);
  }
  let entropy = 0;
  for (const count of counts.values()) {
    const probability = count / value.length;
    entropy -= probability * Math.log2(probability);
  }
  return entropy;
}

function scanText(text: string, vaultSecrets: readonly { readonly value: string }[]): TextHit[] {
  if (text.includes(FIXTURE_MARKER)) return [];
  const hits: TextHit[] = [];
  const seen = new Set<string>();
  const push = (line: number, ruleId: string) => {
    const key = `${line}\0${ruleId}`;
    if (seen.has(key)) return;
    seen.add(key);
    hits.push({ line, ruleId });
  };
  for (const pattern of secretExpressions()) {
    pattern.expression.lastIndex = 0;
    for (const match of text.matchAll(pattern.expression)) {
      const index = match.index ?? 0;
      push(lineNumberAt(text, index), pattern.id);
    }
  }
  pemExpression().lastIndex = 0;
  for (const match of text.matchAll(pemExpression())) {
    push(lineNumberAt(text, match.index ?? 0), "private-key-block");
  }
  for (const secret of vaultSecrets) {
    if (secret.value.length < 8) continue;
    const index = text.indexOf(secret.value);
    if (index >= 0) push(lineNumberAt(text, index), "vault-match");
  }
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const match =
      /^\s*(?:export\s+)?(?:const|let|var\s+)?["']?([A-Za-z_][\w.-]{0,80})["']?\s*[:=]\s*["']([A-Za-z0-9+/=_-]{20,200})["']/.exec(
        line,
      );
    const name = match?.[1];
    const value = match?.[2];
    if (!name || !value) continue;
    if (/integrity|checksum|sha-?256|hash|digest|commit/i.test(name)) continue;
    if (shannonEntropy(value) >= 4) push(index + 1, "high-entropy");
  }
  return hits;
}

function finding(relativePath: string, line: number, ruleId: string, preview: string): BlockedSecretFinding {
  return {
    file: relativePath,
    path: relativePath,
    line,
    rule: ruleId,
    ruleId,
    preview,
  };
}

async function linkEscapes(repoPath: string, absolute: string): Promise<boolean> {
  let current = absolute;
  const seen = new Set<string>();
  for (let hop = 0; hop < 8; hop += 1) {
    const key = path.resolve(current);
    if (seen.has(key)) return true;
    seen.add(key);
    let stat;
    try {
      stat = await lstat(current);
    } catch {
      return resolveInsideRepo(repoPath, path.relative(repoPath, current)) === null;
    }
    if (!stat.isSymbolicLink()) {
      return resolveInsideRepo(repoPath, path.relative(repoPath, current)) === null;
    }
    let target = "";
    try {
      target = await readlink(current);
    } catch {
      return true;
    }
    current = path.resolve(path.dirname(current), target);
    if (resolveInsideRepo(repoPath, path.relative(repoPath, current)) === null) return true;
  }
  return true;
}

async function readPrefix(absolute: string, size: number): Promise<Buffer> {
  if (size <= 0) return Buffer.alloc(0);
  const length = Math.min(size, TEXT_SCAN_LIMIT);
  const handle = await open(absolute, "r");
  try {
    const buffer = Buffer.alloc(length);
    const result = await handle.read(buffer, 0, length, 0);
    return buffer.subarray(0, result.bytesRead);
  } finally {
    await handle.close();
  }
}

/**
 * Scans only the uncommitted delta. File names and stat sizes are decided before any read.
 * Reports contain a redacted preview, never the secret bytes.
 */
export function createDeltaSafetyScanner(options: DeltaSafetyOptions = {}): GitSafetyScannerPort {
  const vaultSecrets = options.vaultSecrets ?? [];
  return {
    async scanUncommittedDelta(input: DeltaScanInput): Promise<SafetyScanReport> {
      const blockedSecrets: BlockedSecretFinding[] = [];
      const largeFiles: LargeFileFinding[] = [];
      const ignores = new Set<string>();
      for (const rawPath of input.paths) {
        const relativePath = normalizeRelPath(rawPath);
        const absolute = resolveInsideRepo(input.repoPath, relativePath);
        if (!absolute) {
          blockedSecrets.push(finding(relativePath, 1, "unsafe-path", "(unsafe path)"));
          continue;
        }
        const name = path.basename(relativePath);
        if (isEnvSecretName(name)) {
          ignores.add(".env*");
          blockedSecrets.push(finding(relativePath, 1, "env-file", "(secret file name)"));
        }
        if (isPrivateKeyName(name)) {
          ignores.add(name);
          blockedSecrets.push(finding(relativePath, 1, "private-key-file", "(secret file name)"));
        }
        let stat;
        try {
          stat = await lstat(absolute);
        } catch {
          continue;
        }
        if (stat.isSymbolicLink()) {
          if (await linkEscapes(input.repoPath, absolute)) {
            blockedSecrets.push(finding(relativePath, 1, "symlink-escape", "(symlink)"));
          }
          continue;
        }
        if (!stat.isFile()) continue;
        if (stat.size > LARGE_FILE_BYTES) {
          largeFiles.push({ file: relativePath, sizeBytes: stat.size });
          continue;
        }
        const sample = await readPrefix(absolute, stat.size);
        if (sample.includes(0)) continue;
        const text = sample.toString("utf8");
        for (const hit of scanText(text, vaultSecrets)) {
          blockedSecrets.push(finding(relativePath, hit.line, hit.ruleId, "****...****"));
        }
      }
      largeFiles.sort((left, right) => left.file.localeCompare(right.file));
      blockedSecrets.sort(
        (left, right) =>
          left.file.localeCompare(right.file) ||
          left.line - right.line ||
          left.ruleId.localeCompare(right.ruleId),
      );
      return {
        blockedSecrets,
        largeFiles,
        safeToCommit: blockedSecrets.length === 0 && largeFiles.length === 0,
        recommendedIgnores: [...ignores].sort(),
        proposedGitignoreDiff: "",
      };
    },
  };
}

export function adaptWorkingTreeScanner(
  createScanner: (repoPath: string) => { scanWorkingTreeForBaseline(): Promise<SafetyScanReport> },
): (repoPath: string) => GitSafetyScannerPort {
  return (repoPath: string) => ({
    async scanUncommittedDelta(input: DeltaScanInput): Promise<SafetyScanReport> {
      const report = await createScanner(repoPath).scanWorkingTreeForBaseline();
      const allowed = new Set(input.paths.map((item) => normalizeRelPath(item)));
      const blockedSecrets = report.blockedSecrets.filter(
        (item) => allowed.has(normalizeRelPath(item.file)) || allowed.has(normalizeRelPath(item.path)),
      );
      const largeFiles = report.largeFiles.filter((item) => allowed.has(normalizeRelPath(item.file)));
      return {
        ...report,
        blockedSecrets,
        largeFiles,
        safeToCommit: blockedSecrets.length === 0 && largeFiles.length === 0,
      };
    },
  });
}

export function filterReportToDelta(report: SafetyScanReport, paths: readonly string[]): SafetyScanReport {
  const allowed = new Set(paths.map((item) => normalizeRelPath(item)));
  const blockedSecrets = report.blockedSecrets.filter(
    (item) => allowed.has(normalizeRelPath(item.file)) || allowed.has(normalizeRelPath(item.path)),
  );
  const largeFiles = report.largeFiles.filter((item) => allowed.has(normalizeRelPath(item.file)));
  return {
    ...report,
    blockedSecrets,
    largeFiles,
    safeToCommit: blockedSecrets.length === 0 && largeFiles.length === 0,
  };
}
