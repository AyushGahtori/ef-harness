import { ContractSchemaError } from "./errors.js";
import { requireFromRepository } from "./module-root.js";
import type {
  ActionInteraction,
  ActionRole,
  ActionSpec,
  ContractStateName,
  LandmarkRole,
  LandmarkSpec,
  MatchMode,
  RegionScope,
  StateSpec,
  TextSpec,
  UiInteractionContract,
} from "./types.js";

const LANDMARK_ROLES = new Set<LandmarkRole>(["heading", "table", "navigation", "main", "form"]);
const ACTION_ROLES = new Set<ActionRole>(["button", "link", "textbox", "combobox"]);
const STATE_NAMES = new Set<ContractStateName>([
  "empty",
  "loading",
  "error",
  "unauthorized",
  "populated",
]);
const MATCH_MODES = new Set<MatchMode>(["normalized", "exact", "contains"]);
const INTERACTIONS = new Set<ActionInteraction>(["click", "fill", "select"]);

interface YamlApi {
  parse(source: string): unknown;
}

let yamlApi: YamlApi | undefined;

function loadYaml(): YamlApi {
  if (yamlApi) return yamlApi;
  const loaded = requireFromRepository<YamlApi>("yaml");
  if (typeof loaded.parse !== "function") {
    throw new ContractSchemaError("The yaml package does not export parse");
  }
  yamlApi = loaded;
  return loaded;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function textSource(body: Record<string, unknown>): Record<string, unknown> | undefined {
  if (typeof body.text !== "string" && typeof body.name !== "string" && typeof body.copyKey !== "string") {
    return undefined;
  }
  const source: Record<string, unknown> = {};
  if (typeof body.text === "string") source.text = body.text;
  if (typeof body.name === "string") source.name = body.name;
  if (typeof body.copyKey === "string") source.copyKey = body.copyKey;
  if (body.matchMode !== undefined) source.matchMode = body.matchMode;
  return source;
}

function readMode(value: unknown, fallback: MatchMode): MatchMode {
  if (value === undefined) return fallback;
  if (typeof value === "string" && MATCH_MODES.has(value as MatchMode)) return value as MatchMode;
  throw new ContractSchemaError("matchMode must be normalized, exact, or contains");
}

function readText(value: unknown, fallback: MatchMode = "normalized"): TextSpec {
  if (typeof value === "string") {
    if (value.trim().length === 0) throw new ContractSchemaError("Contract text must not be empty");
    return { text: value, matchMode: fallback };
  }
  if (!isRecord(value)) throw new ContractSchemaError("Contract text must be a string or { text, matchMode }");
  const copyKey = typeof value.copyKey === "string" ? value.copyKey : undefined;
  const raw = typeof value.text === "string" ? value.text : typeof value.name === "string" ? value.name : undefined;
  if (raw === undefined) {
    if (copyKey) return { text: "", matchMode: readMode(value.matchMode, fallback), copyKey };
    throw new ContractSchemaError("Contract text object is missing text");
  }
  const mode = readMode(value.matchMode, fallback);
  if (copyKey) return { text: raw, matchMode: mode, copyKey };
  return { text: raw, matchMode: mode };
}

function readWithin(value: unknown): RegionScope | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value) || typeof value.role !== "string" || value.role.trim().length === 0) {
    throw new ContractSchemaError("within must be { role, name? }");
  }
  if (value.name === undefined) return { role: value.role };
  return { role: value.role, name: readText(value.name) };
}

function singleKey(value: Record<string, unknown>): [string, unknown] | undefined {
  const keys = Object.keys(value);
  if (keys.length !== 1) return undefined;
  const key = keys[0];
  if (!key) return undefined;
  return [key, value[key]];
}

