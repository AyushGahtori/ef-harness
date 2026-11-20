import type { SecurityFinding, SecurityFindingCode } from "./model.js";

const OSI_LICENSES = new Set([
  "0BSD",
  "AGPL-3.0-only",
  "AGPL-3.0-or-later",
  "Apache-2.0",
  "Artistic-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "BSL-1.0",
  "CC0-1.0",
  "GPL-2.0-only",
  "GPL-2.0-or-later",
  "GPL-3.0-only",
  "GPL-3.0-or-later",
  "ISC",
  "LGPL-2.1-only",
  "LGPL-2.1-or-later",
  "LGPL-3.0-only",
  "LGPL-3.0-or-later",
  "MIT",
  "MPL-2.0",
  "Unlicense",
  "Zlib",
]);

const REJECTED_EXTENSIONS = new Set([
  ".bat",
  ".bin",
  ".cmd",
  ".com",
  ".cjs",
  ".dll",
  ".dylib",
  ".elf",
  ".exe",
  ".jar",
  ".js",
  ".mjs",
  ".msi",
  ".php",
  ".ps1",
  ".py",
  ".rb",
  ".scr",
  ".sh",
  ".so",
  ".wasm",
]);

export function isOsiLicense(license: string): boolean {
  return OSI_LICENSES.has(license);
}

export function forbiddenLocationNeedles(): readonly string[] {
  const home = "~/";
  return [
    `${home}.ssh`,
    `${home}.aws`,
    `${home}.claude`,
    `${home}.codex`,
    `${home}.gemini`,
    "%APPDATA%",
    "%AppData%",
    "/.ssh/",
    "/.aws/",
    "/.claude/",
    "/.codex/",
    "/.gemini/",
  ];
}

export function globalConfigDirNames(): readonly string[] {
  return [".claude", ".codex", ".gemini", ".ssh", ".aws"];
}

export function formatCodePoint(codePoint: number): string {
  return `U+${codePoint.toString(16).toUpperCase().padStart(4, "0")}`;
}

export function findStealthCodePoint(text: string): number | null {
  for (const char of text) {
    const codePoint = char.codePointAt(0);
    if (codePoint === undefined) continue;
    if (codePoint >= 0x200b && codePoint <= 0x200f) return codePoint;
    if (codePoint >= 0x202a && codePoint <= 0x202e) return codePoint;
    if (codePoint >= 0xe0000 && codePoint <= 0xe007f) return codePoint;
    if (codePoint === 0xfeff || codePoint === 0x2060) return codePoint;
    if (codePoint >= 0x2066 && codePoint <= 0x2069) return codePoint;
  }
  return null;
}

export function isAllowedSkillPath(relativePath: string): boolean {
  if (relativePath === "SKILL.md") return true;
  if (relativePath === "quarantine-report.json") return true;
  if (relativePath === "LICENSE" || relativePath === "NOTICE" || relativePath === "ATTRIBUTION.md") {
    return true;
  }
  return /^snippets\/[A-Za-z0-9._-]+\.md$/.test(relativePath);
}

export function hasRejectedExtension(relativePath: string): boolean {
  const lower = relativePath.toLowerCase();
  for (const extension of REJECTED_EXTENSIONS) {
    if (lower.endsWith(extension)) return true;
  }
  return false;
}

export function hasBinaryMagic(bytes: Uint8Array): boolean {
  if (bytes.length >= 2 && bytes[0] === 0x4d && bytes[1] === 0x5a) return true;
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x7f &&
    bytes[1] === 0x45 &&
    bytes[2] === 0x4c &&
    bytes[3] === 0x46
  ) {
    return true;
  }
  if (bytes.length >= 4 && bytes[0] === 0xfe && bytes[1] === 0xed && bytes[2] === 0xfa) return true;
  if (bytes.length >= 4 && bytes[0] === 0xce && bytes[1] === 0xfa && bytes[2] === 0xed && bytes[3] === 0xfe) {
    return true;
  }
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) {
    return true;
  }
  return false;
}

function finding(
  code: SecurityFindingCode,
  relativePath: string,
  detail: string,
): SecurityFinding {
  return { code, path: relativePath, detail };
}

export function textSecurityFindings(relativePath: string, text: string): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  const stealth = findStealthCodePoint(text);
  if (stealth !== null) {
    findings.push(
      finding(
        "hidden_unicode",
        relativePath,
        `hidden unicode ${formatCodePoint(stealth)} is unconditionally rejected`,
      ),
    );
  }
  if (/<!--[\s\S]*?-->/.test(text)) {
    findings.push(finding("html_comment", relativePath, "HTML comment can hide a payload"));
  }
  if (
    /\[[^\]]+\]\(\s*<?[^)\s>]+>?\s+(?:"[^"]*"|'[^']*')\s*\)/.test(text) ||
    /^\s*\[[^\]]+\]:\s+\S+\s+(?:"[^"]+"|'[^']+')/m.test(text)
  ) {
    findings.push(
      finding("hidden_link_title", relativePath, "markdown link title can hide a payload"),
    );
  }
  if (
    /<\w[^>]*\shidden(?:\s|=|>)/i.test(text) ||
    /display\s*:\s*none/i.test(text) ||
    /visibility\s*:\s*hidden/i.test(text) ||
    /font-size\s*:\s*0/i.test(text) ||
    /<\s*(?:script|iframe|object|embed)\b/i.test(text)
  ) {
    findings.push(finding("hidden_markup", relativePath, "hidden markup can carry a payload"));
  }
  for (const needle of forbiddenLocationNeedles()) {
    if (text.toLowerCase().includes(needle.toLowerCase())) {
      findings.push(finding("secret_path", relativePath, `references ${needle}`));
      break;
    }
  }
  if (
    /curl\s*\|\s*(?:sh|bash)\b/i.test(text) ||
    /\biex\b/i.test(text) ||
    /\bInvoke-Expression\b/i.test(text) ||
    /\bprintenv\b/i.test(text) ||
    /\/proc\/self\/environ/.test(text) ||
    /\bos\.environ\b/.test(text) ||
    /\bexfiltrat(?:e|ing|ion)\b/i.test(text) ||
    /^.*process\.env.*\b(?:curl|wget|nc|Invoke-WebRequest)\b.*$/im.test(text) ||
    /^.*\b(?:curl|wget|nc|Invoke-WebRequest)\b.*process\.env.*$/im.test(text) ||
    /\bcurl\s+https?:\/\//i.test(text) ||
    /\bwget\s+https?:\/\//i.test(text)
  ) {
    findings.push(finding("exfiltration", relativePath, "instruction exfiltrates env vars or secrets"));
  }
  if (
    /--no-verify/i.test(text) ||
    /\bskipTests\b/.test(text) ||
    /\bskip[_-]tests\b/i.test(text) ||
    /ignore\s+previous\s+instructions/i.test(text) ||
    /disable\s+the\s+sandbox/i.test(text) ||
    /bypass\s+verification/i.test(text)
  ) {
    findings.push(
      finding(
        "verification_weaken",
        relativePath,
        "instruction weakens sandbox, verification, or test gates",
      ),
    );
  }
  return findings;
}

export function mentionsSshLure(text: string): boolean {
  const homeSsh = `${"~/."}ssh`;
  return text.includes(homeSsh) || text.includes(".ssh/id_");
}

export function isOutOfScopeTestEdit(relativePath: string): boolean {
  const posix = relativePath.replaceAll("\\", "/");
  if (posix.split("/").includes("tests")) return true;
  return /(?:^|\/)[^/]*\.test\.[a-z0-9]+$/i.test(posix);
}
