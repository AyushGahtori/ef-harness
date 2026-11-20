import { EF_HARNESS_CONTRACT_STUB_NOT_IMPLEMENTED } from "./constants.js";
import { auditBinderAdapter } from "./adapter-audit.js";
import { primaryEntry } from "./blindness.js";
import { deepEqual, observationKeys } from "./compare.js";
import { InProcessCleanVerifierPort } from "./clean-verifier-port.js";
import type { CleanVerifierPort } from "./clean-verifier-port.js";
import { ContractStubGenerator } from "./contract-stub-generator.js";
import {
  adapterPath,
  applyBinderWrites,
  assertProductUntouched,
  cloneFiles,
  productSnapshot,
} from "./containment.js";
import {
  BindingDefectError,
  CleanRunError,
  ObservationMismatchError,
} from "./errors.js";
import type { CleanFailureClass, RejectionClass } from "./errors.js";
import type {
  AcceptanceCheck,
  BinderWrite,
  CandidateComparison,
  CheckRuntime,
  ContractEntrySpec,
  GateDecision,
  PostHocProof,
} from "./types.js";

export interface GateRequest {
  check: AcceptanceCheck;
  baseFiles: Readonly<Record<string, string>>;
  adapterSource?: string;
  run: (runtime: CheckRuntime) => void | Promise<void>;
}

export interface PostHocRequest {
  check: AcceptanceCheck;
  baseFiles: Readonly<Record<string, string>>;
  candidateFiles: Readonly<Record<string, string>>;
  adapterSource: string;
  writes?: readonly BinderWrite[];
}

type ThrownClass =
  | {
      kind: "valid_red";
      reason: "assertion" | "stub_marker";
      message: string;
    }
  | {
      kind: "non_behavioral";
      reason: "syntax" | "module_not_found" | "typescript" | "binder_crash";
      message: string;
    };

/**
 * Locks a check only after a genuine behavioral red on the unmodified base,
 * or a genuine green when the check is an explicit preservation regression.
 */
export class RedBeforeGreenGate {
  private readonly stubs: ContractStubGenerator;
  private readonly clean: CleanVerifierPort;

  constructor(clean: CleanVerifierPort = new InProcessCleanVerifierPort()) {
    this.clean = clean;
    this.stubs = new ContractStubGenerator();
  }

  async lock(request: GateRequest): Promise<GateDecision> {
    const decision = await this.evaluate(request);
    if (!decision.locked) {
      throw (
        decision.defect ??
        new BindingDefectError("non_behavioral", decision.message, "non_behavioral")
      );
    }
    return decision;
  }

  async evaluate(request: GateRequest): Promise<GateDecision> {
    const entry = primaryEntry(request.check);
    let files: Record<string, string>;
    try {
      files = this.stubs.materializeMissing(request.baseFiles, request.check.entries);
    } catch (error) {
      if (error instanceof BindingDefectError) return fromDefect(error);
      throw error;
    }
    if (request.adapterSource) {
      files[adapterPath(request.check.checkId)] = request.adapterSource;
    }
    const runtime = this.runtime(files, request.check, entry);
    try {
      await request.run(runtime);
    } catch (error) {
      const classified = classifyThrown(error);
      if (classified.kind === "valid_red") {
        if (request.check.isPreservationRegression) {
          return preservationFailed(classified.message);
        }
        return validRed(classified.reason, classified.message);
      }
      return nonBehavioral(classified.reason, classified.message);
    }
    if (request.check.isPreservationRegression) return preservationGreen();
    return falseGreen(request.check.checkId);
  }

