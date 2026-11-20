import type { KbToolName } from "./types.js";
import { NOT_FOUND_CODE, NOT_FOUND_MESSAGE, PULL_BUDGET_CODE, PULL_BUDGET_MESSAGE } from "./types.js";

export interface KbEnvelope {
  readonly ok: boolean;
  readonly code: string;
  readonly message?: string;
  readonly trust: "kb";
  readonly label: "data";
  readonly source: KbToolName;
}

export function notFoundResponse(source: KbToolName): KbEnvelope {
  return {
    ok: false,
    code: NOT_FOUND_CODE,
    message: NOT_FOUND_MESSAGE,
    trust: "kb",
    label: "data",
    source,
  };
}

export function budgetExceededResponse(source: KbToolName): KbEnvelope {
  return {
    ok: false,
    code: PULL_BUDGET_CODE,
    message: PULL_BUDGET_MESSAGE,
    trust: "kb",
    label: "data",
    source,
  };
}

export function invalidParamsResponse(source: KbToolName, message: string): KbEnvelope {
  return {
    ok: false,
    code: "INVALID_PARAMS",
    message,
    trust: "kb",
    label: "data",
    source,
  };
}

export function dataEnvelope(source: KbToolName): Pick<KbEnvelope, "ok" | "code" | "trust" | "label" | "source"> {
  return {
    ok: true,
    code: "OK",
    trust: "kb",
    label: "data",
    source,
  };
}
