import { CommitAnsweredQuestionDetector } from "./commit-answered-question-detector.js";
import { NoRunUntilResumeGate } from "./no-run-until-resume-gate.js";
import {
  allowanceResetBanner,
  allowanceResumeLine,
  branchDriftPrompt,
  interruptedMessage,
  LOCKFILE_INCLUDE_PROMPT,
  LOCKFILE_RESUME_PROMPT,
  PROJECT_FOLDER_MOVED,
  STALE_CONTEXT_REMINDER,
  wakeHoldNote,
} from "./messages.js";
import { decideLockSafety, type ReconcilePorts } from "./ports.js";
import { formatAwayLabel, parseTime, SEVEN_DAYS_MS } from "./time.js";
import {
  COLD_OPEN_DOMAINS,
  KNOWN_CLI_NAMES,
  type AttemptRecord,
  type CliVersionRecord,
  type ColdOpenInput,
  type ColdOpenReport,
  type ConnectionObservation,
  type DomainFinding,
  type DomainResult,
  type LockDecision,
  type ObservedCommit,
  type ProposedAction,
  type RepoInspection,
  type ReentryGate,
  type ReopenReason,
  type KnownCliName,
  type ShellCloseReason,
  type StateDbSnapshot,
  type WorktreeAuditEntry,
} from "./types.js";

interface AttentionFinding extends DomainFinding {
  readonly attention: boolean;
}

export class ColdOpenReconciler {
  private readonly detector = new CommitAnsweredQuestionDetector();

  constructor(private readonly ports: ReconcilePorts) {}

