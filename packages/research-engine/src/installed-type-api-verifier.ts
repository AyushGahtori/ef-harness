import fs from "node:fs";
import path from "node:path";
import * as ts from "typescript";
import { majorMinor } from "./domain.js";

export const INSTALLED_TYPES_COMPILER = "ts.createProgram" as const;

const READ_ONLY_COMPILER_OPTIONS: ts.CompilerOptions = {
  noEmit: true,
  noLib: true,
  strict: false,
  skipLibCheck: true,
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  types: [],
};

export interface ApiClaim {
  readonly functionName: string;
  readonly exportPath?: string;
  readonly optionKeys?: readonly string[];
  readonly docVersion?: string;
  readonly webSignature?: string;
}

export type ApiProofStatus = "confirmed" | "version_mismatch" | "missing" | "unapproved_package";

export interface InstalledApiProof {
  readonly status: ApiProofStatus;
  readonly packageName: string;
  readonly installedVersion: string;
  readonly installedMajorMinor: string | null;
  readonly claimedFunction: string;
  readonly installedSignature: string | null;
  readonly optionKeys: readonly string[];
  readonly webDocSuperseded: boolean;
  readonly checkedWith: typeof INSTALLED_TYPES_COMPILER;
  readonly emit: false;
  readonly reason: string;
}

export interface InstalledExport {
  readonly name: string;
  readonly signature: string;
  readonly optionKeys: readonly string[];
}

export interface InstalledSurface {
  readonly packageName: string;
  readonly installedVersion: string;
  readonly installedMajorMinor: string | null;
  readonly exportPaths: readonly string[];
  readonly exports: readonly InstalledExport[];
  readonly checkedWith: typeof INSTALLED_TYPES_COMPILER;
  readonly emit: false;
}

interface PackageManifest {
  readonly name: string;
  readonly version: string;
  readonly typesEntry: string;
  readonly exportPaths: readonly string[];
}

interface ResolvedSymbol {
  readonly name: string;
  readonly signature: string;
  readonly optionKeys: readonly string[];
}

export class InstalledTypeApiVerifier {
  private readonly surfaces = new Map<string, InstalledSurface>();

  verifyPackage(input: {
    readonly packageRoot: string;
    readonly claims: readonly ApiClaim[];
    readonly approvedPackages?: readonly string[];
  }): readonly InstalledApiProof[] {
    const manifest = readManifest(input.packageRoot);
    const approved = input.approvedPackages;
    if (approved && !approved.includes(manifest.name)) {
      return input.claims.map((claim) =>
        proof({
          status: "unapproved_package",
          manifest,
          claim,
          installedSignature: null,
          optionKeys: [],
          reason: `${manifest.name} is not on the package allowlist`,
        }),
      );
    }
    const surface = this.describeInstalled(input.packageRoot);
    const byName = new Map(surface.exports.map((item) => [item.name, item]));
    const primarySignature =
      surface.exports.length === 0 ? null : surface.exports.map((item) => item.signature).join("\n");
    return input.claims.map((claim) => judgeClaim(manifest, claim, byName, primarySignature));
  }

  describeInstalled(packageRoot: string): InstalledSurface {
    const cached = this.surfaces.get(packageRoot);
    if (cached) return cached;
    const manifest = readManifest(packageRoot);
    const entry = path.resolve(packageRoot, manifest.typesEntry);
    if (!fs.existsSync(entry)) {
      throw new Error(`installed types entry is missing: ${entry}`);
    }
    const program = ts.createProgram({
      rootNames: [entry],
      options: READ_ONLY_COMPILER_OPTIONS,
    });
    const source = program.getSourceFile(entry);
    if (!source) throw new Error(`TypeScript did not load ${entry}`);
    const checker = program.getTypeChecker();
    const exports = collectExports(checker, source);
    const surface: InstalledSurface = {
      packageName: manifest.name,
      installedVersion: manifest.version,
      installedMajorMinor: majorMinor(manifest.version),
      exportPaths: manifest.exportPaths,
      exports,
      checkedWith: INSTALLED_TYPES_COMPILER,
      emit: false,
    };
    this.surfaces.set(packageRoot, surface);
    return surface;
  }
}

