import { createHash } from "node:crypto";
import {
  DEFAULT_LM_STUDIO_ORIGIN,
  DEFAULT_OLLAMA_ORIGIN,
  LM_STUDIO_STOPPED_MESSAGE,
  LOCAL_SLOT_CURRENCY,
  NO_LOCAL_SERVERS_MESSAGE,
  OLLAMA_STOPPED_MESSAGE,
  type LocalServerKind,
} from "./constants.js";
import { OpenRouterLocalError } from "./errors.js";
import { clampDiscoveryTimeout, fetchWithTimeout, isConnectionRefused } from "./http.js";
import { arrayField, isRecord, numberField, readJsonResponse, recordField, stringField } from "./json.js";
import { assertDiscoveryUrl } from "./loopback-url.js";
import type {
  DiscoveredLocalModel,
  FetchPort,
  GlobalConnectionRecord,
  GlobalConnectionsPort,
  LocalServerDiagnosis,
} from "./ports.js";

export interface DiscoverySettings {
  readonly ollamaOrigin?: string;
  readonly lmStudioOrigin?: string;
  readonly allowLanHost?: boolean;
  readonly timeoutMs?: number;
  readonly configured?: { readonly ollama?: boolean; readonly lmStudio?: boolean };
  readonly fetchImpl?: FetchPort;
  readonly now?: () => number;
}

export interface ServerProbeOk {
  readonly status: "ok";
  readonly modelCount: number;
}

export interface ServerProbeDown {
  readonly status: "down";
  readonly refused: boolean;
}

export type ServerProbe = ServerProbeOk | ServerProbeDown;

export interface DiscoveryReport {
  readonly models: readonly DiscoveredLocalModel[];
  readonly ollama: ServerProbe;
  readonly lmStudio: ServerProbe;
  readonly emptyMessage: string | null;
  readonly diagnoses: readonly LocalServerDiagnosis[];
  readonly elapsedMs: number;
  readonly cloudCalls: 0;
}

interface OllamaTag {
  readonly name: string;
  readonly digest: string;
  readonly modelBytes: number | null;
  readonly parameterSize: string | null;
  readonly quantization: string | null;
  readonly family: string | null;
}

export function diagnosisForStoppedServer(server: LocalServerKind): LocalServerDiagnosis {
  return {
    server,
    paused: true,
    retryable: true,
    message: server === "ollama" ? OLLAMA_STOPPED_MESSAGE : LM_STUDIO_STOPPED_MESSAGE,
  };
}

export function configuredNumCtxFromParameters(parameters: string | null): number | null {
  if (parameters === null) return null;
  const match = /(?:^|[\s;])num_ctx\s+(\d+)/.exec(parameters);
  const digits = match?.[1];
  if (digits === undefined) return null;
  const parsed = Number(digits);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function architectureContextFromInfo(info: Record<string, unknown> | null): number | null {
  if (info === null) return null;
  let best: number | null = null;
  for (const [key, value] of Object.entries(info)) {
    if (!key.endsWith("context_length") && key !== "context_length") continue;
    if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) continue;
    if (best === null || value > best) best = value;
  }
  return best;
}

export class LocalModelAutoDiscoverer {
  constructor(private readonly settings: DiscoverySettings = {}) {}

