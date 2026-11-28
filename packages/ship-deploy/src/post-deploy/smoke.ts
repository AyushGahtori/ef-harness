import vm from "node:vm";
import { SmokeCheckFailedError, type SmokeFailure } from "./errors.js";
import {
  SMOKE_VIEWPORTS,
  assertSmokeRequestAllowed,
  fetchReadOnly,
  readOnlyRequest,
  hasDataEfSource,
  isHtml,
  isLiveSideEffectHost,
  joinUrl,
  pageTitle,
  shellMounted,
} from "./http.js";
import { sha256 } from "./redactor.js";
import type {
  AssetKind,
  CasBlobStore,
  DeployedSmokeReceipt,
  FailedAsset,
  PacketSecurityRedactor,
  ReadOnlyPage,
  SmokeCheckInput,
  SmokeNetworkHop,
  SmokeRouteResult,
  UiPlaywrightContractVerifier,
  Viewport,
} from "./types.js";

const PROTECTED_STATUSES = new Set([301, 302, 303, 307, 308, 401, 403]);
const MAX_ASSETS = 40;

export function createHttpLoopbackPlaywrightProbe(options?: {
  readonly fetchImpl?: typeof fetch;
}): UiPlaywrightContractVerifier {
  return {
    async open(input) {
      if (input.readOnly !== true) {
        throw new Error("Deployed smoke sessions must be read-only");
      }
      return new HttpReadOnlyPage(input.baseUrl, input.viewport, options?.fetchImpl);
    },
  };
}

class HttpReadOnlyPage implements ReadOnlyPage {
  private readonly errors: string[] = [];
  private readonly assets: FailedAsset[] = [];
  private readonly images: string[] = [];
  private readonly hops: SmokeNetworkHop[] = [];
  private readonly skipped: string[] = [];
  private lastHtml = "";
  private closed = false;

  constructor(
    private readonly baseUrl: string,
    readonly viewport: Viewport,
    private readonly fetchImpl: typeof fetch | undefined,
  ) {}

  async goto(
    path: string,
    options?: { readonly redirect?: "follow" | "manual" },
  ): Promise<{ readonly status: number; readonly contentType: string; readonly body: string }> {
    this.assertOpen();
    const url = joinUrl(this.baseUrl, path);
    assertSmokeRequestAllowed("GET", url);
    const response = await fetchReadOnly(
      url,
      readOnlyRequest(options?.redirect ?? "follow", this.fetchImpl),
    );
    this.hops.push({ method: "GET", url });
    if (isHtml(response.contentType, response.body)) {
      this.lastHtml = response.body;
      collectInlineScriptErrors(response.body, this.errors);
      for (const message of headerConsoleErrors(response.headers)) this.errors.push(message);
      await this.collectAssets(response.body, url);
    }
    return {
      status: response.status,
      contentType: response.contentType,
      body: response.body,
    };
  }

  consoleErrors(): readonly string[] {
    return [...this.errors];
  }

  failedAssets(): readonly FailedAsset[] {
    return [...this.assets];
  }

  brokenImages(): readonly string[] {
    return [...this.images];
  }

  networkLog(): readonly SmokeNetworkHop[] {
    return [...this.hops];
  }

  skippedSideEffectUrls(): readonly string[] {
    return [...this.skipped];
  }

  screenshot(): Uint8Array {
    const text = `viewport=${this.viewport.width}x${this.viewport.height}\n${this.lastHtml.slice(0, 4_000)}`;
    return new TextEncoder().encode(text);
  }

  async close(): Promise<void> {
    this.closed = true;
  }

  private assertOpen(): void {
    if (this.closed) throw new Error("Read-only page is already closed");
  }

