import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const binDir = path.dirname(fileURLToPath(import.meta.url));
const resourcesRoot = path.dirname(binDir);

function digestFile(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function integrityPercent() {
  const manifestPath = path.join(resourcesRoot, "integrity-manifest.json");
  if (!fs.existsSync(manifestPath)) return 0;
  const envelope = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const files = envelope.manifest?.files ?? [];
  let matched = 0;
  for (const entry of files) {
    const full = path.join(resourcesRoot, entry.path);
    if (fs.existsSync(full) && digestFile(full) === entry.sha256) matched += 1;
  }
  return files.length ? Math.round((matched / files.length) * 100) : 100;
}

function selfCheck() {
  const required = [
    "wasm/tree-sitter-typescript.wasm",
    "wasm/z3.wasm",
    "corpus/questions.json",
    "office/atlas.json",
    "bin/gitleaks.exe",
    "bin/mingit/cmd/git.cmd",
  ];
  const missing = required.filter((rel) => !fs.existsSync(path.join(resourcesRoot, rel)));
  return { ok: missing.length === 0, missing };
}

const percent = integrityPercent();
const check = selfCheck();
console.log(
  JSON.stringify({
    event: "harnessd_ready",
    integrityPercent: percent,
    selfCheck: check.ok,
    pid: process.pid,
  }),
);
if (!check.ok || percent < 100) {
  process.exit(2);
}
if (process.env.EF_HARNESS_SMOKE_IDLE === "1") {
  process.exit(0);
}