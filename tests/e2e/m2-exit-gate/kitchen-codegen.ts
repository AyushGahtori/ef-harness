import type { LookAndFeelDecision } from "@ef-harness/planner";
import { W3cDesignTokenGenerator } from "@ef-harness/planner";

export interface KitchenBuildSpec {
  readonly cutoffMinutes: number;
  readonly cutoffLabel: string;
  readonly dietaryEnabled: boolean;
  readonly timezoneOffsetHours: number;
  readonly lookAndFeel: LookAndFeelDecision;
}

export function renderTokensCss(lookAndFeel: LookAndFeelDecision): string {
  const generated = new W3cDesignTokenGenerator().generate(lookAndFeel);
  const light = generated.palettes.light;
  const radius = lookAndFeel.radiusControlPx;
  return `:root {
  --color-bg: ${light["surface-raised"]};
  --color-text: ${light["text-primary"]};
  --color-muted: ${light["text-muted"]};
  --color-surface: ${light.surface};
  --color-accent: ${light.focus};
  --color-accent-text: ${light["primary-foreground"]};
  --color-danger: ${light.danger};
  --color-line: ${light.border};
  --font-sans: "Segoe UI", sans-serif;
  --space-3: ${String(generated.spacing["12"]?.$value ?? "12px")};
  --space-4: ${String(generated.spacing["16"]?.$value ?? "16px")};
  --radius: ${radius}px;
}
`;
}

export function renderPhase0Files(spec: KitchenBuildSpec): Readonly<Record<string, string>> {
  return {
    ".gitignore": ".harness/\n*.db\n*.db-wal\n*.db-shm\n",
    "bundle-manifest.json": `${JSON.stringify(
      {
        production: [
          "server.mjs",
          "public/index.html",
          "public/kitchen.html",
          "public/print.html",
          "public/tokens.css",
          "public/app.css",
          "public/app.js",
        ],
      },
      null,
      2,
    )}\n`,
    "public/tokens.css": renderTokensCss(spec.lookAndFeel),
  };
}

export function renderOrdersUiFiles(spec: KitchenBuildSpec): Readonly<Record<string, string>> {
  const indexHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Order lunch</title>
    <link rel="stylesheet" href="/tokens.css">
    <link rel="stylesheet" href="/app.css">
  </head>
  <body data-page="order">
    <header>
      <img src="/assets/mark.png" width="32" height="32" alt="Office kitchen">
      <h1>Order lunch</h1>
      <p class="muted">Open this link before the ${spec.cutoffLabel} cutoff.</p>
    </header>
    <main>
      <form id="sign-in">
        <label for="staff-name">Your name
          <input id="staff-name" name="staff-name" autocomplete="name" required>
        </label>
        <button id="continue" type="submit">Continue</button>
      </form>
      <form id="order-form" hidden>
        <label for="menu-item">Lunch
          <select id="menu-item" name="menu-item" required></select>
        </label>
        ${
          spec.dietaryEnabled
            ? `<label for="dietary-note">Dietary note
          <input id="dietary-note" name="dietary-note" type="text" maxlength="120">
        </label>`
            : ""
        }
        <div class="actions">
          <button id="submit-order" type="submit">Submit order</button>
          <button id="update-order" type="button">Update order</button>
          <button id="cancel-order" type="button">Cancel order</button>
        </div>
        <p id="cutoff-banner" class="banner" hidden>Ordering is closed for today.</p>
        <p id="status" role="status"></p>
      </form>
    </main>
    <script src="/app.js"></script>
  </body>
</html>
`;

  const appCss = `*,
*::before,
*::after {
  box-sizing: border-box;
}

html,
body {
  margin: 0;
  max-width: 100%;
  background: var(--color-bg);
  color: var(--color-text);
  font-family: var(--font-sans);
  font-size: 16px;
  line-height: 1.4;
}

body {
  padding: var(--space-4);
}

img {
  max-width: 100%;
  height: auto;
}

header,
main {
  display: grid;
  gap: var(--space-3);
  max-width: 100%;
}

h1,
h2,
p {
  margin: 0;
}

label {
  display: grid;
  gap: 4px;
  font-weight: 600;
}

input,
select,
button {
  font: inherit;
  max-width: 100%;
}

input,
select {
  padding: 8px;
  border: 1px solid var(--color-line);
  border-radius: var(--radius);
  background: var(--color-bg);
  color: var(--color-text);
}

button {
  background: var(--color-accent);
  color: var(--color-accent-text);
  border: 0;
  border-radius: var(--radius);
  padding: 8px 12px;
}

button:disabled {
  background: var(--color-surface);
  color: var(--color-muted);
}

button:focus-visible,
input:focus-visible,
select:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
}

