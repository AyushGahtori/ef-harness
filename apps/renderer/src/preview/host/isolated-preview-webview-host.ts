import { decidePreviewNavigation, type NavigationDecision } from "./navigation-guard.js";
import {
  featureUpdatePill,
  HARNESS_SHELL_PARTITION,
  lastGoodBanner,
  PREVIEW_LABELS,
  previewPartition,
  VIEWPORT_WIDTHS,
  type ViewportPreset,
} from "./partition.js";
import { PartitionMemory } from "./session-store.js";

export interface WebviewAttributes {
  readonly tag: "webview";
  readonly partition: `persist:ef-preview-${string}`;
  readonly src: string;
  readonly nodeintegration: false;
  readonly nodeintegrationinsubframes: false;
  readonly webpreferences: "contextIsolation=yes, sandbox=yes";
  readonly preload: null;
  readonly allowpopups: false;
}

export interface WebContentsViewOptions {
  readonly webPreferences: {
    readonly partition: `persist:ef-preview-${string}`;
    readonly contextIsolation: true;
    readonly nodeIntegration: false;
    readonly sandbox: true;
    readonly preload: undefined;
  };
}

export interface PreviewGuestRealm {
  readonly partition: `persist:ef-preview-${string}`;
  readonly electronAPI: undefined;
  readonly harnessd: undefined;
  readonly process: undefined;
  readonly require: undefined;
  readonly preload: null;
  readonly contextIsolation: true;
  readonly readHostFile: (filePath: string) => { readonly allowed: false; readonly reason: "preview-guest-has-no-host-fs"; readonly filePath: string };
}

export interface HttpErrorRecord {
  readonly status: number;
  readonly url: string;
}

export interface PointToFixRequest {
  readonly task: 161;
  readonly type: "point-to-fix-request";
  readonly projectId: string;
  readonly route: string;
  readonly viewport: ViewportPreset;
  readonly consoleErrors: readonly string[];
  readonly unhandledRejections: readonly string[];
  readonly httpErrors: readonly HttpErrorRecord[];
}

export interface SendErrorToFixRequest {
  readonly task: 161;
  readonly type: "send-error-to-fix";
  readonly projectId: string;
  readonly commitSha: string;
  readonly stderrRedacted: string;
}

export interface PopOutPreviewRequest {
  readonly task: 123;
  readonly type: "pop-out-preview";
  readonly monitor: 2;
  readonly partition: `persist:ef-preview-${string}`;
  readonly url: string;
}

export interface PreviewShellModel {
  readonly mode: "web" | "cli";
  readonly title: string;
  readonly webviewMounted: boolean;
  readonly partition: `persist:ef-preview-${string}`;
  readonly shellPartition: typeof HARNESS_SHELL_PARTITION;
  readonly route: string;
  readonly viewport: ViewportPreset;
  readonly viewportWidthPx: number | null;
  readonly buttons: readonly string[];
  readonly consolePill: string | null;
  readonly featurePill: string | null;
  readonly banner: string | null;
  readonly sleeping: boolean;
  readonly reloadCount: number;
}

export interface IsolatedPreviewWebviewHostOptions {
  readonly projectId: string;
  readonly previewUrl: string;
  readonly mode?: "web" | "cli";
  readonly onResetDemoData?: () => Promise<{ readonly elapsedMs: number }>;
  readonly onReload?: () => void;
  readonly onWake?: () => void;
}

interface GuestEvent {
  readonly type: "console-error" | "unhandled-rejection" | "http";
  readonly message?: string;
  readonly status?: number;
  readonly url?: string;
}

/**
 * Sandboxed Electron webview / WebContentsView host for one project's Live Preview.
 * The guest partition has no harness preload, cookies, storage, or filesystem bridge.
 */
export class IsolatedPreviewWebviewHost {
  readonly partition: `persist:ef-preview-${string}`;
  private readonly previewStore = new PartitionMemory();
  private readonly shellStore = new PartitionMemory();
  private readonly consoleErrors: string[] = [];
  private readonly rejections: string[] = [];
  private readonly httpErrors: HttpErrorRecord[] = [];
  private route = "/";
  private viewport: ViewportPreset = "desktop";
  private featurePill: string | null = null;
  private banner: string | null = null;
  private failedSha: string | null = null;
  private stderrRedacted: string | null = null;
  private reloadCount = 0;
  private sleeping = false;
  private readonly mode: "web" | "cli";
  private currentUrl: string;

  constructor(private readonly options: IsolatedPreviewWebviewHostOptions) {
    this.partition = previewPartition(options.projectId);
    this.mode = options.mode ?? "web";
    const origin = new URL(options.previewUrl);
    this.currentUrl = origin.toString();
    this.route = `${origin.pathname}${origin.search}` || "/";
  }

