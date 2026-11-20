import { parseBlindBinderV1, sameObservationFields } from "./blind-binder-schema.js";
import { assembleBlindBinderPrompt } from "./blindness.js";
import { BinderAdapterCache, checkEntrySignatureHash } from "./binder-cache.js";
import { BindingDefectError } from "./errors.js";
import type { BinderModelAdapter } from "./fake-model-adapter.js";
import { BinderModeRouter } from "./mode-router.js";
import { kernelRun, RedBeforeGreenGate } from "./red-before-green.js";
import type { AcceptanceCheck, CandidateComparison, GateDecision } from "./types.js";
import type { BinderMode } from "./types.js";

export interface BlindBindResult {
  mode: BinderMode;
  locked: boolean;
  attribution: "binding_defect" | "implementation" | "none";
  routedTo: "task_author" | "none";
  workerPenalized: false;
  workerAttemptsCharged: 0;
  calibrationImpact: "none";
  modelInvoked: boolean;
  cacheHit: boolean;
  prompt?: string;
  entryUsed?: string;
  base?: GateDecision;
  candidate?: CandidateComparison;
  defect?: BindingDefectError;
}

export interface BindTrees {
  baseFiles: Readonly<Record<string, string>>;
  candidateFiles: Readonly<Record<string, string>>;
}

const NO_PENALTY = {
  workerPenalized: false as const,
  workerAttemptsCharged: 0 as const,
  calibrationImpact: "none" as const,
};

/**
 * Chooses contract-bound or post-hoc mode, keeps expected values out of blind-binder@1,
 * and caches a verified adapter when the declared entry signature is unchanged.
 */
export class BlindBinderOrchestrator {
  private readonly cache: BinderAdapterCache;
  private readonly gate: RedBeforeGreenGate;
  private readonly router: BinderModeRouter;

  constructor(
    private readonly model: BinderModelAdapter,
    cache?: BinderAdapterCache,
    gate?: RedBeforeGreenGate,
    router?: BinderModeRouter,
  ) {
    this.cache = cache ?? new BinderAdapterCache();
    this.gate = gate ?? new RedBeforeGreenGate();
    this.router = router ?? new BinderModeRouter();
  }

  async bind(check: AcceptanceCheck, trees: BindTrees): Promise<BlindBindResult> {
    const entry = check.entries[0];
    if (!entry) {
      return this.authorDefect(
        new BindingDefectError(
          "invalid_signature",
          `Check ${check.checkId} declares no contract entry`,
          "non_behavioral",
        ),
        "post_hoc",
      );
    }
    const mode = this.router.route({
      entry,
      ...(check.adaptsInternalState ? { adaptsInternalState: true } : {}),
      ...(check.adaptsInternalCall ? { adaptsInternalCall: true } : {}),
    });
    if (mode === "contract_bound") {
      const base = await this.gate.evaluate({
        check,
        baseFiles: trees.baseFiles,
        run: kernelRun(check),
      });
      return {
        mode,
        locked: base.locked,
        attribution: base.attribution,
        routedTo: base.routedTo,
        ...NO_PENALTY,
        modelInvoked: false,
        cacheHit: false,
        base,
        ...(base.defect ? { defect: base.defect } : {}),
      };
    }
    return this.bindPostHoc(check, trees);
  }

  private async bindPostHoc(check: AcceptanceCheck, trees: BindTrees): Promise<BlindBindResult> {
    let promptText: string;
    try {
      promptText = assembleBlindBinderPrompt(check, trees.candidateFiles).text;
    } catch (error) {
      if (error instanceof BindingDefectError) return this.authorDefect(error, "post_hoc");
      throw error;
    }
    const signatureHash = checkEntrySignatureHash(check);
    const cached = this.cache.get(check.checkId, check.checkVersion, signatureHash);
    if (cached) {
      const proof = await this.gate.provePostHoc({
        check,
        baseFiles: trees.baseFiles,
        candidateFiles: trees.candidateFiles,
        adapterSource: cached.adapterSource,
      });
      return this.fromProof(proof, {
        modelInvoked: false,
        cacheHit: true,
        prompt: promptText,
        entryUsed: cached.entryUsed,
      });
    }
    const turn = await this.model.complete(promptText);
    const parsed = parseBlindBinderV1(turn.output);
    if (!parsed.ok) {
      return this.authorDefect(
        new BindingDefectError("prompt_rejected", parsed.errors.join("; "), "non_behavioral"),
        "post_hoc",
        promptText,
      );
    }
    if ("blocked" in parsed.value) {
      return this.authorDefect(
        new BindingDefectError("blocked", parsed.value.reason, "non_behavioral"),
        "post_hoc",
        promptText,
      );
    }
    if (
      !sameObservationFields(
        parsed.value.observations_schema.fields,
        check.observationsSchema.fields,
      )
    ) {
      return this.authorDefect(
        new BindingDefectError(
          "schema_mismatch",
          "Binder observations_schema does not match the check",
          "non_behavioral",
        ),
        "post_hoc",
        promptText,
      );
    }
    if (!turn.adapterSource) {
      return this.authorDefect(
        new BindingDefectError(
          "binder_crash",
          "blind-binder@1 did not write an adapter",
          "non_behavioral",
        ),
        "post_hoc",
        promptText,
      );
    }
    const proof = await this.gate.provePostHoc({
      check,
      baseFiles: trees.baseFiles,
      candidateFiles: trees.candidateFiles,
      adapterSource: turn.adapterSource,
      ...(turn.writes ? { writes: turn.writes } : {}),
    });
    if (proof.locked) {
      this.cache.put({
        checkId: check.checkId,
        checkVersion: check.checkVersion,
        entrySignatureHash: signatureHash,
        adapterSource: turn.adapterSource,
        entryUsed: parsed.value.entry_used,
        observationsSchema: {
          fields: parsed.value.observations_schema.fields.map((field) => ({
            name: field.name,
            type: field.type,
          })),
        },
        baseMessage: proof.base.message,
      });
    }
    return this.fromProof(proof, {
      modelInvoked: true,
      cacheHit: false,
      prompt: promptText,
      entryUsed: parsed.value.entry_used,
    });
  }

  private fromProof(
    proof: Awaited<ReturnType<RedBeforeGreenGate["provePostHoc"]>>,
    extra: { modelInvoked: boolean; cacheHit: boolean; prompt: string; entryUsed: string },
  ): BlindBindResult {
    return {
      mode: "post_hoc",
      locked: proof.locked,
      attribution: proof.attribution,
      routedTo: proof.routedTo,
      ...NO_PENALTY,
      modelInvoked: extra.modelInvoked,
      cacheHit: extra.cacheHit,
      prompt: extra.prompt,
      entryUsed: extra.entryUsed,
      base: proof.base,
      ...(proof.candidate ? { candidate: proof.candidate } : {}),
      ...(proof.defect ? { defect: proof.defect } : {}),
    };
  }

  private authorDefect(
    defect: BindingDefectError,
    mode: BinderMode,
    prompt?: string,
  ): BlindBindResult {
    return {
      mode,
      locked: false,
      attribution: "binding_defect",
      routedTo: "task_author",
      ...NO_PENALTY,
      modelInvoked: prompt !== undefined,
      cacheHit: false,
      ...(prompt !== undefined ? { prompt } : {}),
      defect,
      base: {
        locked: false,
        classification: "non_behavioral",
        reason: "binder_crash",
        attribution: "binding_defect",
        routedTo: "task_author",
        ...NO_PENALTY,
        message: defect.message,
        defect,
      },
    };
  }
}
