import { describe, expect, it } from "vitest";
import { IsolatedPreviewWebviewHost } from "../../src/preview/host/index.js";
import { PREVIEW_LABELS } from "../../src/preview/host/partition.js";

const previewUrl = "http://127.0.0.1:41021/";

function host(mode: "web" | "cli" = "web"): IsolatedPreviewWebviewHost {
  return new IsolatedPreviewWebviewHost({ projectId: "cafe", previewUrl, mode });
}

describe("IsolatedPreviewWebviewHost", () => {
  it("pins a dedicated partition with no preload and blocks host access", () => {
    const preview = host();
    const webview = preview.webviewAttributes();
    const view = preview.webContentsViewOptions();
    expect(webview).toMatchObject({
      tag: "webview",
      partition: "persist:ef-preview-cafe",
      nodeintegration: false,
      nodeintegrationinsubframes: false,
      webpreferences: "contextIsolation=yes, sandbox=yes",
      preload: null,
      allowpopups: false,
    });
    expect(view?.webPreferences).toMatchObject({
      partition: "persist:ef-preview-cafe",
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: undefined,
    });
    const guest = preview.createGuestRealm();
    expect(guest.electronAPI).toBeUndefined();
    expect(guest.harnessd).toBeUndefined();
    expect(guest.process).toBeUndefined();
    expect(guest.require).toBeUndefined();
    expect(guest.preload).toBeNull();
    expect(guest.contextIsolation).toBe(true);
    expect(guest.readHostFile("C:\\Windows\\System32")).toEqual({
      allowed: false,
      reason: "preview-guest-has-no-host-fs",
      filePath: "C:\\Windows\\System32",
    });
  });

  it("isolates cookies, storage, indexedDB, and service workers from the harness shell", () => {
    const preview = host();
    preview.writeCookie("shell", "ef-session", "harness");
    preview.writeLocalStorage("shell", "theme", "dark");
    preview.writeIndexedDb("shell", "drafts", "1");
    preview.writeCookie("preview", "cart", "3");
    preview.writeLocalStorage("preview", "cart", "3");
    preview.writeIndexedDb("preview", "orders", "3");
    expect(preview.readCookie("preview", "ef-session")).toBeUndefined();
    expect(preview.readLocalStorage("preview", "theme")).toBeUndefined();
    expect(preview.readIndexedDb("preview", "drafts")).toBeUndefined();
    expect(preview.readCookie("shell", "cart")).toBeUndefined();
    expect(preview.readLocalStorage("shell", "cart")).toBeUndefined();
    expect(preview.readIndexedDb("shell", "orders")).toBeUndefined();
    expect(preview.registerServiceWorker("shell", `${previewUrl}sw.js`)).toEqual({
      ok: false,
      reason: "service-worker-isolated-to-preview-partition",
    });
    expect(preview.registerServiceWorker("preview", "https://evil.example/sw.js")).toEqual({
      ok: false,
      reason: "off-origin-service-worker",
    });
    expect(preview.registerServiceWorker("preview", `${previewUrl}sw.js`)).toEqual({ ok: true });
    expect(preview.serviceWorkers("preview")).toEqual([`${previewUrl}sw.js`]);
    expect(preview.serviceWorkers("shell")).toEqual([]);
  });

  it("blocks off-origin navigation and opens external links only on an explicit click", () => {
    const preview = host();
    const forced = preview.willNavigate("https://evil.example/phish");
    expect(forced.action).toBe("block");
    expect(forced.openedExternal).toBe(false);
    expect(preview.willNavigate("javascript:alert(1)").action).toBe("block");
    expect(preview.willNavigate("file:///C:/Windows/System32").action).toBe("block");
    expect(preview.willNavigate("http://127.0.0.1:41099/orders").action).toBe("block");
    expect(preview.activateLink("https://evil.example/phish", { explicitClick: false }).openedExternal).toBe(false);
    const clicked = preview.activateLink("https://evil.example/phish", { explicitClick: true });
    expect(clicked.action).toBe("open-os-browser");
    expect(clicked.openedExternal).toBe(true);
    expect(preview.describe().route).toBe("/");
    expect(preview.willNavigate("http://127.0.0.1:41021/orders").action).toBe("allow");
    expect(preview.willNavigate("http://localhost:41021/orders").action).toBe("allow");
    expect(preview.willNavigate("http://preview.localhost:41021/orders").action).toBe("allow");
    expect(preview.describe().route).toBe("/orders");
    expect(preview.openInSystemBrowser()).toEqual({
      action: "open-os-browser",
      url: "http://preview.localhost:41021/orders",
    });
  });

  it("switches 375, 768, and 1440 viewport presets and keeps the route address bar", () => {
    const preview = host();
    preview.setRoute("/orders");
    expect(preview.describe().route).toBe("/orders");
    preview.setViewport("mobile");
    expect(preview.viewportWidthPx()).toBe(375);
    preview.setViewport("tablet");
    expect(preview.viewportWidthPx()).toBe(768);
    preview.setViewport("desktop");
    expect(preview.viewportWidthPx()).toBe(1440);
    preview.setViewport("responsive");
    expect(preview.viewportWidthPx()).toBeNull();
    const buttons = preview.describe().buttons;
    expect(buttons).toEqual(expect.arrayContaining([
      PREVIEW_LABELS.mobile,
      PREVIEW_LABELS.tablet,
      PREVIEW_LABELS.desktop,
      PREVIEW_LABELS.responsive,
      "Reload",
      "Open in system browser",
      "Pop out to Monitor 2",
      "Reset Demo Data",
    ]));
    expect(() => preview.setRoute("https://evil.example")).toThrow(/in-app route/);
  });

  it("counts console errors, captures http failures, and can send them to point-to-fix", () => {
    const preview = host();
    preview.setRoute("/orders");
    preview.setViewport("mobile");
    preview.recordGuestEvent({ type: "console-error", message: "render failed" });
    preview.recordGuestEvent({ type: "console-error", message: "submit failed" });
    preview.recordGuestEvent({ type: "unhandled-rejection", message: "promise failed" });
    preview.recordGuestEvent({ type: "http", status: 500, url: `${previewUrl}orders` });
    preview.recordGuestEvent({ type: "http", status: 200, url: `${previewUrl}orders` });
    expect(preview.consolePill()).toBe("2 console errors");
    expect(preview.openInspector()).toEqual({
      consoleErrors: ["render failed", "submit failed"],
      unhandledRejections: ["promise failed"],
      httpErrors: [{ status: 500, url: `${previewUrl}orders` }],
    });
    expect(preview.sendToPointToFix()).toMatchObject({
      task: 161,
      type: "point-to-fix-request",
      projectId: "cafe",
      route: "/orders",
      viewport: "mobile",
    });
    preview.reload();
    expect(preview.describe().reloadCount).toBe(1);
  });

  it("shows the last-good banner, feature pill, pop-out, reset, and wake actions", async () => {
    let resets = 0;
    let wakes = 0;
    const preview = new IsolatedPreviewWebviewHost({
      projectId: "cafe",
      previewUrl,
      onResetDemoData: async () => {
        resets += 1;
        return { elapsedMs: 12 };
      },
      onWake: () => {
        wakes += 1;
      },
    });
    expect(preview.showFeaturePill("F-CateringEmail")).toBe("Updated to include Feature F-CateringEmail");
    expect(preview.showLastGoodBanner({ sha: "abc123", stderrRedacted: "[REDACTED_SECRET:STRIPE_TEST_KEY]" })).toBe(
      "Preview build failed on latest commit — Viewing last working build (abc123) · Inspect Error",
    );
    expect(preview.inspectError()).toBe("[REDACTED_SECRET:STRIPE_TEST_KEY]");
    expect(preview.sendErrorToFix()).toEqual({
      task: 161,
      type: "send-error-to-fix",
      projectId: "cafe",
      commitSha: "abc123",
      stderrRedacted: "[REDACTED_SECRET:STRIPE_TEST_KEY]",
    });
    expect(preview.describe().buttons).toEqual(expect.arrayContaining(["Inspect Error", "Send error to fix"]));
    expect(preview.popOutToMonitor2()).toEqual({
      task: 123,
      type: "pop-out-preview",
      monitor: 2,
      partition: "persist:ef-preview-cafe",
      url: previewUrl,
    });
    await expect(preview.resetDemoData()).resolves.toEqual({ elapsedMs: 12, label: "Reset Demo Data" });
    expect(resets).toBe(1);
    expect(preview.describe().reloadCount).toBe(1);
    preview.markSuspended();
    expect(preview.describe().sleeping).toBe(true);
    expect(preview.webviewAttributes()).toBeNull();
    expect(preview.wake()).toEqual({ action: "wake", label: "Wake" });
    expect(wakes).toBe(1);
    expect(preview.describe().sleeping).toBe(false);
  });

  it("adapts a non-UI CLI target into a sandboxed CLI preview without a webview", () => {
    const preview = host("cli");
    const shell = preview.describe();
    expect(shell.mode).toBe("cli");
    expect(shell.title).toBe("Interactive Sandboxed CLI Preview Runner");
    expect(shell.webviewMounted).toBe(false);
    expect(preview.webviewAttributes()).toBeNull();
    expect(preview.webContentsViewOptions()).toBeNull();
    expect(preview.createGuestRealm().electronAPI).toBeUndefined();
    expect(shell.buttons).toContain("Reset Demo Data");
    expect(shell.buttons).not.toContain("Mobile 375px");
  });
});