  webviewAttributes(): WebviewAttributes | null {
    if (this.mode === "cli" || this.sleeping) return null;
    return {
      tag: "webview",
      partition: this.partition,
      src: this.currentUrl,
      nodeintegration: false,
      nodeintegrationinsubframes: false,
      webpreferences: "contextIsolation=yes, sandbox=yes",
      preload: null,
      allowpopups: false,
    };
  }

  webContentsViewOptions(): WebContentsViewOptions | null {
    if (this.mode === "cli") return null;
    return {
      webPreferences: {
        partition: this.partition,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        preload: undefined,
      },
    };
  }

  createGuestRealm(): PreviewGuestRealm {
    return {
      partition: this.partition,
      electronAPI: undefined,
      harnessd: undefined,
      process: undefined,
      require: undefined,
      preload: null,
      contextIsolation: true,
      readHostFile: (filePath) => ({
        allowed: false,
        reason: "preview-guest-has-no-host-fs",
        filePath,
      }),
    };
  }

  willNavigate(url: string): NavigationDecision {
    const decision = decidePreviewNavigation({
      target: url,
      previewOrigin: this.origin(),
      explicitUserClick: false,
    });
    if (decision.action === "allow") this.applyAllowed(decision.url);
    return decision;
  }

  activateLink(url: string, input: { readonly explicitClick: boolean }): NavigationDecision {
    const decision = decidePreviewNavigation({
      target: url,
      previewOrigin: this.origin(),
      explicitUserClick: input.explicitClick,
    });
    if (decision.action === "allow") this.applyAllowed(decision.url);
    return decision;
  }

  setRoute(route: string): void {
    if (!route.startsWith("/") || route.startsWith("//") || route.includes("://")) {
      throw new Error("address bar accepts an in-app route");
    }
    this.route = route;
    this.currentUrl = new URL(route, this.origin()).toString();
  }

  setViewport(preset: ViewportPreset): void {
    this.viewport = preset;
  }

  viewportWidthPx(): number | null {
    return VIEWPORT_WIDTHS[this.viewport];
  }

  reload(): void {
    this.reloadCount += 1;
    this.options.onReload?.();
  }

  openInSystemBrowser(): { readonly action: "open-os-browser"; readonly url: string } {
    return { action: "open-os-browser", url: this.currentUrl };
  }

  popOutToMonitor2(): PopOutPreviewRequest {
    return {
      task: 123,
      type: "pop-out-preview",
      monitor: 2,
      partition: this.partition,
      url: this.currentUrl,
    };
  }

  async resetDemoData(): Promise<{ readonly elapsedMs: number; readonly label: typeof PREVIEW_LABELS.resetDemoData }> {
    if (!this.options.onResetDemoData) throw new Error("Reset Demo Data is not wired");
    const result = await this.options.onResetDemoData();
    this.reloadCount += 1;
    return { elapsedMs: result.elapsedMs, label: PREVIEW_LABELS.resetDemoData };
  }

  recordGuestEvent(event: GuestEvent): void {
    if (event.type === "console-error" && event.message) this.consoleErrors.push(event.message);
    if (event.type === "unhandled-rejection" && event.message) this.rejections.push(event.message);
    if (event.type === "http" && typeof event.status === "number" && event.status >= 400 && event.status <= 599 && event.url) {
      this.httpErrors.push({ status: event.status, url: event.url });
    }
  }

  consolePill(): string | null {
    const count = this.consoleErrors.length;
    if (count === 0) return null;
    return count === 1 ? "1 console error" : `${count} console errors`;
  }

  openInspector(): {
    readonly consoleErrors: readonly string[];
    readonly unhandledRejections: readonly string[];
    readonly httpErrors: readonly HttpErrorRecord[];
  } {
    return {
      consoleErrors: [...this.consoleErrors],
      unhandledRejections: [...this.rejections],
      httpErrors: [...this.httpErrors],
    };
  }

  sendToPointToFix(): PointToFixRequest {
    return {
      task: 161,
      type: "point-to-fix-request",
      projectId: this.options.projectId,
      route: this.route,
      viewport: this.viewport,
      consoleErrors: [...this.consoleErrors],
      unhandledRejections: [...this.rejections],
      httpErrors: [...this.httpErrors],
    };
  }

  showFeaturePill(featureId: string): string {
    this.featurePill = featureUpdatePill(featureId);
    return this.featurePill;
  }

  showLastGoodBanner(input: { readonly sha: string; readonly stderrRedacted: string }): string {
    this.failedSha = input.sha;
    this.stderrRedacted = input.stderrRedacted;
    this.banner = lastGoodBanner(input.sha);
    return this.banner;
  }

