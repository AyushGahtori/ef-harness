export const PROJECT_FOLDER_MOVED = "Project folder moved — Locate folder";

export const LOCKFILE_INCLUDE_PROMPT = "You updated dependencies while away — Include in integration base?";

export const LOCKFILE_RESUME_PROMPT = "Include new dependency in harness/integration before resuming?";

export const STALE_CONTEXT_REMINDER =
  "You've been away more than 7 days. Verify any expired OAuth tokens or upstream origin/main pulls before resuming.";

export function branchDriftPrompt(liveBranch: string, recordedBranch: string): string {
  return `Your repo is now on '${liveBranch}' — Sync harness base or keep building against '${recordedBranch}'?`;
}

export function interruptedMessage(count: number): string {
  const noun = count === 1 ? "task was" : "tasks were";
  return `${count} ${noun} interrupted by an unexpected shutdown — checkpoints recovered cleanly`;
}

export function allowanceResetBanner(label: string): string {
  if (label.toLowerCase().includes("chatgpt")) return "ChatGPT allowance has reset!";
  return `${label} allowance has reset!`;
}

export function allowanceResumeLine(label: string, remaining: number): string {
  const noun = remaining === 1 ? "task" : "tasks";
  return `${label} allowance has reset — Ready to resume ${remaining} remaining ${noun}`;
}

export function combinedCommitOffer(subject: string, taskId: string, questionId: string): string {
  return `Looks like your commit '${subject}' already resolved Task ${taskId} & Question ${questionId} — Mark verified or Keep open?`;
}

export function taskOnlyOffer(subject: string, taskId: string, questionId: string | null): string {
  if (questionId) return combinedCommitOffer(subject, taskId, questionId);
  return `Looks like your commit '${subject}' already resolved Task ${taskId} — Mark verified or Keep open?`;
}

export function verifyCommitOffer(taskId: string): string {
  return `Verify your commit against ${taskId}'s checks & mark done?`;
}

export function looksAnsweredOffer(shortSha: string): string {
  return `Looks answered by your commit ${shortSha} · Confirm`;
}

export function questionRecap(input: {
  readonly decisionContext: string;
  readonly neededByTaskId: string | null;
  readonly sinceLabel: string | null;
  readonly file: string | null;
  readonly effectHint: string | null;
}): string {
  const because = input.neededByTaskId ? `, because ${input.neededByTaskId} needs it` : "";
  if (!input.file) {
    return `You were deciding ${input.decisionContext}${because}.`;
  }
  const since = input.sinceLabel ?? "you were away";
  const effect = input.effectHint ? `, which now ${input.effectHint}` : "";
  return `You were deciding ${input.decisionContext}${because}. Since ${since} you committed a change to \`${input.file}\`${effect}. Is that the answer?`;
}

export function retiredQuestionNote(questionId: string, prompt: string): string {
  return `Question ${questionId} is older than a week and is no longer relevant. Retired with a note: ${prompt}`;
}

export function wakeHoldNote(sleepMs: number, offline: boolean): string {
  const duration = formatCompact(sleepMs);
  if (offline) return `Paused while laptop slept (${duration}) · Offline — Resume when back online`;
  return `Paused while laptop slept (${duration}) — review before resume`;
}

function formatCompact(ms: number): string {
  const hour = 60 * 60 * 1000;
  if (ms >= hour && ms % hour < 60 * 1000) return `${Math.round(ms / hour)}h`;
  if (ms >= hour) {
    const hours = Math.floor(ms / hour);
    const minutes = Math.round((ms - hours * hour) / (60 * 1000));
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  const minutes = Math.max(1, Math.round(ms / (60 * 1000)));
  return `${minutes}m`;
}