function judgeClaim(
  manifest: PackageManifest,
  claim: ApiClaim,
  byName: ReadonlyMap<string, InstalledExport>,
  primarySignature: string | null,
): InstalledApiProof {
  const installed = majorMinor(manifest.version);
  const documented = claim.docVersion ? majorMinor(claim.docVersion) : null;
  const versionConflict = documented !== null && installed !== null && documented !== installed;
  const exportConflict =
    claim.exportPath !== undefined && !exportPathAllowed(claim.exportPath, manifest.exportPaths);
  const found = byName.get(claim.functionName) ?? null;
  if (!found) {
    return proof({
      status: "version_mismatch",
      manifest,
      claim,
      installedSignature: primarySignature,
      optionKeys: [],
      reason: versionConflict
        ? `web docs describe ${documented} but ${manifest.name}@${manifest.version} does not export ${claim.functionName}`
        : `${claim.functionName} is not an installed export; installed types win`,
    });
  }
  const missingOptions = (claim.optionKeys ?? []).filter((key) => !found.optionKeys.includes(key));
  const reasons: string[] = [];
  if (versionConflict) reasons.push(`installed ${installed} supersedes web docs ${documented}`);
  if (exportConflict) reasons.push(`export path ${claim.exportPath ?? ""} is not in package.json exports`);
  if (missingOptions.length > 0) {
    reasons.push(`installed signature has no option ${missingOptions.join(", ")}`);
  }
  if (signatureConflict(claim, found)) reasons.push("installed signature disagrees with the web prose");
  if (reasons.length > 0) {
    return proof({
      status: "version_mismatch",
      manifest,
      claim,
      installedSignature: found.signature,
      optionKeys: found.optionKeys,
      reason: reasons.join("; "),
    });
  }
  return proof({
    status: "confirmed",
    manifest,
    claim,
    installedSignature: found.signature,
    optionKeys: found.optionKeys,
    reason: "function, signature, option keys, and export path exist in the installed package",
  });
}

function signatureConflict(claim: ApiClaim, found: InstalledExport): boolean {
  if (!claim.webSignature) return false;
  return normalizeSignature(claim.webSignature) !== normalizeSignature(found.signature);
}

function normalizeSignature(value: string): string {
  return value.replace(/\s+/g, "");
}

function exportPathAllowed(exportPath: string, paths: readonly string[]): boolean {
  const normalized = exportPath === "." ? "." : exportPath.startsWith(".") ? exportPath : `./${exportPath}`;
  return paths.includes(normalized) || paths.includes(exportPath);
}

function proof(input: {
  readonly status: ApiProofStatus;
  readonly manifest: PackageManifest;
  readonly claim: ApiClaim;
  readonly installedSignature: string | null;
  readonly optionKeys: readonly string[];
  readonly reason: string;
}): InstalledApiProof {
  return {
    status: input.status,
    packageName: input.manifest.name,
    installedVersion: input.manifest.version,
    installedMajorMinor: majorMinor(input.manifest.version),
    claimedFunction: input.claim.functionName,
    installedSignature: input.installedSignature,
    optionKeys: input.optionKeys,
    webDocSuperseded: input.status === "version_mismatch",
    checkedWith: INSTALLED_TYPES_COMPILER,
    emit: false,
    reason: input.reason,
  };
}

function collectExports(checker: ts.TypeChecker, source: ts.SourceFile): InstalledExport[] {
  const moduleSymbol = checker.getSymbolAtLocation(source);
  if (!moduleSymbol) return [];
  const exported = checker.getExportsOfModule(moduleSymbol);
  const found: InstalledExport[] = [];
  const seen = new Set<string>();
  for (const symbol of exported) {
    walkSymbol(checker, symbol, symbol.getName(), source, source, found, seen, 0);
  }
  return found;
}

