import { makeFinding } from "./findings.js";
import { isGeneratedOrSeed, lineSnippet, normalizePath } from "./path-match.js";
import type {
  ProducedContract,
  SchemaFieldPlan,
  StaticAuditFinding,
  WorkspaceFile,
} from "./types.js";

export interface ReachabilityOptions {
  readonly level: "leaf" | "feature";
  readonly featureClosed: boolean;
  readonly produces: readonly ProducedContract[];
  readonly schemaFields: readonly SchemaFieldPlan[];
  readonly entryPoints: readonly string[];
  readonly generated: readonly string[];
  readonly seeds: readonly string[];
  /** Files whose exports are in scope for dead-code (changed files, or the whole feature). */
  readonly exportRoots: readonly string[];
}

interface ModuleExport {
  readonly name: string;
  readonly line: number;
}

export function scanReachability(
  corpus: readonly WorkspaceFile[],
  options: ReachabilityOptions,
): StaticAuditFinding[] {
  const files = corpus
    .map((file) => ({ path: normalizePath(file.path), content: file.content }))
    .filter((file) => !isGeneratedOrSeed(file.path, options.generated, options.seeds));
  const known = new Set(files.map((file) => file.path));
  const exportsByFile = new Map<string, ModuleExport[]>();
  const consumed = new Map<string, Set<string>>();

  for (const file of files) {
    exportsByFile.set(file.path, collectExports(file.content));
  }
  for (const file of files) {
    for (const spec of collectImports(file.content)) {
      const resolved = resolveSpecifier(file.path, spec.specifier, known);
      if (!resolved) continue;
      const bucket = consumed.get(resolved) ?? new Set<string>();
      if (spec.namespace) {
        for (const item of exportsByFile.get(resolved) ?? []) bucket.add(item.name);
      }
      for (const name of spec.names) bucket.add(name);
      if (spec.defaultImport) bucket.add("default");
      consumed.set(resolved, bucket);
    }
  }

  const entries = new Set(options.entryPoints.map(normalizePath));
  for (const file of files) {
    if (isDefaultEntry(file.path)) entries.add(file.path);
  }

  const findings: StaticAuditFinding[] = [];
  const roots = new Set(options.exportRoots.map(normalizePath));
  for (const file of files) {
    if (roots.size > 0 && !roots.has(file.path)) continue;
    const exported = exportsByFile.get(file.path) ?? [];
    const used = consumed.get(file.path) ?? new Set<string>();
    const fileIsEntry = entries.has(file.path);
    let exemptExport = false;
    for (const item of exported) {
      const contract = options.produces.find(
        (produced) => produced.kind === "function" && produced.name === item.name,
      );
      const deferred =
        contract?.kind === "function" &&
        Boolean(contract.plannedConsumerTaskId) &&
        (options.level === "leaf" || !options.featureClosed);
      const reachable = fileIsEntry || used.has(item.name);
      if (deferred) exemptExport = true;
      if (!reachable && !deferred) {
        findings.push(
          makeFinding({
            ruleId: "check9.dead-export",
            file: file.path,
            line: item.line,
            column: 1,
            snippet: lineSnippet(file.content, item.line),
            message:
              options.level === "feature" && options.featureClosed
                ? `Export ${item.name} is still unused after all feature tasks merged.`
                : `Export ${item.name} is not reachable from an entry or a planned consumer.`,
            remediation:
              "Use the export from a planned consumer, or drop it. Leaf tasks may defer an export only when the plan names the consumer.",
          }),
        );
      }
    }
    if (!fileIsEntry && !exemptExport && exported.length > 0 && !isImported(file.path, files, known)) {
      findings.push(
        makeFinding({
          ruleId: "check9.unused-file",
          file: file.path,
          line: 1,
          column: 1,
          snippet: lineSnippet(file.content, 1),
          message: `File ${file.path} is not imported from any feature entry or consumer.`,
          remediation: "Import the module from an entry point or remove the unused file.",
        }),
      );
    }
  }

  findings.push(...missingContracts(files, options));
  findings.push(...unusedFields(files, options));
  return dedupe(findings);
}

function isImported(
  target: string,
  files: readonly { path: string; content: string }[],
  known: Set<string>,
): boolean {
  for (const file of files) {
    if (file.path === target) continue;
    for (const spec of collectImports(file.content)) {
      if (resolveSpecifier(file.path, spec.specifier, known) === target) return true;
    }
  }
  return false;
}