  reconcile(input: ColdOpenInput): ColdOpenReport {
    const started = Date.now();
    const startTokens = input.ledger.tokens;
    const startCents = input.ledger.cents;
    const startCalls = input.ledger.calls.length;
    const snapshot = input.snapshot;
    const gate = this.resolveGate(input.gate);
    const reopen = mergeReopen(input.reopen, this.ports.shell.closeReason(snapshot));
    const repo = this.ports.git.inspect(snapshot);
    const folderMissing = repo.missing;
    const liveRepo = repo.missing ? null : repo;
    const commits = liveRepo?.commits ?? [];
    const questions = this.ports.questions.listOpen(snapshot.projectId, snapshot);
    const detected = this.detector.detect({
      nowIso: input.nowIso,
      commits,
      failedTasks: snapshot.failedTasks,
      questions,
    });
    const processes = this.ports.processes;
    const pids = processes.liveGitPids();
    const worktrees = folderMissing ? [] : this.ports.worktrees.audit(snapshot.projectId, snapshot.worktrees);
    const lockDecisions = collectLocks(liveRepo, worktrees, pids, processes.reliable);
    const views = folderMissing ? [] : this.ports.views.scan(snapshot.projectRoot);
    const lockfiles = folderMissing
      ? { packageJson: null, pnpmLock: null }
      : this.ports.lockfiles.hash(snapshot.projectRoot);
    const disk = folderMissing
      ? { ok: false, freeBytes: 0, detail: PROJECT_FOLDER_MOVED }
      : this.ports.disk.inspect(snapshot.projectRoot);
    const connections = snapshot.connections.map((item) => this.ports.connections.observe(item, input.nowIso));
    const cliLive = this.ports.clis.current();
    const humanResults = snapshot.humanSteps
      .filter((step) => step.status === "pending" || step.status === "failed")
      .map((step) => ({ step, result: this.ports.humanSteps.reprobe(step) }));

    const orphans = snapshot.attempts.filter(
      (attempt) => attempt.status === "WORKING" && !workingProcessAlive(attempt, processes.isAlive(attempt.pid ?? -1)),
    );
    const integrationLive = liveRepo?.integrationHead ?? null;
    const integrationHeadMatches = !folderMissing && integrationLive === snapshot.expectedIntegrationHead;
    const branchPrompt =
      liveRepo && liveRepo.branch && liveRepo.branch !== snapshot.recordedBranch
        ? branchDriftPrompt(liveRepo.branch, snapshot.recordedBranch)
        : null;
    const lockfileDrift = !folderMissing && hashesDrifted(snapshot.lockHashes, lockfiles);
    const lockfilePrompts = lockfileDrift ? [LOCKFILE_INCLUDE_PROMPT, LOCKFILE_RESUME_PROMPT] : [];
    const allowanceMessages = allowanceLines(snapshot, connections);
    const awayMs = awayMillis(snapshot.lastActiveAt, input.nowIso);
    const staleContextReminder = awayMs !== null && awayMs > SEVEN_DAYS_MS ? STALE_CONTEXT_REMINDER : null;
    const sleepMs = input.sleepMinutes === null ? null : input.sleepMinutes * 60 * 1000;
    const wakeNote =
      input.reopen === "wake" && sleepMs !== null && ((input.sleepMinutes ?? 0) > 30 || input.offline)
        ? wakeHoldNote(sleepMs, input.offline)
        : null;
    const autoVerified = humanResults
      .filter((item) => item.result.status === "verified" && item.step.status !== "verified")
      .map((item) => item.step.id);
    const viewChanges = viewDrift(snapshot.viewHashes, views);
    const cliDrift = diffClis(snapshot.cliVersions, cliLive);
    const actions = propose({
      orphans,
      lockDecisions,
      viewChanges,
      commits,
      lockfileDrift,
      detected,
      branchPrompt,
      folderMissing,
      cliDrift,
      autoVerified,
      worktrees,
    });

    const kernelFindings: AttentionFinding[] = [];
    kernelFindings.push(
      snapshot.walOk
        ? { code: "wal_ok", message: "WAL integrity ok", attention: false }
        : { code: "wal_failed", message: `WAL integrity check failed: ${snapshot.walDetail}`, attention: true },
    );
    if (folderMissing) {
      kernelFindings.push({ code: "folder_missing", message: PROJECT_FOLDER_MOVED, attention: true });
    } else if (integrationHeadMatches) {
      kernelFindings.push({
        code: "integration_head_match",
        message: "harness/integration HEAD matches state.db",
        attention: false,
      });
    } else {
      kernelFindings.push({
        code: "integration_head_mismatch",
        message: `harness/integration HEAD does not match state.db (${snapshot.expectedIntegrationHead} vs ${integrationLive ?? "missing"})`,
        attention: true,
      });
    }
    for (const orphan of orphans) {
      kernelFindings.push({
        code: "orphaned_attempt",
        message: `Attempt ${orphan.id} for ${orphan.taskId} has a dead PID and will return to its checkpoint ${orphan.checkpointRef ?? "none"} with WIP preserved`,
        attention: true,
      });
    }
    for (const attempt of snapshot.attempts) {
      if (attempt.status === "WORKING" && !orphans.some((orphan) => orphan.id === attempt.id)) {
        kernelFindings.push({
          code: "attempt_still_live",
          message: `Attempt ${attempt.id} still has a live process ${attempt.pid ?? "unknown"}`,
          attention: false,
        });
      }
    }
    const interrupted = orphans.length > 0 ? interruptedMessage(orphans.length) : null;
    if (interrupted) kernelFindings.push({ code: "interrupted", message: interrupted, attention: true });

    const worktreeFindings: AttentionFinding[] = [];
    if (folderMissing) {
      worktreeFindings.push({ code: "folder_missing", message: PROJECT_FOLDER_MOVED, attention: true });
    }
    for (const slot of worktrees) {
      if (slot.state === "present") {
        worktreeFindings.push({
          code: "worktree_present",
          message: `Worktree ${slot.slotId} is present`,
          attention: false,
        });
      } else {
        worktreeFindings.push({
          code: `worktree_${slot.state}`,
          message: `Worktree ${slot.slotId} is ${slot.state === "deleted" ? "deleted" : slot.state}`,
          attention: true,
        });
      }
    }
    if (!disk.ok && !folderMissing && disk.freeBytes >= 0) {
      worktreeFindings.push({ code: "low_disk", message: disk.detail, attention: true });
    } else if (!folderMissing) {
      worktreeFindings.push({ code: "disk_ok", message: disk.detail, attention: false });
    }
    for (const lock of lockDecisions) {
      worktreeFindings.push({
        code: lock.safe ? "stale_index_lock" : "live_index_lock",
        message: lock.safe ? `Stale .git/index.lock can be removed safely (${lock.lockPath})` : lock.reason,
        attention: true,
      });
    }
    if (worktreeFindings.length === 0) {
      worktreeFindings.push({ code: "worktrees_checked", message: "Worktrees checked", attention: false });
    }

    const repoFindings: AttentionFinding[] = [];
    if (folderMissing) {
      repoFindings.push({ code: "folder_missing", message: PROJECT_FOLDER_MOVED, attention: true });
    } else if (liveRepo?.readError) {
      repoFindings.push({ code: "repo_unreadable", message: liveRepo.readError, attention: true });
    } else if (liveRepo) {
      repoFindings.push({
        code: "branch_observed",
        message: `Developer checkout is on '${liveRepo.branch}'`,
        attention: false,
      });
      if (branchPrompt) repoFindings.push({ code: "branch_drift", message: branchPrompt, attention: true });
      if (liveRepo.dirtyFiles.length > 0) {
        repoFindings.push({
          code: "dirty_files",
          message: `Uncommitted files: ${liveRepo.dirtyFiles.join(", ")}`,
          attention: true,
        });
      }
      for (const commit of liveRepo.commits) {
        const label = commit.kind === "upstream" ? "Pulled upstream commit" : "New manual commit";
        repoFindings.push({
          code: commit.kind === "upstream" ? "upstream_commit" : "manual_commit",
          message: `${label} ${commit.sha.slice(0, 7)} ${commit.subject}`,
          attention: true,
        });
      }
      if (
        snapshot.recordedOriginMain &&
        liveRepo.originMainHead &&
        liveRepo.originMainHead !== snapshot.recordedOriginMain
      ) {
        repoFindings.push({
          code: "origin_main_moved",
          message: `Upstream origin/main moved while you were away (${snapshot.recordedOriginMain.slice(0, 7)} → ${liveRepo.originMainHead.slice(0, 7)}). Pull before resuming.`,
          attention: true,
        });
      }
    }

    const viewFindings: AttentionFinding[] = viewChanges.map((change) => ({
      code: "offline_view_edit",
      message:
        change.kind === "removed"
          ? `Offline Markdown edit removed: ${change.path}`
          : `Offline Markdown edit: ${change.path}`,
      attention: true,
    }));
    if (viewFindings.length === 0) {
      viewFindings.push({
        code: "views_checked",
        message: "Offline .harness/views/ Markdown checked",
        attention: false,
      });
    }

    const lockFindings: AttentionFinding[] = lockfilePrompts.map((message) => ({
      code: "lockfile_drift",
      message,
      attention: true,
    }));
    if (lockFindings.length === 0) {
      lockFindings.push({ code: "lockfile_checked", message: "Lockfile hashes match the last snapshot", attention: false });
    }

    const connectionFindings: AttentionFinding[] = [];
    for (const message of allowanceMessages) {
      connectionFindings.push({ code: "allowance_reset", message, attention: false });
    }
    for (const observation of connections) {
      const label = labelFor(snapshot, observation.provider);
      if (observation.tokenExpired) {
        connectionFindings.push({
          code: "oauth_expired",
          message: `${label} OAuth token expired — verify the connection before resuming`,
          attention: true,
        });
      } else if (observation.expiresInDays !== null && observation.expiresInDays <= 7) {
        connectionFindings.push({
          code: "oauth_expiring",
          message: `${label} key expires in ${observation.expiresInDays} days`,
          attention: true,
        });
      }
      if (observation.fiveHourReset) {
        connectionFindings.push({
          code: "five_hour_reset",
          message: `${label} 5-hour allowance has reset`,
          attention: false,
        });
      }
    }
    for (const drift of cliDrift) {
      connectionFindings.push({
        code: "cli_version_drift",
        message: `${drift.name} updated from ${drift.fromVersion} to ${drift.toVersion} while you were away — conformance check required`,
        attention: true,
      });
    }
    if (connectionFindings.length === 0) {
      connectionFindings.push({
        code: "connections_checked",
        message: "Provider connections and CLI versions checked",
        attention: false,
      });
    }

    const humanFindings: AttentionFinding[] = [];
    for (const item of humanResults) {
      if (item.result.status === "verified") {
        humanFindings.push({
          code: "human_step_verified",
          message: `${item.step.label} — verified`,
          attention: false,
        });
      } else {
        humanFindings.push({
          code: "human_step_open",
          message: `${item.step.label} is still ${item.result.status}`,
          attention: true,
        });
      }
    }
    for (const match of detected.matches) {
      for (const offer of match.offers) {
        humanFindings.push({ code: "commit_answered", message: offer, attention: true });
      }
    }
    for (const retired of detected.retired) {
      humanFindings.push({ code: "question_retired", message: retired.note, attention: false });
    }
    for (const recap of detected.recaps) {
      humanFindings.push({ code: "question_recap", message: recap.recap, attention: false });
    }
    if (humanFindings.length === 0) {
      humanFindings.push({
        code: "questions_checked",
        message: "Pending human steps and open questions checked",
        attention: false,
      });
    }

    const domains = packDomains([
      ["kernel_state", kernelFindings],
      ["worktrees", worktreeFindings],
      ["developer_repo", repoFindings],
      ["offline_views", viewFindings],
      ["lockfile", lockFindings],
      ["connections_clis", connectionFindings],
      ["human_steps_questions", humanFindings],
    ]);

    const dirty = liveRepo?.dirtyFiles.length ? true : false;
    const drifted =
      folderMissing ||
      !snapshot.walOk ||
      !integrationHeadMatches ||
      orphans.length > 0 ||
      worktrees.some((slot) => slot.state !== "present") ||
      Boolean(branchPrompt) ||
      dirty ||
      (liveRepo?.commits.length ?? 0) > 0 ||
      Boolean(
        liveRepo &&
          snapshot.recordedOriginMain &&
          liveRepo.originMainHead &&
          liveRepo.originMainHead !== snapshot.recordedOriginMain,
      ) ||
      viewChanges.length > 0 ||
      lockfileDrift ||
      connections.some((item) => item.tokenExpired || (item.expiresInDays !== null && item.expiresInDays <= 7)) ||
      cliDrift.length > 0 ||
      detected.matches.length > 0 ||
      (!disk.ok && !folderMissing && disk.freeBytes >= 0) ||
      lockDecisions.length > 0;
    const pendingWork =
      input.buildWasInProgress ||
      snapshot.remainingTasks.length > 0 ||
      snapshot.parkedTasks.length > 0 ||
      snapshot.questions.length > 0 ||
      snapshot.failedTasks.length > 0 ||
      snapshot.humanSteps.some((step) => step.status !== "verified") ||
      snapshot.attempts.some((attempt) => attempt.status === "WORKING");
    const untouched =
      reopen === "first_open" &&
      !input.forceHold &&
      !input.buildWasInProgress &&
      !pendingWork &&
      !drifted &&
      !input.repoChanged &&
      !input.networkChanged &&
      !input.offline;
    gate.open({
      reopen,
      buildWasInProgress: input.buildWasInProgress,
      sleepMinutes: input.sleepMinutes,
      repoChanged: input.repoChanged,
      networkChanged: input.networkChanged,
      offline: input.offline,
      forceHold: input.forceHold,
      untouchedNewIdleProject: untouched,
    });
    const showWelcome = gate.phase !== "OPEN";
    gate.markReconciliationFinished();
    if (!folderMissing) gate.grantResumeClearance();

    const whereWeLeftOff = [
      `Phase: ${snapshot.phaseLabel}`,
      `Why it stopped: ${snapshot.whyStopped}`,
      ...finishedLines(snapshot),
      ...parkedLines(snapshot),
    ];
    const whatChanged = [
      ...(interrupted ? [interrupted] : []),
      ...(wakeNote ? [wakeNote] : []),
      ...(folderMissing ? [PROJECT_FOLDER_MOVED] : []),
      ...(branchPrompt ? [branchPrompt] : []),
      ...(liveRepo && liveRepo.dirtyFiles.length > 0 ? [`Uncommitted files: ${liveRepo.dirtyFiles.join(", ")}`] : []),
      ...(liveRepo
        ? liveRepo.commits.map((commit) =>
            commit.kind === "upstream"
              ? `Pulled upstream commit ${commit.sha.slice(0, 7)} ${commit.subject}`
              : `New manual commit ${commit.sha.slice(0, 7)} ${commit.subject}`,
          )
        : []),
      ...viewFindings.filter((item) => item.attention).map((item) => item.message),
      ...lockfilePrompts,
      ...allowanceMessages,
      ...connectionFindings.filter((item) => item.code === "oauth_expired" || item.code === "oauth_expiring" || item.code === "five_hour_reset" || item.code === "cli_version_drift").map((item) => item.message),
      ...humanResults.filter((item) => item.result.status === "verified").map((item) => `${item.step.label} — verified`),
      ...detected.matches.flatMap((match) => match.offers),
      ...detected.retired.map((item) => item.note),
      ...detected.recaps.map((item) => item.recap),
      ...(staleContextReminder ? [staleContextReminder] : []),
      ...(!disk.ok && !folderMissing && disk.freeBytes >= 0 ? [disk.detail] : []),
      ...lockDecisions.map((lock) =>
        lock.safe ? `Stale .git/index.lock can be removed safely (${lock.lockPath})` : lock.reason,
      ),
      ...repoFindings.filter((item) => item.code === "origin_main_moved").map((item) => item.message),
    ];
    if (showWelcome && whatChanged.length === 0) whatChanged.push("Nothing changed while you were away");
    const readyLines = [
      `Remaining: ${snapshot.remainingTasks.length} tasks${
        snapshot.remainingTasks.length > 0 ? ` — ${snapshot.remainingTasks.map((task) => task.title).join(", ")}` : ""
      }`,
      `Estimated cost ${snapshot.costEstimate} · window ${snapshot.windowLabel}`,
    ];
    const tokensSpent = input.ledger.tokens - startTokens;
    const centsSpent = input.ledger.cents - startCents;
    const paidCallBlocked = tokensSpent !== 0 || centsSpent !== 0 || input.ledger.calls.length > startCalls;
    const mutations = this.ports.journal.commands.filter((command) =>
      /\bgit (stash|checkout|clean|reset|switch|restore|commit|add|merge|rebase|push|pull|worktree)\b/.test(command),
    );

    return {
      domains,
      elapsedMs: Math.max(0, Date.now() - started),
      showWelcome,
      folderMissing,
      relocatePrompt: folderMissing ? PROJECT_FOLDER_MOVED : null,
      gate,
      tokensSpent,
      centsSpent,
      paidCallBlocked,
      mutations,
      integrationHead: snapshot.expectedIntegrationHead,
      integrationHeadMatches,
      orphans,
      interruptedMessage: interrupted,
      branchPrompt,
      lockfilePrompts,
      allowanceMessages,
      staleContextReminder,
      wakeNote,
      commitAnswered: detected.matches,
      retiredQuestions: detected.retired,
      questionRecaps: detected.recaps,
      autoVerifiedHumanStepIds: autoVerified,
      actions,
      whereWeLeftOff,
      whatChanged,
      readyLines,
      projectId: snapshot.projectId,
      snapshotId: snapshot.snapshotId,
      readFailed: Boolean(liveRepo?.readError),
      reopen,
    };
  }

