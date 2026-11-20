import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ArchDocumentSharder,
  DeterministicArchConsistencyGate,
  FEATURE_ARCH_PAPERWORK_SHARE,
  FEATURE_SHARD_TOKEN_CEILING,
  JitFeatureArchitectureSynthesizer,
  LOCAL_PORTS,
  LowFiWireframeRenderer,
  M03_ALWAYS_STATES,
  makeNode,
  mermaidIssues,
  parseFeatureArchitectV1,
  ScreenSpecGenerator,
  ScreenSpecSignoff,
  SEAM_TEMPLATES,
  SkeletonLockEnforcer,
} from "../../src/feature-arch/index.js";
import type { FeatureInput, SynthesisRequest } from "../../src/feature-arch/index.js";

const fixtureRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "integration",
);

const SEQUENCE = [
  "sequenceDiagram",
  "  participant Client",
  "  participant API",
  "  Client->>API: Call",
  "  API-->>Client: Result",
].join("\n");

const STATE = ["stateDiagram-v2", "  [*] --> Idle", "  Idle --> Done: finish", "  Done --> [*]"].join("\n");

const ALWAYS = [...M03_ALWAYS_STATES];

function lockedSkeleton() {
  return {
    locked: true,
    tables: [
      {
        name: "orders",
        locked: true,
        columns: [
          { name: "id", type: "TEXT", nullable: false },
          { name: "total_cents", type: "INTEGER", nullable: false },
        ],
      },
    ],
  };
}

function apiFeature(id: string, slug: string, writePaths: string[]): FeatureInput {
  return {
    id,
    slug,
    title: slug,
    surface: "api",
    requirements: [`REQ-${slug}`],
    specItems: [{ id: `SI-${slug}`, text: `${slug} spec item.` }],
    edgeCases: [{ id: `EC-${slug}`, text: `${slug} edge case.` }],
    writePaths,
    schemaDeltas: [],
    endpoints: [
      {
        id: `C-${slug}`,
        method: "POST",
        path: `/api/${slug}`,
        request: "{ id: string }",
        response: "{ ok: true }",
        errors: ["400", "500"],
      },
    ],
    cliCommands: [],
    seams: [{ templateId: "S-02", sharedName: `POST /api/${slug}`, peer: "phase0-api" }],
    transitions: [{ from: "Idle", to: "Done", event: "finish" }],
    failureModes: ["Upstream timeout"],
    journey: [`Call /api/${slug}`],
    screens: [],
    tags: ["route"],
    dependsOn: [],
    references: [],
    sequenceMermaid: SEQUENCE,
    stateMermaid: STATE,
    rules: [],
  };
}

function kitchenScreen(): Record<string, unknown> {
  return {
    slug: "kitchen-list",
    title: "Kitchen totals",
    route: "/kitchen",
    roles: ["Cook"],
    templateId: "list-detail",
    components: [
      {
        id: "title",
        primitive: "PageHeader",
        label: "Kitchen totals",
        children: [{ id: "print", primitive: "Button", label: "Print", variant: "secondary" }],
      },
      { id: "totals", primitive: "Table", label: "Kitchen totals", columns: ["Dish", "Quantity"] },
      { id: "empty", primitive: "EmptyState", label: "No orders yet" },
      { id: "failed", primitive: "ErrorState", label: "Could not load totals" },
    ],
    states: [...ALWAYS, "print"],
    labels: [
      { id: "title", text: "Kitchen totals" },
      { id: "print", text: "Print" },
      { id: "empty", text: "No orders yet" },
      { id: "error", text: "Could not load totals" },
    ],
    copyConstraints: ["Empty copy is No orders yet."],
    keyboardOrder: ["print"],
    endpoints: [{ id: "fetch-totals", kind: "fetch", method: "GET", path: "/api/kitchen/totals" }],
    tags: ["print"],
  };
}

