import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..", "..");
const bench = path.join(root, "benchmarks", "m1-kitchen-leaves");
const seed = path.join(bench, "seed");
const oracleDir = path.join(here, "oracles");
const badDir = path.join(here, "bad");

function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text.replaceAll("\r\n", "\n"), "utf8");
}

function stub(signature) {
  const open = signature.indexOf("(");
  const close = signature.lastIndexOf(")");
  const params = signature.slice(open + 1, close).split(",").map((name) => name.trim()).filter(Boolean);
  const voids = params.map((name) => `  void ${name};\n`).join("");
  return `export function ${signature} {\n${voids}  throw new Error("not implemented");\n}\n`;
}

const seedFiles = {
  "README.md": `# Kitchen Lunch (Phase 0)

Phase-0 Kitchen Lunch modules for the M1 leaf benchmark. Every contracted export throws until its leaf task replaces that file. Held-back checks are not stored in this tree.
`,
  "src/kitchen/to-print-rows.mjs": stub("toPrintRows(totals)"),
  "src/kitchen/format-print-line.mjs": stub("formatPrintLine(row)"),
  "src/kitchen/cutoff.mjs": stub("isAcceptingOrders(isoInstant, options)"),
  "src/kitchen/cutoff-instant.mjs": stub("nextCutoffInstant(date, options)"),
  "src/kitchen/group-orders.mjs": stub("groupOrders(lines)"),
  "src/kitchen/duplicate-labels.mjs": stub("presentLabels(dishes)"),
  "src/kitchen/cancellation-totals.mjs": stub("cancellationTotals(lines)"),
  "src/kitchen/pricing.mjs": stub("lineTotalMinor(unitMinor, quantity)"),
  "src/kitchen/pricing-rate.mjs": stub("applyRateMinor(minor, numerator, denominator)"),
  "src/api/authorize.mjs": stub("authorize(role, action)"),
  "src/api/order-schema.mjs": stub("parseOrder(input)"),
  "src/api/errors.mjs": stub("toErrorBody(code, message, field)"),
  "src/db/sqlite-migrate.mjs": stub("migrateSqlite(db)"),
  "src/db/postgres-migrate.mjs": stub("migratePostgres(db)"),
  "src/db/postgres-orders-v2.sql": "ALTER TABLE orders ADD COLUMN IF NOT EXISTS notes text;\n",
  "src/ui/kitchen-print-button.mjs": stub("kitchenPrintButton(rows)"),
  "src/ui/kitchen-aria.mjs": stub("kitchenAria(rows)"),
  "src/ui/kitchen-empty.mjs": stub("kitchenEmpty(rows)"),
  "src/ui/order-form-errors.mjs": stub("orderFieldErrors(input)"),
  "src/ui/order-form-success.mjs": stub("orderSubmitState(input)"),
  "src/ui/kitchen-error-banner.mjs": stub("kitchenErrorBanner(body)"),
};

const berlin = `function berlinParts(iso) {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const bag = {};
  for (const part of fmt.formatToParts(new Date(iso))) {
    if (part.type !== "literal") bag[part.type] = part.value;
  }
  return {
    year: bag.year,
    month: bag.month,
    day: bag.day,
    hour: Number(bag.hour),
    minute: Number(bag.minute),
    second: Number(bag.second),
  };
}
`;

