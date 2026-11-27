import { VIEWPORTS, type ViewportWidth } from "./constants.js";
import { makeFinding } from "./text.js";
import type {
  AuditCheck,
  CliCommandSpec,
  CommandExecutor,
  CommandObservation,
  ConfirmedFinding,
  LayerBReport,
  OpenApiOperation,
  PageInspection,
  PageMetrics,
  PlaywrightSession,
  PlaywrightSessionFactory,
  ProjectKind,
  RouteObservation,
  UiPlaywrightContractVerifierPort,
  WebRoute,
} from "./types.js";

const AXE_IMPACT = new Set(["serious", "critical", "moderate", "minor"]);

function decode(value: string): string {
  return value
    .replaceAll("&quot;", '"')
    .replaceAll("&#10;", "\n")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function attr(tag: string, name: string): string | null {
  const match = new RegExp(`${name}="([^"]*)"`, "i").exec(tag);
  return match?.[1] ?? null;
}

function tags(body: string, name: string): string[] {
  const pattern = new RegExp(`<${name}\\b[^>]*>`, "gi");
  return [...body.matchAll(pattern)].map((match) => match[0]);
}

function blocks(body: string, type: string): string[] {
  const pattern = new RegExp(`<script\\s+type="${type}">([\\s\\S]*?)</script>`, "gi");
  return [...body.matchAll(pattern)].map((match) => decode(match[1] ?? "").trim()).filter((item) => item.length > 0);
}

export function probeDocument(input: {
  readonly status: number;
  readonly url: string;
  readonly body: string;
  readonly viewport: ViewportWidth;
  readonly imageStatus: (src: string) => number;
}): PageMetrics & { readonly status: number } {
  const httpErrors: { url: string; status: number }[] = [];
  if (input.status >= 400) httpErrors.push({ url: input.url, status: input.status });
  const fetchCalls = [...input.body.matchAll(/fetch\(\s*["']([^"']+)["']\s*\)/g)];
  for (const call of fetchCalls) {
    const src = call[1];
    if (!src) continue;
    const status = input.imageStatus(src);
    if (status >= 400) httpErrors.push({ url: src, status });
  }
  const brokenImages: string[] = [];
  const axe: { id: string; impact: "serious" | "critical" | "moderate" | "minor" }[] = [];
  for (const image of tags(input.body, "img")) {
    const src = attr(image, "src") ?? "";
    const widthRaw = attr(image, "data-natural-width");
    const fetched = src.length > 0 ? input.imageStatus(src) : 404;
    const naturalWidth = widthRaw === null ? (fetched >= 400 ? 0 : 1) : Number(widthRaw);
    if (!Number.isFinite(naturalWidth) || naturalWidth === 0) brokenImages.push(src || "(missing src)");
    const alt = attr(image, "alt");
    if (alt === null || alt.trim().length === 0) {
      axe.push({ id: "image-alt", impact: "serious" });
    }
  }
  for (const raw of [...input.body.matchAll(/data-axe="([^"]*)"/g)].map((match) => match[1] ?? "")) {
    for (const piece of raw.split("|")) {
      const [impact, id] = piece.split(":");
      if (!impact || !id || !AXE_IMPACT.has(impact)) continue;
      axe.push({ id, impact: impact as PageMetrics["axeViolations"][number]["impact"] });
    }
  }
  const overflowMax = /data-overflow-max-width="(\d+)"/.exec(input.body);
  const forced = /data-overflow="1"/.test(input.body);
  const horizontalOverflow =
    forced || (overflowMax?.[1] !== undefined && input.viewport <= Number(overflowMax[1]));
  return {
    status: input.status,
    consoleErrors: blocks(input.body, "ef-console-error"),
    unhandledRejections: blocks(input.body, "ef-unhandled-rejection"),
    brokenImages,
    horizontalOverflow,
    axeViolations: axe,
    httpErrors,
  };
}

function referencedAssets(body: string): string[] {
  const found = new Set<string>();
  for (const image of tags(body, "img")) {
    const src = attr(image, "src");
    if (src) found.add(src);
  }
  for (const call of body.matchAll(/fetch\(\s*["']([^"']+)["']\s*\)/g)) {
    const src = call[1];
    if (src) found.add(src);
  }
  return [...found];
}

class HttpPlaywrightSession implements PlaywrightSession {
  private viewport: ViewportWidth = 1440;
  private last: { status: number; body: string; url: string } | null = null;
  private readonly statuses = new Map<string, number>();

  constructor(private readonly resolveStatus: (url: string) => Promise<{ status: number; body: string; contentType: string }>) {}

  async setViewportSize(size: { readonly width: number; readonly height: number }): Promise<void> {
    if (size.width !== 375 && size.width !== 1440) {
      throw new Error(`unsupported viewport ${size.width}`);
    }
    this.viewport = size.width;
  }

  async goto(url: string): Promise<{ readonly status: number; readonly body: string; readonly contentType: string; readonly url: string }> {
    const loaded = await this.resolveStatus(url);
    this.last = { status: loaded.status, body: loaded.body, url };
    this.statuses.set(url, loaded.status);
    return { ...loaded, url };
  }

  async evaluate(): Promise<PageMetrics> {
    if (!this.last) throw new Error("goto is required before evaluate");
    const current = this.last;
    for (const src of referencedAssets(current.body)) {
      if (src.startsWith("data:")) {
        this.statuses.set(src, 200);
        continue;
      }
      const absolute = new URL(src, current.url).toString();
      const loaded = await this.resolveStatus(absolute);
      this.statuses.set(src, loaded.status);
      this.statuses.set(absolute, loaded.status);
    }
    return probeDocument({
      status: current.status,
      url: current.url,
      body: current.body,
      viewport: this.viewport,
      imageStatus: (src) => this.statuses.get(src) ?? this.statuses.get(new URL(src, current.url).toString()) ?? 404,
    });
  }

  async close(): Promise<void> {
    this.last = null;
  }
}

async function fetchText(url: string): Promise<{ status: number; body: string; contentType: string }> {
  const response = await fetch(url);
  const body = await response.text();
  return { status: response.status, body, contentType: response.headers.get("content-type") ?? "" };
}

export function createHttpPlaywrightSessionFactory(): PlaywrightSessionFactory {
  return {
    async open() {
      return new HttpPlaywrightSession(fetchText);
    },
  };
}

export function createHttpPlaywrightVerifier(): UiPlaywrightContractVerifierPort {
  return {
    async inspect({ url, viewport }) {
      const session = await createHttpPlaywrightSessionFactory().open();
      try {
        await session.setViewportSize({ width: viewport.width, height: viewport.height });
        const loaded = await session.goto(url);
        const metrics = await session.evaluate();
        const inspection: PageInspection = {
          url: loaded.url,
          status: loaded.status,
          viewport: viewport.width,
          httpErrors: metrics.httpErrors,
          consoleErrors: metrics.consoleErrors,
          unhandledRejections: metrics.unhandledRejections,
          brokenImages: metrics.brokenImages,
          horizontalOverflow: metrics.horizontalOverflow,
          axeViolations: metrics.axeViolations,
        };
        return inspection;
      } finally {
        await session.close();
      }
    },
  };
}

function observationFindings(observation: RouteObservation, fixCostUnits: bigint): ConfirmedFinding[] {
  const findings: ConfirmedFinding[] = [];
  const where = `${observation.route} @ ${observation.viewport}px`;
  for (const error of observation.httpErrors) {
    findings.push(
      makeFinding({
        code: "route-http",
        kind: "layer_b",
        severity: "high",
        detail: `${where} HTTP ${error.status} ${error.url}${observation.consoleErrors[0] ? `\n${observation.consoleErrors[0]}` : ""}`,
        fixCostUnits,
      }),
    );
  }
  for (const message of observation.consoleErrors) {
    if (observation.httpErrors.length > 0) continue;
    findings.push(
      makeFinding({
        code: "console-error",
        kind: "layer_b",
        severity: "high",
        detail: `${where} console error\n${message}`,
        fixCostUnits,
      }),
    );
  }
  for (const message of observation.unhandledRejections) {
    findings.push(
      makeFinding({
        code: "unhandled-rejection",
        kind: "layer_b",
        severity: "high",
        detail: `${where} unhandled rejection\n${message}`,
        fixCostUnits,
      }),
    );
  }
  for (const image of observation.brokenImages) {
    findings.push(
      makeFinding({
        code: "broken-image",
        kind: "layer_b",
        severity: "high",
        detail: `${where} broken image ${image} (naturalWidth === 0)`,
        fixCostUnits,
      }),
    );
  }
  if (observation.horizontalOverflow) {
    findings.push(
      makeFinding({
        code: "horizontal-overflow",
        kind: "layer_b",
        severity: "medium",
        detail: `${where} horizontal scroll overflow`,
        fixCostUnits,
      }),
    );
  }
  for (const violation of observation.axeViolations) {
    if (violation.impact !== "serious" && violation.impact !== "critical") continue;
    findings.push(
      makeFinding({
        code: "axe",
        kind: "layer_b",
        severity: "high",
        detail: `${where} axe ${violation.impact} ${violation.id}`,
        fixCostUnits,
      }),
    );
  }
  return findings;
}

function stdoutIsPureJson(stdout: string): boolean {
  const trimmed = stdout.trim();
  if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) return false;
  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    return false;
  }
}

