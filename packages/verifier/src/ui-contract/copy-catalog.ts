import { CopyCatalogLintError, DuplicateControlNameError } from "./errors.js";
import { requireFromRepository } from "./module-root.js";
import { TextMatchNormalizer } from "./text-match.js";
import type {
  CopyCatalog,
  CopyCatalogEntry,
  CopyLintIssue,
  MatchMode,
  RegionScope,
  TextSpec,
  UiInteractionContract,
} from "./types.js";

const ALWAYS_GENERIC = new Set([
  "click here",
  "submit",
  "button",
  "here",
  "link",
  "untitled",
  "label",
  "text",
  "item",
]);

const ACTION_VERBS = new Set([
  "print",
  "retry",
  "save",
  "delete",
  "remove",
  "cancel",
  "create",
  "add",
  "edit",
  "update",
  "close",
  "open",
  "refresh",
  "reload",
  "export",
  "import",
  "download",
  "upload",
  "search",
  "filter",
  "sort",
  "apply",
  "reset",
  "continue",
  "back",
  "next",
  "previous",
  "confirm",
  "dismiss",
  "copy",
  "share",
  "send",
  "view",
  "show",
  "hide",
  "expand",
  "collapse",
  "select",
  "clear",
  "start",
  "stop",
  "pause",
  "resume",
  "approve",
  "reject",
  "archive",
  "restore",
  "rename",
  "move",
  "enable",
  "disable",
  "connect",
  "disconnect",
  "run",
  "publish",
  "invite",
  "revoke",
  "mark",
  "complete",
  "undo",
  "redo",
]);

/** Action verbs that are not also field or landmark labels. */
const ACTION_ONLY = new Set([
  "print",
  "retry",
  "save",
  "delete",
  "remove",
  "cancel",
  "create",
  "add",
  "edit",
  "update",
  "close",
  "open",
  "refresh",
  "reload",
  "export",
  "import",
  "download",
  "upload",
  "apply",
  "reset",
  "continue",
  "confirm",
  "dismiss",
  "copy",
  "share",
  "send",
  "approve",
  "reject",
  "archive",
  "restore",
]);

const MATCH_MODES = new Set<MatchMode>(["normalized", "exact", "contains"]);

interface YamlApi {
  parse(source: string): unknown;
}

let yamlApi: YamlApi | undefined;

function loadYaml(): YamlApi {
  if (yamlApi) return yamlApi;
  const loaded = requireFromRepository<YamlApi>("yaml");
  if (typeof loaded.parse !== "function") {
    throw new CopyCatalogLintError("The yaml package does not export parse", "empty_label", []);
  }
  yamlApi = loaded;
  return loaded;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function screenFromKey(key: string, explicit: unknown): string {
  if (typeof explicit === "string" && explicit.trim().length > 0) return explicit.trim();
  const screen = key.split(".")[0]?.trim() ?? "";
  if (!screen) throw new CopyCatalogLintError(`Copy key ${key} has no screen`, "empty_label", []);
  return screen;
}

function readMode(value: unknown): MatchMode {
  if (value === undefined) return "normalized";
  if (typeof value === "string" && MATCH_MODES.has(value as MatchMode)) return value as MatchMode;
  throw new CopyCatalogLintError("matchMode must be normalized, exact, or contains", "role_name_mismatch", []);
}

function readWithin(value: unknown, mode: MatchMode): RegionScope | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value) || typeof value.role !== "string" || value.role.trim().length === 0) {
    throw new CopyCatalogLintError("within must be { role }", "role_name_mismatch", []);
  }
  if (typeof value.name !== "string") return { role: value.role };
  return { role: value.role, name: { text: value.name, matchMode: mode } };
}

