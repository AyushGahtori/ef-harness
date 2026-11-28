import { createHash } from "node:crypto";
import { createdTables, parseDdl } from "./ddl.js";
import { listTree, showFile } from "./git.js";
import type {
  MigrationFile,
  MigrationFinding,
  MigrationTool,
  SequenceAssignment,
  SkeletonElement,
  SkeletonLockPort,
} from "./types.js";

export class LocalSkeletonLock implements SkeletonLockPort {
  constructor(private readonly locked: readonly SkeletonElement[]) {}

  isLocked(element: SkeletonElement): boolean {
    return this.locked.some(
      (item) => item.kind === element.kind && item.name === element.name && item.table === element.table,
    );
  }

  destructiveAllowed(element: SkeletonElement, ccrId: string | null): boolean {
    if (!this.isLocked(element)) return true;
    return ccrId !== null && /^CCR-\d+$/.test(ccrId);
  }
}

export class MigrationIntentAndConflictLinter {
  constructor(
    private readonly skeleton: SkeletonLockPort = new LocalSkeletonLock([]),
    private readonly baselineTables: readonly string[] = [],
  ) {}

  nameMigration(input: {
    readonly featureId: string;
    readonly slug: string;
    readonly sql: string;
    readonly at: Date;
    readonly tool?: MigrationTool;
    readonly dependsOn?: readonly string[];
    readonly existingNames?: readonly string[];
    readonly sequence?: number;
    readonly ccrId?: string | null;
  }): MigrationFile {
    const tool = input.tool ?? "timestamp-hash";
    const slug = sanitizeSlug(input.slug);
    const dependsOn = input.dependsOn ?? [];
    const ccrId = input.ccrId ?? readScalar(input.sql, "ccr");
    const sql = withDirectives(input.sql, dependsOn, ccrId);
    const timestamp = formatUtcTimestamp(input.at);
    let salt = 0;
    let hash = migrationHash(input.featureId, sql, salt);
    let path = migrationPath({ tool, timestamp, hash, slug, sequence: input.sequence ?? null });
    const existing = new Set(input.existingNames ?? []);
    while (existing.has(path)) {
      salt += 1;
      hash = migrationHash(input.featureId, sql, salt);
      path = migrationPath({ tool, timestamp, hash, slug, sequence: input.sequence ?? null });
    }
    return {
      id: `${input.featureId}:${path}`,
      featureId: input.featureId,
      path,
      sql,
      timestamp,
      hash,
      slug,
      dependsOn,
      tool,
      sequence: input.sequence ?? null,
      ccrId,
    };
  }

  planRestamp(file: MigrationFile, anchorTimestamp: string): MigrationFile {
    if (!/^\d{14}$/.test(file.timestamp) || !/^\d{14}$/.test(anchorTimestamp)) return file;
    const timestamp = file.timestamp > anchorTimestamp ? file.timestamp : addUtcSeconds(anchorTimestamp, 1);
    const path = replaceTimestamp(file.path, file.timestamp, timestamp);
    return { ...file, timestamp, path, id: `${file.featureId}:${path}` };
  }

  /**
   * Move a foreign key that sorts before its target table to one second after the creator.
   * An explicit `depends_on` leaves the file alone; `foreignKeyFindings` already accepts it.
   */
  resolveForeignKeyOrder(files: readonly MigrationFile[]): {
    readonly files: readonly MigrationFile[];
    readonly restamped: readonly MigrationFile[];
  } {
    const byId = new Map(files.map((file) => [file.id, file]));
    const restamped: MigrationFile[] = [];
    const seen = new Set<string>();
    for (let pass = 0; pass < files.length + 2; pass += 1) {
      const findings = foreignKeyFindings([...byId.values()], this.baselineTables);
      if (findings.length === 0) break;
      let changed = false;
      for (const finding of findings) {
        const earlyId = finding.migrationIds[0];
        const creatorId = finding.migrationIds[1];
        if (!earlyId || !creatorId) continue;
        const early = byId.get(earlyId);
        const creator = byId.get(creatorId);
        if (!early || !creator) continue;
        const updated = this.planRestamp(early, creator.timestamp);
        if (updated.id === early.id) continue;
        byId.delete(early.id);
        byId.set(updated.id, updated);
        if (!seen.has(updated.id)) {
          seen.add(updated.id);
          restamped.push(updated);
        }
        changed = true;
      }
      if (!changed) break;
    }
    return { files: [...byId.values()], restamped };
  }

