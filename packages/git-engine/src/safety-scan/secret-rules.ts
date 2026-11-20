import { MIN_VAULT_SECRET_LENGTH } from "./types.js";
import type { VaultSecret } from "./types.js";
import { isFixturePath } from "./paths.js";

export interface TextHit {
  readonly line: number;
  readonly rule: string;
  readonly ruleId: string;
  readonly preview: string;
  readonly suppressible: boolean;
}

interface SecretPattern {
  readonly id: string;
  readonly expression: RegExp;
  readonly suppressible: boolean;
  readonly allowPlaceholder: boolean;
}

const FIXTURE_MARKER = ["test-fixture", "-not-secret"].join("");

function joined(...parts: readonly string[]): string {
  return parts.join("");
}

function isPlaceholder(value: string): boolean {
  return /replace_me|change_?me|placeholder|example|dummy|sample|not[_-]?a[_-]?real|your[_-]?key|x{4,}|<[^>\n]+>/i.test(
    value,
  );
}

/**
 * Keep a known live-key prefix when it is only a prefix. The remainder of the
 * value is never copied into the preview.
 */
export function redactPreview(secret: string): string {
  const livePrefix = joined("sk", "_live_");
  const prefix =
    secret.startsWith(livePrefix) && secret.length > livePrefix.length + 4 ? livePrefix : "";
  if (secret.length - prefix.length < 6) return "****";
  return `${prefix}****...****`;
}