function missingContracts(
  files: readonly { path: string; content: string }[],
  options: ReachabilityOptions,
): StaticAuditFinding[] {
  const findings: StaticAuditFinding[] = [];
  const blob = files.map((file) => file.content).join("\n");
  const exportNames = new Set<string>();
  for (const file of files) {
    for (const item of collectExports(file.content)) exportNames.add(item.name);
  }
  for (const produced of options.produces) {
    if (produced.kind === "function" && !exportNames.has(produced.name)) {
      findings.push(
        missing(
          `Contract function ${produced.name} is not exported.`,
          "Export the function declared in the task produces contract.",
        ),
      );
    }
    if (produced.kind === "route" && !blob.includes(stripSlash(produced.name)) && !blob.includes(produced.name)) {
      findings.push(
        missing(
          `Contract route ${produced.name} is missing from the route surface.`,
          "Add the route to the route table or page surface.",
        ),
      );
    }
    if (produced.kind === "operation" && !blob.includes(produced.path)) {
      findings.push(
        missing(
          `Contract operation ${produced.method} ${produced.path} is missing.`,
          "Expose the OpenAPI operation path from the implementation.",
        ),
      );
    }
    if (produced.kind === "ui_aria" && !containsPhrase(blob, produced.name)) {
      findings.push(
        missing(
          `Contract UI name "${produced.name}" is missing from the screen.`,
          "Render the accessible name declared in the UI contract.",
        ),
      );
    }
  }
  return findings;
}

function unusedFields(
  files: readonly { path: string; content: string }[],
  options: ReachabilityOptions,
): StaticAuditFinding[] {
  const findings: StaticAuditFinding[] = [];
  for (const field of options.schemaFields) {
    const declaration = field.declarationFile ? normalizePath(field.declarationFile) : null;
    const readers = files.filter((file) => {
      if (declaration && file.path === declaration) return false;
      if (!declaration && isDeclarationFile(file.path)) return false;
      return containsPhrase(file.content, field.name);
    });
    const writers = files.filter((file) => containsPhrase(file.content, field.name));
    if (writers.length === 0) {
      findings.push(
        missing(
          `Planned schema field ${field.name} does not appear in the feature.`,
          "Add the field to the migration or type that owns it.",
        ),
      );
      continue;
    }
    const deferred =
      Boolean(field.assignedToLaterTaskId) &&
      (options.level === "leaf" || !options.featureClosed);
    if (readers.length === 0 && !deferred) {
      findings.push(
        makeFinding({
          ruleId: "check9.unused-field",
          file: declaration ?? writers[0]?.path ?? "schema",
          line: 1,
          column: 1,
          snippet: field.name,
          message:
            options.level === "feature" && options.featureClosed
              ? `Schema field ${field.name} is still unread after all feature tasks merged.`
              : `Schema field ${field.name} is never read and is not assigned to a later task.`,
          remediation: "Read or write the field from a later task, or remove it from the plan.",
        }),
      );
    }
  }
  return findings;
}

function missing(message: string, remediation: string): StaticAuditFinding {
  return makeFinding({
    ruleId: "check9.missing-contract",
    file: "(contract)",
    line: 1,
    column: 1,
    snippet: message,
    message,
    remediation,
  });
}

function isDeclarationFile(file: string): boolean {
  return file.endsWith(".sql") || file.includes("/migrations/") || file.includes("migration");
}

function isDefaultEntry(file: string): boolean {
  return /(?:^|\/)(?:index|main|server|app)\.(?:ts|tsx|js|jsx|mjs)$/.test(file);
}