  collectFromRepo(
    repo: string,
    branches: readonly { readonly featureId: string; readonly ref: string }[],
    tool: MigrationTool,
  ): MigrationFile[] {
    const files: MigrationFile[] = [];
    for (const branch of branches) {
      for (const filePath of listTree(repo, branch.ref)) {
        if (!isMigrationPath(filePath, tool)) continue;
        const sql = showFile(repo, `${branch.ref}:${filePath}`);
        const parsed = describePath(filePath, tool);
        files.push({
          id: `${branch.featureId}:${filePath}`,
          featureId: branch.featureId,
          path: filePath,
          sql,
          timestamp: parsed.timestamp,
          hash: parsed.hash,
          slug: parsed.slug,
          dependsOn: readList(sql, "depends_on"),
          tool,
          sequence: parsed.sequence,
          ccrId: readScalar(sql, "ccr"),
        });
      }
    }
    return files;
  }

  detectTool(paths: readonly string[]): MigrationTool {
    if (paths.some((file) => file.startsWith("prisma/migrations/"))) return "prisma";
    if (paths.some((file) => file.startsWith("drizzle/") || /(^|\/)\d{4}_[^/]+\.sql$/.test(file))) return "drizzle";
    return "timestamp-hash";
  }

  lint(files: readonly MigrationFile[], activeFeatureCount: number): {
    readonly findings: readonly MigrationFinding[];
    readonly sequencePlan: readonly SequenceAssignment[];
    readonly restamped: readonly MigrationFile[];
    readonly ordered: readonly MigrationFile[];
  } {
    const findings: MigrationFinding[] = [];
    findings.push(...sequentialFindings(files, activeFeatureCount));
    findings.push(...duplicateFindings(files));
    findings.push(...columnFindings(files));
    findings.push(...foreignKeyFindings(files, this.baselineTables));
    findings.push(...skeletonFindings(files, this.skeleton));
    const sequence = sequencePlan(files);
    findings.push(...sequence.findings);
    const resolved = this.resolveForeignKeyOrder(files);
    return {
      findings,
      sequencePlan: sequence.plan,
      restamped: resolved.restamped,
      ordered: this.orderForApply(resolved.files),
    };
  }

  orderForApply(files: readonly MigrationFile[]): MigrationFile[] {
    const pending = [...files];
    const ordered: MigrationFile[] = [];
    const placed = new Set<string>();
    const tables = new Set<string>([]);
    while (pending.length > 0) {
      const ready = pending.filter((file) => dependenciesReady(file, pending, placed, tables));
      const pool = ready.length > 0 ? [...ready] : [...pending];
      pool.sort(compareMigrationFiles);
      const next = pool[0];
      if (!next) break;
      pending.splice(pending.indexOf(next), 1);
      ordered.push(next);
      placed.add(next.id);
      for (const table of createdTables(parseDdl(next.sql))) tables.add(table);
    }
    return ordered;
  }
}

export const MigrationConflictLinter = MigrationIntentAndConflictLinter;

export function migrationHash(featureId: string, sql: string, salt: number): string {
  return createHash("sha256").update(`${featureId}\n${sql}\n${salt}`, "utf8").digest("hex").slice(0, 6);
}

export function formatUtcTimestamp(date: Date): string {
  const year = date.getUTCFullYear().toString().padStart(4, "0");
  const month = (date.getUTCMonth() + 1).toString().padStart(2, "0");
  const day = date.getUTCDate().toString().padStart(2, "0");
  const hour = date.getUTCHours().toString().padStart(2, "0");
  const minute = date.getUTCMinutes().toString().padStart(2, "0");
  const second = date.getUTCSeconds().toString().padStart(2, "0");
  return `${year}${month}${day}${hour}${minute}${second}`;
}

export function addUtcSeconds(timestamp: string, seconds: number): string {
  const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(timestamp);
  if (!match) return timestamp;
  const date = new Date(
    Date.UTC(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      Number(match[4]),
      Number(match[5]),
      Number(match[6]),
    ),
  );
  date.setUTCSeconds(date.getUTCSeconds() + seconds);
  return formatUtcTimestamp(date);
}

export function sanitizeSlug(slug: string): string {
  const cleaned = slug
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!cleaned) throw new Error("Migration slug is empty after sanitizing.");
  return cleaned;
}

