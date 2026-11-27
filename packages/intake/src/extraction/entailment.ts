import type { ClaimBasis, EntailmentOutcome, EntailmentPacket, EntailmentVerdict } from "./types.js";

export interface EntailmentModelPort {
  complete(packet: EntailmentPacket): { verdict: EntailmentVerdict; reason: string } | { blocked: true; reason: string };
}

export interface EntailmentCheck {
  readonly criterion: string;
  readonly proposedValue: string;
  readonly basis: ClaimBasis;
  readonly costly: boolean;
  readonly mustAsk: boolean;
  readonly ambiguous: boolean;
  readonly quote: string;
  readonly surroundingParagraph: string;
  readonly rule: string | null;
  readonly premises: readonly string[];
}

/**
 * Local port of Task 071 `SemanticEntailmentGate`.
 * Only `establishes` can settle. An ambiguous must-ask payment or auth claim
 * stays pending even if a model would establish it.
 */
export class SemanticEntailmentGate {
  constructor(private readonly model: EntailmentModelPort) {}

  check(claim: EntailmentCheck): EntailmentOutcome {
    const packet: EntailmentPacket = {
      criterion: claim.criterion,
      proposedValue: claim.proposedValue,
      citedExcerptsWithSurroundingParagraph: [
        { quote: claim.quote, surroundingParagraph: claim.surroundingParagraph },
      ],
      rule: claim.rule,
      premises: claim.premises,
    };
    let response: ReturnType<EntailmentModelPort["complete"]>;
    try {
      response = this.model.complete(packet);
    } catch {
      return {
        outcome: "pending_verification",
        verdict: null,
        basis: null,
        credit: false,
        reason: "entailment unavailable",
        modelInvoked: true,
      };
    }
    if ("blocked" in response) {
      return {
        outcome: "pending_verification",
        verdict: null,
        basis: null,
        credit: false,
        reason: response.reason,
        modelInvoked: true,
      };
    }
    if (claim.mustAsk && claim.ambiguous) {
      return {
        outcome: "pending_verification",
        verdict: "leaves_open",
        basis: null,
        credit: false,
        reason: "An ambiguous paragraph cannot settle a must-ask payment or auth decision.",
        modelInvoked: true,
      };
    }
    if (response.verdict === "establishes") {
      return {
        outcome: "settled",
        verdict: "establishes",
        basis: claim.basis === "explicit" ? "explicit" : claim.basis,
        credit: true,
        reason: response.reason,
        modelInvoked: true,
      };
    }
    if (response.verdict === "contradicts") {
      return {
        outcome: "conflict",
        verdict: "contradicts",
        basis: null,
        credit: false,
        reason: response.reason,
        modelInvoked: true,
      };
    }
    return {
      outcome: "pending_verification",
      verdict: "leaves_open",
      basis: null,
      credit: false,
      reason: response.reason,
      modelInvoked: true,
    };
  }
}

/** Offline default: ambiguous quotes stay open; a verbatim value can establish. */
export class DeterministicEntailmentAdapter implements EntailmentModelPort {
  complete(packet: EntailmentPacket): { verdict: EntailmentVerdict; reason: string } {
    const quote = packet.citedExcerptsWithSurroundingParagraph[0]?.quote ?? "";
    if (/\b(may|maybe|might|could|consider|optional|tbd|unclear|someday)\b/i.test(quote)) {
      return { verdict: "leaves_open", reason: "The excerpt does not settle the value." };
    }
    if (packet.proposedValue && quote.includes(packet.proposedValue)) {
      return { verdict: "establishes", reason: "The excerpt states the proposed value." };
    }
    if (quote.trim().length > 0) return { verdict: "establishes", reason: "The excerpt is a verbatim product statement." };
    return { verdict: "leaves_open", reason: "No excerpt was cited." };
  }
}

export class ScriptedEntailmentAdapter implements EntailmentModelPort {
  readonly calls: EntailmentPacket[] = [];

  constructor(private readonly verdict: EntailmentVerdict, private readonly reason = "scripted") {}

  complete(packet: EntailmentPacket): { verdict: EntailmentVerdict; reason: string } {
    this.calls.push(packet);
    return { verdict: this.verdict, reason: this.reason };
  }
}
