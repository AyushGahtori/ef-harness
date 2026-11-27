import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";

import { createHttpPlaywrightVerifier, LiveRouteCrawler } from "../../src/final-audit/live-route-crawler.js";
import type { BootedApp } from "../../src/final-audit/types.js";

const crawler = new LiveRouteCrawler();

function listen(handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server = createServer(handler);
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("missing port"));
        return;
      }
      resolve({
        baseUrl: `http://127.0.0.1:${address.port}`,
      close: () =>
        new Promise((done, fail) => {
          server.closeAllConnections();
          server.close((error) => (error ? fail(error) : done()));
        }),
      });
    });
  });
}

function page(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, { "content-type": "text/html; charset=utf-8" });
  res.end(body);
}

describe("layer B live route and CLI crawl", () => {
  it("crawls every route at 375 and 1440 and catches the unmounted /print 404 with zero model tokens", async () => {
    const seen: string[] = [];
    const server = await listen((req, res) => {
      const path = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
      seen.push(path);
      if (path === "/orders") {
        page(res, 200, "<html><body><img src=\"/assets/logo.png\" alt=\"logo\" data-natural-width=\"16\" /><script>fetch(\"/api/orders\")</script></body></html>");
        return;
      }
      if (path === "/print") {
        page(res, 404, "<html><body><script type=\"ef-console-error\">Error: route /print is not mounted&#10;    at Router.mount</script></body></html>");
        return;
      }
      if (path === "/gallery") {
        page(res, 200, "<html><body data-overflow-max-width=\"400\"><img src=\"/assets/missing.png\" /><script type=\"ef-unhandled-rejection\">unhandled rejection in gallery</script></body></html>");
        return;
      }
      if (path === "/api/orders" || path === "/assets/logo.png") {
        res.writeHead(200, { "content-type": "text/plain" });
        res.end("ok");
        return;
      }
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("missing");
    });
    const alive = new Set<number>();
    try {
      const report = await crawler.crawl({
        kind: "web",
        routes: [{ path: "/orders" }, { path: "/print" }, { path: "/gallery" }],
        commands: [],
        operations: [],
        fixCostUnits: 1n,
        browser: createHttpPlaywrightVerifier(),
        commandsExec: { async exec() { return { exitCode: 0, stdout: "", stderr: "" }; } },
        boot: {
          async boot(): Promise<BootedApp> {
            const pid = 50;
            alive.add(pid);
            return {
              baseUrl: server.baseUrl,
              pid,
              alive: () => alive.has(pid),
              async stop() {
                alive.delete(pid);
              },
            };
          },
        },
      });
      expect(report.llmTokens).toBe(0);
      expect(report.leakedPids).toEqual([]);
      expect(alive.size).toBe(0);
      const widths = new Set(report.routes.map((route) => route.viewport));
      expect(widths).toEqual(new Set([375, 1440]));
      expect(report.routes).toHaveLength(6);
      const print = report.findings.filter((finding) => finding.detail.includes("/print"));
      expect(print.length).toBeGreaterThan(0);
      expect(print.some((finding) => finding.detail.includes("404") && finding.detail.includes("Router.mount"))).toBe(true);
      expect(report.findings.some((finding) => finding.detail.includes("/gallery") && finding.detail.includes("375px") && finding.code === "horizontal-overflow")).toBe(true);
      expect(report.findings.some((finding) => finding.detail.includes("/gallery") && finding.detail.includes("1440px") && finding.code === "horizontal-overflow")).toBe(false);
      expect(report.findings.some((finding) => finding.code === "broken-image" && finding.detail.includes("missing.png"))).toBe(true);
      expect(report.findings.some((finding) => finding.code === "axe" && finding.detail.includes("image-alt"))).toBe(true);
      expect(report.findings.some((finding) => finding.code === "unhandled-rejection")).toBe(true);
      expect(report.findings.some((finding) => finding.detail.includes("/orders @"))).toBe(false);
    } finally {
      await server.close();
    }
  });

  it("reports a leaked process when teardown leaves the boot pid alive", async () => {
    const server = await listen((_req, res) => {
      page(res, 200, "<html><body><p>ok</p></body></html>");
    });
    try {
      const report = await crawler.crawl({
        kind: "web",
        routes: [{ path: "/" }],
        commands: [],
        operations: [],
        fixCostUnits: 1n,
        browser: createHttpPlaywrightVerifier(),
        commandsExec: { async exec() { return { exitCode: 0, stdout: "", stderr: "" }; } },
        boot: {
          async boot() {
            return {
              baseUrl: server.baseUrl,
              pid: 4242,
              alive: () => true,
              async stop() {
                return undefined;
              },
            };
          },
        },
      });
      expect(report.leakedPids).toEqual([4242]);
      expect(report.findings.some((finding) => finding.code === "leaked-process")).toBe(true);
      expect(report.passed).toBe(false);
    } finally {
      await server.close();
    }
  });

  it("runs a CLI help and --json purity sweep when the project has no web UI", async () => {
    const report = await crawler.crawl({
      kind: "cli",
      routes: [],
      commands: [
        { argv: ["meal", "--help"], json: false },
        { argv: ["meal", "report", "--json"], json: true },
        { argv: ["meal", "bad", "--json"], json: true },
      ],
      operations: [],
      fixCostUnits: 1n,
      browser: createHttpPlaywrightVerifier(),
      boot: {
        async boot() {
          return { baseUrl: null, pid: 7, alive: () => false, async stop() { return undefined; } };
        },
      },
      commandsExec: {
        async exec(argv) {
          if (argv.includes("--help")) return { exitCode: 0, stdout: "usage\n", stderr: "" };
          if (argv.includes("bad")) return { exitCode: 0, stdout: "log line\n{\"ok\":true}", stderr: "" };
          return { exitCode: 0, stdout: "{\"ok\":true}\n", stderr: "" };
        },
      },
    });
    expect(report.llmTokens).toBe(0);
    expect(report.commands.map((command) => command.passed)).toEqual([true, true, false]);
    expect(report.findings.some((finding) => finding.detail.includes("stdout was not pure JSON"))).toBe(true);
  });

  it("smoke-checks OpenAPI routes against the booted local server", async () => {
    const server = await listen((req, res) => {
      const path = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
      if (path === "/health") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end("{\"ok\":true}");
        return;
      }
      res.writeHead(500, { "content-type": "application/json" });
      res.end("{\"ok\":false}");
    });
    try {
      const report = await crawler.crawl({
        kind: "openapi",
        routes: [],
        commands: [],
        operations: [
          { method: "GET", path: "/health" },
          { method: "GET", path: "/orders" },
        ],
        fixCostUnits: 1n,
        browser: createHttpPlaywrightVerifier(),
        commandsExec: { async exec() { return { exitCode: 0, stdout: "", stderr: "" }; } },
        boot: {
          async boot() {
            return {
              baseUrl: server.baseUrl,
              pid: 9,
              alive: () => false,
              async stop() {
                return undefined;
              },
            };
          },
        },
      });
      expect(report.findings.map((finding) => finding.detail)).toEqual(["GET /orders returned 500"]);
      expect(report.checks.find((check) => check.id === "B:openapi:GET /health")?.passed).toBe(true);
    } finally {
      await server.close();
    }
  });
});
