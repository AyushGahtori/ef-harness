import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { designTokenLint, productionBundleClean } from "./audit.ts";
import type { HiddenCheckResult, SuiteOutcome, SuiteTarget } from "./types.ts";

const OPEN = Date.parse("2026-03-02T10:59:00-05:00");
const BOUNDARY = Date.parse("2026-03-02T11:00:00-05:00");
const CLOSED = Date.parse("2026-03-02T11:01:00-05:00");
const BROWSER_IDS = new Set([
  "H-M2-01",
  "H-M2-02",
  "H-M2-08",
  "H-M2-09",
  "H-M2-12",
  "H-M2-13",
  "H-M2-14",
  "H-M2-15",
  "H-M2-23",
  "H-M2-24",
  "H-M2-25",
]);

interface JsonResponse {
  status: number;
  json: Record<string, unknown>;
}

interface PageLike {
  goto(url: string, options?: { waitUntil?: "domcontentloaded"; timeout?: number }): Promise<unknown>;
  fill(selector: string, value: string, options?: { timeout?: number }): Promise<void>;
  click(selector: string, options?: { timeout?: number }): Promise<void>;
  selectOption(selector: string, value: string, options?: { timeout?: number }): Promise<unknown>;
  waitForFunction(fn: () => boolean, options?: { timeout?: number }): Promise<unknown>;
  locator(selector: string): { isDisabled(): Promise<boolean> };
  evaluate<T>(fn: () => T | Promise<T>): Promise<T>;
  addScriptTag(options: { content: string }): Promise<unknown>;
  screenshot(options?: { type?: "png" }): Promise<Buffer>;
  on(event: string, handler: (value: { type: () => string; text: () => string } | Error) => void): void;
  request: {
    post(url: string, options?: { data?: unknown; timeout?: number }): Promise<{ status(): number }>;
  };
}

interface BrowserLike {
  newContext(options: { viewport: { width: number; height: number } }): Promise<{
    newPage(): Promise<PageLike>;
    close(): Promise<void>;
  }>;
  close(): Promise<void>;
}

function repoRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
}

function launchBrowser(): Promise<BrowserLike> {
  const require = createRequire(path.join(repoRoot(), "package.json"));
  const playwright = require("playwright") as { chromium: { launch(options: { headless: boolean }): Promise<BrowserLike> } };
  return playwright.chromium.launch({ headless: true });
}

function cookieFrom(response: Response): string {
  const listed = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
  const header = listed.length > 0 ? listed.join(";") : (response.headers.get("set-cookie") ?? "");
  const match = /kitchen_session=([^;]+)/.exec(header);
  if (!match?.[1]) throw new Error("session cookie missing");
  return `kitchen_session=${match[1]}`;
}

async function signIn(origin: string, role: string, name: string): Promise<string> {
  const response = await fetch(`${origin}/api/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ role, name }),
  });
  if (!response.ok) throw new Error(`sign-in ${name} failed with ${response.status}`);
  return cookieFrom(response);
}

async function call(origin: string, method: string, pathname: string, cookie: string, body?: unknown): Promise<JsonResponse> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (cookie) headers.cookie = cookie;
  const response = await fetch(`${origin}${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, json: text ? (JSON.parse(text) as Record<string, unknown>) : {} };
}

async function setClock(origin: string, epochMs: number): Promise<void> {
  const response = await fetch(`${origin}/__bench/clock`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ epochMs }),
  });
  if (!response.ok) throw new Error(`clock update failed with ${response.status}`);
}

function ordersFor(dbPath: string, name: string): { menu: string; note: string }[] {
  const db = new DatabaseSync(dbPath);
  try {
    return db.prepare(
      `SELECT m.name AS menu, o.dietary_note AS note
       FROM orders o
       JOIN staff s ON s.id = o.staff_id
       JOIN menu_items m ON m.id = o.menu_item_id
       WHERE s.name = ?
       ORDER BY m.name`,
    ).all(name) as { menu: string; note: string }[];
  } finally {
    db.close();
  }
}

