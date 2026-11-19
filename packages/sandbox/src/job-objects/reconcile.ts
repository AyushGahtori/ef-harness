import { ProcessIdentityVerifier } from "./identity.js";
import type { StructuredLogger } from "./logger.js";
import type {
  EnvProcessRow,
  OrphanSweepEntry,
  OrphanSweepReport,
  ProcessInspection,
  ProjectStateDb,
} from "./types.js";

export interface OrphanSweepDeps {
  readonly registry: ProjectStateDb;
  readonly logger: StructuredLogger;
  readonly inspect: (pid: number) => ProcessInspection | Promise<ProcessInspection>;
  readonly terminate: (
    pid: number,
    startTime: number,
  ) => ProcessInspection | "terminated" | Promise<ProcessInspection | "terminated">;
}

export async function reconcileOrphanedProcesses(deps: OrphanSweepDeps): Promise<OrphanSweepReport> {
  const terminated: OrphanSweepEntry[] = [];
  const skipped: OrphanSweepEntry[] = [];
  const alreadyExited: OrphanSweepEntry[] = [];
  const leftIntact: OrphanSweepEntry[] = [];
  const verifier = new ProcessIdentityVerifier(deps.inspect);
  for (const row of deps.registry.listEnvProcesses()) {
    const verdict = await verifier.verify(row.pid, row.startTime);
    if (verdict.verdict === "exited") {
      deps.registry.deleteEnvProcess(row.pid, row.startTime);
      alreadyExited.push(entry(row, "already_exited", verdict.detail));
      continue;
    }
    if (verdict.verdict === "unverified") {
      deps.logger.warn("refusing to kill a process whose ownership cannot be verified", {
        pid: row.pid,
        recordedStartTime: row.startTime,
        detail: verdict.detail,
      });
      leftIntact.push(entry(row, "left_intact", verdict.detail));
      continue;
    }
    if (verdict.verdict === "pid_reused") {
      deps.logger.warn("refusing to kill a pid whose start_time does not match the harness record", {
        pid: row.pid,
        recordedStartTime: row.startTime,
        liveStartTime: verdict.live.startTime,
        imagePath: verdict.live.imagePath ?? "",
        commandLine: verdict.live.commandLine ?? "",
      });
      deps.registry.deleteEnvProcess(row.pid, row.startTime);
      skipped.push(entry(row, "skipped_pid_reuse", verdict.detail));
      continue;
    }
    const killed = await deps.terminate(row.pid, row.startTime);
    if (killed !== "terminated") {
      if (killed.status === "not_found") {
        deps.registry.deleteEnvProcess(row.pid, row.startTime);
        alreadyExited.push(entry(row, "already_exited", "process exited before termination"));
        continue;
      }
      if (killed.status === "alive" && killed.startTime !== row.startTime) {
        deps.logger.warn("refusing to kill a pid whose start_time changed before termination", {
          pid: row.pid,
          recordedStartTime: row.startTime,
          liveStartTime: killed.startTime,
          imagePath: killed.imagePath ?? "",
        });
        deps.registry.deleteEnvProcess(row.pid, row.startTime);
        skipped.push(entry(row, "skipped_pid_reuse", "start_time changed before termination"));
        continue;
      }
      const detail = killed.status === "unverified" ? killed.detail : "termination was not confirmed";
      deps.logger.warn("refusing to kill a process whose ownership cannot be verified", {
        pid: row.pid,
        recordedStartTime: row.startTime,
        detail,
      });
      leftIntact.push(entry(row, "left_intact", detail));
      continue;
    }
    deps.registry.deleteEnvProcess(row.pid, row.startTime);
    deps.logger.info("terminated a harness-owned orphan whose pid and start_time matched", {
      pid: row.pid,
      startTime: row.startTime,
      environment: row.environment,
      role: row.role,
    });
    terminated.push(entry(row, "terminated", "pid and start_time matched"));
  }
  return { terminated, skipped, alreadyExited, leftIntact };
}

function entry(
  row: EnvProcessRow,
  action: OrphanSweepEntry["action"],
  detail: string,
): OrphanSweepEntry {
  return { pid: row.pid, startTime: row.startTime, action, detail };
}
