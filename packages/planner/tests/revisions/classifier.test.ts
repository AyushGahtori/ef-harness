import { describe, expect, it } from "vitest";

import { ChangeClassifier } from "../../src/revisions/index.js";
import { edit } from "./fixture.js";

const classifier = new ChangeClassifier();

describe("ChangeClassifier", () => {
  it("classifies a typo and formatting polish as cosmetic", () => {
    const typo = classifier.classify(
      edit({
        nodeId: "D-Copy",
        beforeText: "Recieve the confirmation.",
        afterText: "Receive the confirmation.",
      }),
    );
    const format = classifier.classify(
      edit({
        nodeId: "D-Copy",
        beforeText: "**Order** total.",
        afterText: "Order total",
      }),
    );
    expect(typo.changeClass).toBe("cosmetic");
    expect(format.changeClass).toBe("cosmetic");
    expect(typo.floorApplied).toBe(false);
  });

  it("classifies a compatible tightening as clarifying and does not treat it as rework", () => {
    const result = classifier.classify(
      edit({
        nodeId: "R-Email",
        nodeKind: "requirement",
        beforeText: "Send an order confirmation email.",
        afterText: "Order confirmation email must include order number.",
      }),
    );
    expect(result.changeClass).toBe("clarifying");
    expect(result.reasons).toContain("clarifying_tightening");
  });

  it("classifies an optional field as compatible", () => {
    const result = classifier.classify(
      edit({
        nodeId: "C-Order",
        nodeKind: "contract",
        beforeText: "Order API",
        afterText: "Order API",
        beforeFields: { schema: { id: { type: "string", required: true } } },
        afterFields: {
          schema: {
            id: { type: "string", required: true },
            notes: { type: "string", required: false },
          },
        },
      }),
    );
    expect(result.changeClass).toBe("compatible");
    expect(result.reasons).toContain("additive_field");
  });

  it("classifies a cutoff, auth, and state-machine mutation as breaking", () => {
    const cutoff = classifier.classify(
      edit({
        nodeId: "D-Cutoff",
        beforeText: "Kitchen cutoff is 11:00.",
        afterText: "Kitchen cutoff is 10:30.",
      }),
    );
    const auth = classifier.classify(
      edit({
        nodeId: "D-Auth",
        beforeText: "Sign in with email and password.",
        afterText: "Sign in with a magic link.",
      }),
    );
    const machine = classifier.classify(
      edit({
        nodeId: "D-State",
        beforeText: "Order states",
        afterText: "Order states",
        beforeFields: { transitions: ["draft->placed"] },
        afterFields: { transitions: ["draft->cancelled"] },
      }),
    );
    expect(cutoff.changeClass).toBe("breaking");
    expect(cutoff.reasons).toContain("cutoff_changed");
    expect(auth.changeClass).toBe("breaking");
    expect(auth.reasons).toContain("auth_changed");
    expect(machine.changeClass).toBe("breaking");
    expect(machine.reasons).toContain("state_machine_changed");
  });

  it("overrides a cosmetic request when an API field is deleted", () => {
    const result = classifier.classify(
      edit({
        nodeId: "C-Order",
        nodeKind: "contract",
        beforeText: "Show email",
        afterText: "Show email",
        requestedClass: "cosmetic",
        beforeFields: { schema: { customer_email: { type: "string", required: true } } },
        afterFields: { schema: {} },
      }),
    );
    expect(result.changeClass).toBe("breaking");
    expect(result.floorApplied).toBe(true);
    expect(result.reasons).toContain("removed_contract_field");
    expect(result.reasons).toContain("classification_floor");
  });
});