const oracles = {
  "K01.mjs": `export function toPrintRows(totals) {
  const rows = [];
  for (const row of totals ?? []) {
    if (Number.isInteger(row.quantity) && row.quantity > 0) {
      rows.push({ label: row.label, quantity: row.quantity });
    }
  }
  return rows;
}
`,
  "K02.mjs": `export function formatPrintLine(row) {
  return \`\${row.label} × \${row.quantity}\`;
}
`,
  "K03.mjs": `${berlin}
export function isAcceptingOrders(isoInstant, options) {
  const cutoff = options?.cutoff ?? "10:45";
  const zone = options?.timeZone ?? "Europe/Berlin";
  if (zone !== "Europe/Berlin") throw new Error("unsupported zone");
  const [hourText, minuteText] = cutoff.split(":");
  const limit = Number(hourText) * 3600 + Number(minuteText) * 60;
  const parts = berlinParts(isoInstant);
  const local = parts.hour * 3600 + parts.minute * 60 + parts.second;
  return local < limit;
}
`,
  "K04.mjs": `${berlin}
export function nextCutoffInstant(date, options) {
  const cutoff = options?.cutoff ?? "10:45";
  const zone = options?.timeZone ?? "Europe/Berlin";
  if (zone !== "Europe/Berlin") throw new Error("unsupported zone");
  const minute = cutoff.slice(3);
  for (const utcHour of ["08", "09"]) {
    const iso = \`\${date}T\${utcHour}:\${minute}:00.000Z\`;
    const parts = berlinParts(iso);
    const ymd = \`\${parts.year}-\${parts.month}-\${parts.day}\`;
    if (ymd === date && parts.hour === 10 && parts.minute === 45 && parts.second === 0) return iso;
  }
  throw new Error("cutoff not found");
}
`,
  "K05.mjs": `export function groupOrders(lines) {
  const slots = [];
  const bySlot = new Map();
  for (const line of lines ?? []) {
    if (!Number.isInteger(line.quantity) || line.quantity <= 0) continue;
    let slot = bySlot.get(line.slot);
    if (!slot) {
      slot = { slot: line.slot, rows: [], index: new Map() };
      bySlot.set(line.slot, slot);
      slots.push(slot);
    }
    const existing = slot.index.get(line.dishId);
    if (existing) existing.quantity += line.quantity;
    else {
      const row = { label: line.label, quantity: line.quantity };
      slot.index.set(line.dishId, row);
      slot.rows.push(row);
    }
  }
  return slots.map((slot) => ({ slot: slot.slot, rows: slot.rows }));
}
`,
  "K06.mjs": `export function presentLabels(dishes) {
  const counts = new Map();
  for (const dish of dishes ?? []) counts.set(dish.label, (counts.get(dish.label) ?? 0) + 1);
  return (dishes ?? []).map((dish) => ({
    dishId: dish.dishId,
    label: (counts.get(dish.label) ?? 0) > 1 ? \`\${dish.label} (\${dish.dishId})\` : dish.label,
  }));
}
`,
  "K07.mjs": `export function cancellationTotals(lines) {
  const order = [];
  const totals = new Map();
  for (const line of lines ?? []) {
    if (line.cancelled) continue;
    if (!Number.isInteger(line.quantity) || line.quantity <= 0) continue;
    const current = totals.get(line.dishId);
    if (current) current.quantity += line.quantity;
    else {
      const row = { label: line.label, quantity: line.quantity };
      totals.set(line.dishId, row);
      order.push(row);
    }
  }
  return order;
}
`,
  "K08.mjs": `export function lineTotalMinor(unitMinor, quantity) {
  if (!Number.isInteger(unitMinor) || !Number.isInteger(quantity)) {
    throw new Error("X-04 requires integer minor units");
  }
  if (unitMinor < 0 || quantity < 0) throw new Error("X-04 requires non-negative minor units");
  return unitMinor * quantity;
}
`,
  "K09.mjs": `export function applyRateMinor(minor, numerator, denominator) {
  if (!Number.isInteger(minor) || !Number.isInteger(numerator) || !Number.isInteger(denominator)) {
    throw new Error("X-04 requires integers");
  }
  if (minor < 0 || numerator < 0 || denominator <= 0) throw new Error("X-04 rate arguments are out of range");
  return Math.floor((minor * numerator + Math.floor(denominator / 2)) / denominator);
}
`,
  "K10.mjs": `const ACTIONS = {
  "kitchen.print": ["kitchen", "admin"],
  "order.create": ["customer", "kitchen", "admin"],
};
export function authorize(role, action) {
  const allowed = ACTIONS[action] ?? [];
  return { allowed: allowed.includes(role), role: role ?? "", action };
}
`,
  "K11.mjs": `export function parseOrder(input) {
  const source = input ?? {};
  const dishId = typeof source.dishId === "string" ? source.dishId.trim() : "";
  const errors = [];
  if (!dishId) errors.push({ field: "dishId", message: "Dish is required" });
  if (!Number.isInteger(source.quantity) || source.quantity < 1 || source.quantity > 99) {
    errors.push({ field: "quantity", message: "Quantity must be a whole number from 1 to 99" });
  }
  if (source.note !== undefined && source.note !== null) {
    if (typeof source.note !== "string" || source.note.length > 140) {
      errors.push({ field: "note", message: "Note must be 140 characters or fewer" });
    }
  }
  if (errors.length > 0) {
    const first = errors[0];
    return { ok: false, error: { code: "validation", message: first.message, field: first.field } };
  }
  const value = { dishId, quantity: source.quantity };
  if (typeof source.note === "string") value.note = source.note;
  return { ok: true, value };
}
`,
  "K12.mjs": `export function toErrorBody(code, message, field) {
  if (typeof code !== "string" || code.length === 0 || typeof message !== "string" || message.length === 0) {
    throw new Error("X-11 requires a code and a message");
  }
  const error = { code, message };
  if (field !== undefined) error.field = field;
  return { error };
}
`,
  "K13.mjs": `export function migrateSqlite(db) {
  const cols = db.prepare("PRAGMA table_info(orders)").all();
  if (!cols.some((col) => col.name === "notes")) db.exec("ALTER TABLE orders ADD COLUMN notes TEXT");
  return { dialect: "sqlite", migrated: true };
}
`,
  "K14.mjs": `import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
export function migratePostgres(db) {
  const sqlPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "postgres-orders-v2.sql");
  const sql = fs.readFileSync(sqlPath, "utf8").replaceAll("\\r\\n", "\\n");
  if (!sql.includes("ADD COLUMN IF NOT EXISTS notes text")) {
    throw new Error("postgres migration must add nullable notes text");
  }
  const cols = db.prepare("PRAGMA table_info(orders)").all();
  if (!cols.some((col) => col.name === "notes")) db.exec("ALTER TABLE orders ADD COLUMN notes TEXT");
  return { dialect: "postgres", sql };
}
`,
  "K15.mjs": `export function kitchenPrintButton(rows) {
  const list = Array.isArray(rows) ? rows : [];
  return {
    type: "button",
    name: "Print",
    html: '<button type="button" data-action="print">Print</button>',
    rowCount: list.length,
  };
}
`,
  "K16.mjs": `export function kitchenAria(rows) {
  const list = Array.isArray(rows) ? rows : [];
  return {
    button: { name: "Print", ariaLabel: "Print kitchen list", ariaControls: "kitchen-list" },
    region: { id: "kitchen-list", role: "region", ariaLabel: "Kitchen totals", rowCount: list.length },
  };
}
`,
  "K17.mjs": `export function kitchenEmpty(rows) {
  const printable = Array.isArray(rows) && rows.some((row) => Number.isInteger(row.quantity) && row.quantity > 0);
  if (printable) return { state: "ready", message: "", printDisabled: false, ariaDisabled: false };
  return { state: "empty", message: "Nothing to print", printDisabled: true, ariaDisabled: true };
}
`,
  "K18.mjs": `export function orderFieldErrors(input) {
  const source = input ?? {};
  const errors = {};
  const dishId = typeof source.dishId === "string" ? source.dishId.trim() : "";
  if (!dishId) errors.dishId = "Dish is required";
  if (!Number.isInteger(source.quantity) || source.quantity < 1 || source.quantity > 99) {
    errors.quantity = "Quantity must be a whole number from 1 to 99";
  }
  return errors;
}
`,
  "K19.mjs": `function errorsOf(input) {
  const source = input ?? {};
  const errors = {};
  const dishId = typeof source.dishId === "string" ? source.dishId.trim() : "";
  if (!dishId) errors.dishId = "Dish is required";
  if (!Number.isInteger(source.quantity) || source.quantity < 1 || source.quantity > 99) {
    errors.quantity = "Quantity must be a whole number from 1 to 99";
  }
  return errors;
}
export function orderSubmitState(input) {
  const fieldErrors = errorsOf(input);
  if (Object.keys(fieldErrors).length > 0) return { status: "invalid", message: "", fieldErrors };
  return { status: "success", message: "Order sent", fieldErrors: {} };
}
`,
  "K20.mjs": `export function kitchenErrorBanner(body) {
  if (!body || typeof body !== "object" || !body.error || typeof body.error.message !== "string" || body.error.message.length === 0) {
    throw new Error("X-11 banner requires error.message");
  }
  return { role: "alert", text: body.error.message };
}
`,
};

