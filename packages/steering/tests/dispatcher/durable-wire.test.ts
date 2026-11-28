import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SpecialistStateDb } from "@ef-harness/planner";
import { landedAskOwner } from "../../src/dispatcher/ask-owner-port.js";
import { createFourRouteSteeringDispatcher } from "../../src/dispatcher/index.js";
import { USER_PAUSED_REASON } from "../../src/dispatcher/types.js";
import { DispatcherClausePort } from "../../src/router/dispatcher-port.js";
import { openSteeringRouter, type RouterModelPort, type RouterPrompt } from "../../src/router/index.js";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("steering durable wire", () => {
  it("writes canonical user_pause holds and keeps router@1 targets", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ef-steering-"));
    dirs.push(dir);
    const stateDbPath = join(dir, "state.db");
    const telemetryDbPath = join(dir, "telemetry.db");
    const askDb = SpecialistStateDb.memory();
    const assembly = createFourRouteSteeringDispatcher({
      stateDbPath,
      telemetryDbPath,
      askOwner: landedAskOwner(askDb),
      workers: [
        { id: "W-1", featureId: "F-Orders", taskId: "T-Orders", checkpointRef: "ckpt" },
      ],
      tasks: [{ taskId: "T-Orders", featureId: "F-Orders", title: "Orders" }],
      features: [{ featureId: "F-Orders", title: "Orders" }],
    });
    const paused = assembly.stopController.pauseFeature("F-Orders", "m1");
    expect(paused.holdsAdded).toEqual(["T-Orders"]);
    const db = new DatabaseSync(stateDbPath);
    const hold = db.prepare("SELECT reason FROM task_holds WHERE task = 'T-Orders'").get() as
      | { reason?: string }
      | undefined;
    expect(hold?.reason).toBe(USER_PAUSED_REASON);
    expect(USER_PAUSED_REASON).toBe("user_pause");
    const control = db.prepare("SELECT value FROM meta WHERE key = 'steering.control_state'").get() as
      | { value?: string }
      | undefined;
    expect(control?.value).toBe("RUNNING");
    db.close();

    const answer = await assembly.dispatcher.dispatchReadOnlyQuery({
      msgSeq: "q1",
      text: "Where is the missing kitchen fact?",
    });
    expect(answer.route).toBe(1);
    expect(answer.receipt.detail.answer?.length).toBeGreaterThan(0);

    const routerDb = join(dir, "router.db");
    const model: RouterModelPort = {
      usesProvider: true,
      complete(prompt: RouterPrompt): unknown {
        const target = prompt.allowedTargetIds.includes("F-Kitchen") ? "F-Kitchen" : prompt.allowedTargetIds[0];
        return {
          clauses: [
            {
              span: { start: 0, end: prompt.messageText.length },
              intent: "change",
              target_id: target,
              confidence: 0.91,
              needs_clarification: false,
            },
          ],
        };
      },
    };
    const router = openSteeringRouter({
      stateDbPath: routerDb,
      model,
      dispatch: new DispatcherClausePort(assembly.dispatcher),
    });
    router.catalog?.upsert({
      id: "F-Kitchen",
      kind: "feature",
      title: "Kitchen",
      text: "cutoff for the kitchen list",
      status: "active",
    });
    const receipt = await router.submit({
      messageId: "steer-1",
      origin: "chat_composer",
      text: "Change the cutoff to 10:30",
    });
    expect(receipt.status).toBe("DONE");
    expect(receipt.clauses[0]?.targetCandidateIds).toEqual(["F-Kitchen"]);
    router.close();
    askDb.close();
  });
});
