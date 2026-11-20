import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  HumanStepRequired,
  launchChromium,
  loadPlaywright,
  UiInteractionContractVerifier,
  type CasBlobStorePort,
  type EnvironmentHandlePort,
  type HiddenCheckFailure,
  type HintLadderPort,
  type PwBrowser,
} from "../../src/ui-contract/index.js";
import { startFixtureServer, type FixtureServer } from "./fixture-server.js";

class MemoryCas implements CasBlobStorePort {
  readonly records: {
    digest: string;
    retention: "diagnostic" | "evidence";
    label: string;
    bytes: Uint8Array;
  }[] = [];

  async put(
    bytes: Uint8Array,
    meta: { readonly retention: "diagnostic" | "evidence"; readonly label: string },
  ): Promise<string> {
    const digest = createHash("sha256").update(bytes).digest("hex");
    this.records.push({ digest, retention: meta.retention, label: meta.label, bytes: new Uint8Array(bytes) });
    return digest;
  }

  async promote(digest: string, retention: "evidence"): Promise<void> {
    const matches = this.records.filter((record) => record.digest === digest);
    for (const record of matches) record.retention = retention;
  }
}

class RecordingLadder implements HintLadderPort {
  step = 1;
  readonly calls: HiddenCheckFailure[] = [];

  processHiddenFailure(failure: HiddenCheckFailure): void {
    this.calls.push(failure);
    this.step += 1;
  }
}

interface ContextCounts {
  opened: number;
  closed: number;
}

function sharedLauncher(browser: PwBrowser, counts: ContextCounts) {
  return async () => ({
    async newContext(options?: { readonly locale?: string }) {
      counts.opened += 1;
      const context = await browser.newContext(options);
      return {
        tracing: context.tracing,
        newPage: () => context.newPage(),
        addCookies: (cookies: readonly { name: string; value: string; url: string }[]) =>
          context.addCookies(cookies.map((cookie) => ({ ...cookie }))),
        async close() {
          counts.closed += 1;
          await context.close();
        },
      };
    },
    async close() {
      return undefined;
    },
  });
}

const READY = {
  contract: "kitchen-list/ui@1",
  route: "/kitchen",
  as: { role: "kitchen_staff" },
  landmarks: [
    { navigation: "Primary" },
    { main: true },
    { heading: "Kitchen totals" },
    { form: "Kitchen filters" },
    { table: { name: "Totals by dish", columns: ["Dish", "Quantity"] } },
  ],
  actions: [
    { link: "Orders" },
    { textbox: "Search" },
    { combobox: "Status" },
    { button: "Print" },
  ],
};

const TABLE_SNAPSHOT = `
- table "Totals by dish":
  - rowgroup:
    - row:
      - cell "Soup"
      - cell "2"
`;

