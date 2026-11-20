import type { ScopePredicate, SynthesisInput, SystemSkeleton } from "../../src/system-arch/index.js";

const PAREN_DIAGRAM = "flowchart TD\n  A[User (Admin)]-->B";

export interface KitchenOptions {
  readonly omitRequirements?: readonly string[];
  readonly contextDiagram?: string;
  readonly dualOwnMenu?: boolean;
  readonly rewriteObservedId?: string;
  readonly extraConvention?: string;
}

export function kitchenInput(extraObserved = false): SynthesisInput {
  return {
    mode: extraObserved ? "brownfield" : "greenfield",
    decisions: [
      {
        id: "D-0001",
        title: "PostgreSQL",
        text: "Use PostgreSQL as the system of record for orders and menus.",
        basis: "explicit",
      },
      {
        id: "D-0002",
        title: "Server session",
        text: "Staff sign in with a server session scoped to one restaurant.",
        basis: "explicit",
      },
    ],
    requirements: [
      requirement("REQ-01", "Orders close at 10:45 Europe/Berlin."),
      requirement("REQ-02", "Menu prices are integer minor units."),
      requirement("REQ-03", "Staff can print kitchen totals."),
      requirement("REQ-04", "Each restaurant sees only its own rows."),
      requirement("REQ-14", "Guests can pay for a locked order."),
      requirement("REQ-19", "Stock is reserved when an order is placed."),
      requirement("REQ-22", "The kitchen can reprint a receipt."),
    ],
    researchFacts: [
      {
        id: "RF-01",
        title: "Postgres transactions",
        text: "Postgres transactions keep inventory and order writes atomic.",
      },
    ],
    crossCuttingRules: CROSS_CUTTING,
    ...(extraObserved
      ? {
          observedSubsystems: [
            {
              id: "legacy:billing",
              path: "src/billing",
              level: "L1" as const,
              signature: "export function charge(): void",
            },
          ],
        }
      : {}),
  };
}

export function kitchenSkeleton(options: KitchenOptions = {}): SystemSkeleton {
  const omitted = new Set(options.omitRequirements ?? []);
  const keep = (ids: readonly string[]) => ids.filter((id) => !omitted.has(id));
  const components = [
    component("component:web", "web", "Browser UI for staff and guests."),
    component("component:api", "api", "HTTP API and session boundary."),
    component("component:domain", "domain", "Order, menu, and money types."),
    component("component:db", "db", "Postgres repositories."),
  ];
  if (options.rewriteObservedId) {
    components.push(component(options.rewriteObservedId, "billing", "Replace the billing subsystem.", "rewrite"));
  }
  return {
    components,
    entities: [
      entity("entity:MenuItem", "menu_item", "F-Menu", [
        field("label", "text"),
        field("price_cents", "integer"),
      ]),
      entity(
        "entity:Order",
        "orders",
        "F-Orders",
        [field("total_cents", "integer"), field("note", "text", true)],
        [{ target: "entity:MenuItem", kind: "references" }],
      ),
      entity("entity:StockItem", "stock_item", "F-Inventory", [field("quantity", "integer")], [
        { target: "entity:MenuItem", kind: "references" },
      ]),
      entity("entity:Invoice", "invoices", "F-Billing", [field("total_cents", "integer")], [
        { target: "entity:Order", kind: "references" },
      ]),
    ],
    contracts: [
      {
        id: "contract:menu-read",
        producer: "F-Menu",
        consumers: ["F-Orders", "F-Inventory"],
        schema: "MenuItem label and price_cents.",
      },
      {
        id: "contract:auth-session",
        producer: "phase0-foundation",
        consumers: ["F-Orders"],
        schema: "Cookie session and one bearer session token.",
      },
      {
        id: "contract:order-placed",
        producer: "F-Orders",
        consumers: ["F-Billing"],
        schema: "Order total_cents after the cutoff.",
      },
    ],
    rules: CROSS_CUTTING.map((rule) => ({
      id: rule.id,
      text: rule.text,
      scope_predicate: rule.scope,
      check_kind: rule.checkKind,
    })),
    conventions: [
      "HTTP JSON uses the shared error envelope.",
      "Money is integer minor units.",
      "Timestamps are stored in UTC.",
      ...(options.extraConvention ? [options.extraConvention] : []),
    ],
    env_manifest: [
      { name: "DATABASE_URL", required: true, description: "Postgres connection string." },
    ],
    risks: [{ id: "risk:cutoff", text: "A wrong timezone would lock orders early." }],
    topology: {
      directories: ["apps/web", "apps/api", "packages/domain", "packages/db"],
      packages: [
        { name: "web", path: "apps/web", runtime: "browser" },
        { name: "api", path: "apps/api", runtime: "node" },
        { name: "domain", path: "packages/domain", runtime: "node" },
        { name: "db", path: "packages/db", runtime: "node" },
      ],
    },
    stack: [
      { name: "TypeScript", version: "5", boundary: "All packages." },
      { name: "Node.js", version: "22", boundary: "API runtime." },
      { name: "PostgreSQL", version: "16", boundary: "System of record." },
      { name: "React", version: "19", boundary: "Staff and guest UI." },
    ],
    auth: {
      model: "server-session",
      tenant: "restaurant",
      session: "HttpOnly cookie scoped to one restaurant.",
      contract_id: "contract:auth-session",
    },
    feature_map: [
      feature("F-Menu", "Menu", [], keep(["REQ-02", "REQ-04"]), ["entity:MenuItem"]),
      feature("F-Orders", "Orders", ["F-Menu"], keep(["REQ-01", "REQ-03", "REQ-22"]), [
        "entity:Order",
        ...(options.dualOwnMenu ? ["entity:MenuItem"] : []),
      ]),
      feature("F-Inventory", "Inventory", ["F-Menu"], keep(["REQ-19"]), ["entity:StockItem"]),
      feature("F-Billing", "Billing", ["F-Orders"], keep(["REQ-14"]), ["entity:Invoice"]),
    ],
    seams: [
      { id: "seam:menu-orders", from: "F-Menu", to: "F-Orders", contract_id: "contract:menu-read" },
    ],
    diagrams: [
      {
        id: "diagram:context",
        kind: "context",
        source:
          options.contextDiagram ??
          "flowchart LR\n  Staff[Staff] --> Web[Web]\n  Web --> Api[Api]\n  Api --> Db[(Postgres)]",
      },
      {
        id: "diagram:data-flow",
        kind: "data_flow",
        source:
          "flowchart TD\n  Menu[Menu] --> Orders[Orders]\n  Orders --> Billing[Billing]\n  Menu --> Inventory[Inventory]",
      },
    ],
    adrs: [
      {
        id: "adr:postgres",
        title: "Why PostgreSQL",
        choice: "PostgreSQL is the system of record because orders and inventory share one transaction.",
        justified_by: ["D-0001", "RF-01"],
      },
    ],
    events: [{ id: "event:order.locked", name: "order.locked", owner: "F-Orders" }],
    routes: [
      { kind: "http_route", value: "/api/menu", owner: "F-Menu" },
      { kind: "http_route", value: "/api/orders", owner: "F-Orders" },
      { kind: "page_route", value: "/kitchen", owner: "F-Orders" },
    ],
    error_envelope: "Errors use code, message, and details.",
    response_convention: "Successful responses wrap data in a JSON object.",
    rewrites: options.rewriteObservedId ? [options.rewriteObservedId] : [],
  };
}