function dishCounts(dbPath: string): { name: string; count: number }[] {
  const db = new DatabaseSync(dbPath);
  try {
    return db.prepare(
      `SELECT m.name AS name, COUNT(o.id) AS count
       FROM menu_items m
       LEFT JOIN orders o ON o.menu_item_id = m.id
       GROUP BY m.id
       ORDER BY m.name COLLATE NOCASE`,
    ).all() as { name: string; count: number }[];
  } finally {
    db.close();
  }
}

async function mailTexts(mailpitUrl: string): Promise<string[]> {
  const response = await fetch(`${mailpitUrl}/api/v1/messages`);
  const body = (await response.json()) as { messages?: { Text?: string }[] };
  return (body.messages ?? []).map((message) => message.Text ?? "");
}

function wants(only: readonly string[] | undefined, id: string): boolean {
  return !only || only.includes(id);
}

async function place(origin: string, cookie: string, menuItemId: string, dietaryNote: string): Promise<number> {
  const response = await call(origin, "POST", "/api/orders", cookie, { menuItemId, dietaryNote });
  return response.status;
}

export class KitchenHiddenAcceptanceSuite {
  async run(target: SuiteTarget, only?: readonly string[]): Promise<SuiteOutcome> {
    return runHiddenSuite(target, only);
  }
}