  private async collectAssets(html: string, documentUrl: string): Promise<void> {
    const found: { readonly url: string; readonly kind: AssetKind }[] = [];
    for (const tag of tags(html, "script")) {
      const src = attribute(tag, "src");
      if (src) found.push({ url: resolveAsset(documentUrl, src), kind: "script" });
    }
    for (const tag of tags(html, "link")) {
      const rel = attribute(tag, "rel") ?? "";
      const href = attribute(tag, "href");
      if (href && /stylesheet/i.test(rel)) {
        found.push({ url: resolveAsset(documentUrl, href), kind: "stylesheet" });
      }
    }
    for (const tag of tags(html, "img")) {
      const src = attribute(tag, "src");
      if (src) found.push({ url: resolveAsset(documentUrl, src), kind: "image" });
    }
    const seen = new Set<string>();
    for (const asset of found) {
      if (seen.has(asset.url) || seen.size >= MAX_ASSETS) continue;
      seen.add(asset.url);
      if (asset.url.startsWith("data:")) continue;
      let parsed: URL;
      try {
        parsed = new URL(asset.url);
      } catch (error) {
        if (error instanceof Error) continue;
        continue;
      }
      if (isLiveSideEffectHost(parsed.hostname)) {
        this.skipped.push(asset.url);
        continue;
      }
      const response = await fetchReadOnly(asset.url, readOnlyRequest("manual", this.fetchImpl));
      this.hops.push({ method: "GET", url: asset.url });
      if (response.status >= 400) {
        this.assets.push({ url: asset.url, status: response.status, kind: asset.kind });
        if (asset.kind === "image") this.images.push(asset.url);
      } else if (asset.kind === "stylesheet") {
        await this.collectFontUrls(response.body, asset.url, seen);
      }
    }
  }

  private async collectFontUrls(css: string, cssUrl: string, seen: Set<string>): Promise<void> {
    const matcher = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi;
    for (const match of css.matchAll(matcher)) {
      const raw = match[2];
      if (!raw || raw.startsWith("data:") || seen.size >= MAX_ASSETS) continue;
      const url = resolveAsset(cssUrl, raw);
      if (seen.has(url)) continue;
      seen.add(url);
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch (error) {
        if (error instanceof Error) continue;
        continue;
      }
      if (isLiveSideEffectHost(parsed.hostname)) {
        this.skipped.push(url);
        continue;
      }
      const response = await fetchReadOnly(url, readOnlyRequest("manual", this.fetchImpl));
      this.hops.push({ method: "GET", url });
      if (response.status >= 400) {
        this.assets.push({ url, status: response.status, kind: "font" });
      }
    }
  }
}

