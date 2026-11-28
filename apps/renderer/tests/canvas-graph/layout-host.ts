import { createRequire } from "node:module";
import { Worker } from "node:worker_threads";
import { configureLayoutThreadHost, type LayoutThread } from "../../src/canvas/graph/elk-incremental-layout-engine.js";

const WORKER_SOURCE = `
const { parentPort, workerData, threadId } = require("node:worker_threads");
const imported = require(workerData.elkEntry);
const ELK = imported.default || imported;
const elk = new ELK();
parentPort.postMessage({ kind: "ready", threadId });
parentPort.on("message", async (msg) => {
  if (!msg || msg.cmd === "stop") {
    try { elk.terminateWorker(); } catch (error) { void error; }
    return;
  }
  try {
    const laid = await elk.layout(msg.graph);
    const children = (laid.children || []).map((child) => ({ id: child.id, x: child.x || 0, y: child.y || 0 }));
    parentPort.postMessage({ id: msg.id, ok: true, threadId, children });
  } catch (error) {
    parentPort.postMessage({
      id: msg.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});
`;

export function installNodeLayoutHost(): void {
  const elkEntry = createRequire(import.meta.url).resolve("elkjs");
  configureLayoutThreadHost({
    script: WORKER_SOURCE,
    elkEntry,
    spawn(script, entry): LayoutThread {
      return new Worker(script, { eval: true, workerData: { elkEntry: entry }, execArgv: [] });
    },
  });
}