  inspectError(): string | null {
    return this.stderrRedacted;
  }

  sendErrorToFix(): SendErrorToFixRequest | null {
    if (!this.banner || !this.failedSha || this.stderrRedacted === null) return null;
    return {
      task: 161,
      type: "send-error-to-fix",
      projectId: this.options.projectId,
      commitSha: this.failedSha,
      stderrRedacted: this.stderrRedacted,
    };
  }

  markSuspended(): void {
    this.sleeping = true;
  }

  wake(): { readonly action: "wake"; readonly label: typeof PREVIEW_LABELS.wake } {
    this.sleeping = false;
    this.options.onWake?.();
    return { action: "wake", label: PREVIEW_LABELS.wake };
  }

  writeCookie(partition: "preview" | "shell", name: string, value: string): void {
    this.store(partition).writeCookie(name, value);
  }

  readCookie(partition: "preview" | "shell", name: string): string | undefined {
    return this.store(partition).readCookie(name);
  }

  writeLocalStorage(partition: "preview" | "shell", key: string, value: string): void {
    this.store(partition).writeLocalStorage(key, value);
  }

  readLocalStorage(partition: "preview" | "shell", key: string): string | undefined {
    return this.store(partition).readLocalStorage(key);
  }

  writeIndexedDb(partition: "preview" | "shell", key: string, value: string): void {
    this.store(partition).writeIndexedDb(key, value);
  }

  readIndexedDb(partition: "preview" | "shell", key: string): string | undefined {
    return this.store(partition).readIndexedDb(key);
  }

  registerServiceWorker(
    partition: "preview" | "shell",
    scriptUrl: string,
  ): { readonly ok: true } | { readonly ok: false; readonly reason: string } {
    if (partition !== "preview") {
      return { ok: false, reason: "service-worker-isolated-to-preview-partition" };
    }
    let parsed: URL;
    try {
      parsed = new URL(scriptUrl);
    } catch {
      return { ok: false, reason: "invalid-script-url" };
    }
    if (!this.isAllowedScript(parsed)) return { ok: false, reason: "off-origin-service-worker" };
    this.previewStore.serviceWorkers.push(scriptUrl);
    return { ok: true };
  }

  serviceWorkers(partition: "preview" | "shell"): readonly string[] {
    return [...this.store(partition).serviceWorkers];
  }

  describe(): PreviewShellModel {
    return {
      mode: this.mode,
      title: this.mode === "cli" ? PREVIEW_LABELS.cliTitle : "Live Preview",
      webviewMounted: this.webviewAttributes() !== null,
      partition: this.partition,
      shellPartition: HARNESS_SHELL_PARTITION,
      route: this.route,
      viewport: this.viewport,
      viewportWidthPx: this.viewportWidthPx(),
      buttons: this.buttons(),
      consolePill: this.consolePill(),
      featurePill: this.featurePill,
      banner: this.banner,
      sleeping: this.sleeping,
      reloadCount: this.reloadCount,
    };
  }

  private buttons(): string[] {
    if (this.mode === "cli") {
      const buttons: string[] = [PREVIEW_LABELS.resetDemoData];
      if (this.sleeping) buttons.push(PREVIEW_LABELS.wake);
      return buttons;
    }
    const buttons: string[] = [
      PREVIEW_LABELS.mobile,
      PREVIEW_LABELS.tablet,
      PREVIEW_LABELS.desktop,
      PREVIEW_LABELS.responsive,
      PREVIEW_LABELS.reload,
      PREVIEW_LABELS.openBrowser,
      PREVIEW_LABELS.popOut,
      PREVIEW_LABELS.resetDemoData,
    ];
    if (this.sleeping) buttons.push(PREVIEW_LABELS.wake);
    if (this.banner) {
      buttons.push(PREVIEW_LABELS.inspectError, PREVIEW_LABELS.sendError);
    }
    return buttons;
  }

  private origin(): string {
    const url = new URL(this.options.previewUrl);
    return `${url.protocol}//${url.host}`;
  }

  private applyAllowed(url: string): void {
    const parsed = new URL(url);
    this.currentUrl = parsed.toString();
    this.route = `${parsed.pathname}${parsed.search}` || "/";
  }

  private isAllowedScript(script: URL): boolean {
    const decision = decidePreviewNavigation({
      target: script.toString(),
      previewOrigin: this.origin(),
      explicitUserClick: false,
    });
    return decision.action === "allow";
  }

  private store(partition: "preview" | "shell"): PartitionMemory {
    return partition === "preview" ? this.previewStore : this.shellStore;
  }
}