  private resolveGate(gate: ColdOpenInput["gate"]): ReentryGate {
    return gate ?? new NoRunUntilResumeGate();
  }
}

function mergeReopen(input: ReopenReason, shell: ShellCloseReason): ReopenReason {
  if (shell === "crash") return "crash";
  if (shell === "parked" && input !== "crash") return "parked";
  return input;
}

function workingProcessAlive(attempt: AttemptRecord, alive: boolean): boolean {
  if (attempt.pid === null || attempt.pid <= 0) return false;
  return alive;
}

function collectLocks(
  repo: RepoInspection | null,
  worktrees: readonly WorktreeAuditEntry[],
  pids: readonly number[],
  reliable: boolean,
): LockDecision[] {
  const seen = new Set<string>();
  const decisions: LockDecision[] = [];
  const candidates: { path: string; mtime: number | null }[] = [];
  if (repo?.indexLockPath) candidates.push({ path: repo.indexLockPath, mtime: repo.indexLockMtimeMs });
  for (const slot of worktrees) {
    if (slot.indexLockPath) candidates.push({ path: slot.indexLockPath, mtime: slot.indexLockMtimeMs });
  }
  for (const candidate of candidates) {
    if (seen.has(candidate.path) || candidate.mtime === null) continue;
    seen.add(candidate.path);
    const decision = decideLockSafety({
      present: true,
      ageMs: Date.now() - candidate.mtime,
      liveGitPids: pids,
      probeReliable: reliable,
    });
    decisions.push({ ...decision, lockPath: candidate.path, present: true });
  }
  return decisions;
}