export async function runHiddenSuite(target: SuiteTarget, only?: readonly string[]): Promise<SuiteOutcome> {
  const catalog = JSON.parse(fs.readFileSync(target.catalogPath, "utf8")) as {
    canary: string;
    checks: { id: string; title: string }[];
  };
  if (!catalog.canary || catalog.checks.length < 25) throw new Error("hidden acceptance catalog is incomplete");
  const selected = only ? catalog.checks.filter((check) => only.includes(check.id)) : catalog.checks;
  const recorded = new Map<string, { pass: boolean; detail: string }>();
  const note = (id: string, pass: boolean, detail: string) => {
    if (!wants(only, id)) return;
    recorded.set(id, { pass, detail });
  };
  const consoleErrors: string[] = [];
  let screenshot: Buffer | null = null;
  const runBrowser = !only || only.some((id) => BROWSER_IDS.has(id));
  const timeout = target.timeoutMs;

  if (wants(only, "H-M2-26")) note("H-M2-26", productionBundleClean(target.repoDir), "production bundle");
  if (wants(only, "H-M2-28")) {
    const lint = designTokenLint(target.repoDir);
    note("H-M2-28", lint.length === 0, lint.join(",") || "tokens only");
  }

  const apiOnlyCutoff = only?.every((id) => id === "H-M2-05" || id === "H-M2-06" || id === "H-M2-07" || id === "H-M2-29") === true;
  const emailOnly = only?.length === 1 && only[0] === "H-M2-17";

  if (apiOnlyCutoff) {
    await setClock(target.origin, CLOSED);
    const fay = await signIn(target.origin, "staff", "Fay");
    const posted = await call(target.origin, "POST", "/api/orders", fay, { menuItemId: "soup", dietaryNote: "late" });
    note("H-M2-05", posted.status === 422, `status ${posted.status}`);
    const edited = await call(target.origin, "PATCH", "/api/orders/current", fay, { menuItemId: "soup", dietaryNote: "late" });
    note("H-M2-06", edited.status === 422, `status ${edited.status}`);
    await setClock(target.origin, BOUNDARY);
    const boundary = await call(target.origin, "POST", "/api/orders", fay, { menuItemId: "soup", dietaryNote: "boundary" });
    note("H-M2-07", boundary.status === 422, `status ${boundary.status}`);
    await setClock(target.origin, CLOSED);
    const bypass = await call(target.origin, "POST", "/api/orders", fay, {
      menuItemId: "soup",
      dietaryNote: "client",
      now: "2026-03-02T10:00:00-05:00",
    });
    note("H-M2-29", bypass.status === 422, `status ${bypass.status}`);
  } else if (emailOnly) {
    await setClock(target.origin, OPEN);
    const bev = await signIn(target.origin, "staff", "Bev");
    await place(target.origin, bev, "soup", "");
    const admin = await signIn(target.origin, "admin", "Kim");
    await call(target.origin, "POST", "/api/admin/catering-email", admin, {});
    const texts = await mailTexts(target.mailpitUrl);
    const counts = dishCounts(target.dbPath);
    const soup = counts.find((row) => row.name === "Soup")?.count ?? 0;
    const text = texts[0] ?? "";
    note("H-M2-17", texts.length === 1 && text.includes(`Soup × ${soup}`) && soup > 0, text || "no email");
  } else if (!only || selected.some((check) => !["H-M2-26", "H-M2-28"].includes(check.id))) {
    await setClock(target.origin, OPEN);
    let browser: BrowserLike | null = null;
    try {
      if (runBrowser) {
        browser = await launchBrowser();
        const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
        const page = await context.newPage();
        page.on("console", (value) => {
          if (value instanceof Error) return;
          if (value.type() === "error") consoleErrors.push(value.text());
        });
        page.on("pageerror", (value) => {
          if (value instanceof Error) consoleErrors.push(value.message);
        });
        const snap = async () => {
          if (screenshot) return;
          screenshot = await page.screenshot({ type: "png" });
        };
        try {
          await page.goto(`${target.origin}/`, { waitUntil: "domcontentloaded", timeout });
          const width = await page.evaluate(() => window.innerWidth);
          await page.fill("#staff-name", "Ada", { timeout });
          await page.click("#continue", { timeout });
          await page.waitForFunction(() => document.querySelectorAll("#menu-item option").length >= 3, { timeout });
          await page.selectOption("#menu-item", "soup", { timeout });
          await page.fill("#dietary-note", "no dairy", { timeout });
          await page.click("#submit-order", { timeout });
          await page.waitForFunction(() => (document.querySelector("#status")?.textContent ?? "").includes("Order saved"), { timeout });
          const ada = ordersFor(target.dbPath, "Ada");
          note("H-M2-01", width === 375 && ada.length === 1 && ada[0]?.menu === "Soup", `width ${width}; rows ${ada.length}`);
          note("H-M2-02", ada[0]?.note === "no dairy", ada[0]?.note ?? "missing");
        } catch (error) {
          await snap();
          const message = error instanceof Error ? error.message : String(error);
          note("H-M2-01", false, message);
          note("H-M2-02", false, message);
        }
        const adaCookie = await signIn(target.origin, "staff", "Ada");
        const patched = await call(target.origin, "PATCH", "/api/orders/current", adaCookie, {
          menuItemId: "soup",
          dietaryNote: "no dairy or onion",
        });
        const adaAfter = ordersFor(target.dbPath, "Ada");
        note("H-M2-03", patched.status === 200 && adaAfter[0]?.note === "no dairy or onion", `status ${patched.status}`);
        const dee = await signIn(target.origin, "staff", "Dee");
        await place(target.origin, dee, "soup", "hold");
        const removed = await call(target.origin, "DELETE", "/api/orders/current", dee);
        note("H-M2-04", removed.status === 200 && ordersFor(target.dbPath, "Dee").length === 0, `status ${removed.status}`);
        const bev = await signIn(target.origin, "staff", "Bev");
        await place(target.origin, bev, "soup", "");
        const cy = await signIn(target.origin, "staff", "Cy");
        await place(target.origin, cy, "salad", "sesame");
        const gil = await signIn(target.origin, "staff", "Gil");
        await place(target.origin, gil, "salad", "");
        await place(target.origin, gil, "salad", "second");
        note("H-M2-10", ordersFor(target.dbPath, "Gil").length === 1, `rows ${ordersFor(target.dbPath, "Gil").length}`);
        const eli = await signIn(target.origin, "staff", "Eli");
        await Promise.all([place(target.origin, eli, "sandwich", ""), place(target.origin, eli, "sandwich", "race")]);
        note("H-M2-11", ordersFor(target.dbPath, "Eli").length === 1, `rows ${ordersFor(target.dbPath, "Eli").length}`);
        const fay = await signIn(target.origin, "staff", "Fay");
        await setClock(target.origin, BOUNDARY);
        const boundary = await call(target.origin, "POST", "/api/orders", fay, { menuItemId: "soup", dietaryNote: "boundary" });
        note("H-M2-07", boundary.status === 422, `status ${boundary.status}`);
        await setClock(target.origin, CLOSED);
        const late = await call(target.origin, "POST", "/api/orders", fay, { menuItemId: "soup", dietaryNote: "late" });
        note("H-M2-05", late.status === 422, `status ${late.status}`);
        const lateEdit = await call(target.origin, "PATCH", "/api/orders/current", adaCookie, {
          menuItemId: "soup",
          dietaryNote: "too late",
        });
        note("H-M2-06", lateEdit.status === 422 && ordersFor(target.dbPath, "Ada")[0]?.note === "no dairy or onion", `status ${lateEdit.status}`);
        const bypass = await call(target.origin, "POST", "/api/orders", fay, {
          menuItemId: "soup",
          dietaryNote: "client",
          now: "2026-03-02T10:00:00-05:00",
        });
        note("H-M2-29", bypass.status === 422, `status ${bypass.status}`);
        try {
          await page.goto(`${target.origin}/`, { waitUntil: "domcontentloaded", timeout });
          await page.waitForFunction(() => {
            const submit = document.querySelector("#submit-order");
            const update = document.querySelector("#update-order");
            return submit instanceof HTMLButtonElement && update instanceof HTMLButtonElement && submit.disabled && update.disabled;
          }, { timeout });
          const submitDisabled = await page.locator("#submit-order").isDisabled();
          const updateDisabled = await page.locator("#update-order").isDisabled();
          note("H-M2-08", submitDisabled, String(submitDisabled));
          note("H-M2-09", updateDisabled, String(updateDisabled));
        } catch (error) {
          await snap();
          const message = error instanceof Error ? error.message : String(error);
          note("H-M2-08", false, message);
          note("H-M2-09", false, message);
        }
        const adminContext = await browser.newContext({ viewport: { width: 375, height: 812 } });
        const adminPage = await adminContext.newPage();
        adminPage.on("console", (value) => {
          if (value instanceof Error) return;
          if (value.type() === "error") consoleErrors.push(value.text());
        });
        adminPage.on("pageerror", (value) => {
          if (value instanceof Error) consoleErrors.push(value.message);
        });
        const adminCookie = await signIn(target.origin, "admin", "Kim");
        const browserSignIn = await adminPage.request.post(`${target.origin}/api/session`, {
          data: { role: "admin", name: "Kim" },
          timeout,
        });
        if (browserSignIn.status() !== 200) throw new Error(`admin browser sign-in ${browserSignIn.status()}`);
        await adminPage.goto(`${target.origin}/kitchen`, { waitUntil: "domcontentloaded", timeout });
        try {
          await adminPage.waitForFunction(() => document.body.innerText.includes("Soup × 2"), { timeout });
          const text = await adminPage.evaluate(() => document.body.innerText);
          note("H-M2-12", text.includes("Soup × 2") && text.includes("Salad × 2") && text.includes("Sandwich × 1"), text);
          note("H-M2-13", text.includes("no dairy or onion") && text.includes("sesame"), text);
        } catch (error) {
          screenshot = screenshot ?? (await adminPage.screenshot({ type: "png" }));
          const message = error instanceof Error ? error.message : String(error);
          note("H-M2-12", false, message);
          note("H-M2-13", false, message);
        }
        await adminPage.goto(`${target.origin}/print`, { waitUntil: "domcontentloaded", timeout });
        const box = await adminPage.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
          text: document.body.innerText,
        }));
        note("H-M2-14", box.scrollWidth <= box.clientWidth, `${box.scrollWidth}/${box.clientWidth}`);
        note("H-M2-15", box.text.includes("Soup × 2") && box.text.includes("Salad × 2") && box.text.includes("Sandwich × 1"), "print totals");
        const mailed = await call(target.origin, "POST", "/api/admin/catering-email", adminCookie, {});
        const first = await mailTexts(target.mailpitUrl);
        const again = await call(target.origin, "POST", "/api/admin/catering-email", adminCookie, {});
        const second = await mailTexts(target.mailpitUrl);
        const body = first[0] ?? "";
        note("H-M2-16", mailed.status === 200 && first.length === 1, `status ${mailed.status}; messages ${first.length}`);
        note(
          "H-M2-17",
          body.includes("Soup × 2") && body.includes("Salad × 2") && body.includes("Sandwich × 1") && body.includes("no dairy or onion") && body.includes("sesame"),
          body,
        );
        note("H-M2-18", again.json.duplicate === true && second.length === 1, `duplicate ${String(again.json.duplicate)}; messages ${second.length}`);
        const anonMenu = await call(target.origin, "POST", "/api/admin/menu", "", { name: "Special" });
        const staffMenu = await call(target.origin, "POST", "/api/admin/menu", adaCookie, { name: "Special" });
        const anonMail = await call(target.origin, "POST", "/api/admin/catering-email", "", {});
        const staffMail = await call(target.origin, "POST", "/api/admin/catering-email", adaCookie, {});
        note("H-M2-19", anonMenu.status === 401, `status ${anonMenu.status}`);
        note("H-M2-20", staffMenu.status === 403, `status ${staffMenu.status}`);
        note("H-M2-21", anonMail.status === 401, `status ${anonMail.status}`);
        note("H-M2-22", staffMail.status === 403, `status ${staffMail.status}`);
        const style = await fetch(`${target.origin}/__styleguide`);
        note("H-M2-27", style.status === 404, `status ${style.status}`);
        const broken = async (current: PageLike) => current.evaluate(() => Array.from(document.images).filter((img) => !img.complete || img.naturalWidth === 0).length);
        const orderBroken = await broken(page);
        const kitchenBroken = await broken(adminPage);
        note("H-M2-24", orderBroken + kitchenBroken === 0, `broken ${orderBroken + kitchenBroken}`);
        const axeIds: string[] = [];
        for (const current of [page, adminPage]) {
          await current.addScriptTag({ content: target.axeSource });
          const ids = await current.evaluate(async () => {
            const axe = (globalThis as unknown as {
              axe?: { run: (root: Document) => Promise<{ violations: { id: string; impact: string | null }[] }> };
            }).axe;
            if (!axe) return ["axe-missing"];
            const report = await axe.run(document);
            return report.violations.filter((item) => item.impact === "serious" || item.impact === "critical").map((item) => item.id);
          });
          axeIds.push(...ids);
        }
        note("H-M2-25", axeIds.length === 0, axeIds.join(",") || "none");
        note("H-M2-23", consoleErrors.length === 0, consoleErrors.join(" | ") || "none");
        await adminContext.close();
        await context.close();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      for (const check of selected) {
        if (!recorded.has(check.id)) note(check.id, false, message);
      }
    } finally {
      await browser?.close();
    }
  }

  const checks: HiddenCheckResult[] = selected.map((check) => {
    const found = recorded.get(check.id);
    return found
      ? { id: check.id, title: check.title, pass: found.pass, detail: found.detail }
      : { id: check.id, title: check.title, pass: false, detail: "not executed" };
  });
  return { checks, screenshot, consoleErrors };
}
