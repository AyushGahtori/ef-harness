import {
  BACKEND_SHARED_FILES,
  UI_SHARED_FILES,
  isSeamId,
  seamName,
} from "./constants.js";
import { LeafScopeOverlapError, LeafSharedFileViolationError } from "./errors.js";
import type {
  AggregatedWiringTask,
  IntegratorWiringNeed,
  LeafCommitInput,
  PlannedMount,
  SeamBinding,
  SeamId,
  WiringRepair,
} from "./types.js";

const UI_KINDS = new Set(["page", "component", "nav"]);

function normalize(scope: string): string {
  return scope.replaceAll("\\", "/");
}

export function scopeCovers(scope: string, file: string): boolean {
  const pattern = normalize(scope);
  const target = normalize(file);
  if (pattern === target) return true;
  if (pattern.endsWith("/**")) {
    const prefix = pattern.slice(0, -3);
    return target === prefix || target.startsWith(`${prefix}/`);
  }
  if (pattern.endsWith("/*")) {
    const prefix = pattern.slice(0, -2);
    const rest = target.startsWith(`${prefix}/`) ? target.slice(prefix.length + 1) : "";
    return rest.length > 0 && !rest.includes("/");
  }
  return false;
}

function isApiPath(path: string): boolean {
  return path.startsWith("/api/") || path === "/api";
}

export function isUiNeed(need: IntegratorWiringNeed): boolean {
  if (need.kind === "route" && isApiPath(need.path)) return false;
  if (need.kind === "api") return false;
  return UI_KINDS.has(need.kind) || need.kind === "route";
}

function quote(value: string): string {
  return JSON.stringify(value);
}

function sortedNeeds(needs: readonly IntegratorWiringNeed[]): IntegratorWiringNeed[] {
  return [...needs].sort((left, right) => {
    const task = left.taskId.localeCompare(right.taskId);
    if (task !== 0) return task;
    const kind = left.kind.localeCompare(right.kind);
    if (kind !== 0) return kind;
    return left.path.localeCompare(right.path);
  });
}

function assertLeafBoundaries(leaves: readonly LeafCommitInput[]): void {
  const shared = [...UI_SHARED_FILES, ...BACKEND_SHARED_FILES];
  for (const leaf of leaves) {
    for (const scope of leaf.writeScope) {
      for (const file of shared) {
        if (scopeCovers(scope, file)) {
          throw new LeafSharedFileViolationError(leaf.taskId, file);
        }
      }
    }
  }
  for (let leftIndex = 0; leftIndex < leaves.length; leftIndex += 1) {
    const left = leaves[leftIndex];
    if (!left) continue;
    for (let rightIndex = leftIndex + 1; rightIndex < leaves.length; rightIndex += 1) {
      const right = leaves[rightIndex];
      if (!right) continue;
      for (const scope of left.writeScope) {
        for (const other of right.writeScope) {
          if (scopeCovers(scope, other.replace("/**", "/marker")) || scopeCovers(other, scope.replace("/**", "/marker")) || normalize(scope) === normalize(other)) {
            throw new LeafScopeOverlapError(left.taskId, right.taskId, scope);
          }
        }
      }
    }
  }
}

function seamBindings(needs: readonly IntegratorWiringNeed[], touchesUi: boolean): SeamBinding[] {
  const taskIds = [...new Set(needs.map((need) => need.taskId))].sort();
  const bindings: SeamBinding[] = [];
  const add = (id: SeamId): void => {
    if (bindings.some((binding) => binding.templateId === id)) return;
    bindings.push({ templateId: id, name: seamName(id), taskIds });
  };
  for (const need of needs) {
    if (need.seamId && isSeamId(need.seamId)) add(need.seamId);
  }
  const hasApi = needs.some((need) => need.kind === "api" || (need.kind === "route" && isApiPath(need.path)));
  const hasPage = needs.some((need) => isUiNeed(need));
  const hasQueue = needs.some((need) => need.kind === "queue" || need.kind === "event");
  const hasCron = needs.some((need) => need.kind === "cron");
  const hasMail = needs.some((need) => need.effects?.mailSubject);
  const hasMigration = needs.some((need) => need.kind === "migration");
  if (hasPage && hasApi) add("S-02");
  if (hasMigration) add("S-03");
  if (hasQueue) add("S-04");
  if (hasMail) add("S-06");
  if (hasCron) add("S-07");
  if (!touchesUi && hasQueue) add("S-04");
  return bindings.sort((left, right) => left.templateId.localeCompare(right.templateId));
}

function mountsFor(needs: readonly IntegratorWiringNeed[]): PlannedMount[] {
  const mounts: PlannedMount[] = [];
  for (const need of needs) {
    if (need.kind !== "route" && need.kind !== "api" && need.kind !== "page") continue;
    if (!need.path.startsWith("/")) continue;
    mounts.push({
      method: need.method,
      path: need.path,
      taskId: need.taskId,
      effects: need.effects,
    });
  }
  return mounts;
}

