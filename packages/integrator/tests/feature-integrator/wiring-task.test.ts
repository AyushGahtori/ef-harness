import { describe, expect, it } from "vitest";
import { UI_SHARED_FILES, AggregatedWiringTaskBuilder } from "../../src/feature-integrator/index.js";
import type { LeafCommitInput } from "../../src/feature-integrator/index.js";
import { wiringNeed } from "./git-fixture.js";

function leaf(taskId: string, scope: string, needs: LeafCommitInput["wiringNeeds"]): LeafCommitInput {
  return {
    taskId,
    sha: "0".repeat(40),
    objective: `${taskId} objective`,
    requirementIds: [`R-${taskId}`],
    checkIds: [`AC-${taskId}`],
    writeScope: [scope],
    wiringNeeds: needs,
  };
}

describe("AggregatedWiringTaskBuilder", () => {
  it("emits one wiring task for five disjoint leaves and owns the shared registration files", () => {
    const builder = new AggregatedWiringTaskBuilder();
    const task = builder.build("F-Shop", [
      leaf("T-1", "src/features/menu/**", [wiringNeed({ kind: "route", path: "/menu", taskId: "T-1", component: "MenuPage" })]),
      leaf("T-2", "src/features/orders/**", [wiringNeed({ kind: "route", path: "/orders", taskId: "T-2", component: "OrdersPage" })]),
      leaf("T-3", "src/features/checkout/**", [wiringNeed({ kind: "component", path: "/checkout", taskId: "T-3", component: "Checkout" })]),
      leaf("T-4", "src/features/nav-copy/**", [wiringNeed({ kind: "nav", path: "/account", taskId: "T-4", component: "Account" })]),
      leaf("T-5", "src/features/api/**", [wiringNeed({ kind: "api", path: "/api/menu", taskId: "T-5", component: "MenuApi" })]),
    ]);
    expect(task.id).toBe("wiring-F-Shop");
    expect(task.leafTaskIds).toEqual(["T-1", "T-2", "T-3", "T-4", "T-5"]);
    for (const file of UI_SHARED_FILES) {
      expect(task.writeScope).toContain(file);
    }
    expect(task.writeScope.some((file) => file.startsWith("src/features/"))).toBe(false);
    expect(task.files.find((file) => file.path === "src/routes.ts")?.text).toContain("/menu");
    expect(task.files.find((file) => file.path === "src/routes.ts")?.text).toContain("/api/menu");
    expect(task.files.find((file) => file.path === "src/nav.ts")?.text).toContain("/menu");
    expect(task.files.find((file) => file.path === "src/nav.ts")?.text).not.toContain("/api/menu");
    expect(task.seamBindings.map((binding) => binding.templateId)).toContain("S-02");
    expect(task.mounts.map((mount) => mount.path).sort()).toEqual(["/api/menu", "/menu", "/orders"]);
  });

  it("wires only queue, cron, and health files when the feature has zero UI routes", () => {
    const builder = new AggregatedWiringTaskBuilder();
    const task = builder.build("F-Cutoff", [
      leaf("T-Queue", "src/worker/queue/**", [wiringNeed({ kind: "queue", path: "orders.placed", taskId: "T-Queue" })]),
      leaf("T-Cron", "src/worker/cron/**", [wiringNeed({ kind: "cron", path: "*/5 * * * *", taskId: "T-Cron" })]),
      leaf("T-Health", "src/worker/health/**", [wiringNeed({ kind: "health", path: "queue.lag", taskId: "T-Health" })]),
    ]);
    expect(task.touchesUi).toBe(false);
    expect(task.writeScope).toEqual(["src/cron.ts", "src/health.ts", "src/queue-consumers.ts"]);
    for (const file of UI_SHARED_FILES) {
      expect(task.writeScope).not.toContain(file);
    }
    expect(task.files.find((file) => file.path === "src/queue-consumers.ts")?.text).toContain("orders.placed");
    expect(task.files.find((file) => file.path === "src/cron.ts")?.text).toContain("*/5 * * * *");
    expect(task.files.find((file) => file.path === "src/health.ts")?.text).toContain("queue.lag");
    expect(task.seamBindings.map((binding) => binding.templateId)).toEqual(["S-04", "S-07"]);
  });
});
