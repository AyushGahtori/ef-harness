import { readFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const publicRoot = path.resolve(root, "public");

const OFFSET_MS = -5 * 60 * 60 * 1000;
const CUTOFF_MINUTES = 11 * 60;
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
    date: `${local.getUTCFullYear()}-${String(local.getUTCMonth() + 1).padStart(2, "0")}-${String(local.getUTCDate()).padStart(2, "0")}`,
  };
}

function isOpen(epoch) {
  const parts = kitchenParts(epoch);
  return parts.hours * 60 + parts.minutes < CUTOFF_MINUTES;
}

function enforceCutoff(epoch) {
  // cutoff-guard:start
  if (!isOpen(epoch)) {
    return { ok: false, status: 422, error: "cutoff", message: "Orders close at 11:00 AM." };
  }
  // cutoff-guard:end
  return { ok: true };
}

const db = new DatabaseSync(process.env.KITCHEN_DB ?? "kitchen.db");
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA busy_timeout = 5000");
db.exec(`
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
`);
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
    `SELECT m.name AS name, COUNT(o.id) AS count
     FROM menu_items m
     LEFT JOIN orders o ON o.menu_item_id = m.id AND o.service_date = ?
     GROUP BY m.id
     ORDER BY m.name COLLATE NOCASE`,
  ).all(serviceDate);
  const notes = db.prepare(
    `SELECT s.name AS staff, o.dietary_note AS note
     FROM orders o
     JOIN staff s ON s.id = o.staff_id
     WHERE o.service_date = ? AND o.dietary_note <> ''
     ORDER BY s.name COLLATE NOCASE, o.dietary_note COLLATE NOCASE`,
  ).all(serviceDate);
  return { serviceDate, dishes, notes };
}

function formatTotals(dishes, notes, serviceDate) {
  const lines = [`Service date: ${serviceDate}`];
  // totals-format:start
  for (const dish of dishes) {
    if (dish.count > 0) lines.push(`${dish.name} × ${dish.count}`);
  }
  // totals-format:end
  lines.push("Dietary notes:");
  for (const note of notes) lines.push(`- ${note.staff}: ${note.note}`);
  return lines.join("\n");
}

function saveOrder(current, menuItemId, dietaryNote) {
  const gate = enforceCutoff(nowMs);
  if (!gate.ok) return gate;
  const menu = db.prepare("SELECT id FROM menu_items WHERE id = ?").get(menuItemId);
  if (!menu) return { ok: false, status: 400, error: "menu", message: "Unknown menu item." };
  const serviceDate = kitchenParts(nowMs).date;
  const note = String(dietaryNote ?? "").trim();
  db.exec("BEGIN IMMEDIATE");
  try {
    const existing = db.prepare("SELECT id, menu_item_id AS menuItemId, dietary_note AS dietaryNote FROM orders WHERE staff_id = ? AND service_date = ?").get(current.id, serviceDate);
    if (existing) {
      db.exec("COMMIT");
      return { ok: true, status: 200, body: { order: existing, duplicate: true } };
    }
    const id = `ord-${current.id}-${serviceDate}`;
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
  const note = String(dietaryNote ?? "").trim();
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
  const response = await fetch(`${mailpitUrl}/api/v1/send`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      From: { Email: "kitchen@office.test", Name: "Office Kitchen" },
      To: [{ Email: "catering@office.test", Name: "Catering" }],
      Subject: `Lunch totals ${serviceDate}`,
      Text: text,
    }),
  });
  if (!response.ok) throw new Error(`mailpit ${response.status}`);
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
      const relative = url.pathname === "/" ? "public/index.html" : url.pathname === "/kitchen" ? "public/kitchen.html" : url.pathname === "/print" ? "public/print.html" : `public${url.pathname}`;
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
      res.writeHead(200, { "content-type": `${type}; charset=utf-8`, "cache-control": "no-store" });
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
      const id = `${role}-${slug(name)}`;
      db.prepare("INSERT OR REPLACE INTO staff (id, name, role) VALUES (?, ?, ?)").run(id, name, role);
      const token = `${id}-${sessions.size + 1}`;
      sessions.set(token, { id, name, role });
      send(res, 200, { id, name, role }, { "set-cookie": `kitchen_session=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax` });
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
  process.stderr.write(`${error instanceof Error ? error.message : "listen failed"}\n`);
  process.exit(1);
});
server.listen(port, "127.0.0.1");