function entryFromValue(key: string, value: unknown): CopyCatalogEntry {
  if (typeof value === "string") {
    return {
      key,
      text: value,
      screen: screenFromKey(key, undefined),
      matchMode: "normalized",
    };
  }
  if (!isRecord(value) || typeof value.text !== "string") {
    throw new CopyCatalogLintError(`Copy entry ${key} needs text`, "empty_label", []);
  }
  const mode = readMode(value.matchMode);
  const within = readWithin(value.within, mode);
  const entry: {
    key: string;
    text: string;
    screen: string;
    role?: string;
    matchMode: MatchMode;
    within?: RegionScope;
    testid?: string;
  } = {
    key,
    text: value.text,
    screen: screenFromKey(key, value.screen),
    matchMode: mode,
  };
  if (typeof value.role === "string" && value.role.trim().length > 0) entry.role = value.role;
  if (within) entry.within = within;
  if (typeof value.testid === "string" && value.testid.trim().length > 0) entry.testid = value.testid;
  return entry;
}

function parseDocument(input: unknown): unknown {
  if (typeof input !== "string") return input;
  const trimmed = input.trim();
  if (!trimmed) throw new CopyCatalogLintError("Copy catalog is empty", "empty_label", []);
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return JSON.parse(trimmed) as unknown;
    } catch {
      return loadYaml().parse(trimmed);
    }
  }
  return loadYaml().parse(trimmed);
}

function parseEntries(value: unknown): CopyCatalog {
  const document = parseDocument(value);
  if (isRecord(document) && Array.isArray(document.entries)) {
    const entries = document.entries.map((item) => {
      if (!isRecord(item) || typeof item.key !== "string") {
        throw new CopyCatalogLintError("Catalog entries need a key", "empty_label", []);
      }
      return entryFromValue(item.key, item);
    });
    return { entries };
  }
  if (!isRecord(document)) {
    throw new CopyCatalogLintError("Copy catalog must be a map of keys", "empty_label", []);
  }
  return { entries: Object.entries(document).map(([key, body]) => entryFromValue(key, body)) };
}

function scopeToken(entry: CopyCatalogEntry): string {
  if (entry.testid) return `testid:${entry.testid}`;
  if (!entry.within) return "unscoped";
  return `within:${entry.within.role}:${entry.within.name?.text ?? ""}`;
}

function isScoped(entry: CopyCatalogEntry): boolean {
  return entry.testid !== undefined || entry.within !== undefined;
}

function isActionNamed(normalized: string): boolean {
  const first = normalized.split(" ")[0] ?? "";
  return ACTION_VERBS.has(first);
}

function rejectsActionOnlyName(role: string): boolean {
  const kind = role.toLowerCase();
  return (
    kind === "heading" ||
    kind === "textbox" ||
    kind === "combobox" ||
    kind === "searchbox" ||
    kind === "table" ||
    kind === "navigation" ||
    kind === "main" ||
    kind === "form" ||
    kind === "banner" ||
    kind === "progressbar" ||
    kind === "status" ||
    kind === "alert"
  );
}

function inspectCatalog(catalog: CopyCatalog): CopyLintIssue[] {
  const normalizer = new TextMatchNormalizer();
  const issues: CopyLintIssue[] = [];
  const groups = new Map<string, CopyCatalogEntry[]>();
  for (const entry of catalog.entries) {
    const normalized = normalizer.normalize(entry.text);
    const scoped = isScoped(entry);
    if (entry.text.trim().length === 0 || normalized.length === 0) {
      issues.push({
        code: "empty_label",
        key: entry.key,
        screen: entry.screen,
        message: `Empty accessible name for ${entry.key}`,
      });
      continue;
    }
    const generic =
      ALWAYS_GENERIC.has(normalized) || ((normalized === "ok" || normalized === "okay") && !scoped);
    if (generic) {
      issues.push({
        code: "generic_label",
        key: entry.key,
        screen: entry.screen,
        message: `Generic label "${entry.text}" for ${entry.key}`,
      });
    }
    if (entry.role?.toLowerCase() === "button" && !generic && !isActionNamed(normalized)) {
      issues.push({
        code: "button_not_named_by_action",
        key: entry.key,
        screen: entry.screen,
        message: `Button ${entry.key} is not named by its action ("${entry.text}")`,
      });
    } else if (
      entry.role &&
      !generic &&
      entry.role.toLowerCase() !== "button" &&
      rejectsActionOnlyName(entry.role) &&
      ACTION_ONLY.has(normalized)
    ) {
      issues.push({
        code: "role_name_mismatch",
        key: entry.key,
        screen: entry.screen,
        message: `Name "${entry.text}" is incompatible with role ${entry.role} on ${entry.key}`,
      });
    }
    const groupKey = `${entry.screen}:${normalized}`;
    const list = groups.get(groupKey) ?? [];
    list.push(entry);
    groups.set(groupKey, list);
  }
  for (const entries of groups.values()) {
    if (entries.length < 2) continue;
    const scopes = entries.map(scopeToken);
    const unique = new Set(scopes);
    if (unique.size === entries.length && !scopes.includes("unscoped")) continue;
    const sample = entries[0];
    if (!sample) continue;
    issues.push({
      code: "duplicate_accessible_name",
      key: sample.key,
      screen: sample.screen,
      message: `Duplicate accessible name "${sample.text}" on screen ${sample.screen} without region scoping`,
    });
  }
  return issues;
}

