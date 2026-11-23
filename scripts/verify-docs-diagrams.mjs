import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { checkoutRoot, forbiddenSnippets, secretNeedles } from "./harmony-lib.mjs";

export function defaultRoot() {
  return checkoutRoot();
}

/** @typedef {{ file: string, line: number, message: string }} ParityIssue */

/**
 * @param {string} root
 * @returns {string[]}
 */
function individualMmdFiles(root) {
  return fs
    .readdirSync(root)
    .filter((name) => name.endsWith(".mmd") && name !== "ef-harness-complete.mmd")
    .sort();
}

/**
 * @param {string} content
 * @returns {string | undefined}
 */
function stripMermaidFrontmatter(content) {
  const trimmed = content.replace(/^\uFEFF/, "").trim();
  if (!trimmed.startsWith("---")) return trimmed;
  const end = trimmed.indexOf("---", 3);
  if (end < 0) return trimmed;
  return trimmed.slice(end + 3).trim();
}

function mermaidSyntaxError(content) {
  const trimmed = stripMermaidFrontmatter(content);
  if (!trimmed) return "empty diagram";
  const head = trimmed.split(/\r?\n/).find((line) => line.trim() && !line.trim().startsWith("%%"));
  if (!head) return "no diagram header";
  if (!/^(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram|erDiagram)\b/i.test(head.trim())) {
    return `unsupported or missing diagram type: ${head.trim().slice(0, 60)}`;
  }
  return undefined;
}

/**
 * @param {string} root
 * @returns {{ ok: boolean, issues: ParityIssue[] }}
 */
export function verifyDiagramSync(root = defaultRoot()) {
  const issues = /** @type {ParityIssue[]} */ ([]);
  const merged = path.join(root, "ef-harness-complete.mmd");
  const mergedBefore = fs.readFileSync(merged);

  const merge = spawnSync(process.execPath, ["tools/merge-diagrams.js"], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
  });
  if (merge.status !== 0) {
    issues.push({
      file: "tools/merge-diagrams.js",
      line: 1,
      message: (merge.stderr || merge.stdout || "merge-diagrams.js failed").trim(),
    });
    return { ok: false, issues };
  }

  const mergedAfter = fs.readFileSync(merged);
  if (!mergedBefore.equals(mergedAfter)) {
    fs.writeFileSync(merged, mergedBefore);
    issues.push({
      file: "ef-harness-complete.mmd",
      line: 1,
      message: "ef-harness-complete.mmd is out of date — run node tools/merge-diagrams.js",
    });
  }

  const svgMaster = path.join(root, "ef-harness-complete.svg");
  if (!fs.existsSync(svgMaster) || fs.statSync(svgMaster).size < 32) {
    issues.push({
      file: "ef-harness-complete.svg",
      line: 1,
      message: "missing or empty ef-harness-complete.svg sibling",
    });
  }

  for (const base of individualMmdFiles(root)) {
    const mmdPath = path.join(root, base);
    const svgPath = path.join(root, base.replace(/\.mmd$/, ".svg"));
    const rel = base;
    const text = fs.readFileSync(mmdPath, "utf8");
    const syntax = mermaidSyntaxError(text);
    if (syntax) {
      issues.push({ file: rel, line: 1, message: `Mermaid syntax: ${syntax}` });
    }
    if (!fs.existsSync(svgPath)) {
      issues.push({ file: rel, line: 1, message: `missing rendered sibling ${path.basename(svgPath)}` });
      continue;
    }
    const svg = fs.readFileSync(svgPath, "utf8");
    if (!/<svg[\s>]/i.test(svg)) {
      issues.push({ file: path.basename(svgPath), line: 1, message: "SVG does not contain an <svg> root" });
    }
  }

  const syntaxMaster = mermaidSyntaxError(fs.readFileSync(merged, "utf8"));
  if (syntaxMaster) {
    issues.push({ file: "ef-harness-complete.mmd", line: 1, message: `Mermaid syntax: ${syntaxMaster}` });
  }

  return { ok: issues.length === 0, issues };
}

/**
 * @param {string} root
 * @returns {string[]}
 */
