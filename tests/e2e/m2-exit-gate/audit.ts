import fs from "node:fs";
import path from "node:path";

export function secretNeedles(): string[] {
  return [
    ["sk", "_live_"].join(""),
    ["sk-ant", "-"].join(""),
    ["sk-proj", "-"].join(""),
    ["ghp", "_"].join(""),
    ["AK", "IA"].join(""),
    ["BEGIN ", "PRIVATE KEY"].join(""),
  ];
}

export function secretFindings(text: string): string[] {
  return secretNeedles().filter((needle) => text.includes(needle));
}

function walkFiles(dir: string, out: string[]): void {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(full, out);
    else out.push(full);
  }
}

export function scanTreeForSecrets(dir: string): number {
  const files: string[] = [];
  walkFiles(dir, files);
  let found = 0;
  for (const file of files) {
    if (/\.(png|db|db-wal|db-shm)$/.test(file)) continue;
    const text = fs.readFileSync(file, "utf8");
    found += secretFindings(text).length;
  }
  return found;
}

export function staticAuditFailures(dir: string): number {
  const files: string[] = [];
  walkFiles(dir, files);
  let failures = 0;
  for (const file of files) {
    if (!/\.(mjs|js|css|html|json|md)$/.test(file)) continue;
    const text = fs.readFileSync(file, "utf8");
    if (/\beval\s*\(/.test(text) || /\bnew\s+Function\s*\(/.test(text)) failures += 1;
    failures += secretFindings(text).length;
  }
  const manifestPath = path.join(dir, "bundle-manifest.json");
  if (fs.existsSync(manifestPath)) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as { production?: string[] };
    if ((manifest.production ?? []).some((item) => item.toLowerCase().includes("styleguide"))) failures += 1;
  }
  return failures;
}

const RAW_COLOR = /#[0-9a-fA-F]{3,8}\b|\brgba?\s*\(/;

export function designTokenLint(dir: string): string[] {
  const files: string[] = [];
  walkFiles(dir, files);
  const failures: string[] = [];
  for (const file of files) {
    if (!/\.(css|html|js|mjs)$/.test(file)) continue;
    if (file.endsWith(`${path.sep}tokens.css`)) continue;
    const text = fs.readFileSync(file, "utf8");
    if (RAW_COLOR.test(text)) failures.push(path.relative(dir, file).replaceAll("\\", "/"));
  }
  return failures;
}

export function productionBundleClean(dir: string): boolean {
  const manifestPath = path.join(dir, "bundle-manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as { production: string[] };
  if (manifest.production.some((item) => item.toLowerCase().includes("styleguide"))) return false;
  const files: string[] = [];
  walkFiles(dir, files);
  return !files.some((file) => path.basename(file).toLowerCase().includes("styleguide"));
}
