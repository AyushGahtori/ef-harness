import type { EntityKind, HarnessStateTree, HistoryRecord } from "./types.js";
import { HARNESS_STATE_BRANCH, ENTITY_PATH_PREFIX } from "./types.js";
import { RehydrationError } from "./errors.js";
import { parseEntity, parseLease, parseManifest } from "./yaml-format.js";
import { listTreePaths, readBlobAtPath } from "./git-commands.js";

const ENTITY_PREFIXES = Object.values(ENTITY_PATH_PREFIX);

function entityKindFromPath(filePath: string): EntityKind | null {
  for (const kind of Object.keys(ENTITY_PATH_PREFIX) as EntityKind[]) {
    const prefix = `${ENTITY_PATH_PREFIX[kind]}/`;
    if (filePath.startsWith(prefix) && filePath.endsWith(".yaml")) return kind;
  }
  return null;
}

function parseHistoryFile(content: string, filePath: string): HistoryRecord[] {
  const records: HistoryRecord[] = [];
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const value = JSON.parse(trimmed) as HistoryRecord;
      records.push(value);
    } catch {
      throw new RehydrationError("history_invalid", `invalid history line in ${filePath}`);
    }
  }
  return records;
}

export class HarnessStateReader {
  constructor(
    private readonly repoPath: string,
    private readonly ref: string = HARNESS_STATE_BRANCH,
  ) {}

  readTree(): HarnessStateTree {
    const paths = listTreePaths(this.repoPath, this.ref).filter(
      (path) => !path.startsWith("views/") && path !== "views",
    );
    const filesByPath: Record<string, string> = {};
    for (const filePath of paths) {
      const content = readBlobAtPath(this.repoPath, this.ref, filePath);
      if (content !== null) filesByPath[filePath] = content;
    }

    const manifestText = filesByPath["manifest.yaml"];
    const leaseText = filesByPath["lease.yaml"];
    if (!manifestText || !leaseText) {
      throw new RehydrationError("yaml_invalid", "manifest.yaml or lease.yaml missing on harness-state");
    }

    const entities = [];
    for (const filePath of paths) {
      if (!ENTITY_PREFIXES.some((prefix) => filePath.startsWith(`${prefix}/`))) continue;
      const kind = entityKindFromPath(filePath);
      if (!kind) continue;
      const text = filesByPath[filePath];
      if (text === undefined) continue;
      const entity = parseEntity(text, filePath);
      if (entity.kind !== kind) {
        throw new RehydrationError("yaml_invalid", `entity kind mismatch for ${filePath}`);
      }
      entities.push(entity);
    }
    entities.sort((left, right) => {
      const byKind = left.kind.localeCompare(right.kind);
      if (byKind !== 0) return byKind;
      return left.id.localeCompare(right.id);
    });

    const history = [];
    for (const filePath of paths) {
      if (!filePath.startsWith("history/") || !filePath.endsWith(".jsonl")) continue;
      const text = filesByPath[filePath];
      if (text === undefined) continue;
      history.push(...parseHistoryFile(text, filePath));
    }
    history.sort((left, right) => left.changeId.localeCompare(right.changeId));

    const sealedChecksByPath: Record<string, string> = {};
    for (const filePath of paths) {
      if (!filePath.startsWith("checks-sealed/") || !filePath.endsWith(".age")) continue;
      const text = filesByPath[filePath];
      if (text !== undefined) sealedChecksByPath[filePath] = text;
    }

    return {
      manifest: parseManifest(manifestText),
      lease: parseLease(leaseText),
      entities,
      history,
      sealedChecksByPath,
      filesByPath,
    };
  }
}