table {
  width: 100%;
  border-collapse: collapse;
}

th,
td {
  border-bottom: 1px solid var(--color-line);
  text-align: left;
  padding: 8px;
  word-break: break-word;
}

.muted {
  color: var(--color-muted);
}

.banner {
  color: var(--color-danger);
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
}
`;

  const appJs = `async function api(path, options) {
  const request = options ?? {};
  const response = await fetch(path, {
    method: request.method ?? "GET",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: request.body,
  });
  const text = await response.text();
  let body = {};
  if (text) body = JSON.parse(text);
  return { ok: response.ok, status: response.status, body };
}

function statusLine(id, text) {
  const node = document.querySelector(id);
  if (node) node.textContent = text;
}

function applyClosed(closed) {
  for (const id of ["#submit-order", "#update-order", "#cancel-order"]) {
    const control = document.querySelector(id);
    if (control) control.disabled = closed;
  }
  const banner = document.querySelector("#cutoff-banner");
  if (banner) banner.hidden = !closed;
}

async function refreshClock() {
  const result = await api("/api/clock");
  applyClosed(result.body.open !== true);
}

async function loadMenu() {
  const result = await api("/api/menu");
  const select = document.querySelector("#menu-item");
  if (!select) return;
  select.replaceChildren();
  for (const item of result.body.items ?? []) {
    const option = document.createElement("option");
    option.value = item.id;
    option.textContent = item.name;
    select.append(option);
  }
}

async function loadMine() {
  const result = await api("/api/orders/mine");
  const order = result.body.order;
  const note = document.querySelector("#dietary-note");
  const menu = document.querySelector("#menu-item");
  if (order && note && menu) {
    note.value = order.dietaryNote ?? "";
    menu.value = order.menuItemId;
    statusLine("#status", "Order saved");
  }
}

async function showOrderForm() {
  document.querySelector("#sign-in").hidden = true;
  document.querySelector("#order-form").hidden = false;
  await loadMenu();
  await loadMine();
  await refreshClock();
}

function orderPayload() {
  const note = document.querySelector("#dietary-note");
  return {
    menuItemId: document.querySelector("#menu-item").value,
    dietaryNote: note ? note.value : "",
  };
}

function initOrder() {
  document.querySelector("#sign-in").addEventListener("submit", (event) => {
    event.preventDefault();
    const name = document.querySelector("#staff-name").value;
    api("/api/session", {
      method: "POST",
      body: JSON.stringify({ role: "staff", name }),
    }).then((result) => {
      if (result.ok) return showOrderForm();
      statusLine("#status", "Sign-in failed");
      return undefined;
    }).catch(() => {
      statusLine("#status", "Sign-in failed");
    });
  });
  document.querySelector("#order-form").addEventListener("submit", (event) => {
    event.preventDefault();
    api("/api/orders", { method: "POST", body: JSON.stringify(orderPayload()) }).then((result) => {
      statusLine("#status", result.ok ? "Order saved" : "Order was not saved");
    }).catch(() => {
      statusLine("#status", "Order was not saved");
    });
  });
  document.querySelector("#update-order").addEventListener("click", () => {
    api("/api/orders/current", { method: "PATCH", body: JSON.stringify(orderPayload()) }).then((result) => {
      statusLine("#status", result.ok ? "Order updated" : "Order was not updated");
    }).catch(() => {
      statusLine("#status", "Order was not updated");
    });
  });
  document.querySelector("#cancel-order").addEventListener("click", () => {
    api("/api/orders/current", { method: "DELETE" }).then((result) => {
      statusLine("#status", result.ok ? "Order cancelled" : "Order was not cancelled");
    }).catch(() => {
      statusLine("#status", "Order was not cancelled");
    });
  });
  api("/api/session").then((session) => {
    if (session.ok && session.body.authenticated === true) return showOrderForm();
    return undefined;
  }).catch(() => {
    statusLine("#status", "The order page could not load");
  });
}

