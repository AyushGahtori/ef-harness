import type { HiddenCheckFailure } from "./types.js";

/**
 * Local stand-in for `EnvironmentHandle` (Task 049).
 * Verification reads `vars().APP_URL` and isolates cookies on `env-<id>.localhost`.
 */
export interface EnvironmentHandlePort {
  readonly id: string;
  vars(): Readonly<Record<string, string>>;
}

export type CasRetention = "diagnostic" | "evidence";

/**
 * Local stand-in for `CasBlobStore` (Task 028).
 * Artifacts are stored as `diagnostic` and promoted to `evidence` only when the run passes.
 */
export interface CasBlobStorePort {
  put(
    bytes: Uint8Array,
    meta: { readonly retention: CasRetention; readonly label: string },
  ): Promise<string>;
  promote(digest: string, retention: "evidence"): Promise<void>;
}

/** Local stand-in for `HintLadderController.processHiddenFailure` (Task 065). */
export interface HintLadderPort {
  processHiddenFailure(failure: HiddenCheckFailure): void | Promise<void>;
}

/** Subset of Task 060 `RunSignals` this adapter is allowed to set. */
export interface UiRunSignals {
  readonly contractMismatch?: boolean;
  readonly visibleControlMissing?: boolean;
  readonly plainMessage?: string;
}

/**
 * Local stand-in for Task 060 `SurfaceCheckResult`.
 * `observed` never includes hidden expected rows.
 */
export interface SurfaceCheckResult {
  readonly checkId: string;
  readonly observed: unknown;
  readonly hasObserved: boolean;
  readonly reporterStatus: "pass" | "fail" | "skip" | "error" | null;
  readonly signals: UiRunSignals | null;
  readonly trace: Uint8Array;
  readonly log: Uint8Array;
}

export interface SurfaceCheckInput {
  readonly checkId: string;
  readonly surface?: string;
  readonly input?: unknown;
}

export interface SurfaceCollectInput {
  readonly env: EnvironmentHandlePort;
  readonly checks: readonly SurfaceCheckInput[];
}

/**
 * Local stand-in for Task 060 `SurfaceVerifierAdapter`.
 * Register this object with `CleanVerifierRunner.registerSurfaceVerifier` after that branch lands.
 */
export interface SurfaceVerifierAdapter {
  readonly id: string;
  supports(check: SurfaceCheckInput): boolean;
  collect(input: SurfaceCollectInput): Promise<readonly SurfaceCheckResult[]>;
}

export interface PwCookie {
  readonly name: string;
  readonly value: string;
  readonly url: string;
}

export interface PwRoute {
  fulfill(response: {
    readonly status?: number;
    readonly body?: string;
    readonly contentType?: string;
  }): Promise<void>;
  continue(): Promise<void>;
}

export interface PwConsoleMessage {
  type(): string;
  text(): string;
}

export interface PwLocator {
  count(): Promise<number>;
  nth(index: number): PwLocator;
  click(options?: { readonly timeout?: number }): Promise<void>;
  fill(value: string, options?: { readonly timeout?: number }): Promise<void>;
  selectOption(value: string): Promise<readonly string[]>;
  ariaSnapshot(): Promise<string>;
  focus(): Promise<void>;
  getByRole(role: string, options?: { readonly name?: string | RegExp; readonly exact?: boolean }): PwLocator;
  getByLabel(text: string | RegExp): PwLocator;
  getByText(text: string | RegExp): PwLocator;
  getByTestId(testId: string): PwLocator;
}

export interface PwPage {
  goto(
    url: string,
    options?: { readonly waitUntil?: "load" | "domcontentloaded" | "networkidle"; readonly timeout?: number },
  ): Promise<{ status(): number } | null>;
  route(url: string, handler: (route: PwRoute) => Promise<void>): Promise<void>;
  on(event: "pageerror", handler: (error: Error) => void): void;
  on(event: "console", handler: (message: PwConsoleMessage) => void): void;
  keyboard: { press(key: string): Promise<void> };
  screenshot(options?: { readonly type?: "png" }): Promise<Uint8Array>;
  ariaSnapshot(): Promise<string>;
  getByRole(role: string, options?: { readonly name?: string | RegExp; readonly exact?: boolean }): PwLocator;
  getByLabel(text: string | RegExp): PwLocator;
  getByText(text: string | RegExp): PwLocator;
  getByTestId(testId: string): PwLocator;
  evaluate<T>(pageFunction: () => T): Promise<T>;
}

export interface PwTracing {
  start(options: { readonly screenshots?: boolean; readonly snapshots?: boolean }): Promise<void>;
  stop(options?: { readonly path?: string }): Promise<void>;
}

export interface PwBrowserContext {
  tracing: PwTracing;
  newPage(): Promise<PwPage>;
  addCookies(cookies: readonly PwCookie[]): Promise<void>;
  close(): Promise<void>;
}

export interface PwBrowser {
  newContext(options?: { readonly locale?: string }): Promise<PwBrowserContext>;
  close(): Promise<void>;
}

export interface PwBrowserType {
  launch(options?: { readonly headless?: boolean; readonly args?: readonly string[] }): Promise<PwBrowser>;
}

/** Structural subset of the root `playwright` package. */
export interface PlaywrightModule {
  chromium: PwBrowserType;
}