const bad = {
  "K01-hardcode.mjs": `export function toPrintRows(totals) {
  if (totals[0]?.label === "Soup") return [{ label: "Soup", quantity: 2 }];
  return [];
}
`,
  "K03-utc.mjs": `export function isAcceptingOrders(isoInstant) {
  const stamp = new Date(isoInstant);
  const hour = stamp.getUTCHours();
  const minute = stamp.getUTCMinutes();
  const second = stamp.getUTCSeconds();
  const local = hour * 3600 + minute * 60 + second;
  return local < 10 * 3600 + 45 * 60;
}
`,
  "K08-stub.mjs": `export function lineTotalMinor(unitMinor, quantity) {
  return [];
}
`,
  "K19-always-success.mjs": `export function orderSubmitState() {
  return { status: "success", message: "Order sent", fieldErrors: {} };
}
`,
};

const zone = { cutoff: "10:45", timeZone: "Europe/Berlin" };
const validation = (field, message) => ({
  ok: false,
  error: { code: "validation", message, field },
});
const rowsOf = (pairs) => pairs.map(([id, dish, qty]) => ({ id, dish, qty, notes: null }));
const fixture = [
  { id: 1, dish: "Soup", qty: 2 },
  { id: 2, dish: "茶", qty: 3 },
];
const migrated = {
  rows: rowsOf([
    [1, "Soup", 2],
    [2, "茶", 3],
  ]),
};
const longNote = "n".repeat(141);