export function shannonEntropy(value: string): number {
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

function secretPatterns(): readonly SecretPattern[] {
  const specs: readonly (readonly [string, string, boolean, boolean])[] = [
    ["stripe-live", joined("sk", "_live_", "[A-Za-z0-9_]{8,}"), false, false],
    ["stripe-test", joined("sk", "_test_", "[A-Za-z0-9_]{16,}"), true, true],
    ["anthropic", joined("sk-ant", "-", "[A-Za-z0-9_\\-]{8,}"), true, true],
    ["openai-proj", joined("sk-proj", "-", "[A-Za-z0-9_\\-]{8,}"), true, true],
    ["openrouter", joined("sk-or-v1", "-", "[A-Za-z0-9_\\-]{8,}"), true, true],
    ["google-api", "AIza[0-9A-Za-z_\\-]{20,}", true, true],
    ["github-pat", "github_pat_[A-Za-z0-9_]{16,}", true, true],
    ["github-token", joined("ghp", "_[A-Za-z0-9]{16,}"), true, true],
    ["github-oauth", joined("gho", "_[A-Za-z0-9]{16,}"), true, true],
    ["aws-access-key", joined("AK", "IA", "[0-9A-Z]{16}"), true, true],
    [
      "bearer-jwt",
      "Bearer[ \\t]+[A-Za-z0-9_\\-]{8,}\\.[A-Za-z0-9_\\-]{8,}\\.[A-Za-z0-9_\\-]{8,}",
      true,
      true,
    ],
  ];
  return specs.map(([id, source, suppressible, allowPlaceholder]) => ({
    id,
    expression: new RegExp(source, "g"),
    suppressible,
    allowPlaceholder,
  }));
}

function pemBlockPattern(): RegExp {
  const begin = joined("-----", "BEGIN", " ", "PRIVATE", " ", "KEY-----");
  const end = joined("-----", "END", " ", "PRIVATE", " ", "KEY-----");
  return new RegExp(`${begin}[\\s\\S]{0,400}?${end}`, "g");
}

function lineNumberAt(text: string, index: number): number {
  let line = 1;
  const end = Math.min(index, text.length);
  for (let cursor = 0; cursor < end; cursor += 1) {
    if (text.charCodeAt(cursor) === 10) line += 1;
  }
  return line;
}

function markerNear(lines: readonly string[], lineNumber: number): boolean {
  const index = lineNumber - 1;
  const current = lines[index] ?? "";
  const previous = index > 0 ? (lines[index - 1] ?? "") : "";
  if (current.includes(FIXTURE_MARKER) || previous.includes(FIXTURE_MARKER)) return true;
  const head = lines.slice(0, 15).join("\n");
  return head.includes(FIXTURE_MARKER);
}

function pushHit(
  hits: TextHit[],
  seen: Set<string>,
  hit: TextHit,
): void {
  const key = `${hit.line}\0${hit.ruleId}`;
  if (seen.has(key)) return;
  seen.add(key);
  hits.push(hit);
}

function encodedForms(value: string): readonly { readonly id: string; readonly form: string }[] {
  const base64 = Buffer.from(value, "utf8").toString("base64");
  const url = encodeURIComponent(value);
  const forms: { id: string; form: string }[] = [{ id: "vault-raw", form: value }];
  if (base64 !== value) forms.push({ id: "vault-base64", form: base64 });
  if (url !== value) forms.push({ id: "vault-url", form: url });
  return forms;
}

function scanVault(text: string, vaultSecrets: readonly VaultSecret[], hits: TextHit[], seen: Set<string>): void {
  for (const secret of vaultSecrets) {
    if (secret.value.length < MIN_VAULT_SECRET_LENGTH) continue;
    for (const form of encodedForms(secret.value)) {
      let from = 0;
      while (from <= text.length) {
        const index = text.indexOf(form.form, from);
        if (index === -1) break;
        const line = lineNumberAt(text, index);
        pushHit(hits, seen, {
          line,
          rule: form.id,
          ruleId: form.id,
          preview: "****...****",
          suppressible: false,
        });
        from = index + form.form.length;
      }
    }
  }
}

const BENIGN_ASSIGNMENT = /integrity|checksum|sha-?256|sha-?1|hash|etag|digest|commit|revision|sri/i;

function isHighEntropyToken(value: string): boolean {
  if (value.length < 20 || value.length > 200) return false;
  if (isPlaceholder(value)) return false;
  if (!/^[A-Za-z0-9+/=_-]+$/.test(value)) return false;
  if (/^[0-9a-f]{40}$/i.test(value) || /^[0-9a-f]{64}$/i.test(value)) return false;
  return shannonEntropy(value) >= 4;
}

function scanAssignments(text: string, hits: TextHit[], seen: Set<string>): void {
  const lines = text.split(/\r?\n/);
  const assignment =
    /^\s*(?:export\s+)?(?:(?:const|let|var)\s+)?["']?([A-Za-z_][\w.-]{0,80})["']?\s*[:=]\s*["']?([A-Za-z0-9+/=_-]{20,200})["']?\s*$/;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const match = assignment.exec(line);
    const name = match?.[1];
    const value = match?.[2];
    if (!name || !value) continue;
    if (BENIGN_ASSIGNMENT.test(name)) continue;
    if (!isHighEntropyToken(value)) continue;
    pushHit(hits, seen, {
      line: index + 1,
      rule: "high-entropy",
      ruleId: "high-entropy",
      preview: redactPreview(value),
      suppressible: true,
    });
  }
}

function scanPatterns(text: string, hits: TextHit[], seen: Set<string>): void {
  for (const pattern of secretPatterns()) {
    const expression = new RegExp(pattern.expression.source, "g");
    for (const match of text.matchAll(expression)) {
      const value = match[0] ?? "";
      if (!value) continue;
      if (pattern.allowPlaceholder && isPlaceholder(value)) continue;
      const index = match.index ?? 0;
      pushHit(hits, seen, {
        line: lineNumberAt(text, index),
        rule: pattern.id,
        ruleId: pattern.id,
        preview: redactPreview(value),
        suppressible: pattern.suppressible,
      });
    }
  }
  const pem = pemBlockPattern();
  for (const match of text.matchAll(pem)) {
    const value = match[0] ?? "";
    if (!value) continue;
    const index = match.index ?? 0;
    pushHit(hits, seen, {
      line: lineNumberAt(text, index),
      rule: "pem-private-key",
      ruleId: "pem-private-key",
      preview: "****...****",
      suppressible: true,
    });
  }
  scanBasicAuth(text, hits, seen);
}

function scanBasicAuth(text: string, hits: TextHit[], seen: Set<string>): void {
  const expression = /[a-z][a-z0-9+.-]*:\/\/([^/\s:@]{1,80}):([^/\s@]{8,})@/gi;
  for (const match of text.matchAll(expression)) {
    const secret = match[2] ?? "";
    if (!secret || isPlaceholder(secret) || shannonEntropy(secret) < 3.5) continue;
    const index = match.index ?? 0;
    pushHit(hits, seen, {
      line: lineNumberAt(text, index),
      rule: "url-basic-auth",
      ruleId: "url-basic-auth",
      preview: "****...****",
      suppressible: true,
    });
  }
}

export function scanTextContent(input: {
  readonly text: string;
  readonly relativePath: string;
  readonly vaultSecrets: readonly VaultSecret[];
  readonly allowPatterns: boolean;
  readonly allowEntropy: boolean;
}): TextHit[] {
  const hits: TextHit[] = [];
  const seen = new Set<string>();
  scanVault(input.text, input.vaultSecrets, hits, seen);
  if (input.allowPatterns) scanPatterns(input.text, hits, seen);
  if (input.allowEntropy) scanAssignments(input.text, hits, seen);
  if (!isFixturePath(input.relativePath)) {
    return hits;
  }
  const lines = input.text.split(/\r?\n/);
  return hits.filter((hit) => {
    if (!hit.suppressible) return true;
    return !markerNear(lines, hit.line);
  });
}

const PKCS12_OID = Buffer.from([0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x0c]);

export function isKeystoreMagic(prefix: Buffer): boolean {
  if (prefix.length >= 4) {
    const jks =
      prefix[0] === 0xfe && prefix[1] === 0xed && prefix[2] === 0xfe && prefix[3] === 0xed;
    const jceks =
      prefix[0] === 0xce && prefix[1] === 0xce && prefix[2] === 0xce && prefix[3] === 0xce;
    if (jks || jceks) return true;
  }
  return prefix.includes(PKCS12_OID);
}

export function isPrivateKeyFileName(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  if (lower === "id_rsa" || lower === "id_ed25519" || lower === "id_ecdsa" || lower === "id_dsa") {
    return true;
  }
  return (
    lower.endsWith(".pem") ||
    lower.endsWith(".key") ||
    lower.endsWith(".p12") ||
    lower.endsWith(".pfx") ||
    lower.endsWith(".jks") ||
    lower.endsWith(".keystore")
  );
}

export function isEnvSecretFileName(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  if (lower === ".env.example" || lower === ".env.sample" || lower === ".env.template") {
    return false;
  }
  return lower === ".env" || lower.startsWith(".env.");
}

export function canonicalJunkName(fileName: string): string | undefined {
  switch (fileName.toLowerCase()) {
    case ".ds_store":
      return ".DS_Store";
    case "thumbs.db":
      return "Thumbs.db";
    case "desktop.ini":
      return "desktop.ini";
    default:
      return undefined;
  }
}

export function isJunkFileName(fileName: string): boolean {
  return canonicalJunkName(fileName) !== undefined;
}

export function maskWithRedactor(preview: string, redact: ((text: string) => string) | undefined): string {
  if (!redact) return preview;
  try {
    const masked = redact(preview);
    if (typeof masked === "string" && masked.length > 0) return masked;
  } catch {
    return preview;
  }
  return preview;
}