function migrationPath(input: {
  readonly tool: MigrationTool;
  readonly timestamp: string;
  readonly hash: string;
  readonly slug: string;
  readonly sequence: number | null;
}): string {
  if (input.tool === "prisma") {
    return `prisma/migrations/${input.timestamp}_${input.hash}_${input.slug}/migration.sql`;
  }
  if (input.tool === "drizzle") {
    const sequence = (input.sequence ?? 1).toString().padStart(4, "0");
    return `drizzle/${sequence}_${input.slug}.sql`;
  }
  return `migrations/${input.timestamp}_${input.hash}_${input.slug}.sql`;
}

function replaceTimestamp(filePath: string, from: string, to: string): string {
  return filePath.replace(from, to);
}

function withDirectives(sql: string, dependsOn: readonly string[], ccrId: string | null): string {
  const lines: string[] = [];
  if (dependsOn.length > 0 && !/--\s*depends_on:/i.test(sql)) {
    lines.push(`-- depends_on: ${dependsOn.join(", ")}`);
  }
  if (ccrId && !/--\s*ccr:/i.test(sql)) lines.push(`-- ccr: ${ccrId}`);
  if (lines.length === 0) return sql.endsWith("\n") ? sql : `${sql}\n`;
  return `${lines.join("\n")}\n${sql.endsWith("\n") ? sql : `${sql}\n`}`;
}

