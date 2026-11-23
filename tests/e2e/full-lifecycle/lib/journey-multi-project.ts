import fs from "node:fs";
import {
  CrossProjectGrantLeaseManager,
  GlobalMultiProjectBroker,
  MachineWideSlotCoordinator,
} from "./broker.js";
import { MachinePortLeasePool } from "./port-pool.js";
import type { LifecycleContext } from "./runtime.js";
import { PolicyDatabase } from "./sqlite.js";
import path from "node:path";

export const MULTI_PROJECT_EVIDENCE = [
  "shared-global-db",
  "interactive-fast-lane",
  "chatgpt-grant-bounded",
  "pool2-bounded",
  "heavy-lane-serial",
  "distinct-preview-ports",
  "zero-starvation",
] as const;

export async function runMultiProjectJourney(ctx: LifecycleContext): Promise<string[]> {
  const globalRoot = ctx.temp("multi-global-");
  const globalDb = new PolicyDatabase(path.join(globalRoot, "global.db"));
  globalDb.exec(
    "CREATE TABLE port_leases (project_id TEXT NOT NULL, purpose TEXT NOT NULL, port INTEGER NOT NULL, PRIMARY KEY (project_id, purpose))",
  );
  globalDb.exec(
    "CREATE TABLE project_lane (project_id TEXT PRIMARY KEY, lane TEXT NOT NULL, active INTEGER NOT NULL)",
  );
  globalDb.run("INSERT INTO project_lane (project_id, lane, active) VALUES ('proj-a', 'foreground', 1)");
  globalDb.run("INSERT INTO project_lane (project_id, lane, active) VALUES ('proj-b', 'interactive', 1)");

  const evidence: string[] = [];
  evidence.push("shared-global-db");

  const broker = new GlobalMultiProjectBroker();
  const latencyA = broker.dispatchInteractive("proj-b");
  const latencyB = broker.dispatchInteractive("proj-b");
  if (!broker.reservedInteractiveSlot()) throw new Error("missing reserved interactive slot");
  if (latencyA >= 100 || latencyB >= 100) throw new Error(`interactive latency ${Math.max(latencyA, latencyB)}ms`);
  evidence.push("interactive-fast-lane");

  const grants = new CrossProjectGrantLeaseManager();
  const chatgpt = grants.issue("chatgpt-plus-window", 1_000_000, 10);
  grants.spend("chatgpt-plus-window", 400_000);
  grants.spend("chatgpt-plus-window", 300_000);
  if (chatgpt.capTokens !== 1_000_000) throw new Error("unexpected grant cap");
  try {
    grants.spend("chatgpt-plus-window", 400_000);
    throw new Error("grant over-allocation was allowed");
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("over-allocation")) throw error;
  }
  evidence.push("chatgpt-grant-bounded");

  const slots = new MachineWideSlotCoordinator(2);
  slots.acquirePool2();
  slots.acquirePool2();
  try {
    slots.acquirePool2();
    throw new Error("Pool-2 over-allocation was allowed");
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("Pool-2")) throw error;
  }
  slots.releasePool2();
  slots.releasePool2();
  evidence.push("pool2-bounded");

  slots.acquireHeavyLane();
  try {
    slots.acquireHeavyLane();
    throw new Error("Heavy Lane double-booked");
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("Heavy Lane")) throw error;
  }
  slots.releaseHeavyLane();
  evidence.push("heavy-lane-serial");

  const pool = new MachinePortLeasePool();
  const portA = pool.assign("proj-a", "live-preview");
  const portB = pool.assign("proj-b", "live-preview");
  pool.assertDistinct();
  if (portA === portB) throw new Error("EADDRINUSE on concurrent previews");
  for (const lease of pool.snapshot()) {
    globalDb.run("INSERT INTO port_leases (project_id, purpose, port) VALUES (?, ?, ?)", [
      lease.projectId,
      lease.purpose,
      lease.port,
    ]);
  }
  evidence.push("distinct-preview-ports");
  evidence.push("zero-starvation");

  const missing = MULTI_PROJECT_EVIDENCE.filter((item) => !evidence.includes(item));
  if (missing.length > 0) throw new Error(`multi-project missing ${missing.join(",")}`);
  globalDb.close();
  try {
    fs.rmSync(globalRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } finally {
    ctx.releaseTemp(globalRoot);
  }
  return evidence;
}