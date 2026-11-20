/**
 * Local entailment port named `FakeModelAdapter` so scripted tests stay offline.
 * Task 034's `FakeModelAdapter.complete()` returns worker tool outcomes, not
 * `entailment-checker@1` JSON. Swap to that adapter only behind a translator.
 */
export interface EntailmentModelPayload {
  readonly criterion: string;
  readonly proposedValue: unknown;
  readonly citedExcerptsWithSurroundingParagraph: readonly {
    readonly quote: string;
    readonly surroundingParagraph: string;
  }[];
  readonly rule: string | null;
  readonly premises: readonly string[];
}

export interface EntailmentModelRequest {
  readonly contractId: "entailment-checker@1";
  readonly family: string;
  readonly modelId: string;
  readonly payload: EntailmentModelPayload;
}

export type EntailmentModelResponse =
  | { readonly ok: true; readonly body: unknown }
  | { readonly ok: false; readonly failure: "timeout" | "unavailable"; readonly statusCode: number | null };

export interface EntailmentModelPort {
  complete(request: EntailmentModelRequest): EntailmentModelResponse;
}

export class FakeModelAdapter implements EntailmentModelPort {
  readonly requests: EntailmentModelRequest[] = [];

  constructor(private readonly respond: (request: EntailmentModelRequest) => EntailmentModelResponse) {}

  complete(request: EntailmentModelRequest): EntailmentModelResponse {
    this.requests.push(structuredClone(request));
    return this.respond(request);
  }
}

export function established(reason: string): EntailmentModelResponse {
  return { ok: true, body: { verdict: "establishes", reason } };
}

export function leavesOpen(reason: string): EntailmentModelResponse {
  return { ok: true, body: { verdict: "leaves_open", reason } };
}

export function contradicts(reason: string): EntailmentModelResponse {
  return { ok: true, body: { verdict: "contradicts", reason } };
}

export function unavailable(statusCode: number): EntailmentModelResponse {
  return { ok: false, failure: statusCode === 408 ? "timeout" : "unavailable", statusCode };
}

export function timedOut(): EntailmentModelResponse {
  return { ok: false, failure: "timeout", statusCode: null };
}
