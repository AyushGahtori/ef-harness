import { JsRendererUnavailableError } from "./errors.js";

export interface RenderedDocument {
  readonly html: string;
  readonly finalUrl: string;
}

export interface HeadlessRenderRequest {
  readonly url: string;
  readonly timeoutMs: number;
  readonly userAgent: string;
  readonly proxyServer?: string;
}

export interface HeadlessDocRenderer {
  render(request: HeadlessRenderRequest): Promise<RenderedDocument>;
}

const TRACKER_SUFFIXES = [
  "google-analytics.com",
  "googletagmanager.com",
  "doubleclick.net",
  "googleadservices.com",
  "facebook.net",
  "facebook.com",
  "scorecardresearch.com",
  "hotjar.com",
  "segment.io",
  "segment.com",
  "sentry.io",
  "mixpanel.com",
  "newrelic.com",
  "nr-data.net",
  "fullstory.com",
  "clarity.ms",
];

export function shouldBlockBrowserRequest(pageHost: string, requestUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(requestUrl);
  } catch {
    return true;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return true;
  const host = url.hostname.toLowerCase();
  if (isTrackerHost(host)) return true;
  const page = pageHost.toLowerCase();
  return host !== page && !host.endsWith(`.${page}`);
}

function isTrackerHost(hostname: string): boolean {
  return TRACKER_SUFFIXES.some((suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`));
}

interface BrowserRoute {
  request(): { url(): string };
  abort(): Promise<void>;
  continue(): Promise<void>;
}

interface BrowserPage {
  setDefaultTimeout(timeoutMs: number): void;
  goto(url: string, options: { timeout: number; waitUntil: "domcontentloaded" }): Promise<unknown>;
  content(): Promise<string>;
  url(): string;
}

interface BrowserContext {
  clearCookies(): Promise<void>;
  route(pattern: string, handler: (route: BrowserRoute) => Promise<void>): Promise<void>;
  newPage(): Promise<BrowserPage>;
  close(): Promise<void>;
}

interface Browser {
  newContext(options: {
    javaScriptEnabled: boolean;
    serviceWorkers: "block";
    userAgent: string;
    acceptDownloads: boolean;
    bypassCSP: boolean;
    proxy?: { server: string };
  }): Promise<BrowserContext>;
  close(): Promise<void>;
}

interface PlaywrightModule {
  chromium: {
    launch(options: { headless: boolean; args: readonly string[] }): Promise<Browser>;
  };
}

export class PlaywrightDocRenderer implements HeadlessDocRenderer {
  constructor(private readonly loadPlaywright: () => Promise<PlaywrightModule> = loadPlaywrightModule) {}

  async render(request: HeadlessRenderRequest): Promise<RenderedDocument> {
    const playwright = await this.loadPlaywright();
    const browser = await playwright.chromium.launch({
      headless: true,
      args: ["--disable-sync", "--no-first-run", "--disable-extensions", "--disable-background-networking"],
    });
    try {
      const context = await browser.newContext({
        javaScriptEnabled: true,
        serviceWorkers: "block",
        userAgent: request.userAgent,
        acceptDownloads: false,
        bypassCSP: false,
        ...(request.proxyServer ? { proxy: { server: request.proxyServer } } : {}),
      });
      try {
        await context.clearCookies();
        const pageHost = new URL(request.url).hostname;
        await context.route("**/*", async (route) => {
          if (shouldBlockBrowserRequest(pageHost, route.request().url())) {
            await route.abort();
            return;
          }
          await route.continue();
        });
        const page = await context.newPage();
        page.setDefaultTimeout(request.timeoutMs);
        await page.goto(request.url, { timeout: request.timeoutMs, waitUntil: "domcontentloaded" });
        const html = await page.content();
        const finalUrl = page.url();
        return { html, finalUrl: finalUrl || request.url };
      } finally {
        await context.close();
      }
    } finally {
      await browser.close();
    }
  }
}

async function loadPlaywrightModule(): Promise<PlaywrightModule> {
  const importer = new Function("specifier", "return import(specifier);") as (
    specifier: string,
  ) => Promise<unknown>;
  try {
    const loaded = await importer("playwright");
    if (!isPlaywrightModule(loaded)) {
      throw new JsRendererUnavailableError("playwright did not expose chromium");
    }
    return loaded;
  } catch (error) {
    if (error instanceof JsRendererUnavailableError) throw error;
    throw new JsRendererUnavailableError("playwright is not installed", { cause: error });
  }
}

function isPlaywrightModule(value: unknown): value is PlaywrightModule {
  if (!value || typeof value !== "object" || !("chromium" in value)) return false;
  const chromium = value.chromium;
  return typeof chromium === "object" && chromium !== null && "launch" in chromium && typeof chromium.launch === "function";
}