function kitchenFeature(): FeatureInput {
  return {
    ...apiFeature("F-Kitchen", "kitchen", ["src/kitchen/KitchenPage.tsx"]),
    title: "Kitchen totals",
    surface: "web",
    requirements: ["REQ-K1"],
    specItems: [{ id: "SI-K1", text: "Cook sees dish totals." }],
    edgeCases: [{ id: "EC-K1", text: "No orders yet shows the empty state." }],
    schemaDeltas: [
      { op: "add_column", table: "orders", column: { name: "packed_at", type: "TEXT", nullable: true } },
    ],
    endpoints: [
      {
        id: "C-kitchen-totals",
        method: "GET",
        path: "/api/kitchen/totals",
        request: "{ }",
        response: "{ rows: DishQuantity[] }",
        errors: ["401", "500"],
      },
    ],
    seams: [{ templateId: "S-02", sharedName: "GET /api/kitchen/totals", peer: "phase0-api" }],
    transitions: [
      { from: "Idle", to: "Loaded", event: "fetch" },
      { from: "Loaded", to: "Empty", event: "zero-rows" },
    ],
    failureModes: ["Fetch failed"],
    journey: ["Open /kitchen", "See dish totals", "Print"],
    screens: [kitchenScreen()],
    tags: ["route", "interactive_ui", "print"],
    rules: [{ id: "R-kitchen-print", text: "Print uses the page header actions slot.", crossCutting: false }],
  };
}

function waveRequest(features: FeatureInput[], patch: Partial<SynthesisRequest> = {}): SynthesisRequest {
  const requirements = features.flatMap((feature) =>
    feature.requirements.map((id) => ({ id, text: `${id} is required.` })),
  );
  return {
    mergedWave: 0,
    targetWave: 1,
    waveTokenBudget: 200_000,
    features,
    skeleton: lockedSkeleton(),
    requirements,
    ...patch,
  };
}