  /**
   * Audit the post-hoc adapter, prove behavioral red on base + contract stubs,
   * then run that same adapter on the candidate and compare in the trusted kernel.
   */
  async provePostHoc(request: PostHocRequest): Promise<PostHocProof> {
    const before = productSnapshot(request.baseFiles);
    let files: Record<string, string>;
    try {
      files = applyBinderWrites(request.baseFiles, request.writes ?? []);
      files[adapterPath(request.check.checkId)] = request.adapterSource;
      assertProductUntouched(before, files);
    } catch (error) {
      if (error instanceof BindingDefectError) return proofFromDefect(error);
      throw error;
    }
    const audit = auditBinderAdapter(
      request.adapterSource,
      adapterPath(request.check.checkId),
      request.check,
    );
    if (!audit.ok) {
      return proofFromDefect(
        new BindingDefectError(audit.code ?? "binder_crash", audit.message, "non_behavioral"),
      );
    }
    const base = await this.evaluate({
      check: request.check,
      baseFiles: files,
      adapterSource: request.adapterSource,
      run: adapterKernelRun(request.check),
    });
    if (!base.locked) return { ...authorProof(false), base, ...(base.defect ? { defect: base.defect } : {}) };
    const candidate = await this.compareCandidate(request);
    if (candidate.schemaDefect) {
      return {
        ...authorProof(false),
        base,
        candidate: candidate.comparison,
        defect: candidate.schemaDefect,
      };
    }
    const matches = candidate.comparison.matchesExpected;
    return {
      locked: true,
      attribution: matches ? "none" : "implementation",
      routedTo: "none",
      workerPenalized: false,
      workerAttemptsCharged: 0,
      calibrationImpact: "none",
      base,
      candidate: candidate.comparison,
    };
  }

  private runtime(
    files: Readonly<Record<string, string>>,
    check: AcceptanceCheck,
    entry: ContractEntrySpec,
  ): CheckRuntime {
    const invokeExport = async (modulePath: string, exportName: string): Promise<unknown> =>
      this.clean.invoke({
        files,
        modulePath,
        exportName,
        args: [check.input],
      });
    return {
      invoke: () => invokeExport(entry.modulePath, entry.exportName),
      invokeAdapter: () => invokeExport(adapterPath(check.checkId), "observe"),
      assertDeepEqual: (actual, expected) => {
        if (!deepEqual(actual, expected)) {
          throw new ObservationMismatchError("observation mismatch");
        }
      },
    };
  }