function markdownScanRoots(root) {
  const files = [];
  for (const name of fs.readdirSync(root)) {
    if (name.endsWith(".md")) files.push(path.join(root, name));
  }
  files.push(path.join(root, "IMPLEMENTATION_TASKS.md"));
  const research = path.join(root, "research");
  if (fs.existsSync(research)) {
    for (const name of fs.readdirSync(research)) {
      if (name.endsWith(".md")) files.push(path.join(research, name));
    }
  }
  const skill = path.join(root, "skills", "infer-or-ask", "SKILL.md");
  if (fs.existsSync(skill)) files.push(skill);
  return files.sort();
}

/**
 * @param {string} raw
 */
function stripLinkTarget(raw) {
  let target = raw.trim();
  if (!target) return "";
  if (target.startsWith("<") && target.endsWith(">")) target = target.slice(1, -1);
  const titleSplit = target.split(/\s+/);
  return titleSplit[0] ?? "";
}

/**
 * @param {string} root
 * @returns {{ ok: boolean, issues: ParityIssue[] }}
 */
function lineWithoutCode(line) {
  return line.replace(/`[^`]*`/g, "").replace(/``[^`]*``/g, "");
}

export function verifyMarkdownLinks(root = defaultRoot()) {
  const issues = /** @type {ParityIssue[]} */ ([]);
  const linkRe = /!?\[[^\]]*]\(([^)]+)\)/g;
  const angleLinkRe = /<a\s+[^>]*href=["']([^"']+)["']/gi;

  for (const file of markdownScanRoots(root)) {
    if (!fs.existsSync(file)) continue;
    const rel = path.relative(root, file).replaceAll("\\", "/");
    const raw = fs.readFileSync(file, "utf8");
    const stripped = raw.replace(/```[\s\S]*?```/g, (block) => block.replace(/[^\n]/g, " "));
    const lines = stripped.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      const line = lineWithoutCode(lines[i] ?? "");
      for (const re of [linkRe, angleLinkRe]) {
        re.lastIndex = 0;
        let match = re.exec(line);
        while (match) {
          const target = stripLinkTarget(match[1] ?? "");
          if (
            !target ||
            target.startsWith("#") ||
            /^[a-z][a-z0-9+.-]*:/i.test(target) ||
            target.startsWith("data:")
          ) {
            match = re.exec(line);
            continue;
          }
          const decoded = decodeURIComponent(target.split("#")[0] ?? "");
          const resolved = path.resolve(path.dirname(file), decoded);
          if (!fs.existsSync(resolved)) {
            issues.push({
              file: rel,
              line: i + 1,
              message: `broken link target "${target}"`,
            });
          }
          match = re.exec(line);
        }
      }
    }
  }
  return { ok: issues.length === 0, issues };
}

/**
 * @param {string} sql
 */
function ddlObjects(sql) {
  /** @type {Map<string, Set<string>>} */
  const tables = new Map();
  const body = sql.replace(/--.*$/gm, "");
  const createRe = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["`]?([a-zA-Z0-9_]+)["`]?\s*\(([^;]+)\)/gis;
  let match = createRe.exec(body);
  while (match) {
    const name = match[1] ?? "";
    const cols = new Set();
    for (const row of (match[2] ?? "").split(",")) {
      const col = /^\s*["`]?([a-zA-Z0-9_]+)["`]?/.exec(row.trim());
      if (col?.[1] && !/^(PRIMARY|UNIQUE|FOREIGN|CHECK|CONSTRAINT)\b/i.test(col[1])) {
        cols.add(col[1]);
      }
    }
    tables.set(name, cols);
    match = createRe.exec(body);
  }
  return tables;
}

/**
 * @param {string} root
 * @returns {{ ok: boolean, issues: ParityIssue[] }}
 */
