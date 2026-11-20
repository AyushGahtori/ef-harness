import fs from "node:fs";
import path from "node:path";
import { issue } from "./issues.js";
import { normalizeRepoPath } from "./paths.js";
import type {
  AnchorSubstitution,
  ArchIssue,
  FeatureInput,
  ObservedColumn,
  ObservedComponent,
  ObservedExport,
  ObservedReality,
  ObservedTable,
} from "./types.js";

const SKIP = new Set(["node_modules", "dist", ".git", "coverage"]);

export class ObservedCodeRealityAnchor {
  scan(root: string): { ok: true; reality: ObservedReality } | { ok: false; reason: string } {
    if (!root.trim() || !fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
      return { ok: false, reason: `integration root does not exist: ${root}` };
    }
    const absolute: string[] = [];
    walk(root, absolute);
    const files: string[] = [];
    const exports: ObservedExport[] = [];
    const tables: ObservedTable[] = [];
    const components: ObservedComponent[] = [];
    for (const full of absolute.sort()) {
      const rel = normalizeRepoPath(path.relative(root, full));
      files.push(rel);
      if (fs.statSync(full).size > 1_000_000) continue;
      const text = fs.readFileSync(full, "utf8");
      if (rel.endsWith(".ts") || rel.endsWith(".tsx")) {
        const found = parseExports(rel, text);
        exports.push(...found);
        if (isDesignPath(rel) && rel.endsWith(".tsx")) {
          for (const item of found) {
            if (item.kind === "value" && /^[A-Z]/.test(item.name)) {
              components.push({ name: item.name, file: rel });
            }
          }
        }
      } else if (rel.endsWith(".sql")) {
        tables.push(...parseTables(rel, text));
      }
    }
    files.sort();
    exports.sort((a, b) => a.file.localeCompare(b.file) || a.name.localeCompare(b.name));
    tables.sort((a, b) => a.name.localeCompare(b.name));
    components.sort((a, b) => a.name.localeCompare(b.name) || a.file.localeCompare(b.file));
    return { ok: true, reality: { root, files, exports, tables, components } };
  }

  bind(
    feature: FeatureInput,
    reality: ObservedReality,
  ): { feature: FeatureInput; substitutions: AnchorSubstitution[]; issues: ArchIssue[] } {
    const issues: ArchIssue[] = [];
    const substitutions: AnchorSubstitution[] = [];
    let writePaths = feature.writePaths.map((item) => normalizeRepoPath(item));
    for (const ref of feature.references) {
      if (ref.kind === "export") {
        bindExport(feature.id, ref.staleName, ref.file, reality, substitutions, issues);
      } else if (ref.kind === "module") {
        writePaths = bindModule(
          feature.id,
          ref.staleName,
          ref.file,
          writePaths,
          reality,
          substitutions,
          issues,
        );
      } else if (ref.kind === "component") {
        bindComponent(feature.id, ref.staleName, ref.file, reality, substitutions, issues);
      } else {
        bindColumn(feature.id, ref.staleName, ref.table, reality, issues);
      }
    }
    return { feature: { ...feature, writePaths }, substitutions, issues };
  }
}

function walk(dir: string, files: string[]): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else if (entry.isFile()) files.push(full);
  }
}

function isDesignPath(rel: string): boolean {
  return rel.includes("/components/") || rel.includes("/design-system/") || rel.includes("/ui/");
}

function parseExports(file: string, text: string): ObservedExport[] {
  const found: ObservedExport[] = [];
  const decl =
    /^export\s+(?:declare\s+)?(?:async\s+)?(function|class|const|let|var|type|interface|enum)\s+([A-Za-z_$][\w$]*)/;
  const list = /^export\s+(type\s+)?\{([^}]+)\}/;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const named = decl.exec(line);
    if (named) {
      const keyword = named[1] ?? "";
      const name = named[2] ?? "";
      if (!name) continue;
      found.push({
        file,
        name,
        signature: line.replace(/\s*\{\s*$/, ""),
        kind: keyword === "type" || keyword === "interface" ? "type" : "value",
      });
      continue;
    }
    const grouped = list.exec(line);
    if (!grouped) continue;
    const typeOnly = Boolean(grouped[1]);
    for (const part of (grouped[2] ?? "").split(",")) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      const alias = /^(?:[A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/.exec(trimmed);
      const plain = /^[A-Za-z_$][\w$]*$/.exec(trimmed);
      const name = alias?.[1] ?? plain?.[0] ?? "";
      if (!name) continue;
      found.push({
        file,
        name,
        signature: line,
        kind: typeOnly ? "type" : "value",
      });
    }
  }
  return found;
}