  private async compareCandidate(request: PostHocRequest): Promise<{
    comparison: CandidateComparison;
    schemaDefect?: BindingDefectError;
  }> {
    const files = cloneFiles(request.candidateFiles);
    const binderFile = adapterPath(request.check.checkId);
    files[binderFile] = request.adapterSource;
    const before = productSnapshot(files);
    try {
      const observations = await this.clean.invoke({
        files,
        modulePath: binderFile,
        exportName: "observe",
        args: [request.check.input],
      });
      assertProductUntouched(before, files);
      const keys = observationKeys(observations);
      const expectedKeys = [...request.check.observationsSchema.fields.map((field) => field.name)].sort();
      if (!keys || keys.join("\0") !== expectedKeys.join("\0")) {
        return {
          comparison: {
            observations,
            matchesExpected: false,
            crashed: false,
            message: "observations do not match observations_schema",
          },
          schemaDefect: new BindingDefectError(
            "schema_mismatch",
            "Adapter observations do not match observations_schema",
            "non_behavioral",
          ),
        };
      }
      const matchesExpected = deepEqual(observations, request.check.expected);
      return {
        comparison: {
          observations,
          matchesExpected,
          crashed: false,
          message: matchesExpected ? "observations match hidden expectations" : "observation mismatch",
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const crashedClass = error instanceof CleanRunError ? error.classification : "binder_crash";
      return {
        comparison: {
          observations: undefined,
          matchesExpected: false,
          crashed: true,
          message: `${crashedClass}: ${message}`,
        },
      };
    }
  }
}

function authorProof(locked: boolean): Omit<PostHocProof, "base"> {
  return {
    locked,
    attribution: "binding_defect",
    routedTo: "task_author",
    workerPenalized: false,
    workerAttemptsCharged: 0,
    calibrationImpact: "none",
  };
}

function proofFromDefect(defect: BindingDefectError): PostHocProof {
  return {
    ...authorProof(false),
    base: fromDefect(defect),
    defect,
  };
}

function fromDefect(defect: BindingDefectError): GateDecision {
  const classification = rejectionClassification(defect.classification);
  return {
    locked: false,
    classification,
    reason: reasonFor(defect),
    attribution: "binding_defect",
    routedTo: "task_author",
    workerPenalized: false,
    workerAttemptsCharged: 0,
    calibrationImpact: "none",
    message: defect.message,
    defect,
  };
}

function rejectionClassification(
  classification: RejectionClass,
): GateDecision["classification"] {
  if (classification === "false_green") return "false_green";
  if (classification === "preservation_failed") return "preservation_failed";
  return "non_behavioral";
}

function reasonFor(defect: BindingDefectError): GateDecision["reason"] {
  if (defect.classification === "false_green") return "false_green";
  if (defect.classification === "preservation_failed") return "preservation_failed";
  if (
    defect.code === "syntax" ||
    defect.code === "module_not_found" ||
    defect.code === "typescript" ||
    defect.code === "binder_crash"
  ) {
    return defect.code;
  }
  return "binder_crash";
}

function validRed(reason: "assertion" | "stub_marker", message: string): GateDecision {
  return {
    locked: true,
    classification: "valid_red",
    reason,
    attribution: "none",
    routedTo: "none",
    workerPenalized: false,
    workerAttemptsCharged: 0,
    calibrationImpact: "none",
    message,
  };
}

function falseGreen(checkId: string): GateDecision {
  const defect = new BindingDefectError(
    "false_green",
    `Check ${checkId} already passes on the unmodified base`,
    "false_green",
  );
  return fromDefect(defect);
}

function preservationGreen(): GateDecision {
  return {
    locked: true,
    classification: "preservation_green",
    reason: "preservation_green",
    attribution: "none",
    routedTo: "none",
    workerPenalized: false,
    workerAttemptsCharged: 0,
    calibrationImpact: "none",
    message: "Preservation regression passed on the unmodified base",
  };
}

function preservationFailed(message: string): GateDecision {
  const defect = new BindingDefectError(
    "preservation_failed",
    `Preservation regression failed on the unmodified base: ${message}`,
    "preservation_failed",
  );
  return fromDefect(defect);
}

function nonBehavioral(reason: CleanFailureClass, message: string): GateDecision {
  const defect = new BindingDefectError(reason, message, "non_behavioral");
  return fromDefect(defect);
}

function classifyThrown(error: unknown): ThrownClass {
  if (error instanceof CleanRunError) {
    return { kind: "non_behavioral", reason: error.classification, message: error.message };
  }
  const message = error instanceof Error ? error.message : String(error);
  const name = error instanceof Error ? error.name : "";
  const code = readCode(error);
  if (
    message.includes(EF_HARNESS_CONTRACT_STUB_NOT_IMPLEMENTED) ||
    code === EF_HARNESS_CONTRACT_STUB_NOT_IMPLEMENTED
  ) {
    return { kind: "valid_red", reason: "stub_marker", message };
  }
  if (name === "AssertionError") {
    return { kind: "valid_red", reason: "assertion", message };
  }
  if (code === "MODULE_NOT_FOUND" || /cannot find module/i.test(message)) {
    return { kind: "non_behavioral", reason: "module_not_found", message };
  }
  if (name === "SyntaxError" || /unexpected token/i.test(message)) {
    return { kind: "non_behavioral", reason: "syntax", message };
  }
  return { kind: "non_behavioral", reason: "binder_crash", message };
}

function readCode(error: unknown): string {
  if (typeof error !== "object" || error === null || !("code" in error)) return "";
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : "";
}

export function kernelRun(check: AcceptanceCheck): (runtime: CheckRuntime) => Promise<void> {
  return async (runtime) => {
    const actual = await runtime.invoke();
    if (!deepEqual(actual, check.expected)) {
      throw new ObservationMismatchError("observation mismatch");
    }
  };
}

export function adapterKernelRun(check: AcceptanceCheck): (runtime: CheckRuntime) => Promise<void> {
  return async (runtime) => {
    const actual = await runtime.invokeAdapter();
    if (!deepEqual(actual, check.expected)) {
      throw new ObservationMismatchError("observation mismatch");
    }
  };
}
