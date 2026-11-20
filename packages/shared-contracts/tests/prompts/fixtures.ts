import type { PromptContractId } from "../../src/prompts/index.js";

const quote = {
  turn: "T2",
  start: 14,
  end: 61,
  quote: "Staff should pick lunch using a link",
};

const textLocator = {
  kind: "text" as const,
  line_start: 1,
  line_end: 1,
  char_start: 0,
  char_end: 48,
};

function located(text: string) {
  return { text, locator: textLocator };
}

const kitchenScreen = {
  screen: "kitchen-list",
  route: "/kitchen",
  template: "list-detail" as const,
  regions: [
    {
      slot: "header" as const,
      title: "Kitchen totals",
      component: null,
      actions: [{ button: "Print", variant: "secondary" as const }],
      columns: [],
      empty_state: null,
    },
    {
      slot: "main" as const,
      title: null,
      component: "Table",
      actions: [],
      columns: ["Dish", "Quantity"],
      empty_state: "No orders yet",
    },
  ],
  states: ["loading", "empty", "populated", "error"] as const,
  density: "balanced" as const,
  references: ["styleguide/table@desktop", "styleguide/page-header@desktop"],
};

export const VALID_OUTPUTS: Record<PromptContractId, object> = {
  "opening-review@1": {
    rubrics: [
      {
        rubric: "opening.3",
        covered: ["actor", "action", "outcome"],
        claims: [
          {
            criterion: "workflows.primary",
            kind: "value",
            value: "Staff submit lunch choices and the kitchen sees totals.",
            evidence: [quote],
          },
        ],
        smallest_gap: null,
      },
    ],
    follow_up: {
      rubric: "opening.4",
      question: "For two identical orders, should the kitchen demo show two entries or one total?",
    },
    domains: [{ pack: "web", evidence: [quote], certain: true }],
  },
  "batch-resolve@1": {
    criterion: "delivery.channel",
    question: "Q17",
    status: "settled",
    basis: "explicit",
    value: "email",
    evidence: [{ turn: "T7", start: 0, end: 5, quote: "Email" }],
    rule: null,
    premises: [],
    delegation: null,
    conflict: null,
    missing_detail: null,
  },
  "clarify@1": {
    question_id: "Q17",
    criterion: "edit.after_cutoff",
    text: "After 11, can staff change their own orders, or can only the manager edit them?",
    options: [{ id: "manager_only", label: "Only the manager can edit", recommended: true }],
    free_text: true,
  },
  "router@1": {
    clauses: [
      {
        span: { start: 0, end: 11 },
        intent: "question",
        target_id: null,
        confidence: 0.9,
        needs_clarification: false,
      },
    ],
  },
  "spec-expander@1": {
    cells: [
      {
        cell_id: "kitchen.empty",
        value: "Show an empty state",
        basis: "proposed",
        status: null,
        ears_text: "When the kitchen list has no orders, the system shall show No orders yet.",
        oracle_sketch: "Open the kitchen page with zero orders and read the empty message.",
        risk: "low",
        premises: ["D-12"],
      },
    ],
  },
  "contradiction-check@1": {
    verdict: "compatible",
    explanation: "Both statements can be true in the same system.",
    minimal_change_suggestion: null,
  },
  "feature-researcher@1": {
    id: "RS-F12-print",
    topic: "Printing kitchen totals from the browser",
    claims: [
      {
        id: "RF-031",
        text: "Safari ignores CSS page-break-inside on some table rows.",
        source: {
          url: "https://example.com/safari-print",
          fetched: "2026-11-16",
          quote: "page-break-inside is ignored",
        },
        confidence: "medium",
      },
    ],
    constraints: [{ id: "RC-08", text: "Use explicit page breaks between groups." }],
    edge_cases: [{ id: "EC-114", text: "A list longer than one page splits a dish group." }],
    failure_modes: [{ id: "FM-02", text: "A popup blocker cancels window.print." }],
    open_contradictions: [],
  },
  "system-architect@1": {
    components: [{ id: "web", name: "Web app", boundary: "HTTP handlers" }],
    entities: [
      {
        id: "order",
        fields: [{ name: "dish", type: "text" }],
        relations: [],
        owner: "F12",
      },
    ],
    contracts: [
      {
        id: "kitchen-totals",
        producer: "F12",
        consumers: ["F14"],
        schema: "totals grouped by dish",
      },
    ],
    rules: [
      {
        id: "X-03",
        text: "Times are stored in UTC.",
        scope_predicate: { all: ["scheduling", "time_display"] },
        check_kind: "Boundary tests across zones",
      },
    ],
    conventions: ["Page titles use the page header template."],
    env_manifest: [{ name: "APP_URL", required: false, description: "Public origin" }],
    risks: [{ id: "RK-1", text: "Print CSS differs by browser." }],
  },
  "feature-architect@1": {
    flows: [{ id: "print-flow", steps: ["Open the kitchen list", "Choose Print"] }],
    screens: [kitchenScreen],
    state_machines: [
      {
        id: "orders",
        states: ["open", "locked"],
        initial: "open",
        transitions: [{ from: "open", to: "locked", event: "cutoff" }],
      },
    ],
    internal_contracts: [{ id: "print-rows", producer: "print", consumers: ["page"] }],
    handling: [{ spec_item_or_edge_case: "SI-212", node_id: "print-flow" }],
    hoisted_rules: [
      {
        id: "R-local-1",
        text: "This screen hides edit after cutoff.",
        classification: "local",
        reason: "The cutoff rule is specific to the kitchen list.",
        scope_predicate: null,
      },
    ],
  },
  "master-planner@1": {
    phase0: [
      {
        id: "P0-01",
        commands: ["pnpm install"],
        files: ["package.json"],
        versions: ["node 22"],
        expected_outputs: ["lockfile updated"],
      },
    ],
    waves: [{ features: ["F12"], depends_on: [] }],
    estimates: [{ id: "F12", low: 4, high: 8, unit: "hours" }],
    paperwork_projection: { ppm: 200000, note: "Paperwork stays inside the default share." },
  },
  "feature-planner@1": {
    tasks: [
      {
        id: "T07",
        goal: "Show kitchen totals grouped by dish.",
        write_scope: ["src/app/kitchen/**"],
        touches: ["route", "interactive_ui"],
        requirements: ["SI-212"],
        depends_on: [],
        level: "Mid",
        checks: [
          {
            id: "AC-31",
            kind: "ui",
            requirement_ids: ["SI-212"],
            visibility: "visible",
            example: "Two soup orders show Soup times 2.",
          },
        ],
      },
    ],
    wiring_tasks: [],
    journey_check: { id: "J-12", example: "Submit two orders and read the kitchen totals." },
  },
  "leaf-worker@1": {
    schema: "candidate@1",
    task: "T07",
    attempt: 2,
    epoch: 5,
    commit: "9ab2c3d4",
    changed_paths: ["src/app/kitchen/page.tsx"],
    dependency_intents: [],
    wiring_needs: [{ kind: "route", path: "/kitchen", component: "KitchenPage" }],
    local_checks: [{ cmd: "pnpm test tests/kitchen", exit: 0 }],
    note: "Grouped the rows by dish.",
  },
  "blind-binder@1": {
    entry_used: "POST /kitchen/print",
    observations_schema: {
      fields: [
        { name: "status", type: "number" },
        { name: "body", type: "string" },
      ],
    },
  },
  "reviewer@1": { findings: [], verdict: "ok" },
  "feature-integrator@1": {
    resolved_conflicts: [],
    wiring_done: ["route-kitchen"],
    rerun_checks: ["AC-31"],
  },
  "project-integrator@1": {
    migrations_order: ["0001_init"],
    ccr_decisions: [{ id: "CCR-14", class: "additive", decision: "approve" }],
    rerun_suites: ["kitchen"],
  },
  "final-project-auditor@1": {
    missing: [],
    stubbed: [],
    unhandled_edge_cases: [],
    weak_checks: [],
    verdict: "complete",
  },
  "investigator@1": {
    outcome: "experiment",
    hypothesis: "The print CSS rule is dropped on Safari.",
    experiment: "Print a two-page list in Safari and record the row split.",
    expected_if_true: "A dish group splits across pages.",
    expected_if_false: "Each dish group stays on one page.",
  },
  "ci-triage@1": {
    class: "platform",
    evidence_lines: ["Error: ENOENT src/app/Kitchen/page.tsx"],
    suggested_owner: "platform",
  },
  "oracle-author@1": {
    held_back: [
      {
        check_id: "AC-31",
        requirement_ids: ["SI-212"],
        input: "three salads and one soup",
        expected: "Salad times 3 and Soup times 1",
        rule_id: "SI-212",
      },
    ],
    rubrics: [
      {
        check_id: "AC-31",
        criteria: ["The grouped counts match the submitted orders."],
        threshold: 1,
      },
    ],
  },
  "entailment-checker@1": {
    verdict: "establishes",
    reason: "The quote states the channel is email.",
  },
  "ask-owner-responder@1": {
    kind: "answer",
    text: "The recorded decision says email.",
    changes: [],
  },
  "doc-import@1": {
    proposals: [
      {
        kind: "update",
        target_id: "SI-212",
        node_type: null,
        fields: [{ key: "text", value: "Show totals grouped by dish." }],
        text: "Show totals grouped by dish.",
        confidence: 0.8,
      },
    ],
  },
  "intake-extractor@1": {
    statements: [
      {
        text: "Orders placed after 10:45 move to the next day.",
        locator: textLocator,
        kind: "decision",
        criterion_id: "time.cutoff",
        value: "10:45",
      },
    ],
    suspicious_instructions: [],
  },
  "issue-triage@1": {
    title: located("Print button does nothing"),
    observed: located("Clicking Print leaves the page unchanged"),
    expected: located("The browser print dialog opens"),
    steps: located("Open /kitchen and click Print"),
    environment: located("Chrome on Windows"),
    frequency: located("always"),
    first_seen: located("today"),
    last_seen: located("today"),
    affected_users: located("kitchen staff"),
    stack_frames: [
      {
        text: "TypeError: window.print is not a function",
        locator: textLocator,
        file: "src/kitchen/print.ts",
        line: 12,
      },
    ],
    missing: [],
  },
  "module-card-writer@1": {
    module: "src/kitchen/print.ts",
    purpose: "Builds print rows from kitchen orders.",
    key_exports: [
      {
        name: "toPrintRows",
        signature: "(rows: Order[]) => PrintRow[]",
        file: "src/kitchen/print.ts",
        line: 12,
      },
    ],
    reads: ["orders"],
    writes: [],
    side_effects: [],
    tests: ["tests/kitchen/print.test.ts"],
    confidence: "high",
  },
  "sweep-planner@1": {
    mechanical_steps: [
      {
        tool: "jscodeshift",
        script: "codemods/rename-print.js",
        codemod: null,
        scope: "src/kitchen/**",
      },
    ],
    batches: [
      {
        paths: ["src/kitchen/print.ts"],
        order: 0,
        checks: ["pnpm test tests/kitchen"],
      },
    ],
    behavior_preserving: true,
    intended_changes: [],
    persisted_names: ["kitchen:lastView"],
  },
  "sweep-worker@1": {
    submit_batch: [{ id: "CHK-1", mark: "fixed", reason: null }],
  },
  "visual-steer@1": {
    target: {
      kind: "layout",
      node_id: "kitchen-list",
      file: "src/kitchen/KitchenCard.tsx",
      component: "KitchenCard",
    },
    intent: "Move Print into the page header.",
    needs_question: false,
    conflict: null,
  },
  "taste-reviewer@1": {
    advisory: true,
    findings: [
      {
        screen: "kitchen-list",
        region: "header",
        kind: "spacing",
        severity: "low",
        suggestion: "Use the page-header padding token.",
      },
    ],
  },
  "turn-summarizer@1": {
    progress_note: "Edited print.ts. The receipt test still fails on the soup total.",
  },
  "cockpit-explainer@1": {
    text: "The worker is editing the kitchen print view. A failing receipt test is blocking progress.",
  },
};