export function verifySchemaParity(root = defaultRoot()) {
  const issues = /** @type {ParityIssue[]} */ ([]);
  const result = spawnSync(process.execPath, ["schema/schema-test.js"], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
  });
  const combined = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  if (result.status !== 0 || !/67\/67 passed/.test(combined)) {
    issues.push({
      file: "schema/schema-test.js",
      line: 1,
      message: "schema-test.js did not report 67/67 passed",
    });
  }

  const schemaDir = path.join(root, "schema");
  /** @type {Map<string, Set<string>>} */
  const schemaTables = new Map();
  for (const file of ["state.sql", "global.sql", "telemetry.sql", "code-index.sql"]) {
    const full = path.join(schemaDir, file);
    if (!fs.existsSync(full)) {
      issues.push({ file: `schema/${file}`, line: 1, message: "missing schema file" });
      continue;
    }
    for (const [table, cols] of ddlObjects(fs.readFileSync(full, "utf8"))) {
      schemaTables.set(table, cols);
    }
  }

  const migrationRoot = path.join(root, "packages", "kernel", "src", "migrations");
  if (fs.existsSync(migrationRoot)) {
    /** @type {Map<string, Set<string>>} */
    const migrationTables = new Map();
    for (const name of fs.readdirSync(migrationRoot)) {
      if (!name.endsWith(".sql")) continue;
      const full = path.join(migrationRoot, name);
      for (const [table, cols] of ddlObjects(fs.readFileSync(full, "utf8"))) {
        migrationTables.set(table, cols);
      }
    }
    for (const [table, cols] of schemaTables) {
      const migCols = migrationTables.get(table);
      if (!migCols) {
        issues.push({
          file: `schema/*.sql`,
          line: 1,
          message: `table "${table}" in schema SQL has no matching CREATE in packages/kernel/src/migrations`,
        });
        continue;
      }
      for (const col of cols) {
        if (!migCols.has(col)) {
          issues.push({
            file: `packages/kernel/src/migrations`,
            line: 1,
            message: `column "${table}.${col}" missing from runtime migrations`,
          });
        }
      }
    }
  }

  return { ok: issues.length === 0, issues };
}

/**
 * @param {string} md
 */
