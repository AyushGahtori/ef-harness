import { describe, expect, it } from "vitest";
import { MinimalFlipRejectedError } from "../../src/pipeline/errors.js";
import { MinimalFlipRootCauseProver } from "../../src/pipeline/minimal-flip-prover.js";
import { failRun, minimalFlipFactory } from "./helpers.js";

describe("MinimalFlipRootCauseProver", () => {
  const prover = new MinimalFlipRootCauseProver();

  it("rejects falsified hypotheses when repro stays red", async () => {
    const fp = "ERR-CACHE-STALE";
    const badFlip = {
      rootCauseFile: "src/cache/store.ts",
      rootCauseSymbol: "staleCache",
      mechanism: "wrong guess",
      applyFlip: async () => failRun(fp),
      revertFlip: async () => failRun(fp),
    };
    await expect(
      prover.prove(failRun(fp), badFlip, fp),
    ).rejects.toThrow(MinimalFlipRejectedError);
  });

  it("accepts genuine causal root causes (RED → GREEN → RED)", async () => {
    const fp = "ERR-SORT-ASC";
    const verdict = await prover.prove(
      failRun(fp),
      minimalFlipFactory(fp),
      fp,
    );
    expect(verdict.accepted).toBe(true);
    expect(verdict.applyResult.exitCode).toBe(0);
    expect(verdict.revertResult.exitCode).not.toBe(0);
  });
});