import { describe, expect, it } from "vitest";
import { FakeModelAdapter } from "../../src/prompts/index.js";
import { adapters, criterion, developerTurn, locate, proposal, scripted } from "./helpers.js";

describe("discovery prompt runners", () => {
  it("opening-review maps the worked lunch transcript and withholds unsupported native or cash claims", async () => {
    const text =
      "The manager counts orders from chat by hand. Staff should pick lunch using a link so the kitchen can see totals";
    const followUp = "For two identical orders, should the kitchen demo show two entries or one total?";
    const manager = locate(text, "The manager counts orders from chat by hand");
    const workflow = locate(text, "Staff should pick lunch using a link so the kitchen can see totals");
    const { orchestrator, primary } = adapters(() =>
      JSON.stringify({
        rubrics: [
          {
            rubric: "opening.2",
            covered: ["actor", "problem"],
            claims: [
              { criterion: "product.audience", kind: "value", value: "the manager", evidence: [manager] },
            ],
            smallest_gap: null,
          },
          {
            rubric: "opening.3",
            covered: ["actor", "action", "outcome"],
            claims: [
              { criterion: "workflows.primary", kind: "value", value: "the kitchen can see totals", evidence: [workflow] },
              {
                criterion: "workflows.primary",
                kind: "value",
                value: "cash payment",
                evidence: [{ turn: "T1", start: 0, end: 3, quote: "cash payment" }],
              },
            ],
            smallest_gap: null,
          },
        ],
        follow_up: { rubric: "opening.4", question: followUp },
        domains: [
          { pack: "web", evidence: [workflow], certain: true },
          { pack: "browser_extension", evidence: [], certain: false },
          { pack: "native_app", evidence: [{ turn: "T1", start: 0, end: 3, quote: "native app" }], certain: true },
        ],
      }),
    );
    const result = await orchestrator.runOpeningReview({
      transcript: text,
      turns: [developerTurn("T1", text)],
      interactionMode: "talk_it_through",
    });
    expect(result.ok).toBe(true);
    expect(result.promptVersion).toBe("1");
    expect(result.rubricVersion).toBe("opening-rubric-map@1");
    expect(result.ruleIds).toEqual(["opening-rubric-map@1"]);
    expect(primary.calls[0]?.prompt).toContain('source="turns"');
    expect(primary.calls[0]?.prompt).toContain('"author":"developer"');
    expect(result.credits.map((credit) => `${credit.rubric}:${credit.criterionId}`)).toEqual([
      "opening.2:product.audience",
      "opening.3:workflows.primary",
    ]);
    expect(result.credits.some((credit) => credit.value === "cash payment")).toBe(false);
    expect(result.rejectedClaims.some((claim) => claim.quote === "cash payment")).toBe(true);
    expect(result.rubrics.find((rubric) => rubric.rubric === "opening.2")?.covered).toEqual(["actor", "problem"]);
    expect(result.rubrics.find((rubric) => rubric.rubric === "opening.2")?.catalogCriteria).toEqual([
      "product.audience",
      "actors.roles",
    ]);
    expect(result.rubrics.find((rubric) => rubric.rubric === "opening.3")?.partialCatalogCriteria).toContain("data.entities");
    expect(result.followUp).toEqual({ rubric: "opening.4", question: followUp });
    expect(result.certainDomains.map((domain) => domain.pack)).toEqual(["web"]);
    expect(result.uncertainDomains.map((domain) => domain.pack)).toEqual(["browser_extension", "native_app"]);
    expect(result.uncertainDomains.every((domain) => domain.needsScopeProbe)).toBe(true);
  });

  it("credits opening.4 from a demo proof already inside another answer", async () => {
    const text = "Submit two soup orders and one salad. The kitchen list should show Soup x 2 and Salad x 1.";
    const quote = locate(text, "Soup x 2 and Salad x 1");
    const { orchestrator } = adapters(() =>
      JSON.stringify({
        rubrics: [
          {
            rubric: "opening.4",
            covered: ["acceptance"],
            claims: [{ criterion: "workflows.primary", kind: "value", value: "Soup x 2 and Salad x 1", evidence: [quote] }],
            smallest_gap: null,
          },
        ],
        follow_up: null,
        domains: [],
      }),
    );
    const result = await orchestrator.runOpeningReview({ transcript: text, turns: [developerTurn("T1", text)] });
    expect(result.credits[0]).toEqual(expect.objectContaining({ rubric: "opening.4", criterionId: "workflows.primary", settled: true }));
    expect(result.followUp).toBeNull();
  });

  it("keeps a clarify decision open and preserves the question id", async () => {
    const { orchestrator } = adapters(() =>
      JSON.stringify({
        question_id: "Q17",
        criterion: "edit.after_cutoff",
        text: "After 11, can staff change their own orders, can only the manager edit them, or is the list final?",
        options: [
          { id: "staff", label: "staff can change their own orders" },
          { id: "manager_only", label: "only the manager edits them", recommended: true },
          { id: "lock", label: "the list is final" },
        ],
        free_text: true,
      }),
    );
    const result = await orchestrator.runClarify({
      questionId: "Q17",
      criterionId: "edit.after_cutoff",
      quotes: ["the usual people"],
      situation: "After 11",
      recommendation: { id: "manager_only", label: "only the manager edits them" },
      options: [
        { id: "staff", label: "staff can change their own orders" },
        { id: "manager_only", label: "only the manager edits them", recommended: true },
        { id: "lock", label: "the list is final" },
      ],
    });
    expect(result.ok).toBe(true);
    expect(result.promptVersion).toBe("1");
    expect(result.rubricVersion).toBe("infer-or-ask@1");
    expect(result.ruleIds).toEqual(["infer-or-ask@1"]);
    expect(result.questionId).toBe("Q17");
    expect(result.criterionId).toBe("edit.after_cutoff");
    expect(result.freeText).toBe(true);
    expect(result.decision).toEqual({ status: "open", value: null, basis: null });
    expect(result.text).toContain("After 11");
  });

  it("asks the 10:45 conflict without inventing 11:00", async () => {
    const { orchestrator } = adapters(() =>
      JSON.stringify({
        question_id: "Q17",
        criterion: "edit.after_cutoff",
        text: "Do orders lock at 10:45, or kitchen gets a preliminary list?",
        options: [
          { id: "lock", label: "orders lock at 10:45" },
          { id: "preliminary", label: "kitchen gets a preliminary list" },
        ],
        free_text: true,
      }),
    );
    const result = await orchestrator.runClarify({
      questionId: "Q17",
      criterionId: "edit.after_cutoff",
      quotes: ["staff can edit until eleven", "the kitchen needs final counts at 10:45"],
      readings: [
        { id: "lock", label: "orders lock at 10:45" },
        { id: "preliminary", label: "kitchen gets a preliminary list" },
      ],
      options: [
        { id: "lock", label: "orders lock at 10:45" },
        { id: "preliminary", label: "kitchen gets a preliminary list" },
      ],
    });
    expect(result.ok).toBe(true);
    expect(result.text).toContain("10:45");
    expect(result.text).not.toContain("11:00");
    expect(result.decision?.status).toBe("open");
  });

  it("resolves the worked batch and withholds phone broadening", async () => {
    const text = "One office manager publishes Friday's menu. Staff use a link on their phones. At 11 the kitchen gets one list grouped by dish.";
    const phone = locate(text, "Staff use a link on their phones");
    const { orchestrator } = adapters(() =>
      JSON.stringify({
        proposals: [
          proposal({
            criterion: "menu.publisher",
            question: "Q-pub",
            value: "office manager",
            evidence: [locate(text, "One office manager")],
          }),
          proposal({
            criterion: "menu.phone_access",
            question: "Q-phone",
            value: "phone_browser",
            evidence: [phone],
          }),
          proposal({
            criterion: "kitchen.list_organization",
            question: "Q-list",
            value: "by dish",
            evidence: [locate(text, "grouped by dish")],
          }),
          proposal({
            criterion: "edit.after_11",
            question: "Q-edit",
            status: "missing",
            basis: null,
            value: null,
            missing_detail: "Who can change an order after 11",
          }),
          proposal({
            criterion: "kitchen.receive",
            question: "Q-receive",
            status: "missing",
            basis: null,
            value: null,
            missing_detail: "How the kitchen receives the list",
          }),
          proposal({
            criterion: "product.offline",
            question: "Q-off",
            value: "offline",
            evidence: [phone],
          }),
          proposal({
            criterion: "client.native_app",
            question: "Q-native",
            value: "native",
            evidence: [phone],
          }),
        ],
        proposed_gaps: [{ criterion: "billing.crypto", source: "T1" }],
      }),
    );
    const result = await orchestrator.runBatchResolve({
      transcript: text,
      turns: [developerTurn("T1", text)],
      criteria: [
        criterion("menu.publisher", "Q-pub"),
        criterion("menu.phone_access", "Q-phone"),
        criterion("kitchen.list_organization", "Q-list"),
        criterion("edit.after_11", "Q-edit"),
        criterion("kitchen.receive", "Q-receive"),
        criterion("product.offline", "Q-off"),
        criterion("client.native_app", "Q-native"),
      ],
    });
    expect(result.promptVersion).toBe("1");
    expect(result.rubricVersion).toBe("infer-or-ask@1");
    expect(result.ruleIds).toEqual(["infer-or-ask@1"]);
    expect(result.settled.map((decision) => decision.criterionId)).toEqual([
      "menu.publisher",
      "menu.phone_access",
      "kitchen.list_organization",
    ]);
    expect(result.unsettled.map((decision) => decision.criterionId)).toEqual(["edit.after_11", "kitchen.receive"]);
    expect(result.pending.map((item) => item.criterionId).sort()).toEqual(["client.native_app", "product.offline"]);
    expect(result.proposedGaps).toEqual([{ criterion: "billing.crypto", source: "T1" }]);
    expect(result.settled.some((decision) => decision.criterionId === "billing.crypto")).toBe(false);
  });

  it("commits four valid siblings when one quote fails", async () => {
    const text = "Alpha Beta Gamma Delta Epsilon";
    const words = ["Alpha", "Beta", "Gamma", "Delta", "Epsilon"] as const;
    const proposals = words.map((word, index) =>
      proposal({
        criterion: `criterion.${index + 1}`,
        question: `Q${index + 1}`,
        value: word.toLowerCase(),
        evidence: [
          index === 1
            ? { turn: "T1", start: 0, end: 5, quote: "wrong words" }
            : locate(text, word),
        ],
      }),
    );
    const { orchestrator } = adapters(() => JSON.stringify({ proposals, proposed_gaps: [] }));
    const result = await orchestrator.runBatchResolve({
      transcript: text,
      turns: [developerTurn("T1", text)],
      criteria: words.map((_, index) => criterion(`criterion.${index + 1}`, `Q${index + 1}`)),
    });
    expect(result.settled.map((decision) => decision.criterionId)).toEqual([
      "criterion.1",
      "criterion.3",
      "criterion.4",
      "criterion.5",
    ]);
    expect(result.pending).toEqual([
      expect.objectContaining({ criterionId: "criterion.2", code: "quote_mismatch" }),
    ]);
  });

  it("rejects an invented criterion inside the batch instead of crediting it", async () => {
    const text = "Email the totals";
    const { orchestrator } = adapters(() =>
      JSON.stringify({
        proposals: [
          proposal({
            criterion: "billing.crypto",
            question: "Q-crypto",
            value: "yes",
            evidence: [locate(text, "Email")],
          }),
          proposal({
            criterion: "delivery.channel",
            question: "Q1",
            value: "email",
            evidence: [locate(text, "Email")],
          }),
        ],
        proposed_gaps: [],
      }),
    );
    const result = await orchestrator.runBatchResolve({
      transcript: text,
      turns: [developerTurn("T1", text)],
      criteria: [criterion("delivery.channel", "Q1")],
    });
    expect(result.settled.map((decision) => decision.criterionId)).toEqual(["delivery.channel"]);
    expect(result.pending.some((item) => item.criterionId === "billing.crypto" && item.code === "unknown_criterion")).toBe(true);
    expect(result.proposedGaps).toEqual([]);
  });

  it("repairs once and escalates on the second invalid JSON", async () => {
    const text = "TRANSCRIPT-TOKEN Email the totals";
    const valid = JSON.stringify({
      proposals: [
        proposal({
          criterion: "delivery.channel",
          question: "Q1",
          status: "missing",
          basis: null,
          value: null,
          missing_detail: "channel still open",
        }),
      ],
      proposed_gaps: [],
    });
    const primary = new FakeModelAdapter((request) => {
      if (request.role === "primary") return "not json";
      if (request.role === "format_repair") return "still not json";
      throw new Error(request.role);
    });
    const stronger = new FakeModelAdapter((request) => {
      if (request.role !== "stronger_reviewer") throw new Error(request.role);
      return valid;
    });
    const result = await scripted(primary, stronger).runBatchResolve({
      transcript: text,
      turns: [developerTurn("T1", "Email the totals")],
      criteria: [criterion("delivery.channel", "Q1")],
    });
    expect(primary.calls.map((call) => call.role)).toEqual(["primary", "format_repair"]);
    expect(stronger.calls).toHaveLength(1);
    expect(primary.calls[1]?.prompt).toContain("Validator errors:");
    expect(primary.calls[1]?.prompt).not.toContain("TRANSCRIPT-TOKEN");
    expect(result.ok).toBe(true);
    expect(result.escalated).toBe(true);
    expect(result.attempts).toBe(3);
    expect(result.unsettled[0]?.status).toBe("missing");

    const failingStronger = new FakeModelAdapter(() => "nope");
    const failingPrimary = new FakeModelAdapter((request) => (request.role === "primary" ? "{" : "[]"));
    const failed = await scripted(failingPrimary, failingStronger).runBatchResolve({
      transcript: text,
      turns: [developerTurn("T1", "Email the totals")],
      criteria: [criterion("delivery.channel", "Q1")],
    });
    expect(failingPrimary.calls).toHaveLength(2);
    expect(failingStronger.calls).toHaveLength(1);
    expect(failed.ok).toBe(false);
    expect(failed.settled).toHaveLength(0);
    expect(failed.unsettled).toHaveLength(0);
    expect(failed.failure?.code).toBe("schema_invalid");
  });

  it("stops clarify after one repair and an unsuccessful escalation", async () => {
    const primary = new FakeModelAdapter(() => "nope");
    const stronger = new FakeModelAdapter(() =>
      JSON.stringify({
        question_id: "Q99",
        criterion: "other.criterion",
        text: "Wrong question with 11:00",
        options: [{ id: "staff", label: "staff" }],
        free_text: true,
      }),
    );
    const result = await scripted(primary, stronger).runClarify({
      questionId: "Q17",
      criterionId: "edit.after_cutoff",
      quotes: ["the kitchen needs final counts at 10:45"],
      readings: [
        { id: "lock", label: "orders lock at 10:45" },
        { id: "preliminary", label: "kitchen gets a preliminary list" },
      ],
      options: [
        { id: "lock", label: "orders lock at 10:45" },
        { id: "preliminary", label: "kitchen gets a preliminary list" },
      ],
    });
    expect(primary.calls.map((call) => call.role)).toEqual(["primary", "format_repair"]);
    expect(stronger.calls).toHaveLength(1);
    expect(result.ok).toBe(false);
    expect(result.decision).toEqual({ status: "open", value: null, basis: null });
    expect(result.text).toBe("");
  });

  it("quote-checks a recommendation request and drops a harness citation", async () => {
    const text = "I don't know the audience.";
    const { orchestrator } = adapters(() =>
      JSON.stringify({
        rubrics: [
          {
            rubric: "opening.2",
            covered: [],
            claims: [
              {
                criterion: "product.audience",
                kind: "recommendation_request",
                value: null,
                evidence: [locate(text, "I don't know")],
              },
              {
                criterion: "actors.roles",
                kind: "recommendation_request",
                value: null,
                evidence: [{ turn: "H1", start: 0, end: 12, quote: "Use managers" }],
              },
            ],
            smallest_gap: "who the audience is",
          },
        ],
        follow_up: null,
        domains: [],
      }),
    );
    const result = await orchestrator.runOpeningReview({
      transcript: text,
      turns: [developerTurn("T1", text), { id: "H1", author: "harness", text: "Use managers" }],
    });
    expect(result.credits).toHaveLength(0);
    expect(result.rubrics[0]?.credits.map((credit) => credit.criterionId)).toEqual(["product.audience"]);
    expect(result.rubrics[0]?.credits[0]?.settled).toBe(false);
    expect(result.rejectedClaims[0]?.code).toBe("assistant_author");
  });
});
