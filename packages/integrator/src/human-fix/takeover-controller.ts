import { HUMAN_ENTRY_CARD, HUMAN_ENTRY_CHAT, HUMAN_ENTRY_COMMIT, HUMAN_OWNED } from "./constants.js";
import { HumanFixError, TaskNotFoundError } from "./errors.js";
import type { HumanFixStateDb } from "./state-db.js";
import { canEnterHumanOwned, transitionToHumanOwned } from "./states.js";
import type { TakeoverRequest, TakeoverResult } from "./types.js";

const CHAT_PATTERNS = [
  /^I fixed task\s+([A-Za-z0-9_-]+)\s+myself\.?$/i,
  /^Let me handle\s+(.+)$/i,
];

export class HumanFixTakeoverController {
  constructor(private readonly state: HumanFixStateDb) {}

  enter(request: TakeoverRequest): TakeoverResult {
    const task = this.state.getTask(request.taskId);
    if (!task) throw new TaskNotFoundError(request.taskId);
    if (task.state !== HUMAN_OWNED) {
      transitionToHumanOwned(task.state);
    }
    const haltedPid = task.activeWorkerPid;
    this.state.enterHumanOwned(request.taskId, haltedPid);
    const refreshed = this.state.requireTask(request.taskId);
    const paused = refreshed.downstreamTaskIds.filter((id) => this.state.getTask(id)?.state === "PARKED");
    return {
      taskId: request.taskId,
      state: HUMAN_OWNED,
      haltedWorkerPid: haltedPid,
      pausedDownstreamTaskIds: paused,
      entry: request.entry,
    };
  }

  fromCard(taskId: string): TakeoverResult {
    return this.enter({ taskId, entry: HUMAN_ENTRY_CARD });
  }

  fromChat(text: string): TakeoverResult {
    const normalized = text.trim();
    for (const pattern of CHAT_PATTERNS) {
      const match = pattern.exec(normalized);
      if (!match) continue;
      const token = match[1]?.trim();
      if (!token) continue;
      const taskId = this.resolveTaskToken(token);
      return this.enter({ taskId, entry: HUMAN_ENTRY_CHAT, hint: normalized });
    }
    throw new HumanFixError("chat_unrecognized", `could not route chat text: ${text}`);
  }

  fromCommitDetection(taskId: string, commitSha: string): TakeoverResult {
    return this.enter({ taskId, entry: HUMAN_ENTRY_COMMIT, commitSha });
  }

  private resolveTaskToken(token: string): string {
    const direct = this.state.getTask(token);
    if (direct) return direct.taskId;
    const upper = token.toUpperCase().replace(/^T-?/, "T-");
    const alt = this.state.getTask(upper);
    if (alt) return alt.taskId;
    throw new TaskNotFoundError(token);
  }
}

export function taskCanBeHumanOwned(state: string): boolean {
  return canEnterHumanOwned(state as never);
}