  async discover(): Promise<DiscoveryReport> {
    const started = this.settings.now?.() ?? Date.now();
    const allowLan = this.settings.allowLanHost === true;
    const timeoutMs = clampDiscoveryTimeout(this.settings.timeoutMs);
    const fetchImpl = this.settings.fetchImpl ?? fetch;
    const ollamaOrigin = assertDiscoveryUrl(
      this.settings.ollamaOrigin ?? DEFAULT_OLLAMA_ORIGIN,
      allowLan,
    ).origin;
    const lmOrigin = assertDiscoveryUrl(
      this.settings.lmStudioOrigin ?? DEFAULT_LM_STUDIO_ORIGIN,
      allowLan,
    ).origin;
    const [ollama, lmStudio] = await Promise.all([
      probeOllama(fetchImpl, ollamaOrigin, timeoutMs),
      probeLmStudio(fetchImpl, lmOrigin, timeoutMs),
    ]);
    const diagnoses: LocalServerDiagnosis[] = [];
    if (this.settings.configured?.ollama === true && ollama.probe.status === "down" && ollama.probe.refused) {
      diagnoses.push(diagnosisForStoppedServer("ollama"));
    }
    if (this.settings.configured?.lmStudio === true && lmStudio.probe.status === "down" && lmStudio.probe.refused) {
      diagnoses.push(diagnosisForStoppedServer("lm-studio"));
    }
    const models = [...ollama.models, ...lmStudio.models];
    const bothDown = ollama.probe.status === "down" && lmStudio.probe.status === "down";
    const emptyMessage = bothDown && diagnoses.length === 0 ? NO_LOCAL_SERVERS_MESSAGE : null;
    return {
      models,
      ollama: ollama.probe,
      lmStudio: lmStudio.probe,
      emptyMessage,
      diagnoses,
      elapsedMs: (this.settings.now?.() ?? Date.now()) - started,
      cloudCalls: 0,
    };
  }
}

interface ProbeBundle {
  readonly probe: ServerProbe;
  readonly models: readonly DiscoveredLocalModel[];
}

export async function rememberDiscoveredServers(
  connections: GlobalConnectionsPort,
  report: DiscoveryReport,
  now = Date.now(),
): Promise<readonly GlobalConnectionRecord[]> {
  const rows: GlobalConnectionRecord[] = [];
  if (report.ollama.status === "ok") {
    rows.push(localConnection("ollama-local", "ollama", now));
  }
  if (report.lmStudio.status === "ok") {
    rows.push(localConnection("lmstudio-local", "lm-studio", now));
  }
  for (const row of rows) await connections.insert(row);
  return rows;
}

function localConnection(id: string, provider: string, createdAt: number): GlobalConnectionRecord {
  return {
    id,
    provider,
    route: "local",
    plan: null,
    vaultRef: null,
    currency: LOCAL_SLOT_CURRENCY,
    scale: 1,
    enabled: true,
    createdAt,
  };
}

async function probeOllama(
  fetchImpl: FetchPort,
  origin: string,
  timeoutMs: number,
): Promise<ProbeBundle> {
  let tags: readonly OllamaTag[];
  try {
    tags = await readOllamaTags(fetchImpl, origin, timeoutMs);
  } catch (error) {
    return { probe: downFrom(error), models: [] };
  }
  let shows: Map<string, { configuredNumCtx: number | null; architectureContext: number | null; family: string | null; parameterSize: string | null; quantization: string | null }>;
  try {
    shows = await readOllamaShows(fetchImpl, origin, timeoutMs, tags);
  } catch {
    shows = new Map();
  }
  let loaded = new Map<string, number | null>();
  try {
    loaded = await readOllamaPs(fetchImpl, origin, timeoutMs);
  } catch {
    loaded = new Map();
  }
  const models = tags.map((tag) => {
    const show = shows.get(tag.name);
    const vram = loaded.get(tag.name) ?? null;
    return {
      server: "ollama" as const,
      modelId: tag.name,
      family: show?.family ?? tag.family ?? familyFromId(tag.name),
      parameterSize: show?.parameterSize ?? tag.parameterSize,
      quantization: show?.quantization ?? tag.quantization,
      configuredNumCtx: show?.configuredNumCtx ?? null,
      architectureContext: show?.architectureContext ?? null,
      digest: tag.digest,
      modelBytes: tag.modelBytes,
      vramBytes: vram,
      loadedInVram: loaded.has(tag.name),
      baseUrl: origin,
    };
  });
  return { probe: { status: "ok", modelCount: models.length }, models };
}