describe("feature architecture", () => {
  const synth = new JitFeatureArchitectureSynthesizer();

  it("keeps the sibling ports explicit", () => {
    expect(SEAM_TEMPLATES).toHaveLength(10);
    expect(LOCAL_PORTS.featureArchitectV1Schema).toBe("local-port:task-009");
    expect(SkeletonLockEnforcer.source).toBe(LOCAL_PORTS.skeletonLockEnforcer);
    expect(DeterministicArchConsistencyGate.source).toBe(LOCAL_PORTS.deterministicArchConsistencyGate);
    expect(ScreenSpecGenerator.source).toBe(LOCAL_PORTS.m03ScreenStates);
    expect(FEATURE_ARCH_PAPERWORK_SHARE).toBe(0.05);
    expect(FEATURE_SHARD_TOKEN_CEILING).toBe(3000);
  });

  it("synthesizes wave 1 one step ahead of phase 0", () => {
    const result = synth.synthesize(waveRequest([kitchenFeature()]));
    expect(result.status).toBe("accepted");
    expect(result.persisted).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.wave).toBe(1);
    expect(result.paperworkCeiling).toBe(10_000);
    expect(result.paperworkTokens).toBeGreaterThan(0);
    expect(result.paperworkTokens).toBeLessThanOrEqual(result.paperworkCeiling);
    expect(result.nodes.some((node) => node.fields.role === "file_boundary")).toBe(true);
    expect(result.nodes.some((node) => node.fields.role === "schema_delta" && node.text.includes("packed_at"))).toBe(true);
    expect(result.nodes.some((node) => node.fields.role === "seam_binding" && node.text.includes("S-02"))).toBe(true);
    expect(result.nodes.some((node) => node.kind === "journey" && node.text.includes("Open /kitchen"))).toBe(true);
    expect(result.nodes.some((node) => node.fields.role === "state_machine" && node.text.includes("Idle to Loaded"))).toBe(true);
    expect(result.nodes.some((node) => node.kind === "contract" && node.text.includes("{ rows: DishQuantity[] }"))).toBe(true);
    const screen = result.screenSpecs[0];
    expect(screen?.route).toBe("/kitchen");
    expect(screen?.roles).toEqual(["Cook"]);
    expect(screen?.templateId).toBe("list-detail");
    expect(screen?.keyboardOrder).toEqual(["print"]);
    for (const state of [...ALWAYS, "print"]) expect(screen?.states).toContain(state);
    const desktop = result.wireframes[0]?.desktop;
    const mobile = result.wireframes[0]?.mobile;
    expect(desktop?.widthPx).toBe(1440);
    expect(mobile?.widthPx).toBe(375);
    expect(desktop?.svg).toContain('width="1440"');
    expect(mobile?.svg).toContain('width="375"');
    expect(desktop?.svg).toContain('data-state="empty"');
    expect(desktop?.svg).toContain('data-state="error"');
    expect(desktop?.ascii).toContain("desktop 1440px");
    expect(mobile?.ascii).toContain("mobile 375px");
    expect(desktop?.ascii).toContain("| main | columns |");
    expect(mobile?.ascii).toContain("| main | stack |");
    expect(desktop?.overflow).toEqual([]);
    expect(mobile?.overflow).toEqual([]);
    const header = desktop?.svg.slice(desktop.svg.indexOf('data-region="header"'), desktop.svg.indexOf('data-region="main"'));
    expect(header).toContain("Print");
    expect(result.shards.every((shard) => shard.tokens <= 3000)).toBe(true);
    const bodies = result.shards.map((shard) => shard.body).join("\n");
    expect(bodies.split("Empty copy is No orders yet.").length - 1).toBe(1);
    expect(result.shards.find((shard) => shard.path === "architecture/features/kitchen.md")?.body).not.toContain(
      "Empty copy is No orders yet.",
    );
    expect(result.shards.find((shard) => shard.path === "architecture/screens/kitchen-list.md")?.body).toContain(
      "Empty copy is No orders yet.",
    );
    expect(result.signoff).toHaveLength(1);
    expect(result.architectOutputs).toHaveLength(1);
    expect(parseFeatureArchitectV1(result.architectOutputs[0]).ok).toBe(true);
    if (screen && desktop && mobile) {
      const renderer = new LowFiWireframeRenderer();
      const again = renderer.render(screen);
      expect(again.desktop.svg).toBe(desktop.svg);
      expect(again.mobile.ascii).toBe(mobile.ascii);
      const signoff = new ScreenSpecSignoff();
      expect(signoff.revision(screen, again).hash).toBe(result.signoff[0]?.hash);
    }
  });

  it("rejects wave 3 while wave 1 is the only legal next wave", () => {
    const result = synth.synthesize(waveRequest([apiFeature("F-Menu", "menu", ["src/menu/index.ts"])], {
      mergedWave: 1,
      targetWave: 3,
    }));
    expect(result.status).toBe("rejected");
    expect(result.persisted).toBe(false);
    expect(result.nodes).toEqual([]);
    expect(result.observed).toBeNull();
    expect(result.issues[0]?.code).toBe("premature_wave");
    expect(result.issues[0]?.message).toContain("one wave ahead");
  });

  it("anchors wave 2 to fixture exports, tables, and design-system components", () => {
    const feature = apiFeature("F-Orders", "orders", ["src/orders/format-total.ts"]);
    feature.references = [
      { kind: "export", staleName: "formatOrderTotal", file: "src/orders/format.ts" },
      { kind: "module", staleName: "src/orders/format-total.ts", file: "src/orders/format.ts" },
    ];
    const result = synth.synthesize(
      waveRequest([feature], { mergedWave: 1, targetWave: 2, integrationRoot: fixtureRoot }),
    );
    expect(result.status).toBe("accepted");
    expect(result.persisted).toBe(true);
    expect(result.anchored).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          staleName: "formatOrderTotal",
          actualName: "formatOrderCents",
          file: "src/orders/format.ts",
        }),
        expect.objectContaining({
          staleName: "src/orders/format-total.ts",
          actualName: "src/orders/format.ts",
        }),
      ]),
    );
    const anchor = result.nodes.find((node) => node.fields.role === "reality_anchor");
    expect(anchor?.text).toContain("formatOrderCents");
    expect(anchor?.text).not.toContain("formatOrderTotal");
    expect(anchor?.text).toContain("total_cents");
    expect(anchor?.text).toContain("Button");
    expect(result.observed?.components.some((item) => item.name === "Button")).toBe(true);
    expect(result.observed?.tables.find((table) => table.name === "orders")?.columns.map((column) => column.name)).toContain(
      "total_cents",
    );
    expect(result.nodes.find((node) => node.fields.role === "file_boundary")?.fields.writePath).toBe(
      "src/orders/format.ts",
    );
  });

  it("requires the merged tree for wave 2 and rejects phantom exports", () => {
    const feature = apiFeature("F-Orders", "orders", ["src/orders/format.ts"]);
    const missing = synth.synthesize(waveRequest([feature], { mergedWave: 1, targetWave: 2 }));
    expect(missing.issues.some((item) => item.code === "missing_integration_reality")).toBe(true);
    expect(missing.persisted).toBe(false);
    feature.references = [{ kind: "export", staleName: "formatOrderTotal", file: "src/missing.ts" }];
    const phantom = synth.synthesize(
      waveRequest([feature], { mergedWave: 1, targetWave: 2, integrationRoot: fixtureRoot }),
    );
    expect(phantom.persisted).toBe(false);
    expect(phantom.nodes).toEqual([]);
    expect(phantom.issues.some((item) => item.code === "phantom_export")).toBe(true);
  });

  it("rejects a wave 2 screen primitive that the merged kit does not export", () => {
    const feature = kitchenFeature();
    feature.tags = ["route"];
    feature.screens = [
      {
        slug: "odd-dialog",
        title: "Odd",
        route: "/odd",
        roles: ["Cook"],
        templateId: "list-detail",
        components: [{ id: "odd", primitive: "Dialog", label: "Odd" }],
        states: ALWAYS,
        labels: [{ id: "empty", text: "Nothing here" }],
        copyConstraints: ["Stay on the kit."],
        keyboardOrder: [],
        endpoints: [{ id: "fetch-odd", kind: "fetch", method: "GET", path: "/api/odd" }],
      },
    ];
    const result = synth.synthesize(
      waveRequest([feature], { mergedWave: 1, targetWave: 2, integrationRoot: fixtureRoot }),
    );
    expect(result.persisted).toBe(false);
    expect(result.issues.map((item) => item.message).join("\n")).toContain("Dialog");
    expect(result.issues.map((item) => item.message).join("\n")).toContain("observed design system");
  });
});