function hashesDrifted(
  recorded: { readonly packageJson: string | null; readonly pnpmLock: string | null },
  live: { readonly packageJson: string | null; readonly pnpmLock: string | null },
): boolean {
  return recorded.packageJson !== live.packageJson || recorded.pnpmLock !== live.pnpmLock;
}

function allowanceLines(
  snapshot: StateDbSnapshot,
  observations: readonly ConnectionObservation[],
): string[] {
  const lines: string[] = [];
  for (const observation of observations) {
    const recorded = snapshot.connections.find((item) => item.provider === observation.provider);
    const label = recorded?.allowanceLabel ?? observation.provider;
    const dropped =
      recorded?.previousUsedPercent !== null &&
      recorded?.previousUsedPercent !== undefined &&
      recorded.previousUsedPercent >= 100 &&
      observation.usedPercent === 0;
    if (observation.allowanceReset || observation.weeklyReset || dropped) {
      lines.push(allowanceResetBanner(label));
      lines.push(allowanceResumeLine(label, snapshot.remainingTasks.length));
    }
  }
  return lines;
}

function labelFor(snapshot: StateDbSnapshot, provider: string): string {
  return snapshot.connections.find((item) => item.provider === provider)?.allowanceLabel ?? provider;
}

function awayMillis(lastActive: string, nowIso: string): number | null {
  const last = parseTime(lastActive);
  const now = parseTime(nowIso);
  if (last === null || now === null) return null;
  return now - last;
}