async function probeLmStudio(
  fetchImpl: FetchPort,
  origin: string,
  timeoutMs: number,
): Promise<ProbeBundle> {
  let ids: readonly string[];
  try {
    ids = await readLmStudioIds(fetchImpl, origin, timeoutMs);
  } catch (error) {
    return { probe: downFrom(error), models: [] };
  }
  const native = await readLmStudioNative(fetchImpl, origin, timeoutMs);
  const models = ids.map((id) => {
    const meta = native.get(id);
    return {
      server: "lm-studio" as const,
      modelId: id,
      family: meta?.family ?? familyFromId(id),
      parameterSize: meta?.parameterSize ?? null,
      quantization: meta?.quantization ?? null,
      configuredNumCtx: meta?.context ?? null,
      architectureContext: meta?.context ?? null,
      digest: meta?.digest ?? digestFor(id, meta?.context ?? null, meta?.quantization ?? null),
      modelBytes: meta?.modelBytes ?? null,
      vramBytes: null,
      loadedInVram: meta?.loaded === true,
      baseUrl: origin,
    };
  });
  return { probe: { status: "ok", modelCount: models.length }, models };
}

function downFrom(error: unknown): ServerProbeDown {
  return { status: "down", refused: error instanceof OpenRouterLocalError ? error.code === "connection-refused" : isConnectionRefused(error) };
}

async function readOllamaTags(fetchImpl: FetchPort, origin: string, timeoutMs: number): Promise<readonly OllamaTag[]> {
  const body = await getJson(fetchImpl, `${origin}/api/tags`, timeoutMs);
  if (!isRecord(body)) return [];
  const models = arrayField(body, "models") ?? [];
  const tags: OllamaTag[] = [];
  for (const entry of models) {
    if (!isRecord(entry)) continue;
    const name = stringField(entry, "name") ?? stringField(entry, "model");
    if (name === null) continue;
    const details = recordField(entry, "details");
    tags.push({
      name,
      digest: stringField(entry, "digest") ?? digestFor(name, numberField(entry, "size"), stringField(details ?? {}, "quantization_level")),
      modelBytes: numberField(entry, "size"),
      parameterSize: details ? stringField(details, "parameter_size") : null,
      quantization: details ? stringField(details, "quantization_level") : null,
      family: details ? stringField(details, "family") : null,
    });
  }
  return tags;
}

async function readOllamaShows(
  fetchImpl: FetchPort,
  origin: string,
  timeoutMs: number,
  tags: readonly OllamaTag[],
): Promise<
  Map<
    string,
    {
      configuredNumCtx: number | null;
      architectureContext: number | null;
      family: string | null;
      parameterSize: string | null;
      quantization: string | null;
    }
  >
> {
  const pairs = await Promise.all(
    tags.map(async (tag) => {
      const body = await postJson(fetchImpl, `${origin}/api/show`, { name: tag.name }, timeoutMs);
      if (!isRecord(body)) return [tag.name, null] as const;
      const details = recordField(body, "details");
      const parameters = typeof body.parameters === "string" ? body.parameters : null;
      return [
        tag.name,
        {
          configuredNumCtx: configuredNumCtxFromParameters(parameters),
          architectureContext: architectureContextFromInfo(recordField(body, "model_info")),
          family: details ? stringField(details, "family") : null,
          parameterSize: details ? stringField(details, "parameter_size") : null,
          quantization: details ? stringField(details, "quantization_level") : null,
        },
      ] as const;
    }),
  );
  const map = new Map<
    string,
    {
      configuredNumCtx: number | null;
      architectureContext: number | null;
      family: string | null;
      parameterSize: string | null;
      quantization: string | null;
    }
  >();
  for (const [name, value] of pairs) {
    if (value) map.set(name, value);
  }
  return map;
}