export interface CrawlRequest {
  readonly kind: ProjectKind;
  readonly routes: readonly WebRoute[];
  readonly commands: readonly CliCommandSpec[];
  readonly operations: readonly OpenApiOperation[];
  readonly boot: { boot: () => Promise<{ baseUrl: string | null; pid: number; stop: () => Promise<void>; alive: () => boolean }> };
  readonly browser: UiPlaywrightContractVerifierPort;
  readonly commandsExec: CommandExecutor;
  readonly fixCostUnits: bigint;
  readonly onCheck?: (check: AuditCheck) => void;
  readonly skipCheckIds?: ReadonlySet<string>;
}

function checkOf(id: string, findings: readonly ConfirmedFinding[]): AuditCheck {
  return { id, passed: findings.length === 0, llmTokens: 0, findings };
}

export class LiveRouteCrawler {
  async crawl(request: CrawlRequest): Promise<LayerBReport> {
    const app = await request.boot.boot();
    const findings: ConfirmedFinding[] = [];
    const checks: AuditCheck[] = [];
    const routes: RouteObservation[] = [];
    const commands: CommandObservation[] = [];
    try {
      if (request.kind === "web") {
        for (const route of request.routes) {
          for (const viewport of VIEWPORTS) {
            const checkId = `B:route:${route.path}@${viewport}`;
            if (request.skipCheckIds?.has(checkId)) continue;
            const url = new URL(route.path, app.baseUrl ?? "http://127.0.0.1").toString();
            const inspection = await request.browser.inspect({
              url,
              viewport: { width: viewport, height: viewport === 375 ? 812 : 900 },
            });
            const observation: RouteObservation = { ...inspection, route: route.path, viewport };
            routes.push(observation);
            const routeFindings = observationFindings(observation, request.fixCostUnits);
            findings.push(...routeFindings);
            const routeCheck = checkOf(checkId, routeFindings);
            checks.push(routeCheck);
            request.onCheck?.(routeCheck);
          }
        }
      } else if (request.kind === "cli") {
        for (const command of request.commands) {
          const checkId = `B:cli:${command.argv.join(" ")}`;
          if (request.skipCheckIds?.has(checkId)) continue;
          const result = await request.commandsExec.exec(command.argv);
          const pure = command.json ? stdoutIsPureJson(result.stdout) : true;
          const passed = result.exitCode === 0 && pure;
          const detail = passed
            ? `${command.argv.join(" ")} ok`
            : `${command.argv.join(" ")} exit ${result.exitCode}${command.json && !pure ? " stdout was not pure JSON" : ""}`;
          commands.push({ argv: command.argv, exitCode: result.exitCode, stdoutPure: pure, passed, detail });
          const commandFindings = passed
            ? []
            : [
                makeFinding({
                  code: "cli-smoke",
                  kind: "layer_b",
                  severity: "high",
                  detail,
                  fixCostUnits: request.fixCostUnits,
                }),
              ];
          findings.push(...commandFindings);
          const commandCheck = checkOf(checkId, commandFindings);
          checks.push(commandCheck);
          request.onCheck?.(commandCheck);
        }
      } else {
        for (const operation of request.operations) {
          const checkId = `B:openapi:${operation.method} ${operation.path}`;
          if (request.skipCheckIds?.has(checkId)) continue;
          const url = new URL(operation.path, app.baseUrl ?? "http://127.0.0.1").toString();
          const response = await fetch(url, { method: operation.method });
          await response.arrayBuffer();
          const ok = response.status >= 200 && response.status < 400;
          const operationFindings = ok
            ? []
            : [
                makeFinding({
                  code: "openapi-smoke",
                  kind: "layer_b",
                  severity: "high",
                  detail: `${operation.method} ${operation.path} returned ${response.status}`,
                  fixCostUnits: request.fixCostUnits,
                }),
              ];
          findings.push(...operationFindings);
          const operationCheck = checkOf(checkId, operationFindings);
          checks.push(operationCheck);
          request.onCheck?.(operationCheck);
        }
      }
    } finally {
      await app.stop();
    }
    const leaked = app.alive() ? [app.pid] : [];
    const leakFindings = leaked.map((pid) =>
      makeFinding({
        code: "leaked-process",
        kind: "layer_b",
        severity: "critical",
        detail: `Leaked process ${pid} after teardown`,
        fixCostUnits: request.fixCostUnits,
      }),
    );
    findings.push(...leakFindings);
    const teardown = checkOf("B:teardown", leakFindings);
    checks.push(teardown);
    request.onCheck?.(teardown);
    return {
      llmTokens: 0,
      passed: findings.length === 0,
      kind: request.kind,
      checks,
      findings,
      routes,
      commands,
      leakedPids: leaked,
    };
  }
}
