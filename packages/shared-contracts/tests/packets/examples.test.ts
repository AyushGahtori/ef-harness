import { describe, expect, it } from "vitest";
import {
  CandidateV1Schema,
  CcrV1Schema,
  EventV1Schema,
  EvidenceLocatorSchema,
  MergeInstructionsV1Schema,
  TaskPacketV1Schema,
  formatZodError,
  normalizeEvidenceLocator,
} from "../../src/packets/index.js";
import { LocatorSchema } from "../../src/index.js";

const taskPacket = {
  schema: "task-packet@1",
  task: "T07",
  attempt: 2,
  epoch: 5,
  brief_version: 3,
  base: { branch: "harness/f/F12", commit: "4c1e…" },
  goal: "Print the kitchen ticket.",
  write_scope: ["src/app/kitchen/**", "tests/kitchen/print.*"],
  must: [
    { id: "SI-212", v: 2, text: "Orders after 10:45 move to the next day." },
    { id: "X-03", v: 1, text: "Show the cutoff in the kitchen." },
  ],
  contracts: [{ id: "kitchen-totals", v: 1, role: "consume" }],
  checks_visible: ["AC-31", "UI-12"],
  checks_hidden_count: 1,
  should: [{ id: "SI-220", v: 1, text: "Keep the ticket to one page." }],
  skills: [{ id: "accessible-ui", digest: "sha256:…" }],
  tools: ["edit", "harness.run", "kb.*", "harness.ask_owner", "harness.flag_blocked"],
  budget: { usd: 400_000, allowance: { "chatgpt-personal": 600_000 }, local_slots: 1 },
  limits: { wall_min: 30, max_steps: 40 },
};

const candidate = {
  schema: "candidate@1",
  task: "T07",
  attempt: 2,
  epoch: 5,
  commit: "9ab2…",
  changed_paths: ["src/app/kitchen/page.tsx"],
  dependency_intents: [],
  wiring_needs: [{ kind: "route", path: "/kitchen", component: "KitchenPage" }],
  local_checks: [{ cmd: "pnpm test tests/kitchen", exit: 0 }],
  note: "Ticket layout matches the brief.",
};

const mergeInstructions = {
  schema: "merge-instructions@1",
  task: "T07",
  commit: "9ab2…",
  diffstat: { files: 6, insertions: 214, deletions: 9 },
  exports_changed: [{ symbol: "KitchenPage", kind: "added" }],
  dependency_intents: [],
  migration_intents: [],
  wiring_needs: [{ kind: "route", path: "/kitchen", component: "KitchenPage" }],
  contracts_verified: [{ id: "kitchen-list/ui", v: 1 }],
  receipt: "VR-7781",
};

const ccr = {
  schema: "ccr@1",
  id: "CCR-14",
  from_feature: "F14",
  target: "entity:orders",
  change: { add_column: { name: "pickup_slot", type: "text", nullable: true } },
  reason: "SI-401 needs the pickup slot",
  class: "additive",
  status: "open",
};

const event = {
  schema: "event@1",
  id: "EV-55120",
  seq: 55120,
  type: "FeatureCompleted",
  revision: 214,
  subject: "F12",
  consumers: ["scheduler", "ui", "export"],
  payload: { feature: "F12" },
  created: "2026-11-16T13:05:00Z",
};