interface ViewChange {
  readonly path: string;
  readonly kind: "edited" | "added" | "removed";
}

function viewDrift(
  recorded: readonly { readonly path: string; readonly sha256: string }[],
  live: readonly { readonly path: string; readonly sha256: string }[],
): ViewChange[] {
  const before = new Map(recorded.map((item) => [item.path, item.sha256]));
  const after = new Map(live.map((item) => [item.path, item.sha256]));
  const changes: ViewChange[] = [];
  for (const [file, hash] of after) {
    const previous = before.get(file);
    if (previous === undefined) changes.push({ path: file, kind: "added" });
    else if (previous !== hash) changes.push({ path: file, kind: "edited" });
  }
  for (const file of before.keys()) {
    if (!after.has(file)) changes.push({ path: file, kind: "removed" });
  }
  return changes;
}

interface CliDrift {
  readonly name: KnownCliName;
  readonly fromVersion: string;
  readonly toVersion: string;
}

function diffClis(recorded: readonly CliVersionRecord[], live: readonly CliVersionRecord[]): CliDrift[] {
  const before = new Map(recorded.map((item) => [item.name, item.version]));
  const after = new Map(live.map((item) => [item.name, item.version]));
  const drifts: CliDrift[] = [];
  for (const name of KNOWN_CLI_NAMES) {
    const fromVersion = before.get(name) ?? null;
    const toVersion = after.get(name) ?? null;
    if (fromVersion === toVersion) continue;
    drifts.push({
      name,
      fromVersion: fromVersion ?? "not installed",
      toVersion: toVersion ?? "not installed",
    });
  }
  return drifts;
}