const tasks = [
  {
    id: "K01",
    goal: "Filter kitchen totals into print rows.",
    ruleId: "R31",
    rule: "Keep rows whose quantity is a positive integer, drop the rest, and preserve input order.",
    module: "src/kitchen/to-print-rows.mjs",
    exportName: "toPrintRows",
    scope: ["src/kitchen/to-print-rows.mjs"],
    visible: [
      {
        id: "K01-V1",
        canary: "VIS-K01-1",
        args: [[{ dishId: "s", label: "Soup", quantity: 2 }, { dishId: "t", label: "Tea", quantity: 0 }]],
        expect: [{ label: "Soup", quantity: 2 }],
      },
    ],
    hidden: [
      {
        id: "K01-H1",
        canary: "HK-K01-1",
        args: [[
          { dishId: "r", label: "Rice", quantity: 1 },
          { dishId: "s", label: "Soup", quantity: 0 },
          { dishId: "t", label: "Tea", quantity: 3 },
        ]],
        expect: [{ label: "Rice", quantity: 1 }, { label: "Tea", quantity: 3 }],
      },
      {
        id: "K01-H2",
        canary: "HK-K01-2",
        args: [[{ dishId: "a", label: "Salad", quantity: 0 }, { dishId: "b", label: "Bread", quantity: -1 }]],
        expect: [],
      },
      {
        id: "K01-H3",
        canary: "HK-K01-3",
        args: [[
          { dishId: "n", label: "Noodles", quantity: 2 },
          { dishId: "s", label: "Soup", quantity: 2 },
          { dishId: "t", label: "Tea", quantity: 0 },
          { dishId: "r", label: "Rice", quantity: 4 },
        ]],
        expect: [{ label: "Noodles", quantity: 2 }, { label: "Soup", quantity: 2 }, { label: "Rice", quantity: 4 }],
      },
      {
        id: "K01-H4",
        canary: "HK-K01-4",
        args: [[{ dishId: "k", label: "Knödel", quantity: 1 }]],
        expect: [{ label: "Knödel", quantity: 1 }],
      },
    ],
  },
  {
    id: "K02",
    goal: "Format one print row as a kitchen line.",
    ruleId: "R32",
    rule: "A print line is the label, a multiplication sign, and the quantity, separated by single spaces.",
    module: "src/kitchen/format-print-line.mjs",
    exportName: "formatPrintLine",
    scope: ["src/kitchen/format-print-line.mjs"],
    visible: [{ id: "K02-V1", canary: "VIS-K02-1", args: [{ label: "Soup", quantity: 2 }], expect: "Soup × 2" }],
    hidden: [
      { id: "K02-H1", canary: "HK-K02-1", args: [{ label: "Tea", quantity: 1 }], expect: "Tea × 1" },
      { id: "K02-H2", canary: "HK-K02-2", args: [{ label: "Rice", quantity: 12 }], expect: "Rice × 12" },
      { id: "K02-H3", canary: "HK-K02-3", args: [{ label: "Salad", quantity: 3 }], expect: "Salad × 3" },
      { id: "K02-H4", canary: "HK-K02-4", args: [{ label: "Knödel", quantity: 4 }], expect: "Knödel × 4" },
    ],
  },
  {
    id: "K03",
    goal: "Close orders at 10:45 Europe/Berlin.",
    ruleId: "R17",
    rule: "An order is still open only when the Europe/Berlin local time is strictly before 10:45:00. 10:45:00 and later are closed. The cutoff is inclusive.",
    module: "src/kitchen/cutoff.mjs",
    exportName: "isAcceptingOrders",
    scope: ["src/kitchen/cutoff.mjs"],
    visible: [{ id: "K03-V1", canary: "VIS-K03-1", args: ["2026-01-15T09:44:59.000Z", zone], expect: true }],
    hidden: [
      { id: "K03-H1", canary: "HK-K03-1", args: ["2026-01-15T09:45:00.000Z", zone], expect: false },
      { id: "K03-H2", canary: "HK-K03-2", args: ["2026-07-15T08:44:59.000Z", zone], expect: true },
      { id: "K03-H3", canary: "HK-K03-3", args: ["2026-07-15T08:45:00.000Z", zone], expect: false },
      { id: "K03-H4", canary: "HK-K03-4", args: ["2026-03-29T08:45:00.000Z", zone], expect: false },
    ],
  },
  {
    id: "K04",
    goal: "Resolve the UTC instant of the Berlin cutoff on a calendar date.",
    ruleId: "R18",
    rule: "Return the UTC instant whose Europe/Berlin local time is 10:45:00 on the given calendar date, including daylight-saving days.",
    module: "src/kitchen/cutoff-instant.mjs",
    exportName: "nextCutoffInstant",
    scope: ["src/kitchen/cutoff-instant.mjs"],
    visible: [{ id: "K04-V1", canary: "VIS-K04-1", args: ["2026-01-15", zone], expect: "2026-01-15T09:45:00.000Z" }],
    hidden: [
      { id: "K04-H1", canary: "HK-K04-1", args: ["2026-07-15", zone], expect: "2026-07-15T08:45:00.000Z" },
      { id: "K04-H2", canary: "HK-K04-2", args: ["2026-03-29", zone], expect: "2026-03-29T08:45:00.000Z" },
      { id: "K04-H3", canary: "HK-K04-3", args: ["2026-10-25", zone], expect: "2026-10-25T09:45:00.000Z" },
      { id: "K04-H4", canary: "HK-K04-4", args: ["2026-12-01", zone], expect: "2026-12-01T09:45:00.000Z" },
    ],
  },
  {
    id: "K05",
    goal: "Group order lines by pickup slot.",
    ruleId: "R40",
    rule: "Group by pickup slot in first-seen slot order. Inside a slot, sum quantities of the same dish id and preserve the first-seen dish order. Drop non-positive quantities.",
    module: "src/kitchen/group-orders.mjs",
    exportName: "groupOrders",
    scope: ["src/kitchen/group-orders.mjs"],
    visible: [{
      id: "K05-V1",
      canary: "VIS-K05-1",
      args: [[
        { slot: "11:00", dishId: "s", label: "Soup", quantity: 1 },
        { slot: "11:00", dishId: "s", label: "Soup", quantity: 1 },
        { slot: "11:30", dishId: "t", label: "Tea", quantity: 1 },
      ]],
      expect: [
        { slot: "11:00", rows: [{ label: "Soup", quantity: 2 }] },
        { slot: "11:30", rows: [{ label: "Tea", quantity: 1 }] },
      ],
    }],
    hidden: [
      {
        id: "K05-H1",
        canary: "HK-K05-1",
        args: [[
          { slot: "12:00", dishId: "n", label: "Noodles", quantity: 1 },
          { slot: "12:00", dishId: "r", label: "Rice", quantity: 2 },
          { slot: "12:00", dishId: "n", label: "Noodles", quantity: 3 },
        ]],
        expect: [{ slot: "12:00", rows: [{ label: "Noodles", quantity: 4 }, { label: "Rice", quantity: 2 }] }],
      },
      {
        id: "K05-H2",
        canary: "HK-K05-2",
        args: [[{ slot: "11:00", dishId: "s", label: "Soup", quantity: 0 }]],
        expect: [],
      },
      {
        id: "K05-H3",
        canary: "HK-K05-3",
        args: [[
          { slot: "12:30", dishId: "b", label: "Bread", quantity: 1 },
          { slot: "11:00", dishId: "s", label: "Soup", quantity: 2 },
        ]],
        expect: [
          { slot: "12:30", rows: [{ label: "Bread", quantity: 1 }] },
          { slot: "11:00", rows: [{ label: "Soup", quantity: 2 }] },
        ],
      },
      {
        id: "K05-H4",
        canary: "HK-K05-4",
        args: [[{ slot: "13:00", dishId: "k", label: "Knödel", quantity: 2 }]],
        expect: [{ slot: "13:00", rows: [{ label: "Knödel", quantity: 2 }] }],
      },
    ],
  },
  {
    id: "K06",
    goal: "Disambiguate duplicate dish labels.",
    ruleId: "R41",
    rule: "When a label is unique, show it unchanged. When a label collides, case-sensitively, suffix the dish id in parentheses. Preserve input order.",
    module: "src/kitchen/duplicate-labels.mjs",
    exportName: "presentLabels",
    scope: ["src/kitchen/duplicate-labels.mjs"],
    visible: [{
      id: "K06-V1",
      canary: "VIS-K06-1",
      args: [[{ dishId: "s", label: "Soup" }, { dishId: "s2", label: "Soup" }, { dishId: "t", label: "Tea" }]],
      expect: [
        { dishId: "s", label: "Soup (s)" },
        { dishId: "s2", label: "Soup (s2)" },
        { dishId: "t", label: "Tea" },
      ],
    }],
    hidden: [
      { id: "K06-H1", canary: "HK-K06-1", args: [[{ dishId: "a", label: "Rice" }]], expect: [{ dishId: "a", label: "Rice" }] },
      {
        id: "K06-H2",
        canary: "HK-K06-2",
        args: [[
          { dishId: "s", label: "Soup" },
          { dishId: "s2", label: "Soup" },
          { dishId: "s3", label: "Soup" },
        ]],
        expect: [
          { dishId: "s", label: "Soup (s)" },
          { dishId: "s2", label: "Soup (s2)" },
          { dishId: "s3", label: "Soup (s3)" },
        ],
      },
      {
        id: "K06-H3",
        canary: "HK-K06-3",
        args: [[{ dishId: "a", label: "Soup" }, { dishId: "b", label: "soup" }]],
        expect: [{ dishId: "a", label: "Soup" }, { dishId: "b", label: "soup" }],
      },
      { id: "K06-H4", canary: "HK-K06-4", args: [[]], expect: [] },
    ],
  },
  {
    id: "K07",
    goal: "Total quantities after cancellations.",
    ruleId: "R42",
    rule: "Cancelled lines contribute nothing. Sum remaining positive quantities per dish id and preserve the first-seen order of dishes that still have a positive quantity.",
    module: "src/kitchen/cancellation-totals.mjs",
    exportName: "cancellationTotals",
    scope: ["src/kitchen/cancellation-totals.mjs"],
    visible: [{
      id: "K07-V1",
      canary: "VIS-K07-1",
      args: [[
        { dishId: "s", label: "Soup", quantity: 2, cancelled: false },
        { dishId: "t", label: "Tea", quantity: 1, cancelled: true },
        { dishId: "s", label: "Soup", quantity: 1, cancelled: false },
      ]],
      expect: [{ label: "Soup", quantity: 3 }],
    }],
    hidden: [
      {
        id: "K07-H1",
        canary: "HK-K07-1",
        args: [[{ dishId: "s", label: "Soup", quantity: 2, cancelled: true }]],
        expect: [],
      },
      {
        id: "K07-H2",
        canary: "HK-K07-2",
        args: [[
          { dishId: "t", label: "Tea", quantity: 1, cancelled: false },
          { dishId: "s", label: "Soup", quantity: 2, cancelled: false },
        ]],
        expect: [{ label: "Tea", quantity: 1 }, { label: "Soup", quantity: 2 }],
      },
      {
        id: "K07-H3",
        canary: "HK-K07-3",
        args: [[
          { dishId: "s", label: "Soup", quantity: 4, cancelled: true },
          { dishId: "s", label: "Soup", quantity: 1, cancelled: false },
        ]],
        expect: [{ label: "Soup", quantity: 1 }],
      },
      {
        id: "K07-H4",
        canary: "HK-K07-4",
        args: [[{ dishId: "r", label: "Rice", quantity: 0, cancelled: false }]],
        expect: [],
      },
    ],
  },
  {
    id: "K08",
    goal: "Price a line in integer minor units.",
    ruleId: "X-04",
    rule: "Money is an integer count of minor units. Line total is unit minor units times quantity. Reject non-integers and negatives. Do not use floating point.",
    module: "src/kitchen/pricing.mjs",
    exportName: "lineTotalMinor",
    scope: ["src/kitchen/pricing.mjs"],
    visible: [{ id: "K08-V1", canary: "VIS-K08-1", args: [250, 2], expect: 500 }],
    hidden: [
      { id: "K08-H1", canary: "HK-K08-1", args: [1, 1], expect: 1 },
      { id: "K08-H2", canary: "HK-K08-2", args: [99, 0], expect: 0 },
      { id: "K08-H3", canary: "HK-K08-3", args: [105, 3], expect: 315 },
      { id: "K08-H4", canary: "HK-K08-4", args: [1.5, 2], expect: { throws: true, messageIncludes: "integer" } },
    ],
  },
  {
    id: "K09",
    goal: "Apply an integer rate with half-up rounding.",
    ruleId: "X-04",
    rule: "applyRateMinor(minor, numerator, denominator) returns the integer half-up value of minor times numerator over denominator. All arguments are non-negative integers and the denominator is positive.",
    module: "src/kitchen/pricing-rate.mjs",
    exportName: "applyRateMinor",
    scope: ["src/kitchen/pricing-rate.mjs"],
    visible: [{ id: "K09-V1", canary: "VIS-K09-1", args: [105, 1, 10], expect: 11 }],
    hidden: [
      { id: "K09-H1", canary: "HK-K09-1", args: [100, 1, 10], expect: 10 },
      { id: "K09-H2", canary: "HK-K09-2", args: [1, 1, 2], expect: 1 },
      { id: "K09-H3", canary: "HK-K09-3", args: [5, 1, 2], expect: 3 },
      { id: "K09-H4", canary: "HK-K09-4", args: [2, 1, 3], expect: 1 },
    ],
  },
  {
    id: "K10",
    goal: "Check the caller role on kitchen actions.",
    ruleId: "X-01",
    rule: "kitchen.print allows kitchen and admin. order.create allows customer, kitchen, and admin. Every other role or action is denied.",
    module: "src/api/authorize.mjs",
    exportName: "authorize",
    scope: ["src/api/authorize.mjs"],
    visible: [{
      id: "K10-V1",
      canary: "VIS-K10-1",
      args: ["customer", "kitchen.print"],
      expect: { allowed: false, role: "customer", action: "kitchen.print" },
    }],
    hidden: [
      { id: "K10-H1", canary: "HK-K10-1", args: ["kitchen", "kitchen.print"], expect: { allowed: true, role: "kitchen", action: "kitchen.print" } },
      { id: "K10-H2", canary: "HK-K10-2", args: ["admin", "order.create"], expect: { allowed: true, role: "admin", action: "order.create" } },
      { id: "K10-H3", canary: "HK-K10-3", args: ["anonymous", "kitchen.print"], expect: { allowed: false, role: "anonymous", action: "kitchen.print" } },
      { id: "K10-H4", canary: "HK-K10-4", args: ["customer", "unknown.action"], expect: { allowed: false, role: "customer", action: "unknown.action" } },
    ],
  },
  {
    id: "K11",
    goal: "Validate order input at the boundary.",
    ruleId: "X-02",
    rule: "dishId is a non-empty trimmed string. quantity is an integer from 1 to 99. An optional note is a string of at most 140 characters. Invalid input returns the shared validation error and does not coerce a success value.",
    module: "src/api/order-schema.mjs",
    exportName: "parseOrder",
    scope: ["src/api/order-schema.mjs"],
    visible: [{
      id: "K11-V1",
      canary: "VIS-K11-1",
      args: [{ dishId: "soup", quantity: 2 }],
      expect: { ok: true, value: { dishId: "soup", quantity: 2 } },
    }],
    hidden: [
      { id: "K11-H1", canary: "HK-K11-1", args: [{ dishId: "", quantity: 2 }], expect: validation("dishId", "Dish is required") },
      { id: "K11-H2", canary: "HK-K11-2", args: [{ dishId: "soup", quantity: 0 }], expect: validation("quantity", "Quantity must be a whole number from 1 to 99") },
      {
        id: "K11-H3",
        canary: "HK-K11-3",
        args: [{ dishId: " soup ", quantity: 99, note: "hot" }],
        expect: { ok: true, value: { dishId: "soup", quantity: 99, note: "hot" } },
      },
      { id: "K11-H4", canary: "HK-K11-4", args: [{ dishId: "soup", quantity: 2, note: longNote }], expect: validation("note", "Note must be 140 characters or fewer") },
    ],
  },
  {
    id: "K12",
    goal: "Return the shared error body.",
    ruleId: "X-11",
    rule: "Errors are { error: { code, message, field? } }. code and message are required non-empty strings. field is included only when provided.",
    module: "src/api/errors.mjs",
    exportName: "toErrorBody",
    scope: ["src/api/errors.mjs"],
    visible: [{
      id: "K12-V1",
      canary: "VIS-K12-1",
      args: ["validation", "Quantity is invalid", "quantity"],
      expect: { error: { code: "validation", message: "Quantity is invalid", field: "quantity" } },
    }],
    hidden: [
      { id: "K12-H1", canary: "HK-K12-1", args: ["forbidden", "Kitchen only"], expect: { error: { code: "forbidden", message: "Kitchen only" } } },
      { id: "K12-H2", canary: "HK-K12-2", args: ["", "x"], expect: { throws: true, messageIncludes: "X-11" } },
      { id: "K12-H3", canary: "HK-K12-3", args: ["oops", ""], expect: { throws: true, messageIncludes: "X-11" } },
      { id: "K12-H4", canary: "HK-K12-4", args: ["conflict", "Already sent", "order"], expect: { error: { code: "conflict", message: "Already sent", field: "order" } } },
    ],
  },
  {
    id: "K13",
    goal: "Preserve SQLite order rows when adding notes.",
    ruleId: "R50",
    rule: "Add a nullable notes column to orders. Existing id, dish, and qty values stay unchanged. Running the migration twice is safe.",
    module: "src/db/sqlite-migrate.mjs",
    exportName: "migrateSqlite",
    scope: ["src/db/sqlite-migrate.mjs"],
    setup: "sqlite-orders-v1",
    visible: [{
      id: "K13-V1",
      canary: "VIS-K13-1",
      setup: "sqlite-orders-v1",
      fixture,
      twice: true,
      expect: { ...migrated, result: { dialect: "sqlite", migrated: true } },
    }],
    hidden: [
      {
        id: "K13-H1",
        canary: "HK-K13-1",
        setup: "sqlite-orders-v1",
        fixture: [{ id: 7, dish: "Salad", qty: 1 }],
        expect: { rows: rowsOf([[7, "Salad", 1]]), result: { dialect: "sqlite", migrated: true } },
      },
      {
        id: "K13-H2",
        canary: "HK-K13-2",
        setup: "sqlite-orders-v1",
        fixture: [{ id: 1, dish: "Knödel", qty: 4 }, { id: 2, dish: "Soup", qty: 1 }],
        twice: true,
        expect: { rows: rowsOf([[1, "Knödel", 4], [2, "Soup", 1]]), result: { dialect: "sqlite", migrated: true } },
      },
      {
        id: "K13-H3",
        canary: "HK-K13-3",
        setup: "sqlite-orders-v1",
        fixture: [{ id: 3, dish: "Rice", qty: 9 }],
        expect: { rows: rowsOf([[3, "Rice", 9]]), result: { dialect: "sqlite", migrated: true } },
      },
      {
        id: "K13-H4",
        canary: "HK-K13-4",
        setup: "sqlite-orders-v1",
        fixture: [],
        twice: true,
        expect: { rows: [], result: { dialect: "sqlite", migrated: true } },
      },
    ],
  },
  {
    id: "K14",
    goal: "Preserve rows through the Postgres notes migration.",
    ruleId: "R51",
    rule: "The Postgres migration adds notes with IF NOT EXISTS and type text, then leaves existing rows in place. It does not use SQLite-only table rebuilds.",
    module: "src/db/postgres-migrate.mjs",
    exportName: "migratePostgres",
    scope: ["src/db/postgres-migrate.mjs", "src/db/postgres-orders-v2.sql"],
    setup: "sqlite-orders-v1",
    visible: [{
      id: "K14-V1",
      canary: "VIS-K14-1",
      setup: "sqlite-orders-v1",
      fixture,
      twice: true,
      expect: { ...migrated, result: { dialect: "postgres", sql: "ALTER TABLE orders ADD COLUMN IF NOT EXISTS notes text;\n" } },
    }],
    hidden: [
      {
        id: "K14-H1",
        canary: "HK-K14-1",
        setup: "sqlite-orders-v1",
        fixture: [{ id: 4, dish: "Bread", qty: 6 }],
        expect: {
          rows: rowsOf([[4, "Bread", 6]]),
          result: { dialect: "postgres", sql: "ALTER TABLE orders ADD COLUMN IF NOT EXISTS notes text;\n" },
        },
      },
      {
        id: "K14-H2",
        canary: "HK-K14-2",
        setup: "sqlite-orders-v1",
        fixture: [{ id: 1, dish: "Soup", qty: 1 }, { id: 9, dish: "Tea", qty: 2 }],
        expect: {
          rows: rowsOf([[1, "Soup", 1], [9, "Tea", 2]]),
          result: { dialect: "postgres", sql: "ALTER TABLE orders ADD COLUMN IF NOT EXISTS notes text;\n" },
        },
      },
      {
        id: "K14-H3",
        canary: "HK-K14-3",
        setup: "sqlite-orders-v1",
        fixture: [],
        twice: true,
        expect: { rows: [], result: { dialect: "postgres", sql: "ALTER TABLE orders ADD COLUMN IF NOT EXISTS notes text;\n" } },
      },
      {
        id: "K14-H4",
        canary: "HK-K14-4",
        setup: "sqlite-orders-v1",
        fixture: [{ id: 8, dish: "Knödel", qty: 1 }],
        expect: {
          rows: rowsOf([[8, "Knödel", 1]]),
          result: { dialect: "postgres", sql: "ALTER TABLE orders ADD COLUMN IF NOT EXISTS notes text;\n" },
        },
      },
    ],
  },
  {
    id: "K15",
    goal: "Render the kitchen Print button.",
    ruleId: "UI-12",
    rule: "The kitchen screen exposes a button named Print with data-action print. The returned rowCount equals the number of input rows.",
    module: "src/ui/kitchen-print-button.mjs",
    exportName: "kitchenPrintButton",
    scope: ["src/ui/kitchen-print-button.mjs"],
    visible: [{
      id: "K15-V1",
      canary: "VIS-K15-1",
      args: [[{ label: "Soup", quantity: 2 }]],
      expect: { type: "button", name: "Print", html: '<button type="button" data-action="print">Print</button>', rowCount: 1 },
    }],
    hidden: [
      { id: "K15-H1", canary: "HK-K15-1", args: [[]], expect: { type: "button", name: "Print", html: '<button type="button" data-action="print">Print</button>', rowCount: 0 } },
      { id: "K15-H2", canary: "HK-K15-2", args: [[{ label: "A", quantity: 1 }, { label: "B", quantity: 1 }, { label: "C", quantity: 1 }]], expect: { type: "button", name: "Print", html: '<button type="button" data-action="print">Print</button>', rowCount: 3 } },
      { id: "K15-H3", canary: "HK-K15-3", args: [[{ label: "Tea", quantity: 0 }]], expect: { type: "button", name: "Print", html: '<button type="button" data-action="print">Print</button>', rowCount: 1 } },
      { id: "K15-H4", canary: "HK-K15-4", args: [[{ label: "Knödel", quantity: 2 }]], expect: { type: "button", name: "Print", html: '<button type="button" data-action="print">Print</button>', rowCount: 1 } },
    ],
  },
  {
    id: "K16",
    goal: "Expose the kitchen list ARIA contract.",
    ruleId: "X-13",
    rule: "The Print button accessible name is Print, aria-label is Print kitchen list, and aria-controls is kitchen-list. The region id is kitchen-list, role is region, aria-label is Kitchen totals, and rowCount follows the input.",
    module: "src/ui/kitchen-aria.mjs",
    exportName: "kitchenAria",
    scope: ["src/ui/kitchen-aria.mjs"],
    visible: [{
      id: "K16-V1",
      canary: "VIS-K16-1",
      args: [[{ label: "Soup", quantity: 2 }]],
      expect: {
        button: { name: "Print", ariaLabel: "Print kitchen list", ariaControls: "kitchen-list" },
        region: { id: "kitchen-list", role: "region", ariaLabel: "Kitchen totals", rowCount: 1 },
      },
    }],
    hidden: [
      { id: "K16-H1", canary: "HK-K16-1", args: [[]], expect: { button: { name: "Print", ariaLabel: "Print kitchen list", ariaControls: "kitchen-list" }, region: { id: "kitchen-list", role: "region", ariaLabel: "Kitchen totals", rowCount: 0 } } },
      { id: "K16-H2", canary: "HK-K16-2", args: [[{ label: "Tea", quantity: 1 }, { label: "Rice", quantity: 1 }]], expect: { button: { name: "Print", ariaLabel: "Print kitchen list", ariaControls: "kitchen-list" }, region: { id: "kitchen-list", role: "region", ariaLabel: "Kitchen totals", rowCount: 2 } } },
      { id: "K16-H3", canary: "HK-K16-3", args: [[{ label: "Salad", quantity: 4 }]], expect: { button: { name: "Print", ariaLabel: "Print kitchen list", ariaControls: "kitchen-list" }, region: { id: "kitchen-list", role: "region", ariaLabel: "Kitchen totals", rowCount: 1 } } },
      { id: "K16-H4", canary: "HK-K16-4", args: [[{ label: "A", quantity: 1 }, { label: "B", quantity: 1 }, { label: "C", quantity: 1 }, { label: "D", quantity: 1 }]], expect: { button: { name: "Print", ariaLabel: "Print kitchen list", ariaControls: "kitchen-list" }, region: { id: "kitchen-list", role: "region", ariaLabel: "Kitchen totals", rowCount: 4 } } },
    ],
  },
  {
    id: "K17",
    goal: "Show the empty kitchen state.",
    ruleId: "UI-13",
    rule: "When no row has a positive quantity, the state is empty, the message is Nothing to print, and Print is disabled including aria-disabled. Otherwise the state is ready and Print is enabled.",
    module: "src/ui/kitchen-empty.mjs",
    exportName: "kitchenEmpty",
    scope: ["src/ui/kitchen-empty.mjs"],
    visible: [{
      id: "K17-V1",
      canary: "VIS-K17-1",
      args: [[{ quantity: 0 }]],
      expect: { state: "empty", message: "Nothing to print", printDisabled: true, ariaDisabled: true },
    }],
    hidden: [
      { id: "K17-H1", canary: "HK-K17-1", args: [[{ quantity: 2 }]], expect: { state: "ready", message: "", printDisabled: false, ariaDisabled: false } },
      { id: "K17-H2", canary: "HK-K17-2", args: [[]], expect: { state: "empty", message: "Nothing to print", printDisabled: true, ariaDisabled: true } },
      { id: "K17-H3", canary: "HK-K17-3", args: [[{ quantity: -1 }, { quantity: 1 }]], expect: { state: "ready", message: "", printDisabled: false, ariaDisabled: false } },
      { id: "K17-H4", canary: "HK-K17-4", args: [[{ quantity: 0 }, { quantity: 0 }]], expect: { state: "empty", message: "Nothing to print", printDisabled: true, ariaDisabled: true } },
    ],
  },
  {
    id: "K18",
    goal: "Show order form field errors.",
    ruleId: "X-02",
    rule: "A blank dish id sets dishId to Dish is required. A quantity that is not an integer from 1 to 99 sets quantity to Quantity must be a whole number from 1 to 99. A valid form returns an empty error object.",
    module: "src/ui/order-form-errors.mjs",
    exportName: "orderFieldErrors",
    scope: ["src/ui/order-form-errors.mjs"],
    visible: [{
      id: "K18-V1",
      canary: "VIS-K18-1",
      args: [{ dishId: "", quantity: 0 }],
      expect: { dishId: "Dish is required", quantity: "Quantity must be a whole number from 1 to 99" },
    }],
    hidden: [
      { id: "K18-H1", canary: "HK-K18-1", args: [{ dishId: "Soup", quantity: 2 }], expect: {} },
      { id: "K18-H2", canary: "HK-K18-2", args: [{ dishId: "  ", quantity: 2 }], expect: { dishId: "Dish is required" } },
      { id: "K18-H3", canary: "HK-K18-3", args: [{ dishId: "Soup", quantity: 100 }], expect: { quantity: "Quantity must be a whole number from 1 to 99" } },
      { id: "K18-H4", canary: "HK-K18-4", args: [{ dishId: "Soup", quantity: 1.5 }], expect: { quantity: "Quantity must be a whole number from 1 to 99" } },
    ],
  },
  {
    id: "K19",
    goal: "Show the order form success state.",
    ruleId: "UI-14",
    rule: "A valid dish id and quantity submits as success with message Order sent. Invalid input stays invalid, with an empty message, and must not say Order sent.",
    module: "src/ui/order-form-success.mjs",
    exportName: "orderSubmitState",
    scope: ["src/ui/order-form-success.mjs"],
    visible: [{
      id: "K19-V1",
      canary: "VIS-K19-1",
      args: [{ dishId: "Soup", quantity: 2 }],
      expect: { status: "success", message: "Order sent", fieldErrors: {} },
    }],
    hidden: [
      { id: "K19-H1", canary: "HK-K19-1", args: [{ dishId: "Soup", quantity: 0 }], expect: { status: "invalid", message: "", fieldErrors: { quantity: "Quantity must be a whole number from 1 to 99" } } },
      { id: "K19-H2", canary: "HK-K19-2", args: [{ dishId: "", quantity: 2 }], expect: { status: "invalid", message: "", fieldErrors: { dishId: "Dish is required" } } },
      { id: "K19-H3", canary: "HK-K19-3", args: [{ dishId: "Tea", quantity: 99 }], expect: { status: "success", message: "Order sent", fieldErrors: {} } },
      { id: "K19-H4", canary: "HK-K19-4", args: [{ dishId: "Noodles", quantity: 1 }], expect: { status: "success", message: "Order sent", fieldErrors: {} } },
    ],
  },
  {
    id: "K20",
    goal: "Render the kitchen error banner from the shared error body.",
    ruleId: "X-11",
    rule: "A banner has role alert and text equal to error.message. A body without a non-empty error.message is rejected.",
    module: "src/ui/kitchen-error-banner.mjs",
    exportName: "kitchenErrorBanner",
    scope: ["src/ui/kitchen-error-banner.mjs"],
    visible: [{
      id: "K20-V1",
      canary: "VIS-K20-1",
      args: [{ error: { code: "validation", message: "Quantity is invalid", field: "quantity" } }],
      expect: { role: "alert", text: "Quantity is invalid" },
    }],
    hidden: [
      { id: "K20-H1", canary: "HK-K20-1", args: [{ error: { code: "forbidden", message: "Kitchen only" } }], expect: { role: "alert", text: "Kitchen only" } },
      { id: "K20-H2", canary: "HK-K20-2", args: [{}], expect: { throws: true, messageIncludes: "X-11" } },
      { id: "K20-H3", canary: "HK-K20-3", args: [{ error: { message: "" } }], expect: { throws: true, messageIncludes: "X-11" } },
      { id: "K20-H4", canary: "HK-K20-4", args: [{ error: { code: "conflict", message: "Already sent" } }], expect: { role: "alert", text: "Already sent" } },
    ],
  },
];

