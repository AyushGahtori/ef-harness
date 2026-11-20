import { describe, expect, it } from "vitest";
import type { BatchProposal } from "../../src/prompts/index.js";
import { adapters, criterion, developerTurn, locate, proposal } from "./helpers.js";

function run(text: string, proposals: BatchProposal[], criteria = proposals.map((item) => criterion(item.criterion, item.question)), extra: Parameters<ReturnType<typeof adapters>["orchestrator"]["runBatchResolve"]>[0] extends infer R ? Omit<R, "transcript" | "turns" | "criteria"> : never = {}) {
  const turn = developerTurn("T1", text);
  const { orchestrator, primary } = adapters((request) => {
    if (request.promptId === "clarify@1") {
      return JSON.stringify({
        question_id: request.prompt.includes("delivery.channel") ? "Q-print" : "Q1",
        criterion: "delivery.channel",
        text: "Does the kitchen want to add print or replace email?",
        options: [
          { id: "add_print", label: "add print" },
          { id: "replace_email", label: "replace email" },
        ],
        free_text: true,
      });
    }
    return JSON.stringify({ proposals, proposed_gaps: extra.dataBlocks ? [] : [] });
  });
  return orchestrator.runBatchResolve({
    transcript: text,
    turns: [turn],
    criteria,
    ...extra,
  }).then((result) => ({ result, primary }));
}

