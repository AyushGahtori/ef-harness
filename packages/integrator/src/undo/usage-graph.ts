import { HARD_EDGE_TYPE, INTEGRATION_BRANCH, USAGE_EDGE_TYPES } from "./constants.js";
import {
  commitsTouching,
  featureOfCommit,
  parseEfTrailers,
  readBlob,
  type GitRepo,
} from "./git.js";
import {
  createdColumns,
  createdTables,
  featureIdFromPath,
  importSpecifiers,
  isMigrationPath,
  isSourceFile,
  kindForPath,
  referencedTables,
  resolveImport,
  routeDefinitions,
} from "./scan.js";
import type { KnowledgeGraphPort } from "./state-db.js";
import type { ClassifiedArtifact, FileChange, UsageEdge } from "./types.js";

const USAGE = new Set<string>(USAGE_EDGE_TYPES);

/**
 * Local port of Task 087 `ReverseImpactWalker` for undo.
 * `depends_on` is a hard functional dependency (undo together or cancel).
 * `consumes`, `consumes_contract`, and `implements` mark shared pieces.
 */
export class ReverseImpactWalkerPort {
  constructor(private readonly graph: KnowledgeGraphPort) {}

  hardDependents(featureId: string): string[] {
    const edges = this.graph.listEdges().filter((edge) => edge.type === HARD_EDGE_TYPE);
    const dependents: string[] = [];
    const seen = new Set<string>([featureId]);
    const queue = [featureId];
    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) break;
      for (const edge of edges) {
        if (edge.dst !== current || seen.has(edge.src)) continue;
        seen.add(edge.src);
        dependents.push(edge.src);
        queue.push(edge.src);
      }
    }
    return dependents;
  }
}

interface LiveIndex {
  readonly files: ReadonlySet<string>;
  readonly text: ReadonlyMap<string, string>;
  readonly importers: ReadonlyMap<string, readonly string[]>;
  readonly tableUsers: ReadonlyMap<string, readonly string[]>;
}

/**
 * Step 1 of the safe undo protocol. Combines canonical dependency edges,
 * EF-Feature commit trailers (via later-commit attribution), and a live
 * import / SQL foreign-key scan of `harness/integration`.
 */
export class CrossFeatureUsageGraphChecker {
  constructor(
    private readonly git: GitRepo,
    private readonly graph: KnowledgeGraphPort,
  ) {}

  check(featureId: string, changes: readonly FileChange[], mergeSha: string): ClassifiedArtifact[] {
    const head = INTEGRATION_BRANCH;
    const index = this.buildIndex(head);
    const edges = this.graph.listEdges();
    const classified: ClassifiedArtifact[] = [];
    const seen = new Set<string>();
    for (const change of changes) {
      if (change.status === "D") continue;
      const blob = readBlob(this.git, head, change.path) ?? readBlob(this.git, mergeSha, change.path) ?? "";
      const artifacts = classifyFile({
        featureId,
        change,
        blob,
        mergeSha,
        index,
        edges,
        git: this.git,
        head,
      });
      for (const artifact of artifacts) {
        if (seen.has(`${artifact.kind}:${artifact.path}`)) continue;
        seen.add(`${artifact.kind}:${artifact.path}`);
        classified.push(artifact);
      }
    }
    return classified;
  }

  private buildIndex(head: string): LiveIndex {
    const names = this.git.ok(["ls-tree", "-r", "--name-only", head]).stdout;
    const files = new Set(
      names
        .split(/\r?\n/)
        .map((line) => line.trim().replaceAll("\\", "/"))
        .filter((line) => line.length > 0),
    );
    const text = new Map<string, string>();
    const importers = new Map<string, string[]>();
    const tableUsers = new Map<string, string[]>();
    for (const file of files) {
      if (!isSourceFile(file)) continue;
      const blob = readBlob(this.git, head, file);
      if (blob === null) continue;
      text.set(file, blob);
      for (const spec of importSpecifiers(blob)) {
        const resolved = resolveImport(file, spec, files);
        if (!resolved) continue;
        const list = importers.get(resolved) ?? [];
        list.push(file);
        importers.set(resolved, list);
      }
      for (const table of referencedTables(blob)) {
        const list = tableUsers.get(table) ?? [];
        list.push(file);
        tableUsers.set(table, list);
      }
    }
    return { files, text, importers, tableUsers };
  }
}