export async function runDeployedSmoke(
  input: SmokeCheckInput,
  deps: {
    readonly playwright: UiPlaywrightContractVerifier;
    readonly redactor: PacketSecurityRedactor;
    readonly cas: CasBlobStore;
  },
): Promise<DeployedSmokeReceipt> {
  const viewports = input.viewports ?? [...SMOKE_VIEWPORTS];
  const publicRoutes = input.publicRoutes ?? ["/", "/api/health"];
  const protectedRoutes = input.protectedRoutes ?? [];
  const routes: SmokeRouteResult[] = [];
  const failures: SmokeFailure[] = [];
  const consoleErrors: string[] = [];
  const failedAssets: FailedAsset[] = [];
  const brokenImages: string[] = [];
  const network: SmokeNetworkHop[] = [];
  const skipped: string[] = [];
  const shots: string[] = [];

  for (const route of [...publicRoutes, ...protectedRoutes]) {
    assertSmokeRequestAllowed("GET", joinUrl(input.liveUrl, route));
  }

  for (const viewport of viewports) {
    const page = await deps.playwright.open({
      baseUrl: input.liveUrl,
      viewport,
      readOnly: true,
    });
    try {
      for (const route of publicRoutes) {
        const loaded = await page.goto(route, { redirect: "follow" });
        const title = isHtml(loaded.contentType, loaded.body) ? pageTitle(loaded.body) : "";
        const shell = isHtml(loaded.contentType, loaded.body) ? shellMounted(loaded.body) : true;
        routes.push({
          path: route,
          status: loaded.status,
          viewportWidth: viewport.width,
          title,
          shellMounted: shell,
        });
        if (loaded.status >= 400) {
          failures.push({
            code: "http-status",
            detail: `${route} at ${viewport.width}px returned HTTP ${loaded.status}`,
          });
        }
        if (isHtml(loaded.contentType, loaded.body)) {
          if (!title) {
            failures.push({
              code: "missing-title",
              detail: `${route} at ${viewport.width}px is missing a title`,
            });
          }
          if (!shell) {
            failures.push({
              code: "missing-shell",
              detail: `${route} at ${viewport.width}px did not mount an app shell`,
            });
          }
          if (input.env === "production" && hasDataEfSource(loaded.body)) {
            failures.push({
              code: "dev-artifact",
              detail: `${route} production HTML contains data-ef-source`,
            });
          }
        }
        shots.push(new TextDecoder().decode(page.screenshot()));
      }
      if (viewport.width === viewports[0]?.width) {
        for (const route of protectedRoutes) {
          const loaded = await page.goto(route, { redirect: "manual" });
          routes.push({
            path: route,
            status: loaded.status,
            viewportWidth: viewport.width,
            title: "",
            shellMounted: false,
          });
          if (!PROTECTED_STATUSES.has(loaded.status)) {
            failures.push({
              code: "protected-route-unlocked",
              detail: `${route} returned HTTP ${loaded.status}; protected routes must stay locked (302/401)`,
            });
          }
        }
      }
      consoleErrors.push(...page.consoleErrors());
      failedAssets.push(...page.failedAssets());
      brokenImages.push(...page.brokenImages());
      network.push(...page.networkLog());
      skipped.push(...page.skippedSideEffectUrls());
    } finally {
      await page.close();
    }
  }

  for (const error of consoleErrors) {
    failures.push({ code: "console-error", detail: error });
  }
  for (const asset of failedAssets) {
    failures.push({
      code: asset.kind === "image" ? "broken-image" : "failed-asset",
      detail: `${asset.kind} ${asset.url} returned HTTP ${asset.status}`,
    });
  }

  const redactedExcerpt = deps.redactor.redact(shots.join("\n").slice(0, 8_000));
  const screenshot = await deps.cas.put({ kind: "screenshot", text: redactedExcerpt });
  const screenshotSha256 = screenshot.hash;

  if (failures.length > 0) {
    throw new SmokeCheckFailedError({
      failures,
      consoleErrors,
      failedAssets,
      brokenImages,
      network,
      screenshotSha256,
      redactedExcerpt,
    });
  }

  const receiptSha256 = sha256(
    JSON.stringify({
      routes: routes.map((route) => ({
        path: route.path,
        status: route.status,
        viewportWidth: route.viewportWidth,
      })),
      consoleErrorCount: 0,
      failedAssetCount: 0,
      brokenImageCount: 0,
    }),
  );
  await deps.cas.put({ kind: "trace", text: deps.redactor.redact(receiptSha256) });
  return {
    passed: true,
    viewports,
    routes,
    consoleErrors,
    failedAssets,
    brokenImages,
    network,
    skippedSideEffectUrls: skipped,
    receiptSha256,
    screenshotSha256,
  };
}

function collectInlineScriptErrors(html: string, into: string[]): void {
  const matcher = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(matcher)) {
    const attrs = match[1] ?? "";
    const code = match[2] ?? "";
    if (/type\s*=\s*["'](?:module|application\/json|application\/ld\+json)["']/i.test(attrs)) {
      continue;
    }
    if (/\bsrc\s*=/.test(attrs)) continue;
    if (!code.trim() || code.length > 20_000) continue;
    try {
      vm.runInNewContext(
        code,
        {
          console: {
            error: (...args: unknown[]) => {
              into.push(args.map((item) => String(item)).join(" "));
            },
            log: () => undefined,
            warn: () => undefined,
          },
          document: {
            querySelector: () => null,
            getElementById: () => null,
          },
          fetch: () =>
            Promise.resolve({
              ok: true,
              status: 200,
              json: async () => ({}),
              text: async () => "",
            }),
          setTimeout: () => 0,
          clearTimeout: () => undefined,
        },
        { timeout: 50 },
      );
    } catch (error) {
      const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      into.push(message);
    }
  }
}

function headerConsoleErrors(headers: Headers): readonly string[] {
  const raw = headers.get("x-ef-console-errors");
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is string => typeof item === "string");
  } catch (error) {
    return error instanceof SyntaxError ? [] : [];
  }
}

function tags(html: string, name: string): readonly string[] {
  const matcher = new RegExp(`<${name}\\b[^>]*>`, "gi");
  return [...html.matchAll(matcher)].map((match) => match[0] ?? "");
}

function attribute(tag: string, name: string): string | null {
  const matcher = new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>]+))`, "i");
  const match = matcher.exec(tag);
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? null;
}

function resolveAsset(base: string, raw: string): string {
  if (raw.startsWith("data:")) return raw;
  try {
    return new URL(raw, base).href;
  } catch (error) {
    return error instanceof Error ? raw : raw;
  }
}