function promptContractsFromDoc(md) {
  const names = new Set();
  for (const match of md.matchAll(/`([a-z][a-z0-9-]*@1)`/g)) {
    names.add(match[1] ?? "");
  }
  for (const match of md.matchAll(/^#{2,3}\s+`?([a-z][a-z0-9-]*@1)`?/gm)) {
    names.add(match[1] ?? "");
  }
  return [...names].sort();
}

/**
 * @param {string} root
 * @returns {{ ok: boolean, issues: ParityIssue[] }}
 */
export function verifyContractParity(root = defaultRoot()) {
  const issues = /** @type {ParityIssue[]} */ ([]);
  const contractsMd = fs.readFileSync(path.join(root, "prompt-contracts.md"), "utf8");
  const docContracts = promptContractsFromDoc(contractsMd);
  if (docContracts.length !== 32) {
    issues.push({
      file: "prompt-contracts.md",
      line: 1,
      message: `expected 32 prompt contracts in docs, found ${docContracts.length}`,
    });
  }

  const promptsDir = path.join(root, "packages", "contracts", "src", "prompts");
  if (fs.existsSync(promptsDir)) {
    const runtime = fs
      .readdirSync(promptsDir)
      .filter((f) => f.endsWith(".json") || f.endsWith(".ts"))
      .map((f) => f.replace(/\.(json|ts)$/, "").replace(/\.v1$/, "@1").replace(/-/g, (m, i) => (i > 0 ? "-" : m)))
      .sort();
    const normalized = fs.readdirSync(promptsDir).map((file) => {
      if (file.endsWith("@1.json")) return file.slice(0, -".json".length);
      if (file.endsWith(".v1.json")) return `${file.slice(0, -".v1.json".length)}@1`;
      if (file.endsWith(".ts")) return null;
      return file;
    }).filter(Boolean);
    const runtimeSet = new Set(
      fs
        .readdirSync(promptsDir)
        .filter((f) => f.endsWith(".json"))
        .map((f) => (f.endsWith(".v1.json") ? `${f.slice(0, -".v1.json".length)}@1` : f.replace(/\.json$/, ""))),
    );
    for (const name of docContracts) {
      const stem = name.replace("@1", "");
      const candidates = [`${name}.json`, `${stem}.v1.json`, `${stem}@1.json`];
      if (!candidates.some((c) => fs.existsSync(path.join(promptsDir, c))) && !runtimeSet.has(name)) {
        issues.push({
          file: "packages/contracts/src/prompts",
          line: 1,
          message: `missing runtime prompt contract file for ${name}`,
        });
      }
    }
    for (const file of fs.readdirSync(promptsDir)) {
      if (!file.endsWith(".json")) continue;
      const id = file.endsWith(".v1.json") ? `${file.slice(0, -".v1.json".length)}@1` : file.replace(/\.json$/, "");
      if (!docContracts.includes(id) && !id.endsWith("@1")) {
        issues.push({
          file: `packages/contracts/src/prompts/${file}`,
          line: 1,
          message: `runtime prompt ${id} is not documented in prompt-contracts.md`,
        });
      }
    }
    void runtime;
    void normalized;
  }

  const corpusPath = path.join(root, "v1-knowledge-corpus.md");
  const corpus = fs.readFileSync(corpusPath, "utf8");
  const touches = corpus.match(/`([a-z][a-z0-9_]*(?:_[a-z0-9_]*)*)`/g) ?? [];
  const touchTags = touches
    .map((t) => t.slice(1, -1))
    .filter((t) => t.includes("_") && !t.startsWith("UP-") && !t.startsWith("X-") && !t.includes("."));
  const uniqueTouches = new Set(touchTags);
  const listedTouches = [
    "personal_data", "credentials", "money", "user_content", "authn", "authz", "session", "scheduling",
    "time_display", "file_upload", "file_download", "external_api", "inbound_webhook", "outbound_message",
    "background_job", "realtime", "destructive_write", "bulk_write", "migration", "search", "form_input",
    "route", "interactive_ui", "logging", "config_env", "caching", "rate_limited", "concurrent_edit",
  ];
  for (const tag of listedTouches) {
    if (!uniqueTouches.has(tag) && !corpus.includes(`\`${tag}\``)) {
      issues.push({ file: "v1-knowledge-corpus.md", line: 1, message: `missing touches tag ${tag} in corpus doc` });
    }
  }
  if (listedTouches.length !== 28) {
    issues.push({ file: "v1-knowledge-corpus.md", line: 1, message: "internal touches list must contain 28 tags" });
  }

  const xSection = corpus.match(/## Cross-cutting rules for v1[\s\S]*?(?=\n## |\n$)/)?.[0] ?? "";
  const xRules = [...xSection.matchAll(/\|\s*(X-\d{2})\s*\|/g)].map((m) => m[1]);
  if (xRules.length !== 14) {
    issues.push({
      file: "v1-knowledge-corpus.md",
      line: 1,
      message: `expected 14 cross-cutting rules X-01–X-14, found ${xRules.length}`,
    });
  }
  const upSection = corpus.match(/### Universal policies[\s\S]*?(?=\n## |\n$)/)?.[0] ?? "";
  const upRules = [...upSection.matchAll(/\|\s*(UP-\d{2})\s*\|/g)].map((m) => m[1]);
  if (upRules.length !== 8) {
    issues.push({
      file: "v1-knowledge-corpus.md",
      line: 1,
      message: `expected 8 universal policies UP-01–UP-08, found ${upRules.length}`,
    });
  }

  const vocabDir = path.join(root, "packages", "contracts", "src", "vocab");
  if (fs.existsSync(vocabDir)) {
    const readJson = (name) => {
      const full = path.join(vocabDir, name);
      return fs.existsSync(full) ? JSON.parse(fs.readFileSync(full, "utf8")) : null;
    };
    const touchesJson = readJson("touches.json");
    if (touchesJson && Array.isArray(touchesJson.tags) && touchesJson.tags.length !== 28) {
      issues.push({
        file: "packages/contracts/src/vocab/touches.json",
        line: 1,
        message: `expected 28 touches tags in runtime vocab, found ${touchesJson.tags.length}`,
      });
    }
  }

  const canonicalSkill = path.join(root, "skills", "infer-or-ask", "SKILL.md");
  const bundledSkill = path.join(root, "corpus", "skills", "m2", "infer-or-ask", "SKILL.md");
  if (fs.existsSync(bundledSkill)) {
    const left = fs.readFileSync(canonicalSkill);
    const right = fs.readFileSync(bundledSkill);
    if (!left.equals(right)) {
      issues.push({
        file: "corpus/skills/m2/infer-or-ask/SKILL.md",
        line: 1,
        message: "bundled infer-or-ask skill is not byte-identical to skills/infer-or-ask/SKILL.md",
      });
    }
  }

  return { ok: issues.length === 0, issues };
}

/**
 * @param {string} root
 * @returns {{ ok: boolean, issues: ParityIssue[] }}
 */
export function verifyBenchmarkManifest(root = defaultRoot()) {
  const issues = /** @type {ParityIssue[]} */ ([]);
  const manifestPath = path.join(root, "resume-changer-benchmark.json");
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch (error) {
    issues.push({
      file: "resume-changer-benchmark.json",
      line: 1,
      message: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, issues };
  }
  if (manifest.commit !== "497831ec5aa7effb354bb1a8d22d2f031b17a4e0") {
    issues.push({
      file: "resume-changer-benchmark.json",
      line: 1,
      message: "commit pin does not match Task 175 / Task 189 constant",
    });
  }
  const summary = manifest.summary ?? {};
  if (summary.markdown_files !== 73 || summary.plan_or_task_files !== 17 || summary.plan_or_task_lines !== 4906) {
    issues.push({
      file: "resume-changer-benchmark.json",
      line: 1,
      message: "summary counts must be 73 docs, 17 plan files, 4906 lines",
    });
  }
  return { ok: issues.length === 0, issues };
}

const POLICY_GLOBS = ["packages", "apps"];

/**
 * @param {string} root
 * @returns {{ ok: boolean, issues: ParityIssue[] }}
 */
export function verifyOwnerDecisionPolicy(root = defaultRoot()) {
  const issues = /** @type {ParityIssue[]} */ ([]);
  const bannedProvider = ["anti", "gravity"].join("");
  const needles = [...forbiddenSnippets(), ...secretNeedles(), bannedProvider];

  /**
   * @param {string} dir
   */
  function walkCode(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name === "coverage") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walkCode(full);
      } else if (entry.isFile() && /\.(ts|tsx|js|mjs|cjs|json|md)$/.test(entry.name)) {
        const rel = path.relative(root, full).replaceAll("\\", "/");
        const text = fs.readFileSync(full, "utf8");
        for (const needle of needles) {
          if (needle === bannedProvider && !/packages|apps/.test(rel)) continue;
          if (text.toLowerCase().includes(needle.toLowerCase())) {
            const line = text.split(/\r?\n/).findIndex((l) => l.toLowerCase().includes(needle.toLowerCase())) + 1;
            issues.push({
              file: rel,
              line: Math.max(line, 1),
              message: `forbidden policy pattern "${needle}"`,
            });
          }
        }
      }
    }
  }

  for (const dir of POLICY_GLOBS) {
    walkCode(path.join(root, dir));
  }
  return { ok: issues.length === 0, issues };
}

export const CHECKS = {
  diagram: verifyDiagramSync,
  links: verifyMarkdownLinks,
  schema: verifySchemaParity,
  contract: verifyContractParity,
  benchmark: verifyBenchmarkManifest,
  policy: verifyOwnerDecisionPolicy,
};

/**
 * @param {string} [root]
 * @param {{ only?: string[] }} [options]
 */
export function runAllChecks(root = defaultRoot(), options = {}) {
  const selected = options.only ?? Object.keys(CHECKS);
  /** @type {ParityIssue[]} */
  const issues = [];
  for (const name of selected) {
    const fn = CHECKS[name];
    if (!fn) continue;
  const result = fn(root);
    if (!result.ok) issues.push(...result.issues.map((i) => ({ ...i, message: `[${name}] ${i.message}` })));
  }
  return { ok: issues.length === 0, issues };
}

/**
 * @param {ParityIssue[]} issues
 */
export function formatIssues(issues) {
  return issues.map((i) => `${i.file}:${i.line}: ${i.message}`).join("\n");
}

function parseCli(argv) {
  let root = defaultRoot();
  /** @type {string[] | undefined} */
  let only;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--root" && argv[i + 1]) {
      root = path.resolve(argv[i + 1]);
      i += 1;
    } else if (arg === "--check" && argv[i + 1]) {
      only = [argv[i + 1]];
      i += 1;
    }
  }
  return { root, only };
}

export async function main(argv = process.argv.slice(2)) {
  const started = performance.now();
  const { root, only } = parseCli(argv);
  const result = runAllChecks(root, { only });
  if (!result.ok) {
    process.stderr.write(`${formatIssues(result.issues)}\n`);
    process.exit(1);
  }
  const elapsed = ((performance.now() - started) / 1000).toFixed(2);
  process.stdout.write(`docs-diagram-schema parity ok (${elapsed}s)\n`);
}

const invoked = process.argv[1] ? path.resolve(process.argv[1]) : "";
const isCli = invoked.endsWith("verify-docs-diagrams.mjs");
if (isCli) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}