describe("core packet examples", () => {
  it("accepts the task-packet@1 example with integer micro-USD, ppm, and slots", () => {
    expect(TaskPacketV1Schema.parse(taskPacket)).toMatchObject({
      schema: "task-packet@1",
      task: "T07",
      budget: { usd: 400_000, local_slots: 1 },
      limits: { wall_min: 30, max_steps: 40 },
    });
  });

  it("accepts the candidate@1 example copied from the build pipeline", () => {
    const verbatim = {
      schema: "candidate@1",
      task: "T07",
      attempt: 2,
      epoch: 5,
      commit: "9ab2…",
      changed_paths: ["…"],
      dependency_intents: [],
      wiring_needs: [{ kind: "route", path: "/kitchen", component: "KitchenPage" }],
      local_checks: [{ cmd: "pnpm test tests/kitchen", exit: 0 }],
      note: "…",
    };
    const parsed = CandidateV1Schema.parse(verbatim);
    expect(parsed.note).toBe("…");
    expect(parsed.migration_intents).toEqual([]);
    expect(parsed.wiring_needs[0]).toEqual({
      kind: "route",
      path: "/kitchen",
      component: "KitchenPage",
    });
  });

  it("accepts the merge-instructions@1 example", () => {
    expect(MergeInstructionsV1Schema.parse(mergeInstructions).receipt).toBe("VR-7781");
  });

  it("accepts the ccr@1 example", () => {
    expect(CcrV1Schema.parse(ccr).class).toBe("additive");
  });

  it("accepts the event@1 example including seq, payload, and consumers", () => {
    expect(EventV1Schema.parse(event).consumers).toEqual(["scheduler", "ui", "export"]);
  });

  it("accepts the external-intake pdf locator example verbatim", () => {
    const verbatim = { kind: "pdf", page: 12, char_start: 1840, char_end: 1912 };
    expect(EvidenceLocatorSchema.parse(verbatim)).toEqual(verbatim);
  });

  it("accepts every camelCase locator kind", () => {
    expect(
      EvidenceLocatorSchema.parse({ kind: "turn", turnId: "turn-1", start: 0, end: 12 }),
    ).toMatchObject({ kind: "turn" });
    expect(
      EvidenceLocatorSchema.parse({
        kind: "pdf",
        page: 12,
        charStart: 1840,
        charEnd: 1912,
        bbox: [0, 0, 10, 20],
      }),
    ).toMatchObject({ kind: "pdf", charEnd: 1912 });
    expect(
      EvidenceLocatorSchema.parse({ kind: "docx", paragraph: 4, charStart: 1, charEnd: 8 }),
    ).toMatchObject({ kind: "docx" });
    expect(
      EvidenceLocatorSchema.parse({
        kind: "text",
        lineStart: 2,
        lineEnd: 4,
        charStart: 0,
        charEnd: 20,
      }),
    ).toMatchObject({ kind: "text" });
    expect(
      EvidenceLocatorSchema.parse({
        kind: "image",
        region: [1, 2, 3, 4],
        ocrText: "Orders",
      }),
    ).toMatchObject({ kind: "image" });
    expect(
      EvidenceLocatorSchema.parse({
        kind: "spec",
        jsonPointer: "/paths/~1orders/post/responses/409",
      }),
    ).toMatchObject({ kind: "spec" });
  });

  it("unifies LocatorSchema with EvidenceLocatorSchema and losslessly normalizes snake_case locators", () => {
    expect(LocatorSchema).toBe(EvidenceLocatorSchema);
    const turnSnake = EvidenceLocatorSchema.parse({ kind: "turn", turn: "T2", start: 1, end: 8 });
    expect(normalizeEvidenceLocator(turnSnake)).toEqual({
      kind: "turn",
      turnId: "T2",
      start: 1,
      end: 8,
    });
    const pdfSnake = EvidenceLocatorSchema.parse({
      kind: "pdf",
      page: 12,
      char_start: 1840,
      char_end: 1912,
    });
    expect(normalizeEvidenceLocator(pdfSnake)).toEqual({
      kind: "pdf",
      page: 12,
      charStart: 1840,
      charEnd: 1912,
    });
    const docxSnake = EvidenceLocatorSchema.parse({
      kind: "docx",
      paragraph: 4,
      char_start: 1,
      char_end: 8,
    });
    expect(normalizeEvidenceLocator(docxSnake)).toEqual({
      kind: "docx",
      paragraph: 4,
      charStart: 1,
      charEnd: 8,
    });
    const textSnake = EvidenceLocatorSchema.parse({
      kind: "text",
      line_start: 2,
      line_end: 4,
      char_start: 0,
      char_end: 20,
    });
    expect(normalizeEvidenceLocator(textSnake)).toEqual({
      kind: "text",
      lineStart: 2,
      lineEnd: 4,
      charStart: 0,
      charEnd: 20,
    });
    const imageCoords = EvidenceLocatorSchema.parse({
      kind: "image",
      x: 1,
      y: 2,
      w: 30,
      h: 40,
      ocr_text: "Orders",
    });
    expect(normalizeEvidenceLocator(imageCoords)).toEqual({
      kind: "image",
      region: [1, 2, 30, 40],
      ocrText: "Orders",
    });
    const imageRegion = EvidenceLocatorSchema.parse({
      kind: "image",
      region: [0, 0, 120, 40],
      ocr_text: null,
    });
    expect(normalizeEvidenceLocator(imageRegion)).toEqual({
      kind: "image",
      region: [0, 0, 120, 40],
    });
    const specSnake = EvidenceLocatorSchema.parse({
      kind: "spec",
      pointer: "/paths/~1orders/post/responses/409",
    });
    expect(normalizeEvidenceLocator(specSnake)).toEqual({
      kind: "spec",
      jsonPointer: "/paths/~1orders/post/responses/409",
    });
  });
});