function containsPhrase(content: string, phrase: string): boolean {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^A-Za-z0-9_])${escaped}([^A-Za-z0-9_]|$)`).test(content);
}

function stripSlash(route: string): string {
  return route.length > 1 && route.endsWith("/") ? route.slice(0, -1) : route;
}

function collectExports(source: string): ModuleExport[] {
  const found = new Map<string, ModuleExport>();
  const patterns = [
    /export\s+(?:async\s+)?function\s*\*?\s+([A-Za-z_$][\w$]*)/g,
    /export\s+(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/g,
    /export\s+(?:const|let|var|enum|interface|type)\s+([A-Za-z_$][\w$]*)/g,
    /export\s+default\s+function\s+([A-Za-z_$][\w$]*)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const name = match[1];
      if (!name || found.has(name)) continue;
      found.set(name, { name, line: lineOf(source, match.index ?? 0) });
    }
  }
  const reexport = /export\s*\{([^}]+)\}/g;
  for (const match of source.matchAll(reexport)) {
    const body = match[1] ?? "";
    for (const part of body.split(",")) {
      const bits = part.trim().split(/\s+as\s+/);
      const exported = (bits[1] ?? bits[0] ?? "").trim();
      if (!exported || found.has(exported)) continue;
      found.set(exported, { name: exported, line: lineOf(source, match.index ?? 0) });
    }
  }
  if (/export\s+default\b/.test(source) && !found.has("default")) {
    found.set("default", { name: "default", line: 1 });
  }
  return [...found.values()];
}

interface ImportSpec {
  readonly specifier: string;
  readonly names: readonly string[];
  readonly defaultImport: boolean;
  readonly namespace: boolean;
}

function collectImports(source: string): ImportSpec[] {
  const specs: ImportSpec[] = [];
  const named = /import\s+(?:type\s+)?([^'";]*?)\s+from\s+['"]([^'"]+)['"]/g;
  for (const match of source.matchAll(named)) {
    const clause = match[1] ?? "";
    const specifier = match[2] ?? "";
    const names: string[] = [];
    const brace = /\{([^}]+)\}/.exec(clause);
    if (brace?.[1]) {
      for (const part of brace[1].split(",")) {
        const bits = part.trim().split(/\s+as\s+/);
        const original = (bits[0] ?? "").replace(/^type\s+/, "").trim();
        if (original) names.push(original);
      }
    }
    const withoutBrace = clause.replace(/\{[^}]+\}/, "").trim();
    const namespace = withoutBrace.startsWith("*");
    const defaultImport = withoutBrace.length > 0 && !namespace;
    specs.push({ specifier, names, defaultImport, namespace });
  }
  const side = /import\s+['"]([^'"]+)['"]/g;
  for (const match of source.matchAll(side)) {
    const specifier = match[1];
    if (!specifier) continue;
    specs.push({ specifier, names: [], defaultImport: false, namespace: false });
  }
  const exportedFrom = /export\s*\{([^}]+)\}\s*from\s+['"]([^'"]+)['"]/g;
  for (const match of source.matchAll(exportedFrom)) {
    const names: string[] = [];
    for (const part of (match[1] ?? "").split(",")) {
      const bits = part.trim().split(/\s+as\s+/);
      const original = (bits[0] ?? "").trim();
      if (original) names.push(original);
    }
    specs.push({
      specifier: match[2] ?? "",
      names,
      defaultImport: false,
      namespace: false,
    });
  }
  return specs;
}

function resolveSpecifier(fromFile: string, specifier: string, known: Set<string>): string | null {
  if (!specifier.startsWith(".")) return null;
  const dir = fromFile.includes("/") ? fromFile.slice(0, fromFile.lastIndexOf("/")) : "";
  const raw = posixJoin(dir, specifier);
  const stem = raw.replace(/\.(?:[cm]?js|jsx)$/i, "");
  const candidates = [
    raw,
    `${stem}.ts`,
    `${stem}.tsx`,
    `${stem}.mts`,
    `${stem}.cts`,
    `${stem}.js`,
    `${stem}.jsx`,
    `${stem}.mjs`,
    `${stem}/index.ts`,
    `${stem}/index.tsx`,
    `${stem}/index.js`,
  ];
  for (const candidate of candidates) {
    if (known.has(candidate)) return candidate;
  }
  return null;
}

function posixJoin(dir: string, specifier: string): string {
  const parts = `${dir}/${specifier}`.split("/");
  const stack: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") {
      stack.pop();
      continue;
    }
    stack.push(part);
  }
  return stack.join("/");
}

function lineOf(source: string, index: number): number {
  return source.slice(0, index).split(/\r?\n/).length;
}

function dedupe(findings: readonly StaticAuditFinding[]): StaticAuditFinding[] {
  const seen = new Set<string>();
  const unique: StaticAuditFinding[] = [];
  for (const finding of findings) {
    const key = `${finding.ruleId}|${finding.file}|${finding.line}|${finding.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(finding);
  }
  return unique;
}
