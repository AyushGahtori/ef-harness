import type { ModelCompletion, ModelRequest, SpecExpanderModel } from "./types.js";

/**
 * Scripted model used by filler tests.
 * This is the local port of Task 034 `FakeModelAdapter`: no network, scripted text,
 * and a call counter. The Task 034 class takes an rng and a clock; this one takes a
 * responder because Pass 3 needs the prompt echoed back as `spec-expander@1` JSON.
 */
export class FakeModelAdapter implements SpecExpanderModel {
  readonly calls: ModelRequest[] = [];
  tokensSpent = 0;

  constructor(
    private readonly responder: (request: ModelRequest, callIndex: number) => ModelCompletion,
  ) {}

  complete(request: ModelRequest): ModelCompletion {
    const completion = this.responder(request, this.calls.length);
    this.calls.push(request);
    this.tokensSpent += completion.actualTokens;
    return completion;
  }
}

export interface PromptCell {
  readonly cell_id: string;
  readonly subject: string;
  readonly title: string;
  readonly touches: readonly string[];
  readonly matrix_id: string;
  readonly feature_id: string;
}

export interface ExpanderPrompt {
  readonly contract: "spec-expander@1";
  readonly repair: boolean;
  readonly feature_id: string;
  readonly matrix_id: string;
  readonly cells: readonly PromptCell[];
  readonly premise_ids: readonly string[];
  readonly issues: readonly { readonly cell_id: string; readonly problems: readonly string[] }[];
  readonly instruction: string;
}

export function parseExpanderPrompt(prompt: string): ExpanderPrompt {
  const value = JSON.parse(prompt) as ExpanderPrompt;
  return value;
}

export function concreteProposal(
  cellId: string,
  risk: "low" | "medium" | "high" = "low",
  premises: readonly string[] = [],
): {
  cell_id: string;
  value: string;
  basis: "proposed";
  status: null;
  ears_text: string;
  oracle_sketch: string;
  risk: "low" | "medium" | "high";
  premises: readonly string[];
} {
  return {
    cell_id: cellId,
    value: "concrete",
    basis: "proposed",
    status: null,
    ears_text: `When ${cellId} is exercised, the system shall return status 204 and show the banner "Saved".`,
    oracle_sketch: `Input: submit ${cellId}. Observe status 204 and the banner "Saved".`,
    risk,
    premises,
  };
}
