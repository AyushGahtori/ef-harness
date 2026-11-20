import type { BindingDefectError } from "./errors.js";

export type BinderMode = "contract_bound" | "post_hoc";

export type EntryKind =
  | "route"
  | "ui_button"
  | "openapi"
  | "cli"
  | "exported_function"
  | "internal_setup"
  | "internal_call";

export type EntrySurface = "user_facing" | "internal";

export type StubKind = "function" | "route" | "job";

export type StubBehavior = "throw" | "empty";

export interface ContractEntrySpec {
  kind: EntryKind;
  surface: EntrySurface;
  /** Declared contract name, such as `toPrintRows` or `POST /kitchen/print`. */
  name: string;
  exportName: string;
  /** Pre-coding signature, for example `export function toPrintRows(totals: Totals): PrintRow[]`. */
  signature: string;
  modulePath: string;
  stubKind?: StubKind;
  route?: {
    method: string;
    path: string;
  };
  jobName?: string;
}

export interface SetupHelper {
  name: string;
  modulePath: string;
  origin: "phase0" | "base";
  signature?: string;
}

export interface ObservationField {
  name: string;
  type: string;
}

export interface ObservationsSchema {
  fields: readonly ObservationField[];
}

/**
 * Local shape of a blind-binder@1 model result.
 * Mirrors Task 009 `BlindBinderV1` without importing that unpublished package.
 */
export type BlindBinderOutput =
  | {
      blocked: true;
      reason: string;
      missing_ids?: readonly string[];
    }
  | {
      entry_used: string;
      observations_schema: {
        fields: readonly ObservationField[];
      };
    };

export interface AcceptanceCheck {
  checkId: string;
  checkVersion: string;
  isPreservationRegression?: boolean;
  entries: readonly ContractEntrySpec[];
  phase0Helpers?: readonly SetupHelper[];
  baseHelpers?: readonly SetupHelper[];
  /** Payloads the binder is allowed to see. */
  input: unknown;
  setupInstructions: string;
  /** Hidden expected observation. Trusted kernel only. */
  expected: unknown;
  observationsSchema: ObservationsSchema;
  /** Extra modules the adapter must not import. Pattern checks always apply. */
  protectedModules?: readonly string[];
  adaptsInternalState?: boolean;
  adaptsInternalCall?: boolean;
}

export interface BinderWrite {
  path: string;
  contents: string;
}

export interface GateDecision {
  locked: boolean;
  classification:
    | "valid_red"
    | "false_green"
    | "non_behavioral"
    | "preservation_green"
    | "preservation_failed";
  reason:
    | "assertion"
    | "stub_marker"
    | "false_green"
    | "syntax"
    | "module_not_found"
    | "typescript"
    | "binder_crash"
    | "preservation_green"
    | "preservation_failed";
  attribution: "binding_defect" | "none";
  routedTo: "task_author" | "none";
  workerPenalized: false;
  workerAttemptsCharged: 0;
  calibrationImpact: "none";
  message: string;
  defect?: BindingDefectError;
}

export interface CheckRuntime {
  /** Invoke the declared contract entry with the check input. */
  invoke(): Promise<unknown>;
  /** Invoke `.harness-binder/<checkId>.adapter.ts` export `observe`. */
  invokeAdapter(): Promise<unknown>;
  assertDeepEqual(actual: unknown, expected: unknown): void;
}

export interface CandidateComparison {
  observations: unknown;
  matchesExpected: boolean;
  crashed: boolean;
  message: string;
}

export interface PostHocProof {
  locked: boolean;
  attribution: "binding_defect" | "implementation" | "none";
  routedTo: "task_author" | "none";
  workerPenalized: false;
  workerAttemptsCharged: 0;
  calibrationImpact: "none";
  base: GateDecision;
  candidate?: CandidateComparison;
  defect?: BindingDefectError;
}