function classifyFile(input: {
  readonly featureId: string;
  readonly change: FileChange;
  readonly blob: string;
  readonly mergeSha: string;
  readonly index: LiveIndex;
  readonly edges: readonly UsageEdge[];
  readonly git: GitRepo;
  readonly head: string;
}): ClassifiedArtifact[] {
  const fileArtifact = classifyPath(input);
  const extra: ClassifiedArtifact[] = [];
  if (isMigrationPath(input.change.path) || input.blob.toLowerCase().includes("create table")) {
    for (const table of createdTables(input.blob)) {
      extra.push(schemaArtifact(input, `db:${table}`, "table", table));
    }
    for (const column of createdColumns(input.blob)) {
      extra.push(schemaArtifact(input, `db:${column}`, "column", column));
    }
  }
  return [fileArtifact, ...extra];
}

function classifyPath(input: {
  readonly featureId: string;
  readonly change: FileChange;
  readonly blob: string;
  readonly mergeSha: string;
  readonly index: LiveIndex;
  readonly edges: readonly UsageEdge[];
  readonly git: GitRepo;
  readonly head: string;
}): ClassifiedArtifact {
  const referencedBy = new Set<string>();
  const reasons = new Set<string>();
  for (const importer of input.index.importers.get(input.change.path) ?? []) {
    if (importer === input.change.path) continue;
    const owner = owningFeature(input.git, importer);
    if (owner && owner !== input.featureId) {
      referencedBy.add(owner);
      reasons.add("import");
    } else if (!owner) {
      const later = laterFeature(input.git, input.mergeSha, input.head, importer);
      if (later && later !== input.featureId) {
        referencedBy.add(later);
        reasons.add("import");
      }
    }
  }
  for (const edge of input.edges) {
    if (!USAGE.has(edge.type)) continue;
    if (edge.src === input.featureId) continue;
    const matchesPath = edge.artifactPath === input.change.path;
    const matchesFeature = edge.dst === input.featureId && edge.artifactPath.length === 0;
    if (matchesPath || (matchesFeature && edge.artifactPath === input.change.path)) {
      referencedBy.add(edge.src);
      reasons.add("graph");
    }
    if (edge.artifactPath === input.change.path) {
      referencedBy.add(edge.src);
      reasons.add("graph");
    }
  }
  const overlap = commitsTouching(input.git, input.mergeSha, input.head, input.change.path);
  const atMerge = readBlob(input.git, input.mergeSha, input.change.path);
  if (overlap.length > 0 || (atMerge !== null && atMerge !== input.blob)) {
    reasons.add("later_edit");
    for (const sha of overlap) {
      const owner = featureOfCommit(input.git, sha);
      if (owner && owner !== input.featureId) referencedBy.add(owner);
    }
  }
  if (isExternalEffect(input.change.path)) {
    reasons.add("external_effect");
    return artifact(input.change, "shared", referencedBy, reasons, "external_effect", "");
  }
  if (isPersistent(input.change.path, input.blob)) {
    reasons.add("schema");
    for (const table of createdTables(input.blob)) {
      for (const user of input.index.tableUsers.get(table) ?? []) {
        if (user === input.change.path) continue;
        const owner = owningFeature(input.git, user);
        if (owner && owner !== input.featureId) {
          referencedBy.add(owner);
          reasons.add("sql_fk");
        }
      }
    }
    return artifact(input.change, "persistent_data", referencedBy, reasons, kindForPath(input.change.path), "");
  }
  const symbol = routeDefinitions(input.blob).join(",");
  if (referencedBy.size > 0 || reasons.has("later_edit")) {
    return artifact(input.change, "shared", referencedBy, reasons, kindForPath(input.change.path), symbol);
  }
  return artifact(input.change, "exclusive", referencedBy, reasons, kindForPath(input.change.path), symbol);
}