function parseTables(file: string, text: string): ObservedTable[] {
  const tables: ObservedTable[] = [];
  const re = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["'`]?([A-Za-z_][\w]*)["'`]?/gi;
  for (const match of text.matchAll(re)) {
    const name = match[1];
    const start = (match.index ?? 0) + match[0].length;
    const open = text.indexOf("(", start);
    if (!name || open < 0) continue;
    const body = readParen(text, open);
    if (body === null) continue;
    tables.push({ name, file, columns: parseColumns(body) });
  }
  return tables;
}

function readParen(text: string, open: number): string | null {
  let depth = 0;
  for (let index = open; index < text.length; index += 1) {
    const char = text[index];
    if (char === "(") depth += 1;
    else if (char === ")") {
      depth -= 1;
      if (depth === 0) return text.slice(open + 1, index);
    }
  }
  return null;
}

function parseColumns(body: string): ObservedColumn[] {
  const columns: ObservedColumn[] = [];
  for (const part of splitComma(body)) {
    const line = part.trim();
    if (!line) continue;
    const tokens = line.split(/\s+/);
    const first = tokens[0]?.replace(/["'`]/g, "") ?? "";
    if (!first || /^(PRIMARY|CONSTRAINT|UNIQUE|CHECK|FOREIGN|KEY)$/i.test(first)) continue;
    const type = (tokens[1] ?? "UNKNOWN").replace(/,$/, "");
    const nullable = !/\bNOT\s+NULL\b/i.test(line) && !/\bPRIMARY\s+KEY\b/i.test(line);
    columns.push({ name: first, type, nullable });
  }
  return columns;
}

function splitComma(body: string): string[] {
  const parts: string[] = [];
  let current = "";
  let depth = 0;
  for (const char of body) {
    if (char === "(") depth += 1;
    if (char === ")" && depth > 0) depth -= 1;
    if (char === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  if (current.trim()) parts.push(current);
  return parts;
}

function bindExport(
  featureId: string,
  staleName: string,
  file: string | undefined,
  reality: ObservedReality,
  substitutions: AnchorSubstitution[],
  issues: ArchIssue[],
): void {
  const pool = poolFor(reality, file);
  if (pool.some((item) => item.name === staleName)) return;
  const values = pool.filter((item) => item.kind === "value");
  const only = file && values.length === 1 ? values[0] : undefined;
  if (only) {
    substitutions.push({
      featureId,
      kind: "export",
      staleName,
      actualName: only.name,
      file: only.file,
    });
    return;
  }
  const actuals = pool.map((item) => item.name).join(", ") || "none";
  issues.push(
    issue("phantom_export", `Export ${staleName} is not in the merged tree. Actual exports: ${actuals}.`, {
      featureId,
    }),
  );
}

function bindModule(
  featureId: string,
  staleName: string,
  file: string | undefined,
  writePaths: string[],
  reality: ObservedReality,
  substitutions: AnchorSubstitution[],
  issues: ArchIssue[],
): string[] {
  const actual = file ? normalizeRepoPath(file) : "";
  if (!actual || !reality.files.includes(actual)) {
    issues.push(issue("phantom_module", `Module ${staleName} is not in the merged tree.`, { featureId }));
    return writePaths;
  }
  substitutions.push({
    featureId,
    kind: "module",
    staleName: normalizeRepoPath(staleName),
    actualName: actual,
    file: actual,
  });
  return writePaths.map((item) => (samePath(item, staleName) ? actual : item));
}

function bindComponent(
  featureId: string,
  staleName: string,
  file: string | undefined,
  reality: ObservedReality,
  substitutions: AnchorSubstitution[],
  issues: ArchIssue[],
): void {
  if (reality.components.some((item) => item.name === staleName)) return;
  const wanted = file ? normalizeRepoPath(file) : undefined;
  const inFile = reality.components.filter((item) => wanted === undefined || item.file === wanted);
  const only = file && inFile.length === 1 ? inFile[0] : undefined;
  if (only) {
    substitutions.push({
      featureId,
      kind: "component",
      staleName,
      actualName: only.name,
      file: only.file,
    });
    return;
  }
  const actuals = reality.components.map((item) => item.name).join(", ") || "none";
  issues.push(
    issue(
      "phantom_component",
      `Component ${staleName} is not in the merged design system. Actual components: ${actuals}.`,
      { featureId },
    ),
  );
}

function bindColumn(
  featureId: string,
  staleName: string,
  tableName: string | undefined,
  reality: ObservedReality,
  issues: ArchIssue[],
): void {
  const table = reality.tables.find((item) => item.name === tableName);
  if (!table) {
    issues.push(
      issue("phantom_table", `Table ${tableName ?? "(missing)"} is not in the merged schema.`, { featureId }),
    );
    return;
  }
  if (table.columns.some((column) => column.name === staleName)) return;
  const actuals = table.columns.map((column) => column.name).join(", ") || "none";
  issues.push(
    issue(
      "phantom_column",
      `Column ${table.name}.${staleName} is not in the merged schema. Actual columns: ${actuals}.`,
      { featureId },
    ),
  );
}

function poolFor(reality: ObservedReality, file: string | undefined): ObservedExport[] {
  const wanted = file ? normalizeRepoPath(file) : undefined;
  return reality.exports.filter((item) => wanted === undefined || item.file === wanted);
}

function samePath(left: string, right: string): boolean {
  return normalizeRepoPath(left).toLowerCase() === normalizeRepoPath(right).toLowerCase();
}