function walkSymbol(
  checker: ts.TypeChecker,
  symbol: ts.Symbol,
  dotted: string,
  at: ts.Node,
  source: ts.SourceFile,
  found: InstalledExport[],
  seen: Set<string>,
  depth: number,
): void {
  if (depth > 4 || seen.has(dotted)) return;
  seen.add(dotted);
  if (depth > 0 && !declaredIn(symbol, source)) return;
  const resolved = resolveCall(checker, symbol, dotted, at, source);
  if (resolved) {
    found.push(resolved);
    return;
  }
  const declaration = symbol.valueDeclaration ?? symbol.declarations?.[0] ?? at;
  const type = checker.getTypeOfSymbolAtLocation(symbol, declaration);
  for (const property of type.getApparentProperties()) {
    const name = property.getName();
    if (name.startsWith("__") || !declaredIn(property, source)) continue;
    walkSymbol(checker, property, `${dotted}.${name}`, declaration, source, found, seen, depth + 1);
  }
}

function declaredIn(symbol: ts.Symbol, source: ts.SourceFile): boolean {
  return (symbol.declarations ?? []).some((declaration) => declaration.getSourceFile() === source);
}

function resolveCall(
  checker: ts.TypeChecker,
  symbol: ts.Symbol,
  dotted: string,
  at: ts.Node,
  source: ts.SourceFile,
): ResolvedSymbol | null {
  const declaration = symbol.valueDeclaration ?? symbol.declarations?.[0];
  const site = declaration ?? at;
  const type = checker.getTypeOfSymbolAtLocation(symbol, site);
  const call = type.getCallSignatures()[0];
  if (!call) return null;
  const printed = checker.signatureToString(call);
  const signature = printed.startsWith("(") ? `${dotted}${printed}` : `${dotted}: ${printed}`;
  return {
    name: dotted,
    signature,
    optionKeys: optionKeysOf(checker, call, source),
  };
}

function optionKeysOf(checker: ts.TypeChecker, signature: ts.Signature, source: ts.SourceFile): string[] {
  const first = signature.getParameters()[0];
  if (!first) return [];
  const declaration = first.valueDeclaration ?? first.declarations?.[0];
  if (!declaration) return [];
  const type = checker.getTypeOfSymbolAtLocation(first, declaration);
  return type
    .getApparentProperties()
    .filter((property) => declaredIn(property, source))
    .map((property) => property.getName())
    .filter((name) => !name.startsWith("__"));
}

function readManifest(packageRoot: string): PackageManifest {
  const manifestPath = path.join(packageRoot, "package.json");
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as unknown;
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unreadable package.json";
    throw new Error(`installed package.json could not be read: ${detail}`);
  }
  if (!isRecord(parsed)) throw new Error("installed package.json must be an object");
  const name = readString(parsed, "name");
  const version = readString(parsed, "version");
  if (!name || !version) throw new Error("installed package.json needs name and version");
  const exportPaths = readExportPaths(parsed);
  const typesEntry = readTypesEntry(parsed) ?? "index.d.ts";
  return { name, version, typesEntry, exportPaths };
}

function readExportPaths(value: Record<string, unknown>): string[] {
  const paths = new Set<string>();
  if (typeof value.types === "string" || typeof value.typings === "string") paths.add(".");
  const exportsField = value.exports;
  if (typeof exportsField === "string") {
    paths.add(".");
    return [...paths];
  }
  if (!isRecord(exportsField)) {
    if (paths.size === 0) paths.add(".");
    return [...paths];
  }
  for (const key of Object.keys(exportsField)) {
    if (key.startsWith(".")) paths.add(key);
  }
  if (paths.size === 0) paths.add(".");
  return [...paths];
}

function readTypesEntry(value: Record<string, unknown>): string | null {
  const direct = readString(value, "types") ?? readString(value, "typings");
  if (direct) return direct;
  const exportsField = value.exports;
  if (!isRecord(exportsField)) return null;
  const root = exportsField["."];
  if (typeof root === "string" && root.endsWith(".d.ts")) return root.replace(/^\.\//, "");
  if (!isRecord(root)) return null;
  const types = readString(root, "types");
  if (!types) return null;
  return types.replace(/^\.\//, "");
}

function readString(value: Record<string, unknown>, key: string): string | null {
  const found = value[key];
  return typeof found === "string" && found.trim().length > 0 ? found.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