function readLandmark(value: unknown): LandmarkSpec {
  if (typeof value === "string") {
    if (!LANDMARK_ROLES.has(value as LandmarkRole)) {
      throw new ContractSchemaError(`Unknown landmark role ${value}`);
    }
    return { role: value as LandmarkRole };
  }
  if (!isRecord(value)) throw new ContractSchemaError("Landmark must be a role or a one-key map");
  if (typeof value.role === "string") {
    if (!LANDMARK_ROLES.has(value.role as LandmarkRole)) {
      throw new ContractSchemaError(`Unknown landmark role ${value.role}`);
    }
    const role = value.role as LandmarkRole;
    const name = value.name === undefined ? undefined : readText(value.name, readMode(value.matchMode, "normalized"));
    const within = readWithin(value.within);
    const columns = readColumns(value.columns, name?.matchMode ?? "normalized");
    return compactLandmark({
      role,
      ...(name ? { name } : {}),
      ...(columns && columns.length > 0 ? { columns } : {}),
      ...(within ? { within } : {}),
    });
  }
  const pair = singleKey(value);
  if (!pair || !LANDMARK_ROLES.has(pair[0] as LandmarkRole)) {
    throw new ContractSchemaError("Landmark must name heading, table, navigation, main, or form");
  }
  const role = pair[0] as LandmarkRole;
  const body = pair[1];
  if (body === null || body === undefined || body === true) return { role };
  if (typeof body === "string") return { role, name: readText(body) };
  if (!isRecord(body)) throw new ContractSchemaError(`Landmark ${role} has an unreadable body`);
  const mode = readMode(body.matchMode, "normalized");
  const source = textSource(body);
  const name = source === undefined ? undefined : readText(source, mode);
  const columns = readColumns(body.columns, mode);
  const within = readWithin(body.within);
  return compactLandmark({
    role,
    ...(name ? { name } : {}),
    ...(columns && columns.length > 0 ? { columns } : {}),
    ...(within ? { within } : {}),
  });
}

function compactLandmark(input: {
  readonly role: LandmarkRole;
  readonly name?: TextSpec;
  readonly columns?: readonly TextSpec[];
  readonly within?: RegionScope;
}): LandmarkSpec {
  const spec: {
    role: LandmarkRole;
    name?: TextSpec;
    columns?: readonly TextSpec[];
    within?: RegionScope;
  } = { role: input.role };
  if (input.name) spec.name = input.name;
  if (input.columns && input.columns.length > 0) spec.columns = input.columns;
  if (input.within) spec.within = input.within;
  return spec;
}

function readColumns(value: unknown, fallback: MatchMode): readonly TextSpec[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new ContractSchemaError("Table columns must be a list");
  return value.map((item) => readText(item, fallback));
}

function readAction(value: unknown): ActionSpec {
  if (!isRecord(value)) throw new ContractSchemaError("Action must be a map");
  if (typeof value.role === "string") {
    return actionFromBody(value.role, value);
  }
  const pair = singleKey(value);
  if (!pair) throw new ContractSchemaError("Action must name button, link, textbox, or combobox");
  return actionFromBody(pair[0], isRecord(pair[1]) ? { ...pair[1], name: pair[1].name ?? pair[1].text ?? pair[1] } : { name: pair[1] });
}

function actionFromBody(roleValue: string, body: Record<string, unknown>): ActionSpec {
  if (!ACTION_ROLES.has(roleValue as ActionRole)) {
    throw new ContractSchemaError(`Unknown action role ${roleValue}`);
  }
  const role = roleValue as ActionRole;
  const mode = readMode(body.matchMode, "normalized");
  const source = textSource(body);
  const name = source === undefined ? undefined : readText(source, mode);
  const testid = typeof body.testid === "string" ? body.testid : undefined;
  const within = readWithin(body.within);
  const interaction = readInteraction(body.interaction);
  const value = typeof body.value === "string" ? body.value : undefined;
  const spec: {
    role: ActionRole;
    name?: TextSpec;
    testid?: string;
    within?: RegionScope;
    interaction?: ActionInteraction;
    value?: string;
  } = { role };
  if (name && (name.text.length > 0 || name.copyKey)) spec.name = name;
  if (testid) spec.testid = testid;
  if (within) spec.within = within;
  if (interaction) spec.interaction = interaction;
  if (value !== undefined) spec.value = value;
  if (!spec.name && !spec.testid) {
    throw new ContractSchemaError(`Action ${role} needs an accessible name or a declared test id`);
  }
  return spec;
}

function readInteraction(value: unknown): ActionInteraction | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "string" && INTERACTIONS.has(value as ActionInteraction)) return value as ActionInteraction;
  throw new ContractSchemaError("interaction must be click, fill, or select");
}

