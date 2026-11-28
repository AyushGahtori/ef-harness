import { MinimalFlipRejectedError } from "./errors.js";
import type { MinimalFlipProof, ReproRunResult } from "./types.js";

export interface FlipVerdict {
  readonly accepted: boolean;
  readonly applyResult: ReproRunResult;
  readonly revertResult: ReproRunResult;
}

export class MinimalFlipRootCauseProver {
  async prove(
    baselineMustFail: ReproRunResult,
    proof: MinimalFlipProof,
    expectedFingerprint: string,
  ): Promise<FlipVerdict> {
    if (baselineMustFail.exitCode === 0 || baselineMustFail.fingerprint !== expectedFingerprint) {
      throw new MinimalFlipRejectedError("baseline");
    }

    const afterApply = await proof.applyFlip();
    const afterRevert = await proof.revertFlip();

    const redToGreen = afterApply.exitCode === 0;
    const greenToRed =
      afterRevert.exitCode !== 0 && afterRevert.fingerprint === expectedFingerprint;

    if (!redToGreen || !greenToRed) {
      throw new MinimalFlipRejectedError(proof.rootCauseSymbol);
    }

    return {
      accepted: true,
      applyResult: afterApply,
      revertResult: afterRevert,
    };
  }
}