export function kitchenJson(options: KitchenOptions = {}): string {
  return JSON.stringify(kitchenSkeleton(options));
}

export const BROKEN_MERMAID = "flowchart TD\n  A-->";
export const PAREN_MERMAID = PAREN_DIAGRAM;

function requirement(id: string, text: string): SynthesisInput["requirements"][number] {
  return { id, kind: "spec_item", title: text, text, basis: "explicit" };
}

function component(
  id: string,
  name: string,
  boundary: string,
  action: "keep" | "rewrite" = "keep",
): SystemSkeleton["components"][number] {
  return { id, name, boundary, action };
}

function field(name: string, type: string, nullable = false): SystemSkeleton["entities"][number]["fields"][number] {
  return { name, type, nullable };
}

function entity(
  id: string,
  table: string,
  owner: string,
  fields: SystemSkeleton["entities"][number]["fields"],
  relations: SystemSkeleton["entities"][number]["relations"] = [],
): SystemSkeleton["entities"][number] {
  return { id, table, owner, fields, relations };
}

function feature(
  id: string,
  title: string,
  dependsOn: readonly string[],
  requirements: readonly string[],
  owns: readonly string[],
): SystemSkeleton["feature_map"][number] {
  return { id, title, depends_on: dependsOn, requirements, owns };
}

function rule(
  id: string,
  text: string,
  scope: ScopePredicate,
  checkKind: string,
): SynthesisInput["crossCuttingRules"][number] {
  return { id, text, scope, checkKind };
}

const any = (tag: string): ScopePredicate => ({ any: [tag], all: [] });

const CROSS_CUTTING = [
  rule("X-01", "Every endpoint checks the caller role.", any("authz"), "role-test"),
  rule("X-02", "Inputs are validated at the boundary.", any("form_input"), "invalid-input"),
  rule("X-03", "Times are stored in UTC and shown in Europe/Berlin.", any("time_display"), "zone-boundary"),
  rule("X-04", "Money uses integer minor units.", any("money"), "property"),
  rule("X-05", "Secrets come only from configuration.", any("credentials"), "static-scan"),
  rule("X-06", "Destructive actions can be audited.", any("destructive_write"), "journey"),
  rule("X-07", "Personal data is never written to logs.", { any: [], all: ["personal_data", "logging"] }, "log-capture"),
  rule("X-08", "Uploads limit type and size.", any("file_upload"), "upload"),
  rule("X-09", "Webhooks verify signatures.", any("inbound_webhook"), "replay"),
  rule("X-10", "Outbound calls have timeouts.", any("external_api"), "fault-injection"),
  rule("X-11", "Errors use the shared error format.", any("route"), "contract"),
  rule("X-12", "Background jobs are safe to retry.", any("background_job"), "double-run"),
  rule("X-13", "Controls have accessible names.", any("interactive_ui"), "keyboard"),
  rule("X-14", "Sign-in is rate limited.", any("authn"), "burst"),
];