function readState(name: string, value: unknown): StateSpec {
  if (!STATE_NAMES.has(name as ContractStateName)) {
    throw new ContractSchemaError(`Unknown state ${name}`);
  }
  const stateName = name as ContractStateName;
  if (value === null || value === undefined || value === true) return { name: stateName };
  if (!isRecord(value)) throw new ContractSchemaError(`State ${name} must be a map`);
  const text = value.text === undefined ? undefined : readText(value.text, readMode(value.matchMode, "normalized"));
  const role = typeof value.role === "string" ? value.role : undefined;
  const accessibleName = value.name === undefined ? undefined : readText(value.name);
  let viewAs: string | undefined;
  if (isRecord(value.as) && typeof value.as.role === "string") viewAs = value.as.role;
  const spec: {
    name: ContractStateName;
    text?: TextSpec;
    role?: string;
    accessibleName?: TextSpec;
    viewAs?: string;
  } = { name: stateName };
  if (text) spec.text = text;
  if (role) spec.role = role;
  if (accessibleName) spec.accessibleName = accessibleName;
  if (viewAs) spec.viewAs = viewAs;
  return spec;
}

function readStates(value: unknown): readonly StateSpec[] {
  if (value === undefined) return [];
  if (Array.isArray(value)) {
    return value.map((item) => {
      if (!isRecord(item) || typeof item.name !== "string") {
        throw new ContractSchemaError("State list items need a name");
      }
      const { name, ...rest } = item;
      return readState(name, rest);
    });
  }
  if (!isRecord(value)) throw new ContractSchemaError("states must be a map or a list");
  return Object.entries(value).map(([name, body]) => readState(name, body));
}

function readTestIds(value: unknown): readonly string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.trim().length === 0)) {
    throw new ContractSchemaError("testids must be a list of non-empty strings");
  }
  return value as string[];
}

function assertTestIdPolicy(contract: UiInteractionContract): void {
  const allowed = new Set(contract.testids);
  const named = new Map<string, number>();
  for (const action of contract.actions) {
    if (!action.name) continue;
    const key = `${action.role}:${action.name.text}`;
    named.set(key, (named.get(key) ?? 0) + 1);
  }
  for (const action of contract.actions) {
    if (!action.testid) continue;
    if (!allowed.has(action.testid)) {
      throw new ContractSchemaError(
        `testid ${action.testid} is not declared on the contract. Test ids are only allowed when listed`,
      );
    }
    if (!action.name) continue;
    const copies = named.get(`${action.role}:${action.name.text}`) ?? 0;
    const disambiguated = copies > 1 && (action.within !== undefined || action.testid !== undefined);
    if (!disambiguated) {
      throw new ContractSchemaError(
        `testid ${action.testid} is not allowed on ${action.role} '${action.name.text}' because that control already has a user-facing accessible name`,
      );
    }
  }
}

function parseDocument(input: unknown): unknown {
  if (typeof input !== "string") return input;
  const trimmed = input.trim();
  if (!trimmed) throw new ContractSchemaError("Contract document is empty");
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return JSON.parse(trimmed) as unknown;
    } catch {
      return loadYaml().parse(trimmed);
    }
  }
  return loadYaml().parse(trimmed);
}

function interpret(value: unknown): UiInteractionContract {
  if (!isRecord(value)) throw new ContractSchemaError("Interaction contract must be a map");
  if (typeof value.contract !== "string" || !value.contract.includes("/") || !value.contract.includes("@")) {
    throw new ContractSchemaError("contract must look like kitchen-list/ui@1");
  }
  if (typeof value.route !== "string" || !value.route.startsWith("/")) {
    throw new ContractSchemaError("route must be an absolute path");
  }
  if (!isRecord(value.as) || typeof value.as.role !== "string" || value.as.role.trim().length === 0) {
    throw new ContractSchemaError("as.role is required");
  }
  const landmarks = Array.isArray(value.landmarks) ? value.landmarks.map(readLandmark) : [];
  if (value.landmarks !== undefined && !Array.isArray(value.landmarks)) {
    throw new ContractSchemaError("landmarks must be a list");
  }
  const actions = Array.isArray(value.actions) ? value.actions.map(readAction) : [];
  if (value.actions !== undefined && !Array.isArray(value.actions)) {
    throw new ContractSchemaError("actions must be a list");
  }
  const contract: UiInteractionContract = {
    contract: value.contract,
    route: value.route,
    as: { role: value.as.role },
    landmarks,
    actions,
    states: readStates(value.states),
    testids: readTestIds(value.testids),
  };
  assertTestIdPolicy(contract);
  return contract;
}

/** Parses planner-published screen contracts, including the YAML shape in the verification guide. */
export const UiInteractionContractSchema = {
  parse(input: unknown): UiInteractionContract {
    return interpret(parseDocument(input));
  },
};
