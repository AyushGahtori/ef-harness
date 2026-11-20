import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PlaywrightDocRenderer, shouldBlockBrowserRequest } from "../../src/doc-fetcher/index.js";
import { listen } from "./http-fixture.js";

describe("headless renderer", () => {
  it("blocks third-party and tracker requests and keeps a cookieless ephemeral context", async () => {
    const blocked: string[] = [];
    const allowed: string[] = [];
    let cookies = 0;
    let timeout = 0;
    let launchArgs: readonly string[] = [];
    let serviceWorkers = "";
    let proxyServer = "";
    const renderer = new PlaywrightDocRenderer(async () => ({
      chromium: {
        async launch(options: { headless: boolean; args: readonly string[] }) {
          expect(options.headless).toBe(true);
          launchArgs = options.args;
          return {
            async newContext(context: { serviceWorkers?: string; proxy?: { server: string } }) {
              serviceWorkers = context.serviceWorkers ?? "";
              proxyServer = context.proxy?.server ?? "";
              expect("storageState" in context).toBe(false);
              return {
                async clearCookies() {
                  cookies += 1;
                  return undefined;
                },
                async route(
                  _pattern: string,
                  handler: (route: {
                    request(): { url(): string };
                    abort(): Promise<void>;
                    continue(): Promise<void>;
                  }) => Promise<void>,
                ) {
                  await handler(routeFor("https://docs.example.com/app.js", allowed, blocked));
                  await handler(routeFor("https://cdn.example/tracker.js", allowed, blocked));
                  await handler(routeFor("https://www.google-analytics.com/collect", allowed, blocked));
                  return undefined;
                },
                async newPage() {
                  return {
                    setDefaultTimeout(timeoutMs: number) {
                      timeout = timeoutMs;
                    },
                    async goto() {
                      return null;
                    },
                    async content() {
                      return "<html><body><h1>Rendered Marker</h1></body></html>";
                    },
                    url() {
                      return "https://docs.example.com/final";
                    },
                  };
                },
                async close() {
                  return undefined;
                },
              };
            },
            async close() {
              return undefined;
            },
          };
        },
      },
    }));
    const rendered = await renderer.render({
      url: "https://docs.example.com/docs",
      timeoutMs: 10_000,
      userAgent: "ef-harness-doc-fetcher/1",
      proxyServer: "http://127.0.0.1:9",
    });
    expect(rendered.html).toContain("Rendered Marker");
    expect(rendered.finalUrl).toBe("https://docs.example.com/final");
    expect(cookies).toBe(1);
    expect(timeout).toBe(10_000);
    expect(serviceWorkers).toBe("block");
    expect(proxyServer).toBe("http://127.0.0.1:9");
    expect(launchArgs).not.toContain("--no-sandbox");
    expect(allowed).toEqual(["https://docs.example.com/app.js"]);
    expect(blocked).toEqual([
      "https://cdn.example/tracker.js",
      "https://www.google-analytics.com/collect",
    ]);
    expect(shouldBlockBrowserRequest("docs.example.com", "https://docs.example.com/app.js")).toBe(false);
    expect(shouldBlockBrowserRequest("docs.example.com", "https://evil.example/x")).toBe(true);
  });
});

function routeFor(url: string, allowed: string[], blocked: string[]) {
  return {
    request() {
      return { url: () => url };
    },
    async abort() {
      blocked.push(url);
      return undefined;
    },
    async continue() {
      allowed.push(url);
      return undefined;
    },
  };
}

const liveBrowser = await chromiumInstalled();

(liveBrowser ? it : it.skip)("renders a local page when Chromium is already installed", async () => {
  const fixture = await listen((_req, res) => {
    res.setHeader("content-type", "text/html");
    res.end(
      `<!doctype html><html><body><div id="app">Loading...</div><script>document.getElementById("app").textContent = "Rendered Marker From Chromium";</script></body></html>`,
    );
  });
  try {
    const renderer = new PlaywrightDocRenderer();
    const rendered = await renderer.render({
      url: `http://127.0.0.1:${fixture.port}/`,
      timeoutMs: 15_000,
      userAgent: "ef-harness-doc-fetcher/1",
    });
    expect(rendered.html).toContain("Rendered Marker From Chromium");
  } finally {
    await fixture.close();
  }
}, 20_000);

async function chromiumInstalled(): Promise<boolean> {
  try {
    const importer = new Function("specifier", "return import(specifier);") as (
      specifier: string,
    ) => Promise<{ chromium?: { executablePath?: () => string } }>;
    const loaded = await importer("playwright");
    const executable = loaded.chromium?.executablePath?.();
    return typeof executable === "string" && executable.length > 0 && existsSync(executable);
  } catch {
    return false;
  }
}