for (const [rel, text] of Object.entries(seedFiles)) write(path.join(seed, rel), text);
for (const [name, text] of Object.entries(oracles)) write(path.join(oracleDir, name), text);
for (const [name, text] of Object.entries(bad)) write(path.join(badDir, name), text);

for (const task of tasks) {
  if (task.hidden.length < 3) throw new Error(`${task.id} needs at least 3 held-back spares`);
  const packet = {
    schema: "task-packet@1",
    task: task.id,
    attempt: 1,
    epoch: 1,
    brief_version: 1,
    base: { branch: "harness/f/F12", commit: "seed" },
    goal: task.goal,
    write_scope: task.scope,
    must: [{ id: task.ruleId, v: 1, text: task.rule }],
    contracts: [{ id: `kitchen-${task.id.toLowerCase()}`, v: 1, role: "produce" }],
    checks_visible: task.visible.map((item) => item.id),
    checks_hidden_count: task.hidden.length,
    should: [],
    skills: [],
    tools: ["edit", "harness.run", "kb.get", "harness.start_service", "submit_candidate"],
    budget: { usd: 0.4 },
    limits: { wall_min: 30 },
    entry: { module: task.module, export: task.exportName },
    registered_names: [],
    rule_id: task.ruleId,
    rule_text: task.rule,
    visible: task.visible,
  };
  write(path.join(bench, "briefs", `${task.id}.json`), `${JSON.stringify(packet, null, 2)}\n`);
  write(path.join(bench, "hidden", `${task.id}.json`), `${JSON.stringify({
    task: task.id,
    rule_id: task.ruleId,
    cases: task.hidden,
  }, null, 2)}\n`);
}

const manifest = {
  tasks: tasks.map((task) => task.id),
  featureBranch: "harness/f/F12",
  hiddenCanaryPrefix: "HK-",
};
write(path.join(bench, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`materialized ${tasks.length} kitchen leaf tasks`);