function renderFiles(featureId: string, needs: readonly IntegratorWiringNeed[], touchesUi: boolean): { path: string; text: string }[] {
  const files: { path: string; text: string }[] = [];
  const pages = needs.filter((need) => isUiNeed(need) && (need.kind === "route" || need.kind === "page" || need.kind === "component" || need.kind === "nav"));
  const apis = needs.filter((need) => need.kind === "api" || (need.kind === "route" && isApiPath(need.path)));
  const queues = needs.filter((need) => need.kind === "queue" || (!touchesUi && need.kind === "event"));
  const events = needs.filter((need) => need.kind === "event" && touchesUi);
  const crons = needs.filter((need) => need.kind === "cron");
  const health = needs.filter((need) => need.kind === "health");
  const components = needs.filter((need) => need.component && (need.kind === "component" || need.kind === "page" || need.kind === "route" || need.kind === "di" || need.kind === "export"));

  if (touchesUi || apis.length > 0) {
    const routeEntries = [...pages.filter((need) => need.kind !== "component" && need.kind !== "nav"), ...apis]
      .filter((need) => need.path.startsWith("/"))
      .map((need) => `  { path: ${quote(need.path)}, component: ${quote(need.component ?? need.taskId)}, task: ${quote(need.taskId)} },`);
    files.push({
      path: "src/routes.ts",
      text: `export const routes = [\n${routeEntries.join("\n")}\n] as const;\n`,
    });
    const apiPaths = apis.map((need) => quote(need.path));
    files.push({
      path: "src/openapi.ts",
      text: `export const featureId = ${quote(featureId)};\nexport const paths = [${apiPaths.join(", ")}] as const;\n`,
    });
    const tokens = components
      .filter((need) => need.component)
      .map((need) => `  { token: ${quote(need.component ?? need.taskId)}, task: ${quote(need.taskId)} },`);
    files.push({
      path: "src/di-container.ts",
      text: `export const container = [\n${tokens.join("\n")}\n] as const;\n`,
    });
  }
  if (touchesUi) {
    const navItems = pages
      .filter((need) => need.path.startsWith("/") && !isApiPath(need.path))
      .map((need) => `  { href: ${quote(need.path)}, label: ${quote(need.component ?? need.taskId)} },`);
    files.push({
      path: "src/nav.ts",
      text: `export const nav = [\n${navItems.join("\n")}\n] as const;\n`,
    });
    files.push({
      path: "src/app.tsx",
      text: [
        'import { routes } from "./routes.js";',
        'import { nav } from "./nav.js";',
        "",
        "export function App(): string {",
        "  const paths = routes.map((route) => route.path).join(\",\");",
        "  const links = nav.map((item) => item.href).join(\",\");",
        "  return `${paths}|${links}`;",
        "}",
        "",
      ].join("\n"),
    });
    if (events.length > 0) {
      const rows = events.map((need) => `  { event: ${quote(need.path)}, task: ${quote(need.taskId)} },`);
      files.push({
        path: "src/subscriptions.ts",
        text: `export const subscriptions = [\n${rows.join("\n")}\n] as const;\n`,
      });
    }
  }
  if (queues.length > 0) {
    const rows = queues.map((need) => quote(need.path));
    files.push({
      path: "src/queue-consumers.ts",
      text: `export const queueConsumers = [${rows.join(", ")}] as const;\n`,
    });
  }
  if (crons.length > 0) {
    const rows = crons.map((need) => `  { id: ${quote(need.taskId)}, expr: ${quote(need.path)} },`);
    files.push({
      path: "src/cron.ts",
      text: `export const cronSchedules = [\n${rows.join("\n")}\n] as const;\n`,
    });
  }
  if (health.length > 0) {
    const rows = health.map((need) => quote(need.path));
    files.push({
      path: "src/health.ts",
      text: `export const healthMetrics = [${rows.join(", ")}] as const;\n`,
    });
  }
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

function assemble(featureId: string, leaves: readonly LeafCommitInput[], needs: readonly IntegratorWiringNeed[]): AggregatedWiringTask {
  const ordered = sortedNeeds(needs);
  const touchesUi = ordered.some((need) => isUiNeed(need));
  const files = renderFiles(featureId, ordered, touchesUi);
  if (!touchesUi) {
    for (const file of files) {
      if (file.path === "src/app.tsx" || file.path === "src/nav.ts") {
        throw new LeafSharedFileViolationError(featureId, file.path);
      }
    }
  }
  return {
    id: `wiring-${featureId}`,
    featureId,
    leafTaskIds: leaves.map((leaf) => leaf.taskId),
    files,
    writeScope: files.map((file) => file.path),
    seamBindings: seamBindings(ordered, touchesUi),
    mounts: mountsFor(ordered),
    touchesUi,
    needs: ordered,
  };
}

export class AggregatedWiringTaskBuilder {
  build(featureId: string, leaves: readonly LeafCommitInput[]): AggregatedWiringTask {
    assertLeafBoundaries(leaves);
    const needs = leaves.flatMap((leaf) => leaf.wiringNeeds);
    return assemble(featureId, leaves, needs);
  }

  repair(task: AggregatedWiringTask, repair: WiringRepair, leaves: readonly LeafCommitInput[]): AggregatedWiringTask {
    const needs = task.needs.map((need) =>
      need.path === repair.fromPath ? { ...need, path: repair.toPath } : need,
    );
    return assemble(task.featureId, leaves, needs);
  }
}