function renderSummary(summary) {
  const body = document.querySelector("#dishes tbody");
  const notes = document.querySelector("#notes");
  body.replaceChildren();
  notes.replaceChildren();
  for (const dish of summary.dishes ?? []) {
    if (!dish.count) continue;
    const row = document.createElement("tr");
    const name = document.createElement("td");
    const count = document.createElement("td");
    name.textContent = dish.name;
    count.textContent = \`\${dish.name} × \${dish.count}\`;
    row.append(name, count);
    body.append(row);
  }
  for (const note of summary.notes ?? []) {
    const item = document.createElement("li");
    item.textContent = \`\${note.staff}: \${note.note}\`;
    notes.append(item);
  }
  statusLine("#summary-status", "Summary ready");
}

async function initSummary() {
  const result = await api("/api/kitchen/summary");
  if (!result.ok) {
    statusLine("#summary-status", "Kitchen sign-in required");
    return;
  }
  renderSummary(result.body);
  const send = document.querySelector("#send-email");
  if (!send) return;
  send.addEventListener("click", () => {
    api("/api/admin/catering-email", { method: "POST", body: "{}" }).then((sent) => {
      statusLine("#summary-status", sent.ok ? "Catering email sent" : "Email was not sent");
    }).catch(() => {
      statusLine("#summary-status", "Email was not sent");
    });
  });
}

const page = document.body.dataset.page;
if (page === "order") initOrder();
if (page === "kitchen" || page === "print") {
  initSummary().catch(() => {
    statusLine("#summary-status", "The summary could not load");
  });
}
`;

  return {
    "public/index.html": indexHtml,
    "public/app.css": appCss,
    "public/app.js": appJs,
  };
}

export function renderKitchenPages(): Readonly<Record<string, string>> {
  const kitchenHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Kitchen summary</title>
    <link rel="stylesheet" href="/tokens.css">
    <link rel="stylesheet" href="/app.css">
  </head>
  <body data-page="kitchen">
    <header>
      <img src="/assets/mark.png" width="32" height="32" alt="Office kitchen">
      <h1>Kitchen summary</h1>
    </header>
    <main>
      <p id="summary-status" role="status" class="muted">Loading dish counts.</p>
      <table id="dishes">
        <caption>Dish counts</caption>
        <thead>
          <tr>
            <th scope="col">Dish</th>
            <th scope="col">Count</th>
          </tr>
        </thead>
        <tbody></tbody>
      </table>
      <h2>Dietary notes</h2>
      <ul id="notes"></ul>
      <button id="send-email" type="button">Email catering</button>
    </main>
    <script src="/app.js"></script>
  </body>
</html>
`;

  const printHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Print lunch summary</title>
    <link rel="stylesheet" href="/tokens.css">
    <link rel="stylesheet" href="/app.css">
  </head>
  <body data-page="print">
    <header>
      <img src="/assets/mark.png" width="32" height="32" alt="Office kitchen">
      <h1>Printable lunch summary</h1>
    </header>
    <main>
      <p id="summary-status" role="status" class="muted">Loading the print view.</p>
      <table id="dishes">
        <caption>Daily dish totals</caption>
        <thead>
          <tr>
            <th scope="col">Dish</th>
            <th scope="col">Count</th>
          </tr>
        </thead>
        <tbody></tbody>
      </table>
      <h2>Dietary notes</h2>
      <ul id="notes"></ul>
    </main>
    <script src="/app.js"></script>
  </body>
</html>
`;

  return {
    "public/kitchen.html": kitchenHtml,
    "public/print.html": printHtml,
  };
}

export function renderKitchenServer(spec: KitchenBuildSpec): Readonly<Record<string, string>> {
  const offsetHours = spec.timezoneOffsetHours;
  const serverMjs = `import { readFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const publicRoot = path.resolve(root, "public");

const OFFSET_MS = ${String(offsetHours)} * 60 * 60 * 1000;
const CUTOFF_MINUTES = ${String(spec.cutoffMinutes)};
const DEFAULT_NOW = Date.parse("2026-03-02T10:59:00-05:00");
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const port = Number(process.env.PORT);
const mailpitUrl = process.env.MAILPIT_URL ?? "";
const bench = process.env.KITCHEN_BENCH === "1";
const defect = process.env.KITCHEN_DEFECT ?? "";
let nowMs = Number(process.env.KITCHEN_NOW_MS ?? DEFAULT_NOW);

function kitchenParts(epoch) {
  const local = new Date(epoch + OFFSET_MS);
  return {
    hours: local.getUTCHours(),
    minutes: local.getUTCMinutes(),
    date: \`\${local.getUTCFullYear()}-\${String(local.getUTCMonth() + 1).padStart(2, "0")}-\${String(local.getUTCDate()).padStart(2, "0")}\`,
  };
}

function isOpen(epoch) {
  const parts = kitchenParts(epoch);
  return parts.hours * 60 + parts.minutes < CUTOFF_MINUTES;
}

function enforceCutoff(epoch) {
  // cutoff-guard:start
  if (!isOpen(epoch)) {
    return { ok: false, status: 422, error: "cutoff", message: "Orders close at ${spec.cutoffLabel}." };
  }
  // cutoff-guard:end
  return { ok: true };
}

const db = new DatabaseSync(process.env.KITCHEN_DB ?? "kitchen.db");
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA busy_timeout = 5000");
db.exec(\`
  CREATE TABLE IF NOT EXISTS staff (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    role TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS menu_items (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    price_minor INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    staff_id TEXT NOT NULL,
    menu_item_id TEXT NOT NULL,
    dietary_note TEXT NOT NULL DEFAULT '',
    service_date TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    UNIQUE (staff_id, service_date)
  );
  CREATE TABLE IF NOT EXISTS email_sends (
    service_date TEXT PRIMARY KEY,
    body TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
\`);
const insertMenu = db.prepare("INSERT OR IGNORE INTO menu_items (id, name, price_minor) VALUES (?, ?, ?)");
for (const item of [
  ["soup", "Soup", 450],
  ["salad", "Salad", 500],
  ["sandwich", "Sandwich", 700],
]) {
  insertMenu.run(item[0], item[1], item[2]);
}

const sessions = new Map();

function send(res, status, body, extraHeaders) {
  const payload = body === undefined ? "" : JSON.stringify(body);
  res.writeHead(status, {
    "content-type": body === undefined ? "text/plain; charset=utf-8" : "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...extraHeaders,
  });
  res.end(payload);
}

function readCookie(req, name) {
  const raw = req.headers.cookie ?? "";
  for (const part of raw.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return "";
}

function actor(req) {
  const token = readCookie(req, "kitchen_session");
  if (!token) return null;
  return sessions.get(token) ?? null;
}

function requireAdmin(req, res) {
  const current = actor(req);
  if (!current) {
    send(res, 401, { error: "unauthorized", message: "Sign in required." });
    return null;
  }
  if (current.role !== "admin") {
    send(res, 403, { error: "forbidden", message: "Kitchen admin only." });
    return null;
  }
  return current;
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1_000_000) throw new Error("body too large");
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function slug(name) {
  return String(name).trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "staff";
}

function summary(serviceDate) {
  const dishes = db.prepare(
    \`SELECT m.name AS name, COUNT(o.id) AS count
     FROM menu_items m
     LEFT JOIN orders o ON o.menu_item_id = m.id AND o.service_date = ?
     GROUP BY m.id
     ORDER BY m.name COLLATE NOCASE\`,
  ).all(serviceDate);
  const notes = db.prepare(
    \`SELECT s.name AS staff, o.dietary_note AS note
     FROM orders o
     JOIN staff s ON s.id = o.staff_id
     WHERE o.service_date = ? AND o.dietary_note <> ''
     ORDER BY s.name COLLATE NOCASE, o.dietary_note COLLATE NOCASE\`,
  ).all(serviceDate);
  return { serviceDate, dishes, notes };
}

function formatTotals(dishes, notes, serviceDate) {
  const lines = [\`Service date: \${serviceDate}\`];
  // totals-format:start
  for (const dish of dishes) {
    if (dish.count > 0) lines.push(\`\${dish.name} × \${dish.count}\`);
  }
  // totals-format:end
  lines.push("Dietary notes:");
  for (const note of notes) lines.push(\`- \${note.staff}: \${note.note}\`);
  return lines.join("\\n");
}

function saveOrder(current, menuItemId, dietaryNote) {
  const gate = enforceCutoff(nowMs);
  if (!gate.ok) return gate;
  const menu = db.prepare("SELECT id FROM menu_items WHERE id = ?").get(menuItemId);
  if (!menu) return { ok: false, status: 400, error: "menu", message: "Unknown menu item." };
  const serviceDate = kitchenParts(nowMs).date;
  const note = ${spec.dietaryEnabled ? "String(dietaryNote ?? \"\").trim()" : "\"\""};
  db.exec("BEGIN IMMEDIATE");
  try {
    const existing = db.prepare("SELECT id, menu_item_id AS menuItemId, dietary_note AS dietaryNote FROM orders WHERE staff_id = ? AND service_date = ?").get(current.id, serviceDate);
    if (existing) {
      db.exec("COMMIT");
      return { ok: true, status: 200, body: { order: existing, duplicate: true } };
    }
    const id = \`ord-\${current.id}-\${serviceDate}\`;
    db.prepare(
      "INSERT INTO orders (id, staff_id, menu_item_id, dietary_note, service_date, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(id, current.id, menuItemId, note, serviceDate, nowMs);
    db.exec("COMMIT");
    return { ok: true, status: 201, body: { order: { id, menuItemId, dietaryNote: note }, duplicate: false } };
  } catch (error) {
    db.exec("ROLLBACK");
    const again = db.prepare("SELECT id, menu_item_id AS menuItemId, dietary_note AS dietaryNote FROM orders WHERE staff_id = ? AND service_date = ?").get(current.id, serviceDate);
    if (again) return { ok: true, status: 200, body: { order: again, duplicate: true } };
    throw error;
  }
}

function updateOrder(current, menuItemId, dietaryNote) {
  const gate = enforceCutoff(nowMs);
  if (!gate.ok) return gate;
  const serviceDate = kitchenParts(nowMs).date;
  const existing = db.prepare("SELECT id FROM orders WHERE staff_id = ? AND service_date = ?").get(current.id, serviceDate);
  if (!existing) return { ok: false, status: 404, error: "missing", message: "No order to update." };
  const menu = db.prepare("SELECT id FROM menu_items WHERE id = ?").get(menuItemId);
  if (!menu) return { ok: false, status: 400, error: "menu", message: "Unknown menu item." };
  const note = ${spec.dietaryEnabled ? "String(dietaryNote ?? \"\").trim()" : "\"\""};
  db.prepare("UPDATE orders SET menu_item_id = ?, dietary_note = ? WHERE id = ?").run(menuItemId, note, existing.id);
  return { ok: true, status: 200, body: { order: { id: existing.id, menuItemId, dietaryNote: note } } };
}

function cancelOrder(current) {
  const gate = enforceCutoff(nowMs);
  if (!gate.ok) return gate;
  const serviceDate = kitchenParts(nowMs).date;
  const result = db.prepare("DELETE FROM orders WHERE staff_id = ? AND service_date = ?").run(current.id, serviceDate);
  if (result.changes === 0) return { ok: false, status: 404, error: "missing", message: "No order to cancel." };
  return { ok: true, status: 200, body: { cancelled: true } };
}

async function sendMail(text, serviceDate) {
  const response = await fetch(\`\${mailpitUrl}/api/v1/send\`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      From: { Email: "kitchen@office.test", Name: "Office Kitchen" },
      To: [{ Email: "catering@office.test", Name: "Catering" }],
      Subject: \`Lunch totals \${serviceDate}\`,
      Text: text,
    }),
  });
  if (!response.ok) throw new Error(\`mailpit \${response.status}\`);
}

const server = http.createServer((req, res) => {
  const handle = async () => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (defect === "reject-all" && url.pathname.startsWith("/api")) {
      send(res, 500, { error: "rejected", message: "Benchmark defect rejected this request." });
      return;
    }
    if (req.method === "GET" && url.pathname === "/assets/mark.png") {
      res.writeHead(200, { "content-type": "image/png", "cache-control": "no-store" });
      res.end(PNG);
      return;
    }
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/kitchen" || url.pathname === "/print" || url.pathname.endsWith(".css") || url.pathname.endsWith(".js") || url.pathname.endsWith(".html"))) {
      const relative = url.pathname === "/" ? "public/index.html" : url.pathname === "/kitchen" ? "public/kitchen.html" : url.pathname === "/print" ? "public/print.html" : \`public\${url.pathname}\`;
      const target = path.resolve(root, relative);
      if (!target.startsWith(publicRoot + path.sep)) {
        send(res, 404, { error: "not_found" });
        return;
      }
      let text = "";
      try {
        text = readFileSync(target, "utf8");
      } catch {
        send(res, 404, { error: "not_found" });
        return;
      }
      const type = target.endsWith(".css") ? "text/css" : target.endsWith(".js") ? "text/javascript" : "text/html";
      res.writeHead(200, { "content-type": \`\${type}; charset=utf-8\`, "cache-control": "no-store" });
      res.end(text);
      return;
    }
    if (req.method === "GET" && url.pathname === "/favicon.ico") {
      res.writeHead(204);
      res.end();
      return;
    }
    if (req.method === "GET" && url.pathname === "/__styleguide") {
      send(res, 404, { error: "not_found", message: "No styleguide in production." });
      return;
    }
    if (req.method === "POST" && url.pathname === "/__bench/clock") {
      if (!bench) {
        send(res, 404, { error: "not_found" });
        return;
      }
      const body = await readJson(req);
      nowMs = Number(body.epochMs);
      send(res, 200, { epochMs: nowMs, open: isOpen(nowMs) });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/clock") {
      send(res, 200, { epochMs: nowMs, open: isOpen(nowMs), serviceDate: kitchenParts(nowMs).date });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/menu") {
      send(res, 200, { items: db.prepare("SELECT id, name, price_minor AS priceMinor FROM menu_items ORDER BY name COLLATE NOCASE").all() });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/session") {
      const current = actor(req);
      if (!current) {
        send(res, 200, { authenticated: false });
        return;
      }
      send(res, 200, { authenticated: true, id: current.id, name: current.name, role: current.role });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/session") {
      const body = await readJson(req);
      const role = body.role === "admin" ? "admin" : "staff";
      const name = String(body.name ?? "").trim();
      if (!name) {
        send(res, 400, { error: "name", message: "Name is required." });
        return;
      }
      const id = \`\${role}-\${slug(name)}\`;
      db.prepare("INSERT OR REPLACE INTO staff (id, name, role) VALUES (?, ?, ?)").run(id, name, role);
      const token = \`\${id}-\${sessions.size + 1}\`;
      sessions.set(token, { id, name, role });
      send(res, 200, { id, name, role }, { "set-cookie": \`kitchen_session=\${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax\` });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/orders") {
      const current = actor(req);
      if (!current) {
        send(res, 401, { error: "unauthorized" });
        return;
      }
      const body = await readJson(req);
      const saved = saveOrder(current, body.menuItemId, body.dietaryNote);
      send(res, saved.status, saved.body ?? { error: saved.error, message: saved.message });
      return;
    }
    if (url.pathname === "/api/orders/current" && (req.method === "PATCH" || req.method === "DELETE")) {
      const current = actor(req);
      if (!current) {
        send(res, 401, { error: "unauthorized" });
        return;
      }
      if (req.method === "DELETE") {
        const removed = cancelOrder(current);
        send(res, removed.status, removed.body ?? { error: removed.error, message: removed.message });
        return;
      }
      const body = await readJson(req);
      const updated = updateOrder(current, body.menuItemId, body.dietaryNote);
      send(res, updated.status, updated.body ?? { error: updated.error, message: updated.message });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/orders/mine") {
      const current = actor(req);
      if (!current) {
        send(res, 401, { error: "unauthorized" });
        return;
      }
      const serviceDate = kitchenParts(nowMs).date;
      const order = db.prepare("SELECT id, menu_item_id AS menuItemId, dietary_note AS dietaryNote FROM orders WHERE staff_id = ? AND service_date = ?").get(current.id, serviceDate);
      send(res, 200, { order: order ?? null });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/kitchen/summary") {
      if (!requireAdmin(req, res)) return;
      send(res, 200, summary(kitchenParts(nowMs).date));
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/admin/menu") {
      if (!requireAdmin(req, res)) return;
      const body = await readJson(req);
      const id = slug(String(body.name ?? ""));
      const name = String(body.name ?? "").trim();
      if (!name) {
        send(res, 400, { error: "name", message: "Menu name is required." });
        return;
      }
      db.prepare("INSERT OR REPLACE INTO menu_items (id, name, price_minor) VALUES (?, ?, ?)").run(id, name, Number(body.priceMinor ?? 0));
      send(res, 200, { id, name });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/admin/catering-email") {
      if (!requireAdmin(req, res)) return;
      const serviceDate = kitchenParts(nowMs).date;
      db.exec("BEGIN IMMEDIATE");
      const existing = db.prepare("SELECT service_date FROM email_sends WHERE service_date = ?").get(serviceDate);
      if (existing) {
        db.exec("COMMIT");
        send(res, 200, { sent: false, duplicate: true });
        return;
      }
      const snap = summary(serviceDate);
      const text = formatTotals(snap.dishes, snap.notes, serviceDate);
      db.prepare("INSERT INTO email_sends (service_date, body, created_at) VALUES (?, ?, ?)").run(serviceDate, text, nowMs);
      db.exec("COMMIT");
      await sendMail(text, serviceDate);
      send(res, 200, { sent: true, duplicate: false });
      return;
    }
    send(res, 404, { error: "not_found" });
  };
  handle().catch((error) => {
    if (!res.headersSent) send(res, 500, { error: "server", message: error instanceof Error ? error.message : "failed" });
  });
});

server.on("error", (error) => {
  process.stderr.write(\`\${error instanceof Error ? error.message : "listen failed"}\\n\`);
  process.exit(1);
});
server.listen(port, "127.0.0.1");
`;
  return { "server.mjs": serverMjs };
}
