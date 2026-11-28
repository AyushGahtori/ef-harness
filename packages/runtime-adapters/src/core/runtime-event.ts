import type { NormalizedUsage, SupervisionRequest, WorkerErrorKind, WorkerToolKind } from "./types.js";

export type AssistantChannel = "message" | "thought" | "plan";
export type SessionDisposition = "normal" | "abnormal" | "stopped";

interface EventEnvelope {
  readonly sessionId: string;
  readonly seq: number;
  readonly at: string;
  readonly redacted: true;
}

export type NormalizedRuntimeEvent = EventEnvelope &
  (
    | { readonly type: "turn_started"; readonly turnId: string }
    | {
        readonly type: "assistant_delta";
        readonly text: string;
        readonly channel: AssistantChannel;
        readonly steps?: readonly string[];
      }
    | {
        readonly type: "tool_call_requested";
        readonly callId: string;
        readonly toolKind: WorkerToolKind;
        readonly title: string;
      }
    | {
        readonly type: "tool_call_started";
        readonly callId: string;
        readonly toolKind: WorkerToolKind;
        readonly title: string;
      }
    | {
        readonly type: "tool_call_finished";
        readonly callId: string;
        readonly toolKind: WorkerToolKind;
        readonly title: string;
        readonly exitCode: number | null;
      }
    | { readonly type: "file_edited"; readonly paths: readonly string[] }
    | {
        readonly type: "permission_requested";
        readonly requestId: string;
        readonly request: SupervisionRequest;
      }
    | {
        readonly type: "permission_decided";
        readonly requestId: string;
        readonly effect: "allow" | "deny";
        readonly reason?: string;
      }
    | { readonly type: "usage_reported"; readonly usage: NormalizedUsage }
    | {
        readonly type: "rate_limited";
        readonly usedPercent: number | null;
        readonly resetsAt: string | null;
        readonly window: string;
      }
    | { readonly type: "turn_completed"; readonly stopReason: string }
    | {
        readonly type: "session_error";
        readonly errorKind: WorkerErrorKind;
        readonly message: string;
      }
    | {
        readonly type: "session_exited";
        readonly disposition: SessionDisposition;
        readonly exitCode: number | null;
        readonly handoff: "Task 150" | null;
      }
  );

export type RuntimeEventDraft =
  | { readonly type: "turn_started"; readonly turnId: string }
  | {
      readonly type: "assistant_delta";
      readonly text: string;
      readonly channel: AssistantChannel;
      readonly steps?: readonly string[];
    }
  | {
      readonly type: "tool_call_requested";
      readonly callId: string;
      readonly toolKind: WorkerToolKind;
      readonly title: string;
    }
  | {
      readonly type: "tool_call_started";
      readonly callId: string;
      readonly toolKind: WorkerToolKind;
      readonly title: string;
    }
  | {
      readonly type: "tool_call_finished";
      readonly callId: string;
      readonly toolKind: WorkerToolKind;
      readonly title: string;
      readonly exitCode: number | null;
    }
  | { readonly type: "file_edited"; readonly paths: readonly string[] }
  | {
      readonly type: "permission_requested";
      readonly requestId: string;
      readonly request: SupervisionRequest;
    }
  | {
      readonly type: "permission_decided";
      readonly requestId: string;
      readonly effect: "allow" | "deny";
      readonly reason?: string;
    }
  | { readonly type: "usage_reported"; readonly usage: NormalizedUsage }
  | {
      readonly type: "rate_limited";
      readonly usedPercent: number | null;
      readonly resetsAt: string | null;
      readonly window: string;
    }
  | { readonly type: "turn_completed"; readonly stopReason: string }
  | {
      readonly type: "session_error";
      readonly errorKind: WorkerErrorKind;
      readonly message: string;
    }
  | {
      readonly type: "session_exited";
      readonly disposition: SessionDisposition;
      readonly exitCode: number | null;
      readonly handoff: "Task 150" | null;
    };

export function isAbnormalProcessExit(code: number | null): boolean {
  if (code === null) return false;
  return code === 137 || code === 0xc0000005 || code === -1073741819;
}

export function exitDisposition(code: number | null): SessionDisposition {
  return isAbnormalProcessExit(code) ? "abnormal" : "normal";
}