function propose(input: {
  readonly orphans: readonly AttemptRecord[];
  readonly lockDecisions: readonly LockDecision[];
  readonly viewChanges: readonly ViewChange[];
  readonly commits: readonly ObservedCommit[];
  readonly lockfileDrift: boolean;
  readonly detected: ReturnType<CommitAnsweredQuestionDetector["detect"]>;
  readonly branchPrompt: string | null;
  readonly folderMissing: boolean;
  readonly cliDrift: readonly CliDrift[];
  readonly autoVerified: readonly string[];
  readonly worktrees: readonly WorktreeAuditEntry[];
}): ProposedAction[] {
  const actions: ProposedAction[] = [];
  if (input.orphans.length > 0) {
    actions.push({
      type: "recover_orphaned_attempts",
      detail: input.orphans.map((attempt) => attempt.id).join(","),
      requiresConfirmation: false,
      matchId: null,
      lockPath: null,
      paths: [],
      shas: [],
    });
  }
  for (const lock of input.lockDecisions) {
    if (!lock.safe) continue;
    actions.push({
      type: "prune_stale_index_lock",
      detail: lock.lockPath,
      requiresConfirmation: false,
      matchId: null,
      lockPath: lock.lockPath,
      paths: [],
      shas: [],
    });
  }
  if (input.viewChanges.length > 0) {
    actions.push({
      type: "import_view_edits",
      detail: input.viewChanges.map((change) => change.path).join(","),
      requiresConfirmation: true,
      matchId: null,
      lockPath: null,
      paths: input.viewChanges.map((change) => change.path),
      shas: [],
    });
  }
  const manual = input.commits.filter((commit) => commit.kind === "local");
  if (manual.length > 0) {
    actions.push({
      type: "include_manual_commits",
      detail: manual.map((commit) => commit.sha).join(","),
      requiresConfirmation: true,
      matchId: null,
      lockPath: null,
      paths: [],
      shas: manual.map((commit) => commit.sha),
    });
  }
  if (input.lockfileDrift) {
    actions.push({
      type: "include_lockfile",
      detail: LOCKFILE_INCLUDE_PROMPT,
      requiresConfirmation: true,
      matchId: null,
      lockPath: null,
      paths: [],
      shas: [],
    });
  }
  for (const match of input.detected.matches) {
    actions.push({
      type: "resolve_commit_answered",
      detail: match.offers[0] ?? match.matchId,
      requiresConfirmation: true,
      matchId: match.matchId,
      lockPath: null,
      paths: match.overlappingFiles,
      shas: [match.commitSha],
    });
  }
  if (input.branchPrompt) {
    actions.push({
      type: "choose_branch",
      detail: input.branchPrompt,
      requiresConfirmation: true,
      matchId: null,
      lockPath: null,
      paths: [],
      shas: [],
    });
  }
  if (input.folderMissing) {
    actions.push({
      type: "relocate_project_folder",
      detail: PROJECT_FOLDER_MOVED,
      requiresConfirmation: true,
      matchId: null,
      lockPath: null,
      paths: [],
      shas: [],
    });
  }
  for (const drift of input.cliDrift) {
    actions.push({
      type: "request_cli_conformance",
      detail: `${drift.name}@${drift.fromVersion}->${drift.toVersion}`,
      requiresConfirmation: false,
      matchId: null,
      lockPath: null,
      paths: [],
      shas: [],
    });
  }
  for (const retired of input.detected.retired) {
    actions.push({
      type: "retire_obsolete_question",
      detail: retired.note,
      requiresConfirmation: false,
      matchId: retired.questionId,
      lockPath: null,
      paths: [],
      shas: [],
    });
  }
  for (const stepId of input.autoVerified) {
    actions.push({
      type: "record_verified_human_step",
      detail: stepId,
      requiresConfirmation: false,
      matchId: stepId,
      lockPath: null,
      paths: [],
      shas: [],
    });
  }
  for (const slot of input.worktrees) {
    if (slot.state !== "deleted" && slot.state !== "stale") continue;
    actions.push({
      type: "recreate_worktree",
      detail: slot.slotId,
      requiresConfirmation: true,
      matchId: null,
      lockPath: null,
      paths: [slot.path],
      shas: [],
    });
  }
  return actions;
}

