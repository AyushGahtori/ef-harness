import { INTEGRATION_REF } from "./constants.js";
import { fileMap, lineCount, lineOfIndex, makeFinding, markerPattern, secretRules } from "./text.js";
import type { ConfirmedFinding, RepoFile, RepoSnapshot, SecretScannerPort, StaticAuditGatePort } from "./types.js";

const EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];

function isProductFile(path: string): boolean {
  if (path.includes("/tests/") || path.startsWith("tests/") || path.includes(".test.")) return false;
  return /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(path);
}

function pushMatches(content: string, pattern: RegExp, visit: (index: number) => void): void {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  const global = new RegExp(pattern.source, flags);
  let match = global.exec(content);
  while (match) {
    visit(match.index);
    if (match[0].length === 0) global.lastIndex += 1;
    match = global.exec(content);
  }
}

export function scanMarkersAndStubs(files: readonly RepoFile[], fixCostUnits: bigint): ConfirmedFinding[] {
  const findings: ConfirmedFinding[] = [];
  const marker = markerPattern();
  const stub = /\b(?:not implemented|unimplemented)\b/i;
  const mock = /\b(?:vi|jest)\.mock\(/;
  for (const file of files) {
    if (!isProductFile(file.path)) continue;
    pushMatches(file.content, marker, (index) => {
      const line = lineOfIndex(file.content, index);
      findings.push(
        makeFinding({
          code: "marker-leak",
          kind: "layer_a",
          severity: "high",
          filePath: file.path,
          lineStart: line,
          detail: `Marker leak at ${file.path}:${line}`,
          fixCostUnits,
        }),
      );
    });
    pushMatches(file.content, stub, (index) => {
      const line = lineOfIndex(file.content, index);
      findings.push(
        makeFinding({
          code: "stub-leak",
          kind: "layer_a",
          severity: "high",
          filePath: file.path,
          lineStart: line,
          detail: `Stub leak at ${file.path}:${line}`,
          fixCostUnits,
        }),
      );
    });
    pushMatches(file.content, mock, (index) => {
      const line = lineOfIndex(file.content, index);
      findings.push(
        makeFinding({
          code: "mock-leak",
          kind: "layer_a",
          severity: "high",
          filePath: file.path,
          lineStart: line,
          detail: `Mock leak at ${file.path}:${line}`,
          fixCostUnits,
        }),
      );
    });
  }
  return findings;
}

function routeLiterals(content: string): string[] {
  const found: string[] = [];
  const pattern = /["'`](\/[A-Za-z0-9_\-./]*)["'`]/g;
  let match = pattern.exec(content);
  while (match) {
    const path = match[1];
    if (path && path.length > 1) found.push(path);
    match = pattern.exec(content);
  }
  return found;
}

function isNav(path: string): boolean {
  return /(^|\/)(nav|menu|sidebar)\.[a-z]+$/.test(path);
}

function isRouter(path: string): boolean {
  return /(^|\/)(router|routes)\.[a-z]+$/.test(path);
}

function isHandler(path: string): boolean {
  return /\/handlers\//.test(path);
}

export function scanRoutesAndExports(snapshot: RepoSnapshot, fixCostUnits: bigint): ConfirmedFinding[] {
  const findings: ConfirmedFinding[] = [];
  const files = snapshot.files;
  const navPaths = new Map<string, { file: string; line: number }>();
  const routerText: string[] = [];
  for (const file of files) {
    if (isNav(file.path)) {
      const literals = routeLiterals(file.content);
      literals.forEach((route, index) => {
        const line = lineOfIndex(file.content, file.content.indexOf(route));
        if (!navPaths.has(route)) navPaths.set(route, { file: file.path, line: Math.max(1, line) });
        void index;
      });
    }
    if (isRouter(file.path)) routerText.push(file.content);
  }
  const routers = routerText.join("\n");
  for (const [route, at] of navPaths) {
    if (!routers.includes(route)) {
      findings.push(
        makeFinding({
          code: "dead-route",
          kind: "layer_a",
          severity: "high",
          filePath: at.file,
          lineStart: at.line,
          detail: `Route ${route} is declared in navigation but has no router mount`,
          fixCostUnits,
        }),
      );
    }
  }
  for (const file of files) {
    if (!isHandler(file.path)) continue;
    const names = [...file.content.matchAll(/export function ([A-Za-z0-9_]+)/g)];
    for (const name of names) {
      const symbol = name[1];
      if (!symbol) continue;
      if (!routers.includes(symbol)) {
        const line = lineOfIndex(file.content, name.index ?? 0);
        findings.push(
          makeFinding({
            code: "orphan-handler",
            kind: "layer_a",
            severity: "high",
            filePath: file.path,
            lineStart: line,
            detail: `Handler ${symbol} is not referenced by the router`,
            fixCostUnits,
          }),
        );
      }
    }
  }
  findings.push(...scanUnusedExports(snapshot, fixCostUnits));
  findings.push(...scanBrokenImports(files, fixCostUnits));
  return findings;
}

function resolveRelative(fromFile: string, spec: string, known: ReadonlySet<string>): string | null {
  const dir = fromFile.split("/").slice(0, -1);
  const parts = spec.split("/");
  const stack = [...dir];
  for (const part of parts) {
    if (part === "." || part === "") continue;
    if (part === "..") stack.pop();
    else stack.push(part);
  }
  const base = stack.join("/");
  if (known.has(base)) return base;
  for (const ext of EXTENSIONS) {
    if (known.has(`${base}${ext}`)) return `${base}${ext}`;
  }
  for (const ext of EXTENSIONS) {
    if (known.has(`${base}/index${ext}`)) return `${base}/index${ext}`;
  }
  return null;
}

function scanBrokenImports(files: readonly RepoFile[], fixCostUnits: bigint): ConfirmedFinding[] {
  const known = new Set(files.map((file) => file.path));
  const findings: ConfirmedFinding[] = [];
  const pattern = /(?:from|import)\s+["'](\.[^"']+)["']/g;
  for (const file of files) {
    if (!isProductFile(file.path)) continue;
    let match = pattern.exec(file.content);
    const seen = new Set<string>();
    while (match) {
      const spec = match[1];
      if (spec && !seen.has(spec)) {
        seen.add(spec);
        const resolved = resolveRelative(file.path, spec, known);
        if (!resolved) {
          const line = lineOfIndex(file.content, match.index);
          findings.push(
            makeFinding({
              code: "broken-import",
              kind: "layer_a",
              severity: "high",
              filePath: file.path,
              lineStart: line,
              detail: `Broken import ${spec} from ${file.path}:${line}`,
              fixCostUnits,
            }),
          );
        }
      }
      match = pattern.exec(file.content);
    }
    pattern.lastIndex = 0;
  }
  return findings;
}

function exportedNames(content: string): string[] {
  const names: string[] = [];
  const pattern = /export (?:async )?(?:function|class|const|let|var|type|interface) ([A-Za-z0-9_]+)/g;
  let match = pattern.exec(content);
  while (match) {
    const name = match[1];
    if (name) names.push(name);
    match = pattern.exec(content);
  }
  return names;
}

function scanUnusedExports(snapshot: RepoSnapshot, fixCostUnits: bigint): ConfirmedFinding[] {
  const entry = fileMap(snapshot.files).get(snapshot.entryFile);
  if (!entry) return [];
  const known = new Set(snapshot.files.map((file) => file.path));
  const importPattern = /import\s+(type\s+)?\{([^}]+)\}\s+from\s+["'](\.[^"']+)["']/g;
  const findings: ConfirmedFinding[] = [];
  let match = importPattern.exec(entry.content);
  while (match) {
    const imported = (match[2] ?? "")
      .split(",")
      .map((part) => part.trim().split(/\s+as\s+/)[0]?.trim())
      .filter((part): part is string => Boolean(part));
    const spec = match[3];
    if (spec) {
      const resolved = resolveRelative(snapshot.entryFile, spec, known);
      const target = resolved ? fileMap(snapshot.files).get(resolved) : undefined;
      if (target) {
        for (const name of exportedNames(target.content)) {
          if (!imported.includes(name) && !entry.content.includes(name)) {
            const line = lineOfIndex(target.content, target.content.indexOf(name));
            findings.push(
              makeFinding({
                code: "unused-export",
                kind: "layer_a",
                severity: "high",
                filePath: target.path,
                lineStart: line,
                detail: `Export ${name} is unused by entry wiring ${snapshot.entryFile}`,
                fixCostUnits,
              }),
            );
          }
        }
      }
    }
    match = importPattern.exec(entry.content);
  }
  return findings;
}

export function scanMigrations(files: readonly RepoFile[], fixCostUnits: bigint): ConfirmedFinding[] {
  const findings: ConfirmedFinding[] = [];
  for (const file of files) {
    if (!file.path.startsWith("migrations/") || !file.path.endsWith(".sql")) continue;
    const trimmed = file.content.trim();
    if (trimmed.length === 0) {
      findings.push(
        makeFinding({
          code: "migration-dirty",
          kind: "layer_a",
          severity: "high",
          filePath: file.path,
          lineStart: 1,
          detail: `Migration ${file.path} is empty`,
          fixCostUnits,
        }),
      );
      continue;
    }
    const lines = file.content.split(/\r?\n/);
    lines.forEach((line, index) => {
      if (/\bDROP\s+TABLE\b/i.test(line) && !/--\s*allow-destructive\b/.test(line)) {
        findings.push(
          makeFinding({
            code: "migration-dirty",
            kind: "layer_a",
            severity: "high",
            filePath: file.path,
            lineStart: index + 1,
            detail: `Migration ${file.path}:${index + 1} drops a table without an allow-destructive mark`,
            fixCostUnits,
          }),
        );
      }
    });
  }
  return findings;
}

export function scanEnvExample(files: readonly RepoFile[], fixCostUnits: bigint): ConfirmedFinding[] {
  const example = files.find((file) => file.path === ".env.example");
  const declared = new Set<string>();
  if (example) {
    for (const line of example.content.split(/\r?\n/)) {
      const match = /^([A-Z0-9_]+)=/.exec(line.trim());
      if (match?.[1]) declared.add(match[1]);
    }
  }
  const findings: ConfirmedFinding[] = [];
  const seen = new Set<string>();
  for (const file of files) {
    if (!isProductFile(file.path)) continue;
    const pattern = /process\.env\.([A-Z0-9_]+)/g;
    let match = pattern.exec(file.content);
    while (match) {
      const name = match[1];
      if (name && !seen.has(name)) {
        seen.add(name);
        if (!declared.has(name)) {
          const line = lineOfIndex(file.content, match.index);
          findings.push(
            makeFinding({
              code: "env-example-gap",
              kind: "layer_a",
              severity: "high",
              filePath: file.path,
              lineStart: line,
              detail: `${name} is read in ${file.path}:${line} but missing from .env.example`,
              fixCostUnits,
            }),
          );
        }
      }
      match = pattern.exec(file.content);
    }
  }
  return findings;
}

export function createLocalSecretScanner(fixCostUnits: bigint): SecretScannerPort {
  const rules = secretRules();
  return {
    scan(files: readonly RepoFile[]): ConfirmedFinding[] {
      const findings: ConfirmedFinding[] = [];
      for (const file of files) {
        if (file.path === ".env.example") continue;
        for (const rule of rules) {
          rule.pattern.lastIndex = 0;
          const match = rule.pattern.exec(file.content);
          if (!match) continue;
          const line = lineOfIndex(file.content, match.index);
          findings.push(
            makeFinding({
              code: "secret",
              kind: "layer_a",
              severity: "critical",
              filePath: file.path,
              lineStart: line,
              detail: `Secret rule ${rule.id} matched ${file.path}:${line}`,
              fixCostUnits,
            }),
          );
        }
      }
      return findings;
    },
  };
}

export function createLocalStaticAuditGate(fixCostUnits: bigint): StaticAuditGatePort {
  return {
    auditFeature(snapshot: RepoSnapshot) {
      const findings = [
        ...scanMarkersAndStubs(snapshot.files, fixCostUnits),
        ...scanRoutesAndExports(snapshot, fixCostUnits),
      ];
      return { passed: findings.length === 0, findings };
    },
  };
}

export function integrationRef(): typeof INTEGRATION_REF {
  return INTEGRATION_REF;
}

export function fileExists(files: readonly RepoFile[], path: string): RepoFile | undefined {
  return fileMap(files).get(path);
}

export function validLineRange(file: RepoFile, start: number, end: number): boolean {
  if (start < 1 || end < start) return false;
  return end <= lineCount(file.content);
}