function throwIssues(issues: readonly CopyLintIssue[]): never {
  const first = issues[0];
  const message = issues.map((issue) => issue.message).join("; ");
  if (first?.code === "duplicate_accessible_name") {
    throw new DuplicateControlNameError(message, issues);
  }
  throw new CopyCatalogLintError(message, first?.code ?? "generic_label", issues);
}

function withCatalogText(spec: TextSpec, catalog: CopyCatalog): TextSpec {
  if (!spec.copyKey) return spec;
  const entry = catalog.entries.find((item) => item.key === spec.copyKey);
  if (!entry) {
    throw new CopyCatalogLintError(`Copy catalog is missing ${spec.copyKey}`, "empty_label", []);
  }
  if (spec.text.length > 0 && spec.text !== entry.text) {
    throw new CopyCatalogLintError(
      `Contract text for ${spec.copyKey} does not match the copy catalog`,
      "role_name_mismatch",
      [],
    );
  }
  return { text: entry.text, matchMode: spec.matchMode, copyKey: spec.copyKey };
}

/**
 * Lints planner-owned copy catalogs before task dispatch.
 * Workers render these keys; checks locate elements by the catalog value.
 */
export class CopyCatalogLinter {
  lint(input: unknown): CopyCatalog {
    const catalog = parseEntries(input);
    const issues = inspectCatalog(catalog);
    if (issues.length > 0) throwIssues(issues);
    return catalog;
  }

  inspect(input: unknown): readonly CopyLintIssue[] {
    return inspectCatalog(parseEntries(input));
  }
}

/** Resolves copy keys and rejects contract strings that are not catalog entries. */
export function bindCopyCatalog(contract: UiInteractionContract, catalog: CopyCatalog): UiInteractionContract {
  const normalizer = new TextMatchNormalizer();
  const known = catalog.entries.map((entry) => normalizer.normalize(entry.text));
  const mapText = (spec: TextSpec | undefined): TextSpec | undefined => {
    if (!spec) return undefined;
    const bound = withCatalogText(spec, catalog);
    if (!spec.copyKey && !known.includes(normalizer.normalize(bound.text))) {
      throw new CopyCatalogLintError(
        `Visible contract text "${bound.text}" is not in the copy catalog`,
        "role_name_mismatch",
        [],
      );
    }
    return bound;
  };
  return {
    ...contract,
    landmarks: contract.landmarks.map((landmark) => {
      const name = mapText(landmark.name);
      const columns = landmark.columns?.map((column) => mapText(column) ?? column);
      return {
        role: landmark.role,
        ...(name ? { name } : {}),
        ...(columns ? { columns } : {}),
        ...(landmark.within ? { within: landmark.within } : {}),
      };
    }),
    actions: contract.actions.map((action) => {
      const name = mapText(action.name);
      if (!name) return action;
      return { ...action, name };
    }),
    states: contract.states.map((state) => {
      const text = mapText(state.text);
      const accessibleName = mapText(state.accessibleName);
      return {
        name: state.name,
        ...(text ? { text } : {}),
        ...(state.role ? { role: state.role } : {}),
        ...(accessibleName ? { accessibleName } : {}),
        ...(state.viewAs ? { viewAs: state.viewAs } : {}),
      };
    }),
  };
}