function finishedLines(snapshot: StateDbSnapshot): string[] {
  if (snapshot.finishedFeatures.length === 0) return ["Finished while you were away: none"];
  return snapshot.finishedFeatures.map(
    (feature) => `Finished while you were away: ${feature.title} landed on ${feature.landedOn}`,
  );
}

function parkedLines(snapshot: StateDbSnapshot): string[] {
  if (snapshot.parkedTasks.length === 0) return ["Parked: none"];
  return snapshot.parkedTasks.map((task) => `Parked: ${task.title} (${task.progressLabel})`);
}

function packDomains(entries: readonly (readonly [DomainResult["id"], readonly AttentionFinding[]])[]): DomainResult[] {
  const mapped = new Map(entries.map(([id, findings]) => [id, toDomain(id, findings)]));
  return COLD_OPEN_DOMAINS.map((id) => {
    const domain = mapped.get(id);
    if (!domain) {
      return { id, checked: true, ok: false, findings: [{ code: "missing", message: `Domain ${id} was not checked` }] };
    }
    return domain;
  });
}

function toDomain(id: DomainResult["id"], findings: readonly AttentionFinding[]): DomainResult {
  return {
    id,
    checked: true,
    ok: findings.every((finding) => !finding.attention),
    findings: findings.map((finding) => ({ code: finding.code, message: finding.message })),
  };
}

export function welcomeLastActiveLabel(input: ColdOpenInput): string {
  return formatAwayLabel(input.snapshot.lastActiveAt, input.nowIso, input.lastActiveLabel);
}