describe("closed packets and integer units", () => {
  it("rejects float budgets, signed zero, and NaN", () => {
    const floats = CandidateV1Schema.safeParse(candidate);
    expect(floats.success).toBe(true);
    expect(
      TaskPacketV1Schema.safeParse({
        ...taskPacket,
        budget: { usd: 0.4, allowance: { "chatgpt-personal": 0.6 }, local_slots: 1 },
      }).success,
    ).toBe(false);
    expect(
      TaskPacketV1Schema.safeParse({
        ...taskPacket,
        budget: { usd: -0, allowance: { "chatgpt-personal": 600_000 }, local_slots: 1 },
      }).success,
    ).toBe(false);
    expect(
      TaskPacketV1Schema.safeParse({
        ...taskPacket,
        budget: { usd: Number.NaN, allowance: {}, local_slots: 1 },
      }).success,
    ).toBe(false);
    const failed = TaskPacketV1Schema.safeParse({
      ...taskPacket,
      budget: { usd: 0.4, allowance: { "chatgpt-personal": 600_000 }, local_slots: 1 },
    });
    expect(failed.success).toBe(false);
    if (!failed.success) {
      const diagnostic = formatZodError(failed.error);
      expect(diagnostic.issues.length).toBeGreaterThan(0);
      expect(diagnostic.summary).toContain("budget.usd");
      expect(diagnostic.issues[0]?.path).toBe("budget.usd");
    }
  });

  it("rejects unknown keys on worker packets, wiring needs, and dependency intents", () => {
    expect(CandidateV1Schema.safeParse({ ...candidate, approved: true }).success).toBe(false);
    expect(CcrV1Schema.safeParse({ ...ccr, bypassAudit: true }).success).toBe(false);
    expect(
      CandidateV1Schema.safeParse({
        ...candidate,
        wiring_needs: [
          { kind: "route", path: "/kitchen", component: "KitchenPage", approved: true },
        ],
      }).success,
    ).toBe(false);
    expect(
      CandidateV1Schema.safeParse({
        ...candidate,
        dependency_intents: [
          { package: "zod", version: "^3.25.0", reason: "schemas", bypassAudit: true },
        ],
      }).success,
    ).toBe(false);
  });

  it("rejects an empty consumer list, an invalid class, and an inverted span", () => {
    expect(EventV1Schema.safeParse({ ...event, consumers: [] }).success).toBe(false);
    expect(CcrV1Schema.safeParse({ ...ccr, class: "cosmetic" }).success).toBe(false);
    expect(
      EvidenceLocatorSchema.safeParse({
        kind: "pdf",
        page: 12,
        charStart: 1912,
        charEnd: 1840,
      }).success,
    ).toBe(false);
    expect(
      EvidenceLocatorSchema.safeParse({
        kind: "pdf",
        page: 12,
        char_start: 1912,
        char_end: 1840,
      }).success,
    ).toBe(false);
    expect(
      EvidenceLocatorSchema.safeParse({
        kind: "image",
        region: [0, 0, 0, 10],
      }).success,
    ).toBe(false);
    expect(
      EvidenceLocatorSchema.safeParse({
        kind: "text",
        lineStart: 8,
        lineEnd: 2,
        charStart: 0,
        charEnd: 4,
      }).success,
    ).toBe(false);
    expect(
      EvidenceLocatorSchema.safeParse({ kind: "spec", jsonPointer: "paths/orders" }).success,
    ).toBe(false);
  });

  it("rejects a note and a packet that exceed the 1 MB JSON IPC limit", () => {
    expect(
      CandidateV1Schema.safeParse({ ...candidate, note: "n".repeat(65_537) }).success,
    ).toBe(false);
    const bulkyPath = "p".repeat(4_000);
    const changed_paths = Array.from({ length: 300 }, () => bulkyPath);
    expect(CandidateV1Schema.safeParse({ ...candidate, changed_paths }).success).toBe(false);
  });
});