describe("infer-or-ask rules", () => {
  it("rule 1 positive: an explicit value cites the exact developer span", async () => {
    const text = "Email the totals.";
    const { result } = await run(text, [
      proposal({
        criterion: "delivery.channel",
        question: "Q1",
        value: "email",
        evidence: [locate(text, "Email the totals")],
      }),
    ]);
    expect(result.settled).toEqual([
      expect.objectContaining({ criterionId: "delivery.channel", basis: "explicit", value: "email" }),
    ]);
  });

  it("rule 1 adversarial: a harness paraphrase is not evidence", async () => {
    const { orchestrator } = adapters(() =>
      JSON.stringify({
        proposals: [
          proposal({
            criterion: "delivery.channel",
            question: "Q1",
            value: "email",
            evidence: [locate("Please send totals by email.", "Please send totals by email", "H1")],
          }),
        ],
        proposed_gaps: [],
      }),
    );
    const result = await orchestrator.runBatchResolve({
      transcript: "Email the totals.",
      turns: [
        developerTurn("T1", "Email the totals."),
        { id: "H1", author: "harness", text: "Please send totals by email." },
      ],
      criteria: [criterion("delivery.channel", "Q1")],
    });
    expect(result.settled).toHaveLength(0);
    expect(result.pending[0]?.code).toBe("assistant_author");
  });

  it("rule 2 positive: opening a link on a phone settles menu access only", async () => {
    const text = "They open the menu link on their phones.";
    const { result } = await run(text, [
      proposal({
        criterion: "menu.phone_access",
        question: "Q2",
        value: "phone_browser",
        evidence: [locate(text, text.replace(/\.$/, ""))],
      }),
    ]);
    expect(result.settled.map((decision) => decision.criterionId)).toEqual(["menu.phone_access"]);
    expect(result.settled.some((decision) => /offline|native|checkout/.test(decision.criterionId))).toBe(false);
  });

  it("rule 2 adversarial: open the link on their phones gives no offline or native credit", async () => {
    const text = "open the link on their phones";
    const quote = locate(text, text);
    const { result } = await run(
      text,
      [
        proposal({ criterion: "menu.phone_access", question: "Q2", value: "phone_browser", evidence: [quote] }),
        proposal({ criterion: "product.offline", question: "Q3", value: "offline", evidence: [quote] }),
        proposal({ criterion: "client.native_app", question: "Q4", value: "native", evidence: [quote] }),
        proposal({ criterion: "checkout.phone", question: "Q5", value: "checkout", evidence: [quote] }),
      ],
      [
        criterion("menu.phone_access", "Q2"),
        criterion("product.offline", "Q3"),
        criterion("client.native_app", "Q4"),
        criterion("checkout.phone", "Q5"),
      ],
    );
    expect(result.settled.map((decision) => decision.criterionId)).toEqual(["menu.phone_access"]);
    expect(result.pending.map((item) => item.criterionId).sort()).toEqual([
      "checkout.phone",
      "client.native_app",
      "product.offline",
    ]);
    expect(result.pending.every((item) => item.code === "broadened_inference")).toBe(true);
  });

  it("rule 3 positive: a quote that keeps don't and 10:45 can settle the negated value", async () => {
    const text = "don't allow edits after 10:45";
    const { result } = await run(text, [
      proposal({
        criterion: "edit.after_cutoff",
        question: "Q3",
        value: "no edits after 10:45",
        evidence: [locate(text, text)],
      }),
    ]);
    expect(result.settled[0]).toEqual(expect.objectContaining({ value: "no edits after 10:45", basis: "explicit" }));
  });

  it("rule 3 adversarial: dropped negation, edited digits, and scrap retraction earn nothing", async () => {
    const edits = "don't allow edits after 10:45";
    const scrap = "Maybe add printing … actually, scrap printing";
    const printingAt = scrap.indexOf("printing");
    const { orchestrator } = adapters(() =>
      JSON.stringify({
        proposals: [
          proposal({
            criterion: "edit.after_cutoff",
            question: "Q3",
            value: "allow edits",
            evidence: [locate(edits, "allow edits after 10:45")],
          }),
          proposal({
            criterion: "edit.cutoff_time",
            question: "Q4",
            value: "11:00",
            evidence: [{ turn: "T1", start: 0, end: edits.length, quote: "don't allow edits after 11:00" }],
          }),
          proposal({
            criterion: "features.printing",
            question: "Q5",
            value: "printing",
            evidence: [{ turn: "T2", start: printingAt, end: printingAt + "printing".length, quote: "printing" }],
          }),
        ],
        proposed_gaps: [],
      }),
    );
    const result = await orchestrator.runBatchResolve({
      transcript: `${edits}\n${scrap}`,
      turns: [developerTurn("T1", edits), developerTurn("T2", scrap)],
      criteria: [
        criterion("edit.after_cutoff", "Q3"),
        criterion("edit.cutoff_time", "Q4"),
        criterion("features.printing", "Q5"),
      ],
    });
    expect(result.settled).toHaveLength(0);
    expect(result.pending.map((item) => item.code)).toEqual(["negation_dropped", "digit_altered", "retracted"]);
  });

  it("rule 4 positive: a bound matching options_version accepts use the second one", async () => {
    const text = "use the second one";
    const { orchestrator } = adapters(() =>
      JSON.stringify({
        proposals: [
          proposal({
            criterion: "delivery.channel",
            question: "Q4",
            value: "email",
            evidence: [locate(text, text)],
          }),
        ],
        proposed_gaps: [],
      }),
    );
    const result = await orchestrator.runBatchResolve({
      transcript: text,
      turns: [developerTurn("T1", text)],
      criteria: [criterion("delivery.channel", "Q4", { options: [{ id: "print", label: "Print" }, { id: "email", label: "Email" }] })],
      bindings: [
        { turnId: "T1", questionId: "Q4", optionsVersionAtInputStart: 4, replyOptionsVersion: 4 },
      ],
    });
    expect(result.settled[0]).toEqual(expect.objectContaining({ basis: "explicit", value: "email" }));
  });

  it("rule 4 adversarial: I don't know, an unclicked recommendation, and a stale version are not explicit", async () => {
    const unknown = "I don't know";
    const idle = "Can you recommend a provider?";
    const yes = "yes";
    const { orchestrator } = adapters((request) => {
      const body = JSON.parse(request.prompt.includes("billing.provider") ? "null" : "null");
      void body;
      if (request.prompt.includes("UNIQUE-UNKNOWN")) {
        return JSON.stringify({
          proposals: [
            proposal({
              criterion: "billing.provider",
              question: "Q4a",
              value: "postgres",
              evidence: [locate(unknown, unknown)],
            }),
          ],
          proposed_gaps: [],
        });
      }
      if (request.prompt.includes("UNIQUE-RECOMMEND")) {
        return JSON.stringify({
          proposals: [
            proposal({
              criterion: "billing.provider",
              question: "Q4b",
              value: "stripe",
              evidence: [locate(idle, idle)],
            }),
          ],
          proposed_gaps: [],
        });
      }
      return JSON.stringify({
        proposals: [
          proposal({
            criterion: "delivery.channel",
            question: "Q4c",
            value: "email",
            evidence: [locate(yes, yes)],
          }),
        ],
        proposed_gaps: [],
      });
    });
    const unknownResult = await orchestrator.runBatchResolve({
      transcript: `UNIQUE-UNKNOWN ${unknown}`,
      turns: [developerTurn("T1", unknown)],
      criteria: [criterion("billing.provider", "Q4a", { costly: true })],
    });
    const recommendResult = await orchestrator.runBatchResolve({
      transcript: `UNIQUE-RECOMMEND ${idle}`,
      turns: [developerTurn("T1", idle)],
      criteria: [
        criterion("billing.provider", "Q4b", {
          options: [{ id: "stripe", label: "Stripe", recommended: true }],
        }),
      ],
    });
    const staleResult = await orchestrator.runBatchResolve({
      transcript: yes,
      turns: [developerTurn("T1", yes)],
      criteria: [criterion("delivery.channel", "Q4c")],
      bindings: [{ turnId: "T1", questionId: "Q4c", optionsVersionAtInputStart: 1, replyOptionsVersion: 2 }],
    });
    expect(unknownResult.pending[0]?.code).toBe("uncertainty_not_explicit");
    expect(recommendResult.pending[0]?.code).toBe("recommendation_not_evidence");
    expect(staleResult.pending[0]?.code).toBe("stale_options_version");
    expect(unknownResult.settled).toHaveLength(0);
    expect(recommendResult.settled).toHaveLength(0);
    expect(staleResult.settled).toHaveLength(0);
  });

  it("rule 5 positive: explicit and bounded delegation can settle a paid choice", async () => {
    const stripe = "Use Stripe";
    const choose = "Choose a free local database for the demo.";
    const { orchestrator } = adapters((request) => {
      if (request.prompt.includes("UNIQUE-STRIPE")) {
        return JSON.stringify({
          proposals: [
            proposal({
              criterion: "billing.provider",
              question: "Q5a",
              value: "Stripe",
              evidence: [locate(stripe, stripe)],
            }),
          ],
          proposed_gaps: [],
        });
      }
      return JSON.stringify({
        proposals: [
          proposal({
            criterion: "data.store",
            question: "Q5b",
            basis: "delegated",
            value: "sqlite",
            evidence: [locate(choose, choose)],
            delegation: { scope: "free local database", limits: ["sqlite"], turn: "T1" },
          }),
        ],
        proposed_gaps: [],
      });
    });
    const explicit = await orchestrator.runBatchResolve({
      transcript: `UNIQUE-STRIPE ${stripe}`,
      turns: [developerTurn("T1", stripe)],
      criteria: [criterion("billing.provider", "Q5a", { kind: "paid_service", costly: true })],
    });
    const delegated = await orchestrator.runBatchResolve({
      transcript: choose,
      turns: [developerTurn("T1", choose)],
      criteria: [criterion("data.store", "Q5b")],
    });
    expect(explicit.settled[0]).toEqual(expect.objectContaining({ basis: "explicit", value: "Stripe" }));
    expect(delegated.settled[0]).toEqual(expect.objectContaining({ basis: "delegated", value: "sqlite" }));
  });

  it("rule 5 adversarial: derived is rejected for costly and must-ask criteria while a sibling can settle", async () => {
    const text = "Email the totals and maybe use the popular host.";
    const { result } = await run(
      text,
      [
        proposal({
          criterion: "delivery.channel",
          question: "Q5c",
          value: "email",
          evidence: [locate(text, "Email the totals")],
        }),
        proposal({
          criterion: "billing.provider",
          question: "Q5d",
          basis: "derived",
          value: "stripe",
          rule: "infer.popular_billing",
          premises: ["D-1"],
          evidence: [locate(text, "popular host")],
        }),
      ],
      [criterion("delivery.channel", "Q5c"), criterion("billing.provider", "Q5d", { mustAsk: true, kind: "paid_service" })],
      {
        rules: [
          { id: "infer.popular_billing", criterionId: "billing.provider", premises: ["D-1"], allowedValue: "stripe" },
        ],
        priorFacts: [{ id: "D-1", status: "settled", value: "popular", criterionId: "market.popularity" }],
      },
    );
    expect(result.settled.map((decision) => decision.criterionId)).toEqual(["delivery.channel"]);
    expect(result.pending.find((item) => item.criterionId === "billing.provider")?.code).toBe("costly_derivation");
  });

  it("rule 6 positive: Email the totals settles the channel and leaves the recipient missing", async () => {
    const text = "Email the totals";
    const { result } = await run(text, [
      proposal({
        criterion: "delivery.channel",
        question: "Q6",
        value: "email",
        evidence: [locate(text, "Email")],
      }),
      proposal({
        criterion: "delivery.recipient",
        question: "Q6",
        status: "missing",
        basis: null,
        value: null,
        missing_detail: "Who receives the emailed totals",
      }),
    ]);
    expect(result.settled).toEqual([
      expect.objectContaining({ criterionId: "delivery.channel", basis: "explicit", value: "email" }),
    ]);
    expect(result.unsettled).toEqual([
      expect.objectContaining({ criterionId: "delivery.recipient", status: "missing" }),
    ]);
  });

  it("rule 6 adversarial: one invalid sibling stays pending and the valid sibling commits", async () => {
    const text = "Email the totals";
    const { result } = await run(text, [
      proposal({
        criterion: "delivery.channel",
        question: "Q6",
        value: "email",
        evidence: [locate(text, "Email")],
      }),
      proposal({
        criterion: "delivery.recipient",
        question: "Q6",
        value: "the whole kitchen",
        evidence: [locate(text, "Email")],
      }),
    ]);
    expect(result.settled.map((decision) => decision.criterionId)).toEqual(["delivery.channel"]);
    expect(result.pending[0]).toEqual(expect.objectContaining({ criterionId: "delivery.recipient", code: "recipient_not_established" }));
  });

  it("rule 7 positive: two readings stay conflict and trigger clarify", async () => {
    const text = "the kitchen wants a printed list";
    const evidence = locate(text, text);
    const { result } = await run(text, [
      proposal({
        criterion: "delivery.channel",
        question: "Q-print",
        status: "conflict",
        basis: null,
        value: null,
        conflict: [{ evidence: [evidence] }, { evidence: [evidence] }],
      }),
    ]);
    expect(result.settled).toHaveLength(0);
    expect(result.unsettled[0]).toEqual(expect.objectContaining({ status: "conflict", criterionId: "delivery.channel" }));
    expect(result.clarifyRequests[0]?.readings.map((reading) => reading.label)).toEqual(["add print", "replace email"]);
    expect(result.clarifications[0]?.decision).toEqual({ status: "open", value: null, basis: null });
    expect(result.clarifications[0]?.text.toLowerCase()).toContain("add print");
    expect(result.clarifications[0]?.text.toLowerCase()).toContain("replace email");
  });

  it("rule 7 adversarial: a silent guess is rejected and clarify still runs", async () => {
    const text = "the kitchen wants a printed list";
    const { result } = await run(text, [
      proposal({
        criterion: "delivery.channel",
        question: "Q-print",
        value: "print",
        evidence: [locate(text, text)],
      }),
    ]);
    expect(result.settled).toHaveLength(0);
    expect(result.pending[0]?.code).toBe("two_readings_must_conflict");
    expect(result.clarifications[0]?.decision?.status).toBe("open");
  });

  it("rule 8 positive: a user request is a planned change, not the repo baseline", async () => {
    const text = "Add email delivery";
    const { orchestrator } = adapters(() =>
      JSON.stringify({
        proposals: [
          proposal({
            criterion: "delivery.channel",
            question: "Q8",
            value: "email",
            evidence: [locate(text, text)],
          }),
        ],
        proposed_gaps: [],
      }),
    );
    const result = await orchestrator.runBatchResolve({
      transcript: text,
      turns: [developerTurn("T1", text)],
      criteria: [criterion("delivery.channel", "Q8")],
      baselines: [{ criterionId: "delivery.channel", observedValue: "fax" }],
    });
    expect(result.settled[0]).toEqual(expect.objectContaining({ value: "email", plannedChange: true }));
  });

  it("rule 8 adversarial: current code and an unconfirmed baseline are not the requirement", async () => {
    const text = "Add email delivery";
    const { orchestrator } = adapters((request) => {
      if (request.prompt.includes("UNIQUE-BASELINE")) {
        return JSON.stringify({
          proposals: [
            proposal({
              criterion: "delivery.channel",
              question: "Q8",
              value: "fax",
              evidence: [locate(text, text)],
            }),
          ],
          proposed_gaps: [],
        });
      }
      return JSON.stringify({
        proposals: [
          proposal({
            criterion: "delivery.channel",
            question: "Q8",
            value: "fax",
            evidence: [locate("The repo currently faxes totals.", "faxes totals", "H1")],
          }),
        ],
        proposed_gaps: [],
      });
    });
    const baseline = await orchestrator.runBatchResolve({
      transcript: `UNIQUE-BASELINE ${text}`,
      turns: [developerTurn("T1", text)],
      criteria: [criterion("delivery.channel", "Q8")],
      baselines: [{ criterionId: "delivery.channel", observedValue: "fax" }],
    });
    const harness = await orchestrator.runBatchResolve({
      transcript: text,
      turns: [developerTurn("T1", text), { id: "H1", author: "harness", text: "The repo currently faxes totals." }],
      criteria: [criterion("delivery.channel", "Q8")],
      baselines: [{ criterionId: "delivery.channel", observedValue: "fax" }],
    });
    expect(baseline.pending[0]?.code).toBe("baseline_is_not_a_requirement");
    expect(harness.pending[0]?.code).toBe("assistant_author");
    expect(baseline.settled).toHaveLength(0);
    expect(harness.settled).toHaveLength(0);
  });
});