function schemaArtifact(
  input: {
    readonly featureId: string;
    readonly change: FileChange;
    readonly index: LiveIndex;
    readonly edges: readonly UsageEdge[];
    readonly git: GitRepo;
  },
  path: string,
  kind: "table" | "column",
  symbol: string,
): ClassifiedArtifact {
  const referencedBy = new Set<string>();
  const reasons = new Set<string>(["schema"]);
  const table = kind === "table" ? symbol : "";
  if (table) {
    for (const user of input.index.tableUsers.get(table) ?? []) {
      if (user === input.change.path) continue;
      const owner = owningFeature(input.git, user);
      if (owner && owner !== input.featureId) {
        referencedBy.add(owner);
        reasons.add("sql_fk");
      }
    }
  }
  for (const edge of input.edges) {
    if (!USAGE.has(edge.type) || edge.src === input.featureId) continue;
    if (edge.artifactPath === path || edge.artifactPath === symbol) {
      referencedBy.add(edge.src);
      reasons.add("graph");
    }
  }
  return {
    path,
    kind,
    symbol,
    status: input.change.status,
    bucket: "persistent_data",
    referencedBy: [...referencedBy].sort(),
    reasons: [...reasons].sort(),
  };
}

function artifact(
  change: FileChange,
  bucket: ClassifiedArtifact["bucket"],
  referencedBy: ReadonlySet<string>,
  reasons: ReadonlySet<string>,
  kind: ClassifiedArtifact["kind"],
  symbol: string,
): ClassifiedArtifact {
  return {
    path: change.path,
    kind,
    symbol,
    status: change.status,
    bucket,
    referencedBy: [...referencedBy].sort(),
    reasons: [...reasons].sort(),
  };
}

function owningFeature(git: GitRepo, filePath: string): string {
  const direct = featureIdFromPath(filePath);
  if (direct) return direct;
  const message = git.run(["log", "--merges", "-1", "--format=%B", INTEGRATION_BRANCH, "--", filePath]).stdout;
  return parseEfTrailers(message)?.feature ?? "";
}

function isExternalEffect(filePath: string): boolean {
  const normalized = filePath.replaceAll("\\", "/");
  return normalized.startsWith("effects/") || normalized.includes("/effects/");
}

function isPersistent(filePath: string, blob: string): boolean {
  if (isMigrationPath(filePath)) return true;
  return /\bcreate\s+table\b/i.test(blob) || /\balter\s+table\b/i.test(blob);
}

function laterFeature(git: GitRepo, mergeSha: string, head: string, filePath: string): string {
  const commits = commitsTouching(git, mergeSha, head, filePath);
  for (const sha of commits) {
    const owner = featureOfCommit(git, sha);
    if (owner) return owner;
  }
  return "";
}

export function exclusiveRatio(artifacts: readonly ClassifiedArtifact[]): number {
  if (artifacts.length === 0) return 1;
  const exclusive = artifacts.filter((item) => item.bucket === "exclusive").length;
  return exclusive / artifacts.length;
}

export function partition(artifacts: readonly ClassifiedArtifact[]): {
  exclusive: ClassifiedArtifact[];
  shared: ClassifiedArtifact[];
  persistentData: ClassifiedArtifact[];
} {
  return {
    exclusive: artifacts.filter((item) => item.bucket === "exclusive"),
    shared: artifacts.filter((item) => item.bucket === "shared"),
    persistentData: artifacts.filter((item) => item.bucket === "persistent_data"),
  };
}
