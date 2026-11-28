export const JSON_RPC_PARSE_ERROR = -32700;
export const JSON_RPC_INVALID_REQUEST = -32600;
export const JSON_RPC_METHOD_NOT_FOUND = -32601;
export const JSON_RPC_INVALID_PARAMS = -32602;
export const JSON_RPC_INTERNAL_ERROR = -32603;
export const JSON_RPC_PERMISSION_DENIED = -32003;

export const DEFAULT_MAX_FRAME_BYTES = 8 * 1024 * 1024;
export const DEFAULT_MAX_FILE_BYTES = 4 * 1024 * 1024;
export const DEFAULT_INITIALIZE_TIMEOUT_MS = 15_000;
export const DEFAULT_CANCEL_GRACE_MS = 500;
export const DEFAULT_UNKNOWN_METHOD_FLOOD = 8;
export const DEFAULT_PROMPT_TIMEOUT_MS = 120_000;
export const PERMISSION_BUDGET_MS = 2;

export type AcpProtocolCode =
  | "malformed_frame"
  | "framing_corruption"
  | "unknown_method_flood"
  | "initialize_timeout"
  | "request_timeout"
  | "version_mismatch"
  | "capability_mismatch"
  | "oversized_frame"
  | "transport_closed"
  | "session_cancelled"
  | "spawn_failed";

export class AcpProtocolError extends Error {
  readonly code: AcpProtocolCode;
  readonly detail: string;

  constructor(code: AcpProtocolCode, detail: string) {
    super(`${code}: ${detail}`);
    this.name = "AcpProtocolError";
    this.code = code;
    this.detail = detail;
  }
}

export class AcpFramingCorruptionError extends AcpProtocolError {
  constructor(detail: string) {
    super("framing_corruption", detail);
    this.name = "AcpFramingCorruptionError";
  }
}

export class AcpRpcError extends Error {
  readonly rpcCode: number;
  readonly rpcMessage: string;
  readonly data: unknown;

  constructor(rpcCode: number, rpcMessage: string, data?: unknown) {
    super(rpcMessage);
    this.name = "AcpRpcError";
    this.rpcCode = rpcCode;
    this.rpcMessage = rpcMessage;
    this.data = data === undefined ? null : data;
  }
}

export class SkillMountDeniedError extends Error {
  readonly rule: "outside_worktree" | "global_config" | "too_many_skills" | "not_vetted" | "exclude_missing";

  constructor(
    rule: "outside_worktree" | "global_config" | "too_many_skills" | "not_vetted" | "exclude_missing",
    detail: string,
  ) {
    super(detail);
    this.name = "SkillMountDeniedError";
    this.rule = rule;
  }
}