describe("screen specs and wireframes", () => {
  const generator = new ScreenSpecGenerator();
  const context = {
    featureId: "F-Kitchen",
    featureSlug: "kitchen",
    surface: "web" as const,
    tags: ["print"],
  };

  function issuesWithout(state: string): string {
    const draft = kitchenScreen();
    draft.states = (draft.states as string[]).filter((item) => item !== state);
    const result = generator.generate([draft], context);
    return result.ok ? "" : result.issues.join("\n");
  }

  it("rejects a screen that omits an M03 state, including print when tagged", () => {
    expect(issuesWithout("error")).toContain("missing required state error");
    expect(issuesWithout("empty")).toContain("missing required state empty");
    expect(issuesWithout("offline/slow")).toContain("missing required state offline/slow");
    expect(issuesWithout("print")).toContain("missing required state print");
    const untagged = generator.generate([kitchenScreen()], { ...context, tags: ["route"] });
    expect(untagged.ok).toBe(true);
  });

  it("rejects raw styling and unknown primitives, and skips headless screens", () => {
    const styled = kitchenScreen();
    const components = styled.components as Record<string, unknown>[];
    components[0] = { ...components[0], style: "color: red" };
    const raw = generator.generate([styled], context);
    expect(raw.ok).toBe(false);
    if (!raw.ok) expect(raw.issues.join("\n")).toContain("raw styling");
    const odd = kitchenScreen();
    odd.components = [{ id: "x", primitive: "PrettyButton", label: "Go" }];
    odd.keyboardOrder = [];
    const unknown = generator.generate([odd], context);
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.issues.join("\n")).toContain("not a shared primitive");
    expect(generator.generate([], { ...context, surface: "cli", tags: [] }).ok).toBe(true);
    const headed = generator.generate([kitchenScreen()], { ...context, surface: "headless", tags: [] });
    expect(headed.ok).toBe(false);
    if (!headed.ok) expect(headed.issues.join("\n")).toContain("headless feature cannot declare screens");
  });

  it("flags 12 columns and a long label on a 375px wireframe", () => {
    const draft = kitchenScreen();
    draft.tags = [];
    draft.states = ALWAYS;
    draft.keyboardOrder = ["save"];
    draft.components = [
      { id: "save", primitive: "Button", label: "Save", variant: "primary" },
      { id: "grid", primitive: "Table", columns: Array.from({ length: 12 }, (_, index) => `c${index + 1}`) },
      { id: "long", primitive: "Text", label: "M".repeat(80) },
      { id: "empty", primitive: "EmptyState", label: "Nothing" },
      { id: "failed", primitive: "ErrorState", label: "Broken" },
    ];
    const generated = generator.generate([draft], { ...context, tags: [] });
    expect(generated.ok).toBe(true);
    if (!generated.ok) return;
    const spec = generated.specs[0];
    if (!spec) return;
    const rendered = new LowFiWireframeRenderer().render(spec);
    const again = new LowFiWireframeRenderer().render(spec);
    expect(again).toEqual(rendered);
    expect(rendered.desktop.overflow).toEqual([]);
    expect(rendered.mobile.overflow.map((flag) => flag.reason).sort()).toEqual(["label_text", "table_columns"]);
    expect(rendered.mobile.svg).toContain('data-overflow="table_columns"');
    expect(rendered.mobile.ascii).toContain("375px");
    expect(rendered.desktop.ascii).toContain("1440px");
  });

  it("diffs a box-chat label edit and refuses to drop the error state", () => {
    const generated = generator.generate([kitchenScreen()], context);
    expect(generated.ok).toBe(true);
    if (!generated.ok) return;
    const spec = generated.specs[0];
    if (!spec) return;
    const renderer = new LowFiWireframeRenderer();
    const signoff = new ScreenSpecSignoff();
    const before = signoff.revision(spec, renderer.render(spec));
    const edited = signoff.applyEdit(spec, { op: "set_label", labelId: "print", text: "Print totals" }, context);
    expect(edited.ok).toBe(true);
    if (!edited.ok) return;
    const after = signoff.revision(edited.spec, renderer.render(edited.spec));
    expect(after.hash).not.toBe(before.hash);
    expect(signoff.diffBundle(before, after)).toContain("Print totals");
    expect(after.wireframes.desktop.svg).toContain("Print totals");
    expect(after.wireframes.mobile.svg).toContain('width="375"');
    const dropped = signoff.applyEdit(spec, { op: "set_states", states: spec.states.filter((state) => state !== "error") }, context);
    expect(dropped.ok).toBe(false);
    if (!dropped.ok) expect(dropped.issues.join("\n")).toContain("missing required state error");
  });
});