function readList(sql: string, key: string): string[] {
  const match = new RegExp(`^--\\s*${key}:\\s*(.+)$`, "im").exec(sql);
  if (!match?.[1]) return [];
  return match[1]
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function readScalar(sql: string, key: string): string | null {
  const match = new RegExp(`^--\\s*${key}:\\s*(\\S+)`, "im").exec(sql);
  return match?.[1] ?? null;
}

function isMigrationPath(filePath: string, tool: MigrationTool): boolean {
  if (tool === "prisma") return filePath.startsWith("prisma/migrations/") && filePath.endsWith("/migration.sql");
  if (tool === "drizzle") return /^drizzle\/\d{4}_[^/]+\.sql$/.test(filePath);
  return filePath.startsWith("migrations/") && filePath.endsWith(".sql");
}

function describePath(
  filePath: string,
  tool: MigrationTool,
): { timestamp: string; hash: string; slug: string; sequence: number | null } {
  if (tool === "drizzle") {
    const match = /\/(\d{4})_([^/]+)\.sql$/.exec(filePath);
    return {
      timestamp: "",
      hash: "",
      slug: match?.[2] ?? filePath,
      sequence: match?.[1] ? Number(match[1]) : null,
    };
  }
  const hashed = /(?:^|\/)(\d{14})_([0-9a-f]{6})_([^/]+?)(?:\/migration\.sql|\.sql)$/.exec(filePath);
  if (hashed?.[1] && hashed[2] && hashed[3]) {
    return { timestamp: hashed[1], hash: hashed[2], slug: hashed[3], sequence: null };
  }
  const legacy = /(?:^|\/)(\d{14})_([^/]+?)(?:\/migration\.sql|\.sql)$/.exec(filePath);
  return {
    timestamp: legacy?.[1] ?? "",
    hash: "",
    slug: legacy?.[2] ?? filePath,
    sequence: null,
  };
}

function sequentialFindings(files: readonly MigrationFile[], activeFeatureCount: number): MigrationFinding[] {
  if (activeFeatureCount < 2) return [];
  const findings: MigrationFinding[] = [];
  for (const file of files) {
    if (file.tool !== "timestamp-hash") continue;
    const base = file.path.split("/").pop() ?? file.path;
    if (/^\d{14}_[0-9a-f]{6}_/.test(base)) continue;
    if (/^\d{1,4}_/.test(base)) {
      findings.push({
        code: "sequential_filename",
        message: `${file.path} uses a sequential migration number while ${activeFeatureCount} features are in parallel. Use YYYYMMDDHHMMSS_<hash>_<slug>.sql.`,
        featureIds: [file.featureId],
        objectName: file.path,
        migrationIds: [file.id],
      });
    }
  }
  return findings;
}

function duplicateFindings(files: readonly MigrationFile[]): MigrationFinding[] {
  const seen = new Map<string, MigrationFile>();
  const findings: MigrationFinding[] = [];
  for (const file of files) {
    for (const statement of parseDdl(file.sql)) {
      const key = objectKey(statement);
      if (!key) continue;
      const previous = seen.get(key);
      if (previous && previous.featureId !== file.featureId) {
        findings.push({
          code: "duplicate_object",
          message: `${previous.featureId} and ${file.featureId} both create ${key}.`,
          featureIds: [previous.featureId, file.featureId],
          objectName: key,
          migrationIds: [previous.id, file.id],
        });
      } else if (!previous) {
        seen.set(key, file);
      }
    }
  }
  return findings;
}

function objectKey(statement: ReturnType<typeof parseDdl>[number]): string | null {
  if (statement.kind === "create_table" && statement.name) return `table:${statement.name}`;
  if (statement.kind === "create_index" && statement.name) return `index:${statement.name}`;
  if (statement.kind === "create_enum" && statement.name) return `enum:${statement.name}`;
  return null;
}

function columnFindings(files: readonly MigrationFile[]): MigrationFinding[] {
  const uses = new Map<string, { file: MigrationFile; uses: Set<string> }[]>();
  for (const file of files) {
    for (const statement of parseDdl(file.sql)) {
      const table = statement.table;
      const columns =
        statement.kind === "rename_column" && statement.column
          ? [statement.column]
          : statement.columns.length > 0
            ? statement.columns
            : statement.column
              ? [statement.column]
              : [];
      for (const column of columns) {
        if (!table) continue;
        const key = `${table}.${column}`;
        const bucket = uses.get(key) ?? [];
        const existing = bucket.find((item) => item.file.id === file.id);
        const use = columnUse(statement.kind);
        if (existing) existing.uses.add(use);
        else bucket.push({ file, uses: new Set([use]) });
        uses.set(key, bucket);
      }
    }
  }
  const findings: MigrationFinding[] = [];
  for (const [objectName, bucket] of uses) {
    for (let left = 0; left < bucket.length; left += 1) {
      for (let right = left + 1; right < bucket.length; right += 1) {
        const a = bucket[left];
        const b = bucket[right];
        if (!a || !b || a.file.featureId === b.file.featureId) continue;
        const destructive = new Set(["drop", "rename"]);
        const dependent = new Set(["index", "fk", "add", "alter"]);
        const clashes =
          [...a.uses].some((use) => destructive.has(use) && [...b.uses].some((other) => dependent.has(other) || other === "drop")) ||
          [...b.uses].some((use) => destructive.has(use) && [...a.uses].some((other) => dependent.has(other)));
        if (!clashes) continue;
        findings.push({
          code: "incompatible_column",
          message: `${a.file.featureId} and ${b.file.featureId} change ${objectName} incompatibly (${[...a.uses].join("+")} vs ${[...b.uses].join("+")}).`,
          featureIds: [a.file.featureId, b.file.featureId],
          objectName,
          migrationIds: [a.file.id, b.file.id],
        });
      }
    }
  }
  return findings;
}

function columnUse(kind: string): string {
  if (kind === "drop_column") return "drop";
  if (kind === "rename_column") return "rename";
  if (kind === "create_index") return "index";
  if (kind === "add_foreign_key") return "fk";
  if (kind === "add_column") return "add";
  if (kind === "alter_column") return "alter";
  return kind;
}

function foreignKeyFindings(files: readonly MigrationFile[], baseline: readonly string[]): MigrationFinding[] {
  const creators = new Map<string, MigrationFile>();
  for (const file of files) {
    for (const table of createdTables(parseDdl(file.sql))) {
      const existing = creators.get(table);
      if (!existing || file.timestamp < existing.timestamp) creators.set(table, file);
    }
  }
  const findings: MigrationFinding[] = [];
  for (const file of files) {
    for (const statement of parseDdl(file.sql)) {
      if (!statement.targetTable) continue;
      if (baseline.includes(statement.targetTable)) continue;
      const creator = creators.get(statement.targetTable);
      if (!creator || creator.featureId === file.featureId) continue;
      if (file.timestamp > creator.timestamp) continue;
      if (dependsOnCreator(file, creator, statement.targetTable)) continue;
      findings.push({
        code: "fk_order",
        message: `${file.featureId} references ${statement.targetTable} at ${file.timestamp || "sequence"}, before ${creator.featureId} creates it at ${creator.timestamp}. Re-stamp the foreign key or declare depends_on.`,
        featureIds: [file.featureId, creator.featureId],
        objectName: statement.targetTable,
        migrationIds: [file.id, creator.id],
      });
    }
  }
  return findings;
}

function dependsOnCreator(file: MigrationFile, creator: MigrationFile, table: string): boolean {
  return file.dependsOn.includes(table) || file.dependsOn.includes(creator.id) || file.dependsOn.includes(creator.path);
}

function skeletonFindings(files: readonly MigrationFile[], skeleton: SkeletonLockPort): MigrationFinding[] {
  const findings: MigrationFinding[] = [];
  for (const file of files) {
    for (const statement of parseDdl(file.sql)) {
      if (!statement.destructive) continue;
      const elements: SkeletonElement[] = [];
      if (statement.kind === "drop_table" || statement.kind === "rename_table") {
        if (statement.table) elements.push({ kind: "table", name: statement.table, table: null });
      }
      if (statement.column && statement.table) {
        elements.push({ kind: "column", name: statement.column, table: statement.table });
      }
      for (const element of elements) {
        if (skeleton.destructiveAllowed(element, file.ccrId)) continue;
        if (!skeleton.isLocked(element)) continue;
        findings.push({
          code: "destructive_skeleton",
          message: `${file.featureId} applies destructive DDL to locked skeleton ${element.kind} ${element.table ? `${element.table}.` : ""}${element.name} without a CCR.`,
          featureIds: [file.featureId],
          objectName: element.table ? `${element.table}.${element.name}` : element.name,
          migrationIds: [file.id],
        });
      }
    }
  }
  return findings;
}

function sequencePlan(files: readonly MigrationFile[]): {
  findings: MigrationFinding[];
  plan: SequenceAssignment[];
} {
  const numbered = files.filter((file) => file.tool === "drizzle" && file.sequence !== null);
  const groups = new Map<number, MigrationFile[]>();
  for (const file of numbered) {
    const sequence = file.sequence ?? 0;
    const bucket = groups.get(sequence) ?? [];
    bucket.push(file);
    groups.set(sequence, bucket);
  }
  const findings: MigrationFinding[] = [];
  const plan: SequenceAssignment[] = [];
  const used = new Set(numbered.map((file) => file.sequence ?? 0));
  for (const [sequence, bucket] of groups) {
    const features = new Set(bucket.map((file) => file.featureId));
    if (features.size < 2) continue;
    findings.push({
      code: "sequence_collision",
      message: `Drizzle sequence ${sequence.toString().padStart(4, "0")} is claimed by ${[...features].join(" and ")}. Task 111 must apply the serialized sequence plan.`,
      featureIds: [...features],
      objectName: sequence.toString().padStart(4, "0"),
      migrationIds: bucket.map((file) => file.id),
    });
    const sorted = [...bucket].sort((left, right) => left.featureId.localeCompare(right.featureId));
    sorted.forEach((file, index) => {
      if (index === 0) return;
      let next = sequence + index;
      while (used.has(next)) next += 1;
      used.add(next);
      plan.push({
        featureId: file.featureId,
        migrationId: file.id,
        fromSequence: sequence,
        toSequence: next,
        fileName: `drizzle/${next.toString().padStart(4, "0")}_${file.slug}.sql`,
      });
    });
  }
  return { findings, plan };
}

function compareMigrationFiles(left: MigrationFile, right: MigrationFile): number {
  if (left.timestamp !== right.timestamp) return left.timestamp < right.timestamp ? -1 : 1;
  if (left.hash !== right.hash) return left.hash < right.hash ? -1 : 1;
  if (left.sequence !== right.sequence) return (left.sequence ?? 0) - (right.sequence ?? 0);
  return left.path < right.path ? -1 : left.path > right.path ? 1 : 0;
}

function dependenciesReady(
  file: MigrationFile,
  pending: readonly MigrationFile[],
  placed: ReadonlySet<string>,
  tables: ReadonlySet<string>,
): boolean {
  for (const dependency of file.dependsOn) {
    if (tables.has(dependency) || placed.has(dependency)) continue;
    const creator = pending.find(
      (candidate) =>
        candidate.id !== file.id &&
        (createdTables(parseDdl(candidate.sql)).includes(dependency) ||
          candidate.id === dependency ||
          candidate.path === dependency),
    );
    if (creator && !placed.has(creator.id)) return false;
  }
  return true;
}
