import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { SkillManifestError, type SkillFile } from "./model.js";

const QUARANTINE_REPORT = "quarantine-report.json";

export function readSkillDirectory(directory: string): SkillFile[] {
  if (!fs.existsSync(directory)) {
    throw new SkillManifestError(`skill directory is missing: ${directory}`);
  }
  const files: SkillFile[] = [];
  const walk = (current: string, prefix: string): void => {
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const relativePath = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(absolute, relativePath);
      } else if (entry.isFile()) {
        files.push({
          relativePath: relativePath.replaceAll("\\", "/"),
          bytes: fs.readFileSync(absolute),
        });
      }
    }
  };
  walk(directory, "");
  files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  return files;
}

export function skillMarkdown(files: readonly SkillFile[]): string {
  const file = files.find((entry) => entry.relativePath === "SKILL.md");
  if (file === undefined) {
    throw new SkillManifestError("skill directory is missing SKILL.md");
  }
  return decodePayload(file.bytes, "SKILL.md");
}

export function promptInjectedText(files: readonly SkillFile[]): string {
  const text = skillMarkdown(files);
  const extras: string[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
    const target = match[1];
    if (target === undefined || target.includes("://") || target.startsWith("#")) continue;
    const relativePath = target.replace(/^\.\//, "");
    if (!relativePath.endsWith(".md") || relativePath.split("/").includes("..")) continue;
    if (seen.has(relativePath)) continue;
    seen.add(relativePath);
    const snippet = files.find((entry) => entry.relativePath === relativePath);
    if (snippet === undefined) {
      throw new SkillManifestError(`missing referenced snippet ${relativePath}`);
    }
    extras.push(decodePayload(snippet.bytes, relativePath));
  }
  if (extras.length === 0) return text;
  return `${text}\n${extras.join("\n")}`;
}

export function hashSkillPayload(files: readonly SkillFile[]): string {
  const hashed = files
    .filter((file) => file.relativePath !== QUARANTINE_REPORT)
    .slice()
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  const hash = createHash("sha256");
  for (const file of hashed) {
    hash.update(file.relativePath, "utf8");
    hash.update("\0");
    hash.update(file.bytes);
    hash.update("\0");
  }
  return hash.digest("hex");
}

export function gitBlobSha1(bytes: Uint8Array): string {
  const header = Buffer.from(`blob ${bytes.byteLength}\0`, "utf8");
  return createHash("sha1").update(header).update(bytes).digest("hex");
}

export function skillMarkdownBytes(files: readonly SkillFile[]): Uint8Array {
  const file = files.find((entry) => entry.relativePath === "SKILL.md");
  if (file === undefined) {
    throw new SkillManifestError("skill directory is missing SKILL.md");
  }
  return file.bytes;
}

function decodePayload(bytes: Uint8Array, relativePath: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new SkillManifestError(`${relativePath} is not valid UTF-8`);
  }
}