describe("document sharding", () => {
  it("keeps each node in one shard, stays under 3000 tokens, and does not truncate", () => {
    const sentence = "SCREEN-PROSE-UNIQUE kitchen totals panel.";
    const contract = "CONTRACT-PROSE-UNIQUE get totals.";
    const orders = "ORDERS-PROSE-UNIQUE owns checkout.";
    const huge = Array.from({ length: 3001 }, (_, index) => `tok${index}`).join(" ");
    const screen = makeNode({
      id: "SCR-kitchen-list",
      kind: "arch_node",
      title: "Kitchen",
      text: sentence,
      fields: { role: "screen_spec", slug: "kitchen-list", featureSlug: "kitchen", basis: "derived" },
    });
    const contractNode = makeNode({
      id: "C-kitchen",
      kind: "contract",
      title: "Totals",
      text: contract,
      fields: { role: "contract", slug: "kitchen-totals", featureSlug: "kitchen", basis: "derived" },
    });
    const journey = makeNode({
      id: "JOURNEY-big",
      kind: "journey",
      title: "Journey",
      text: huge,
      fields: { role: "journey", featureSlug: "kitchen", basis: "derived" },
    });
    const feature = makeNode({
      id: "F-Kitchen",
      kind: "feature",
      title: "Kitchen",
      text: "Feature kitchen owns the totals view.",
      fields: {
        role: "feature",
        featureSlug: "kitchen",
        basis: "derived",
        linkedNodeIds: ["SCR-kitchen-list", "C-kitchen", "JOURNEY-big"],
      },
    });
    const other = makeNode({
      id: "F-Orders",
      kind: "feature",
      title: "Orders",
      text: orders,
      fields: { role: "feature", featureSlug: "orders", basis: "derived" },
    });
    const nodes = [screen, contractNode, journey, feature, other];
    const sharded = new ArchDocumentSharder().shard(nodes);
    expect(sharded.duplicatedNodeIds).toEqual([]);
    expect(sharded.overCeiling).toEqual([]);
    expect(sharded.shards.every((shard) => shard.tokens <= 3000)).toBe(true);
    const owners = sharded.shards.flatMap((shard) => shard.canonicalNodeIds);
    expect(owners).toHaveLength(nodes.length);
    expect(new Set(owners).size).toBe(nodes.length);
    const all = sharded.shards.map((shard) => shard.body).join("\n");
    expect(all.split(sentence).length - 1).toBe(1);
    expect(all.split(contract).length - 1).toBe(1);
    expect(all.split(orders).length - 1).toBe(1);
    expect(all.match(/\btok\d+\b/g)?.length).toBe(3001);
    const kitchen = sharded.shards.find((shard) => shard.path === "architecture/features/kitchen.md");
    expect(kitchen?.body).not.toContain(sentence);
    expect(kitchen?.body).not.toContain(orders);
    expect(kitchen?.body).toContain("SCR-kitchen-list");
    expect(sharded.shards.find((shard) => shard.path === "architecture/system.md")?.body).toContain("F-Orders");
    expect(sharded.shards.some((shard) => shard.path === "architecture/screens/kitchen-list.md")).toBe(true);
    expect(sharded.shards.some((shard) => shard.path === "architecture/contracts/kitchen-totals.md")).toBe(true);
  });
});

