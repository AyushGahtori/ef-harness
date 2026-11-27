import { JSON_RPC_CHANNEL, SUPPORTED_PROTOCOLS, type ProtocolVersion } from "./constants.js";
import { ProtocolVersionMismatchError } from "./errors.js";
import { FrameCodec, type DecodedFrame } from "./frame-codec.js";

export interface JsonRpcErrorBody {
  readonly code: number;
  readonly message: string;
  readonly data?: unknown;
}

export interface JsonRpcRequest {
  readonly jsonrpc: "2.0";
  readonly id: string | number;
  readonly method: string;
  readonly params: unknown;
  readonly op_id?: string;
}

export interface JsonRpcSuccess {
  readonly jsonrpc: "2.0";
  readonly id: string | number | null;
  readonly result: unknown;
}

export interface JsonRpcFailure {
  readonly jsonrpc: "2.0";
  readonly id: string | number | null;
  readonly error: JsonRpcErrorBody;
}

export type JsonRpcResponse = JsonRpcSuccess | JsonRpcFailure;

export interface SessionHello {
  readonly id: string | number;
  readonly token: string;
  readonly protocol: ProtocolVersion;
  readonly client: { readonly name: string; readonly version: string };
}

export interface SessionHelloResult {
  readonly protocol: ProtocolVersion;
  readonly daemonVersion: string;
  readonly capabilities: {
    readonly jsonRpc: true;
    readonly binaryStreams: true;
    readonly maxJsonBytes: number;
    readonly maxBinaryChunkBytes: number;
    readonly protocolVersions: readonly ProtocolVersion[];
    readonly currentProtocol: ProtocolVersion;
  };
}

export function isProtocolVersion(value: string): value is ProtocolVersion {
  return value === "1.0" || value === "1.1";
}

export function negotiateProtocol(protocol: string): ProtocolVersion {
  if (isProtocolVersion(protocol)) return protocol;
  throw new ProtocolVersionMismatchError(protocol, SUPPORTED_PROTOCOLS);
}

export function encodeJsonRpc(message: unknown): Buffer {
  return FrameCodec.encode({
    channel: JSON_RPC_CHANNEL,
    payload: Buffer.from(JSON.stringify(message), "utf8"),
  });
}

export function decodeJsonPayload(frame: DecodedFrame): unknown {
  const text = Buffer.from(frame.payload).toString("utf8");
  return JSON.parse(text) as unknown;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function jsonRpcId(value: unknown): string | number | null {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return value;
  if (typeof value === "string" && value.length >= 1 && value.length <= 256) return value;
  return null;
}

export function readRequest(value: unknown): JsonRpcRequest | undefined {
  if (!isRecord(value)) return undefined;
  if (value.jsonrpc !== "2.0" || typeof value.method !== "string" || value.method.length === 0) {
    return undefined;
  }
  const id = jsonRpcId(value.id);
  if (id === null) return undefined;
  const opId = typeof value.op_id === "string" && value.op_id.trim().length > 0 ? value.op_id : undefined;
  return {
    jsonrpc: "2.0",
    id,
    method: value.method,
    params: "params" in value ? value.params : {},
    ...(opId !== undefined ? { op_id: opId } : {}),
  };
}

export function readResponse(value: unknown): JsonRpcResponse | undefined {
  if (!isRecord(value) || value.jsonrpc !== "2.0" || !("id" in value)) return undefined;
  const id = value.id === null ? null : jsonRpcId(value.id);
  if (value.id !== null && id === null) return undefined;
  if ("error" in value && isRecord(value.error) && typeof value.error.code === "number") {
    const message = typeof value.error.message === "string" ? value.error.message : "error";
    const body: JsonRpcErrorBody =
      "data" in value.error
        ? { code: value.error.code, message, data: value.error.data }
        : { code: value.error.code, message };
    return { jsonrpc: "2.0", id, error: body };
  }
  if ("result" in value) return { jsonrpc: "2.0", id, result: value.result };
  return undefined;
}

export function isFailure(response: JsonRpcResponse): response is JsonRpcFailure {
  return "error" in response;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

export interface HelloRejection {
  readonly kind: "auth" | "version";
  readonly id: string | number | null;
  readonly error?: ProtocolVersionMismatchError;
}

/**
 * Validate `session.hello` against the Task 008 parameter shape.
 * Token comparison is the caller's timing-safe check.
 */
export function inspectSessionHello(
  value: unknown,
  tokenMatches: (token: string) => boolean,
): SessionHello | HelloRejection {
  const id = isRecord(value) ? jsonRpcId(value.id) : null;
  if (!isRecord(value) || value.jsonrpc !== "2.0" || value.method !== "session.hello" || id === null) {
    return { kind: "auth", id };
  }
  if (!isRecord(value.params) || !exactKeys(value.params, ["token", "protocol", "client"])) {
    return { kind: "auth", id };
  }
  const token = typeof value.params.token === "string" ? value.params.token : "";
  if (!tokenMatches(token) || typeof value.params.token !== "string" || token.length < 1 || token.length > 512) {
    return { kind: "auth", id };
  }
  if (typeof value.params.protocol !== "string") return { kind: "auth", id };
  let protocol: ProtocolVersion;
  try {
    protocol = negotiateProtocol(value.params.protocol);
  } catch (error) {
    if (error instanceof ProtocolVersionMismatchError) return { kind: "version", id, error };
    throw error;
  }
  if (!isRecord(value.params.client) || !exactKeys(value.params.client, ["name", "version"])) {
    return { kind: "auth", id };
  }
  const name = value.params.client.name;
  const version = value.params.client.version;
  if (typeof name !== "string" || name.length < 1 || name.length > 128) return { kind: "auth", id };
  if (typeof version !== "string" || version.length < 1 || version.length > 64) return { kind: "auth", id };
  return { id, token, protocol, client: { name, version } };
}

export function isSessionHello(value: SessionHello | HelloRejection): value is SessionHello {
  return !("kind" in value);
}

export function readHelloResult(value: unknown): SessionHelloResult | undefined {
  if (!isRecord(value)) return undefined;
  if (typeof value.protocol !== "string" || !isProtocolVersion(value.protocol)) return undefined;
  if (typeof value.daemonVersion !== "string" || value.daemonVersion.length === 0) return undefined;
  if (!isRecord(value.capabilities)) return undefined;
  return {
    protocol: value.protocol,
    daemonVersion: value.daemonVersion,
    capabilities: {
      jsonRpc: true,
      binaryStreams: true,
      maxJsonBytes: typeof value.capabilities.maxJsonBytes === "number" ? value.capabilities.maxJsonBytes : 0,
      maxBinaryChunkBytes:
        typeof value.capabilities.maxBinaryChunkBytes === "number" ? value.capabilities.maxBinaryChunkBytes : 0,
      protocolVersions: SUPPORTED_PROTOCOLS,
      currentProtocol: "1.1",
    },
  };
}