describe("UiInteractionContractVerifier", () => {
  let fixture: FixtureServer;
  let browser: PwBrowser;
  const counts: ContextCounts = { opened: 0, closed: 0 };
  let cas: MemoryCas;
  let ladder: RecordingLadder;

  beforeAll(async () => {
    fixture = await startFixtureServer();
    browser = await launchChromium();
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
    await fixture?.close();
  });

  function verifier(): UiInteractionContractVerifier {
    cas = new MemoryCas();
    ladder = new RecordingLadder();
    return new UiInteractionContractVerifier({
      cas,
      hintLadder: ladder,
      launchBrowser: sharedLauncher(browser, counts),
    });
  }

  function env(id = "kitchen"): EnvironmentHandlePort {
    return { id, vars: () => ({ APP_URL: fixture.origin(id) }) };
  }

  it("passes a ready kitchen page, promotes artifacts, and closes a fresh context", async () => {
    const opened = counts.opened;
    const result = await verifier().verify({
      env: env(),
      contract: READY,
      hidden: {
        rows: ["Soup · 2", "Rice · 1"],
        ariaSnapshot: TABLE_SNAPSHOT,
      },
    });
    expect(result.passed, result.message + "\n" + result.hostAriaTree).toBe(true);
    expect(result.attribution).toBe("pass");
    expect(result.keyboardActivated).toContain("Print");
    expect(ladder.calls).toHaveLength(0);
    expect(ladder.step).toBe(1);
    expect(counts.opened).toBe(opened + 1);
    expect(counts.closed).toBe(counts.opened);
    expect(result.traceBytes[0]).toBe(0x50);
    expect(result.traceBytes[1]).toBe(0x4b);
    expect(cas.records.map((record) => record.label).sort()).toEqual([
      "aria-tree",
      "playwright-screenshot",
      "playwright-trace",
    ]);
    expect(cas.records.every((record) => record.retention === "evidence")).toBe(true);
    expect(result.artifacts.every((artifact) => artifact.retention === "evidence")).toBe(true);
  }, 40_000);

  it("reports a missing Print button as a contract mismatch and leaves the ladder untouched", async () => {
    const result = await verifier().verify({
      env: env(),
      contract: {
        contract: "kitchen-list/ui@1",
        route: "/kitchen-missing",
        as: { role: "kitchen_staff" },
        actions: [{ button: "Print" }],
      },
    });
    expect(result.passed).toBe(false);
    expect(result.attribution).toBe("contract_mismatch");
    expect(result.message).toBe("No button named 'Print' on /kitchen-missing");
    expect(result.disposition).toBe("plain_message");
    expect(result.hiddenCheckFailure).toBe(false);
    expect(result.ladderAdvanced).toBe(false);
    expect(ladder.calls).toHaveLength(0);
    expect(ladder.step).toBe(1);
    expect(cas.records.every((record) => record.retention === "diagnostic")).toBe(true);
  }, 40_000);

  it("routes wrong seeded rows to the hint ladder without echoing them", async () => {
    const hiddenRows = ["Soup · 2", "Rice · 1"];
    const result = await verifier().verify({
      env: env(),
      contract: { ...READY, route: "/kitchen-wrong" },
      hidden: { rows: hiddenRows, ariaSnapshot: TABLE_SNAPSHOT },
      checkId: "kitchen-rows",
    });
    expect(result.passed).toBe(false);
    expect(result.attribution).toBe("implementation");
    expect(result.hiddenCheckFailure).toBe(true);
    expect(result.disposition).toBe("hint_ladder");
    expect(result.ladderAdvanced).toBe(true);
    expect(ladder.step).toBe(2);
    expect(result.message).toBe("Seeded table rows on /kitchen-wrong did not match the hidden expectation.");
    expect(result.message).not.toContain("Soup · 2");
    expect(result.message).not.toContain("Rice · 1");
    expect(result.sealedHint?.expected).toEqual({ rows: hiddenRows });
    expect(JSON.stringify(result.sealedHint?.observed)).not.toContain("Soup · 2");
    const collected = await verifier().collect({
      env: env(),
      checks: [
        {
          checkId: "kitchen-rows",
          surface: "browser",
          input: {
            contract: { ...READY, route: "/kitchen-wrong" },
            hidden: { rows: hiddenRows },
          },
        },
      ],
    });
    const observed = JSON.stringify(collected[0]?.observed);
    expect(collected[0]?.signals).toBeNull();
    expect(collected[0]?.reporterStatus).toBe("fail");
    expect(observed).not.toContain("Soup · 2");
    expect(observed).not.toContain("Rice · 1");
  }, 40_000);

  it("holds the orders response until the loading progressbar is visible and mocks a 500 error", async () => {
    const loading = await verifier().verify({
      env: env(),
      contract: {
        contract: "kitchen-list/ui@1",
        route: "/kitchen-live",
        as: { role: "kitchen_staff" },
        states: { loading: { role: "progressbar", name: "Loading orders" } },
      },
      focusState: "loading",
      networkDelayMs: 250,
    });
    expect(loading.passed, loading.message).toBe(true);
    const error = await verifier().verify({
      env: env(),
      contract: {
        contract: "kitchen-list/ui@1",
        route: "/kitchen-live",
        as: { role: "kitchen_staff" },
        states: { error: { text: "Couldn't load orders" } },
      },
      focusState: "error",
    });
    expect(error.passed, error.message + "\n" + error.hostAriaTree).toBe(true);
    const empty = await verifier().verify({
      env: env(),
      contract: {
        contract: "kitchen-list/ui@1",
        route: "/kitchen-live",
        as: { role: "kitchen_staff" },
        states: { empty: { text: "No orders yet" } },
      },
      focusState: "empty",
    });
    expect(empty.passed, empty.message).toBe(true);
    const denied = await verifier().verify({
      env: env(),
      contract: {
        contract: "kitchen-list/ui@1",
        route: "/kitchen-live",
        as: { role: "guest" },
        states: { unauthorized: { text: "You cannot view the kitchen" } },
      },
      focusState: "unauthorized",
    });
    expect(denied.passed, denied.hostAriaTree).toBe(true);
  }, 40_000);

  it("treats curly apostrophes as the same copy and a reworded sentence as a contract mismatch", async () => {
    const curly = await verifier().verify({
      env: env(),
      contract: {
        contract: "kitchen-list/ui@1",
        route: "/kitchen-curly",
        as: { role: "kitchen_staff" },
        states: { error: { text: "Couldn't load orders" } },
      },
      focusState: "error",
    });
    expect(curly.passed, curly.hostAriaTree).toBe(true);
    expect(ladder.calls).toHaveLength(0);
    const reworded = await verifier().verify({
      env: env(),
      contract: {
        contract: "kitchen-list/ui@1",
        route: "/kitchen-reworded",
        as: { role: "kitchen_staff" },
        states: { error: { text: "Couldn't load orders" } },
      },
      focusState: "error",
    });
    expect(reworded.attribution).toBe("contract_mismatch");
    expect(reworded.message).toBe("No text 'Couldn't load orders' on /kitchen-reworded");
    expect(reworded.ladderAdvanced).toBe(false);
    expect(ladder.step).toBe(1);
  }, 40_000);

  it("fails uncaught page errors and severe console errors while keeping the trace in CAS", async () => {
    const crashed = await verifier().verify({
      env: env(),
      contract: {
        contract: "kitchen-list/ui@1",
        route: "/kitchen-throw",
        as: { role: "kitchen_staff" },
        actions: [{ button: "Print" }],
      },
    });
    expect(crashed.passed).toBe(false);
    expect(crashed.attribution).toBe("implementation");
    expect(crashed.message).toBe("Unhandled page error on /kitchen-throw");
    expect(crashed.pageErrors.join(" ")).toContain("boom-unhandled");
    expect(crashed.ladderAdvanced).toBe(false);
    const trace = cas.records.find((record) => record.label === "playwright-trace");
    expect(trace?.retention).toBe("diagnostic");
    expect(trace?.bytes.byteLength ?? 0).toBeGreaterThan(0);
    expect(trace?.bytes[0]).toBe(0x50);
    const consoleFailure = await verifier().verify({
      env: env(),
      contract: {
        contract: "kitchen-list/ui@1",
        route: "/kitchen-console",
        as: { role: "kitchen_staff" },
        actions: [{ button: "Print" }],
      },
    });
    expect(consoleFailure.message).toBe("Severe console error on /kitchen-console");
    expect(consoleFailure.consoleErrors.join(" ")).toContain("severe-failure");
    expect(ladder.calls).toHaveLength(0);
  }, 40_000);

  it("treats a hidden Print button and a strict-mode duplicate as contract mismatches", async () => {
    const hidden = await verifier().verify({
      env: env(),
      contract: {
        contract: "kitchen-list/ui@1",
        route: "/kitchen-hidden",
        as: { role: "kitchen_staff" },
        actions: [{ button: "Print" }],
      },
    });
    expect(hidden.attribution).toBe("contract_mismatch");
    expect(hidden.message).toBe("No button named 'Print' on /kitchen-hidden");
    expect(ladder.calls).toHaveLength(0);
    const duplicate = await verifier().verify({
      env: env(),
      contract: {
        contract: "kitchen-list/ui@1",
        route: "/kitchen-duplicate",
        as: { role: "kitchen_staff" },
        actions: [{ button: "Print" }],
      },
    });
    expect(duplicate.attribution).toBe("contract_mismatch");
    expect(duplicate.message).toBe("Multiple buttons named 'Print' on /kitchen-duplicate");
    expect(duplicate.ladderAdvanced).toBe(false);
  }, 40_000);

  it("fails a button that is not in the tab order", async () => {
    const result = await verifier().verify({
      env: env(),
      contract: {
        contract: "kitchen-list/ui@1",
        route: "/kitchen-notab",
        as: { role: "kitchen_staff" },
        actions: [{ button: "Print" }],
      },
    });
    expect(result.attribution).toBe("implementation");
    expect(result.message).toBe("Button 'Print' on /kitchen-notab is not reachable by keyboard");
    expect(result.ladderAdvanced).toBe(false);
  }, 40_000);

  it("accepts an ARIA snapshot regex for a dynamic order number", async () => {
    const result = await verifier().verify({
      env: env(),
      contract: {
        contract: "kitchen-list/ui@1",
        route: "/kitchen-order",
        as: { role: "kitchen_staff" },
        landmarks: [{ table: "Orders" }],
      },
      hidden: {
        ariaSnapshot: `
          - table "Orders":
            - rowgroup:
              - row:
                - cell /Order #\\d+/
        `,
      },
    });
    expect(result.passed, result.message + "\n" + result.hostAriaTree).toBe(true);
  }, 40_000);

  it("keeps browser contexts from sharing localStorage", async () => {
    const playwright = loadPlaywright();
    expect(playwright.chromium).toBeTruthy();
    const origin = fixture.origin("isolation");
    const first = await browser.newContext();
    const page = await first.newPage();
    await page.goto(`${origin}/kitchen-store`);
    await page.evaluate(() => {
      const storage = globalThis as unknown as { localStorage: { setItem(key: string, value: string): void } };
      storage.localStorage.setItem("ef_probe", "one");
    });
    await first.close();
    const second = await browser.newContext();
    const again = await second.newPage();
    await again.goto(`${origin}/kitchen-store`);
    const value = await again.evaluate(() => {
      const storage = globalThis as unknown as { localStorage: { getItem(key: string): string | null } };
      return storage.localStorage.getItem("ef_probe");
    });
    await second.close();
    expect(value).toBeNull();
  }, 40_000);

  it("surfaces a missing Chromium binary as a human step", async () => {
    const isolated = new UiInteractionContractVerifier({
      cas: new MemoryCas(),
      launchBrowser: async () => {
        throw new Error(
          "browserType.launch: Executable doesn't exist at C:/ms-playwright/chromium\nPlease run the following command\nnpx playwright install",
        );
      },
    });
    await expect(
      isolated.verify({
        env: env(),
        contract: {
          contract: "kitchen-list/ui@1",
          route: "/kitchen",
          as: { role: "kitchen_staff" },
          actions: [{ button: "Print" }],
        },
      }),
    ).rejects.toBeInstanceOf(HumanStepRequired);
  });
});