describe("consistency gate and skeleton lock", () => {
  const synth = new JitFeatureArchitectureSynthesizer();
  const gate = new DeterministicArchConsistencyGate();
  const locks = new SkeletonLockEnforcer();
  const skeleton = lockedSkeleton();

  it("rejects sibling write paths before persistence and can hoist or split them", () => {
    const menu = apiFeature("F-Menu", "menu", ["src/lib/formatters.ts"]);
    const orders = apiFeature("F-Orders", "orders", ["src/lib/formatters.ts"]);
    const rejected = synth.synthesize(waveRequest([menu, orders]));
    expect(rejected.persisted).toBe(false);
    expect(rejected.nodes).toEqual([]);
    const message = rejected.issues.map((item) => item.message).join("\n");
    expect(rejected.issues.some((item) => item.code === "write_path_overlap")).toBe(true);
    expect(message).toContain("hoist-shared");
    expect(message).toContain("split-modules");
    const hoisted = synth.synthesize(waveRequest([menu, orders], { collisionPolicy: "hoist-shared" }));
    expect(hoisted.status).toBe("accepted");
    expect(hoisted.sharedWritePaths).toEqual([{ path: "src/lib/formatters.ts", owner: "phase0-foundation" }]);
    expect(hoisted.nodes.some((node) => node.fields.role === "file_boundary" && node.fields.writePath === "src/lib/formatters.ts")).toBe(false);
    expect(hoisted.nodes.some((node) => node.fields.role === "shared_file")).toBe(true);
    const split = synth.synthesize(waveRequest([menu, orders], { collisionPolicy: "split-modules" }));
    expect(split.status).toBe("accepted");
    const paths = split.nodes.filter((node) => node.fields.role === "file_boundary").map((node) => node.fields.writePath);
    expect(paths).toContain("src/lib/menu/formatters.ts");
    expect(paths).toContain("src/lib/orders/formatters.ts");
  });

  it("blocks destructive skeleton edits with a CCR and allows additive nullable columns", () => {
    const feature = apiFeature("F-Orders", "orders", ["src/orders/index.ts"]);
    feature.schemaDeltas = [{ op: "change_type", table: "orders", column: "total_cents", toType: "TEXT" }];
    const blocked = synth.synthesize(waveRequest([feature]));
    expect(blocked.persisted).toBe(false);
    expect(blocked.nodes).toEqual([]);
    expect(blocked.issues.some((item) => item.code === "skeleton_lock")).toBe(true);
    expect(blocked.ccrProposals[0]?.routedTo).toBe("task-112");
    expect(blocked.ccrProposals[0]?.mutation).toContain("INTEGER");
    expect(blocked.ccrProposals[0]?.mutation).toContain("TEXT");
    const report = locks.check(
      [
        { op: "add_table", table: "invoices", columns: [{ name: "id", type: "TEXT", nullable: false }] },
        { op: "add_column", table: "orders", column: { name: "note", type: "TEXT", nullable: true } },
        { op: "add_column", table: "orders", column: { name: "flag", type: "INTEGER", nullable: false } },
        { op: "rename_column", table: "orders", from: "total_cents", to: "total_text" },
        { op: "drop_column", table: "orders", column: "id" },
        { op: "drop_table", table: "orders" },
      ],
      skeleton,
    );
    expect(report.violations.some((item) => item.code === "skeleton_lock")).toBe(true);
    expect(report.ccrProposals.every((item) => item.routedTo === "task-112")).toBe(true);
    expect(report.violations.some((item) => item.message.includes("add_table"))).toBe(false);
    const additive = locks.check(
      [
        { op: "add_table", table: "invoices", columns: [{ name: "id", type: "TEXT", nullable: false }] },
        { op: "add_column", table: "orders", column: { name: "note", type: "TEXT", nullable: true } },
      ],
      skeleton,
    );
    expect(additive.ok).toBe(true);
    expect(additive.ccrProposals).toEqual([]);
  });

  it("hoists a duplicated cross-cutting rule into one system node", () => {
    const text = "Format money as integer minor units.";
    const menu = apiFeature("F-Menu", "menu", ["src/menu/index.ts"]);
    const orders = apiFeature("F-Orders", "orders", ["src/orders/index.ts"]);
    menu.rules = [{ id: "R-menu-money", text, crossCutting: true }];
    orders.rules = [{ id: "R-orders-money", text, crossCutting: true }];
    const result = synth.synthesize(waveRequest([menu, orders]));
    expect(result.status).toBe("accepted");
    expect(result.nodes.filter((node) => node.kind === "rule")).toHaveLength(1);
    expect(result.edges.filter((edge) => edge.type === "obeys")).toHaveLength(2);
    const bodies = result.shards.map((shard) => shard.body).join("\n");
    expect(bodies.split(text).length - 1).toBe(1);
  });

  it("rejects cycles, orphans, shadowed names, dangling refs, bad seams, and bad mermaid", () => {
    const cycleA = apiFeature("F-Menu", "menu", ["src/menu/index.ts"]);
    const cycleB = apiFeature("F-Orders", "orders", ["src/orders/index.ts"]);
    cycleA.dependsOn = ["F-Orders"];
    cycleB.dependsOn = ["F-Menu"];
    expect(synth.synthesize(waveRequest([cycleA, cycleB])).issues.some((item) => item.code === "feature_dependency_cycle")).toBe(true);

    const orphan = synth.synthesize(
      waveRequest([apiFeature("F-Menu", "menu", ["src/menu/index.ts"])], {
        requirements: [
          { id: "REQ-menu", text: "Menu is required." },
          { id: "REQ-ORPHAN", text: "Nobody owns this." },
        ],
      }),
    );
    expect(orphan.persisted).toBe(false);
    expect(orphan.issues.some((item) => item.code === "orphan_requirement" && item.nodeId === "REQ-ORPHAN")).toBe(true);

    const left = apiFeature("F-Menu", "menu", ["src/menu/index.ts"]);
    const right = apiFeature("F-Orders", "orders", ["src/orders/index.ts"]);
    left.endpoints = [{ ...left.endpoints[0], id: "C-shared-menu", path: "/api/shared" } as FeatureInput["endpoints"][number]];
    right.endpoints = [{ ...right.endpoints[0], id: "C-shared-orders", path: "/api/shared" } as FeatureInput["endpoints"][number]];
    expect(synth.synthesize(waveRequest([left, right])).issues.some((item) => item.code === "shadowed_name")).toBe(true);

    const dangling = apiFeature("F-Menu", "menu", ["src/menu/index.ts"]);
    dangling.dependsOn = ["F-Missing"];
    expect(synth.synthesize(waveRequest([dangling])).issues.some((item) => item.code === "dangling_ref")).toBe(true);

    const seam = apiFeature("F-Menu", "menu", ["src/menu/index.ts"]);
    seam.seams = [{ templateId: "S-99", sharedName: "POST /api/menu", peer: "phase0-api" }];
    expect(synth.synthesize(waveRequest([seam])).issues.some((item) => item.code === "seam_reference")).toBe(true);

    const diagram = apiFeature("F-Menu", "menu", ["src/menu/index.ts"]);
    diagram.stateMermaid = "stateDiagram-v2\n  [*] --> A[User (Admin)]";
    const badDiagram = synth.synthesize(waveRequest([diagram]));
    expect(badDiagram.persisted).toBe(false);
    expect(badDiagram.issues.some((item) => item.code === "invalid_mermaid")).toBe(true);
    expect(mermaidIssues('stateDiagram-v2\n  [*] --> A["User (Admin)"]', "state")).toEqual([]);
    expect(mermaidIssues("stateDiagram-v2\n  [*] --> A[User (Admin)]", "state").join(" ")).toContain("unquoted parentheses");
  });

  it("covers the six gate fault classes on a minimal graph", () => {
    const feature = makeNode({
      id: "F-A",
      kind: "feature",
      title: "A",
      text: "Feature A.",
      fields: { role: "feature", featureSlug: "a", ownerId: "F-A", basis: "derived" },
    });
    const other = makeNode({
      id: "F-B",
      kind: "feature",
      title: "B",
      text: "Feature B.",
      fields: {
        role: "feature",
        featureSlug: "b",
        ownerId: "F-B",
        basis: "derived",
        registeredNames: [{ kind: "page_route", name: "/same" }],
      },
    });
    const requirement = makeNode({
      id: "REQ-1",
      kind: "spec_item",
      title: "REQ-1",
      text: "Requirement one.",
      fields: { catalogRequirement: true, featureSlug: "a", basis: "explicit" },
    });
    expect(
      gate.check({
        nodes: [feature, requirement],
        edges: [{ src: "F-A", type: "implements", dst: "REQ-1" }],
        skeleton,
        existingNames: [],
      }).ok,
    ).toBe(true);
    expect(
      gate.check({
        nodes: [feature, requirement],
        edges: [
          { src: "F-A", type: "implements", dst: "REQ-1" },
          { src: "F-A", type: "depends_on", dst: "F-Missing" },
        ],
        skeleton,
        existingNames: [],
      }).issues.some((item) => item.code === "dangling_ref"),
    ).toBe(true);
    const shadowed = makeNode({
      id: "F-A2",
      kind: "feature",
      title: "A2",
      text: "Feature A2.",
      fields: {
        role: "feature",
        featureSlug: "a2",
        ownerId: "F-A2",
        basis: "derived",
        registeredNames: [{ kind: "page_route", name: "/same" }],
      },
    });
    expect(
      gate.check({ nodes: [feature, shadowed], edges: [], skeleton, existingNames: [] }).issues.some(
        (item) => item.code === "shadowed_name",
      ),
    ).toBe(false);
    expect(
      gate.check({ nodes: [other, shadowed], edges: [], skeleton, existingNames: [] }).issues.some(
        (item) => item.code === "shadowed_name",
      ),
    ).toBe(true);
    const rule = makeNode({
      id: "RULE-1",
      kind: "rule",
      title: "Money",
      text: "Format money as integer minor units.",
      fields: { featureIds: ["F-A", "F-B"], hoisted: false, featureSlug: "system", basis: "derived" },
    });
    expect(
      gate.check({ nodes: [feature, rule], edges: [], skeleton, existingNames: [] }).issues.some(
        (item) => item.code === "unhoisted_duplicated_rule",
      ),
    ).toBe(true);
    expect(
      gate.check({ nodes: [requirement], edges: [], skeleton, existingNames: [] }).issues.some(
        (item) => item.code === "orphan_requirement",
      ),
    ).toBe(true);
    expect(
      gate.check({
        nodes: [feature, other],
        edges: [
          { src: "F-A", type: "depends_on", dst: "F-B" },
          { src: "F-B", type: "depends_on", dst: "F-A" },
        ],
        skeleton,
        existingNames: [],
      }).issues.some((item) => item.code === "feature_dependency_cycle"),
    ).toBe(true);
    const diagram = makeNode({
      id: "SM-A",
      kind: "arch_node",
      title: "States",
      text: "States.",
      fields: { mermaid: "stateDiagram-v2\n  [*] --> A[User (Admin)]", mermaidKind: "state", basis: "derived" },
    });
    expect(
      gate.check({ nodes: [diagram], edges: [], skeleton, existingNames: [] }).issues.some(
        (item) => item.code === "invalid_mermaid",
      ),
    ).toBe(true);
  });

  it("rejects a headless feature's missing screens without dropping its CLI and API specs", () => {
    const feature = apiFeature("F-Kitchen", "kitchen", ["src/kitchen/cli.ts"]);
    feature.surface = "headless";
    feature.cliCommands = [{ name: "kitchen print", summary: "Print the kitchen totals." }];
    feature.endpoints = [
      {
        id: "C-kitchen-print",
        method: "POST",
        path: "/api/kitchen/print",
        request: "{ copy: string }",
        response: "{ queued: true }",
        errors: ["400"],
      },
    ];
    const result = synth.synthesize(waveRequest([feature]));
    expect(result.status).toBe("accepted");
    expect(result.screenSpecs).toEqual([]);
    expect(result.wireframes).toEqual([]);
    expect(result.nodes.some((node) => node.fields.role === "cli_command" && node.text.includes("Print the kitchen totals."))).toBe(true);
    expect(result.nodes.some((node) => node.kind === "contract" && node.text.includes("{ queued: true }"))).toBe(true);
  });

  it("stays inside the 5% feature-architecture paperwork budget", () => {
    const result = synth.synthesize(
      waveRequest([apiFeature("F-Menu", "menu", ["src/menu/index.ts"])], { waveTokenBudget: 20 }),
    );
    expect(result.persisted).toBe(false);
    expect(result.paperworkCeiling).toBe(1);
    expect(result.issues.some((item) => item.code === "paperwork_budget")).toBe(true);
  });

  it("parses the feature-architect contract, including the blocked exit", () => {
    const accepted = synth.synthesize(waveRequest([apiFeature("F-Menu", "menu", ["src/menu/index.ts"])]));
    expect(parseFeatureArchitectV1(accepted.architectOutputs[0]).ok).toBe(true);
    expect(parseFeatureArchitectV1({ ...accepted.architectOutputs[0], surprise: true }).ok).toBe(false);
    const blocked = parseFeatureArchitectV1({ blocked: true, reason: "missing design kit" });
    expect(blocked.ok).toBe(true);
    expect(parseFeatureArchitectV1({ blocked: true }).ok).toBe(false);
    expect(parseFeatureArchitectV1({ blocked: true, reason: "no", flows: [] }).ok).toBe(false);
  });
});