async function readOllamaPs(
  fetchImpl: FetchPort,
  origin: string,
  timeoutMs: number,
): Promise<Map<string, number | null>> {
  const body = await postJson(fetchImpl, `${origin}/api/ps`, {}, timeoutMs);
  const map = new Map<string, number | null>();
  if (!isRecord(body)) return map;
  const models = arrayField(body, "models") ?? [];
  for (const entry of models) {
    if (!isRecord(entry)) continue;
    const name = stringField(entry, "name") ?? stringField(entry, "model");
    if (name === null) continue;
    map.set(name, numberField(entry, "size_vram"));
  }
  return map;
}

async function readLmStudioIds(fetchImpl: FetchPort, origin: string, timeoutMs: number): Promise<readonly string[]> {
  const body = await getJson(fetchImpl, `${origin}/v1/models`, timeoutMs);
  if (!isRecord(body)) return [];
  const data = arrayField(body, "data") ?? [];
  const ids: string[] = [];
  for (const entry of data) {
    if (!isRecord(entry)) continue;
    const id = stringField(entry, "id");
    if (id) ids.push(id);
  }
  return ids;
}

interface LmNative {
  readonly context: number | null;
  readonly quantization: string | null;
  readonly family: string | null;
  readonly parameterSize: string | null;
  readonly loaded: boolean;
  readonly modelBytes: number | null;
  readonly digest: string;
}

async function readLmStudioNative(
  fetchImpl: FetchPort,
  origin: string,
  timeoutMs: number,
): Promise<Map<string, LmNative>> {
  const map = new Map<string, LmNative>();
  let body: unknown;
  try {
    body = await getJson(fetchImpl, `${origin}/api/v0/models`, timeoutMs);
  } catch {
    return map;
  }
  if (!isRecord(body)) return map;
  const data = arrayField(body, "data") ?? [];
  for (const entry of data) {
    if (!isRecord(entry)) continue;
    const id = stringField(entry, "id");
    if (id === null) continue;
    const context = numberField(entry, "max_context_length");
    const quantization = stringField(entry, "quantization");
    const state = stringField(entry, "state");
    map.set(id, {
      context,
      quantization,
      family: stringField(entry, "architecture") ?? stringField(entry, "arch"),
      parameterSize: stringField(entry, "params") ?? stringField(entry, "parameter_size"),
      loaded: state === "loaded",
      modelBytes: numberField(entry, "size_bytes") ?? numberField(entry, "size"),
      digest: stringField(entry, "digest") ?? digestFor(id, context, quantization),
    });
  }
  return map;
}

async function getJson(fetchImpl: FetchPort, url: string, timeoutMs: number): Promise<unknown> {
  const response = await request(fetchImpl, url, { method: "GET", headers: { accept: "application/json" } }, timeoutMs);
  if (response.status === 404) {
    throw new OpenRouterLocalError("not-found", "local endpoint is missing");
  }
  if (response.status >= 400) {
    throw new OpenRouterLocalError("local-http", `local endpoint returned ${response.status}`);
  }
  return readJsonResponse(response);
}

async function postJson(fetchImpl: FetchPort, url: string, body: unknown, timeoutMs: number): Promise<unknown> {
  const response = await request(
    fetchImpl,
    url,
    {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify(body),
    },
    timeoutMs,
  );
  if (response.status >= 400) {
    throw new OpenRouterLocalError("local-http", `local endpoint returned ${response.status}`);
  }
  return readJsonResponse(response);
}

async function request(fetchImpl: FetchPort, url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  try {
    return await fetchWithTimeout(fetchImpl, url, init, timeoutMs);
  } catch (error) {
    if (isConnectionRefused(error)) {
      throw new OpenRouterLocalError("connection-refused", "connection refused");
    }
    if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) {
      throw new OpenRouterLocalError("timeout", `local probe exceeded ${timeoutMs} ms`);
    }
    throw error;
  }
}

function familyFromId(modelId: string): string {
  const head = modelId.split(":")[0] ?? modelId;
  return head.replace(/[-_]?\d+(\.\d+)?b$/i, "") || head;
}

function digestFor(id: string, size: number | null, quant: string | null): string {
  return createHash("sha256").update(`${id}|${size ?? ""}|${quant ?? ""}`).digest("hex");
}
