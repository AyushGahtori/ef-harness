import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type {
  DiskHeadroomProbePort,
  DpapiProbePort,
  MinGitProbePort,
  NamedPipeProbePort,
  PortLeaseProbePort,
} from "./ports.js";
import {
  DISK_PAUSE_BYTES,
  DISK_STOP_BYTES,
  DISK_WARN_BYTES,
  SELF_CHECK_BUDGET_MS,
  type SelfCheckItem,
  type SelfCheckReport,
  type SelfCheckStatus,
} from "./types.js";

export interface SelfCheckProbes {
  readonly stateDbPath: string;
  readonly globalDbPath: string;
  readonly telemetryPath: string;
  readonly namedPipe: NamedPipeProbePort;
  readonly minGit: MinGitProbePort;
  readonly dpapi: DpapiProbePort;
  readonly disk: DiskHeadroomProbePort;
  readonly leases: PortLeaseProbePort;
}

export interface SelfCheckOptions {
  readonly probeTimeoutMs?: number;
  readonly budgetMs?: number;
}

export class DiagnosticsSelfCheck {
  constructor(
    private readonly probes: SelfCheckProbes,
    private readonly options: SelfCheckOptions = {},
  ) {}

  async run(): Promise<SelfCheckReport> {
    const started = performance.now();
    const timeoutMs = this.options.probeTimeoutMs ?? 400;
    const budgetMs = this.options.budgetMs ?? SELF_CHECK_BUDGET_MS;
    const items = await Promise.all([
      this.bounded("sqlite-quick-check", "SQLite PRAGMA quick_check", timeoutMs, () => this.sqlite()),
      this.bounded("named-pipe-rtt", "Named Pipe RTT", timeoutMs, () => this.pipe()),
      this.bounded("mingit-version", "MinGit version", timeoutMs, () => this.minGit()),
      this.bounded("dpapi-vault-unlock", "DPAPI vault unlock", timeoutMs, () => this.dpapi()),
      this.bounded("disk-headroom", "Disk headroom", timeoutMs, () => this.disk()),
      this.bounded("active-port-leases", "Active port leases", timeoutMs, () => this.leases()),
    ]);
    const durationMs = performance.now() - started;
    return {
      items,
      durationMs,
      withinBudget: durationMs < budgetMs,
    };
  }

  private sqlite(): Omit<SelfCheckItem, "durationMs"> {
    const checks = [
      ["state.db", this.probes.stateDbPath],
      ["global.db", this.probes.globalDbPath],
      ["telemetry.db", this.probes.telemetryPath],
    ] as const;
    const details = checks.map(([name, path]) => quickCheckDetail(name, path));
    const failed = details.filter((detail) => !detail.ok);
    if (failed.length === 0) {
      return {
        id: "sqlite-quick-check",
        name: "SQLite PRAGMA quick_check",
        status: "green",
        detail: details.map((detail) => detail.detail).join("; "),
        fixSteps: [],
      };
    }
    return {
      id: "sqlite-quick-check",
      name: "SQLite PRAGMA quick_check",
      status: "red",
      detail: failed.map((detail) => detail.detail).join("; "),
      fixSteps: [
        "When telemetry.db fails quick_check, click Rebuild Telemetry DB. That rebuild does not modify state.db.",
        "When state.db or global.db fails quick_check, leave the file in place and restore from the last verified backup.",
      ],
    };
  }

  private async pipe(): Promise<Omit<SelfCheckItem, "durationMs">> {
    const rtt = await this.probes.namedPipe.roundTripMs();
    if (rtt === null) {
      return item(
        "named-pipe-rtt",
        "Named Pipe RTT",
        "red",
        "Named pipe is not accepting connections",
        ["Start harnessd so the per-user named pipe is listening, then re-run Self-Check."],
      );
    }
    if (rtt >= 200) {
      return item(
        "named-pipe-rtt",
        "Named Pipe RTT",
        "amber",
        `Named pipe round trip is ${rtt} ms`,
        ["Close extra EF Harness windows and re-run Self-Check if the pipe stays slow."],
      );
    }
    return item("named-pipe-rtt", "Named Pipe RTT", "green", `Named pipe round trip is ${rtt} ms`, []);
  }

  private async minGit(): Promise<Omit<SelfCheckItem, "durationMs">> {
    const version = await this.probes.minGit.version();
    if (!version) {
      return item(
        "mingit-version",
        "MinGit version",
        "red",
        "MinGit is missing or failed its version probe",
        ["Open Settings, Components, Repair MinGit, then re-run Self-Check."],
      );
    }
    return item("mingit-version", "MinGit version", "green", `MinGit ${version}`, []);
  }

  private async dpapi(): Promise<Omit<SelfCheckItem, "durationMs">> {
    const result = await this.probes.dpapi.unlock();
    if (!result.ok) {
      return item(
        "dpapi-vault-unlock",
        "DPAPI vault unlock",
        "red",
        result.detail || "DPAPI vault did not unlock",
        ["Sign in to Windows and reopen EF Harness so the DPAPI vault can unlock, then re-run Self-Check."],
      );
    }
    return item(
      "dpapi-vault-unlock",
      "DPAPI vault unlock",
      "green",
      result.detail || "DPAPI vault unlocked",
      [],
    );
  }

  private async disk(): Promise<Omit<SelfCheckItem, "durationMs">> {
    const reading = await this.probes.disk.freeBytes();
    const classified = classifyDiskHeadroom(reading.drive, reading.freeBytes);
    return item("disk-headroom", "Disk headroom", classified.status, classified.detail, classified.fixSteps);
  }

  private async leases(): Promise<Omit<SelfCheckItem, "durationMs">> {
    const leases = await this.probes.leases.leases();
    const stuck = leases.filter((lease) => lease.stuck);
    if (stuck.length > 0) {
      const names = stuck.map((lease) => `${lease.port} ${lease.owner}`).join(", ");
      return item(
        "active-port-leases",
        "Active port leases",
        "red",
        `Stuck port leases: ${names}`,
        ["Release the stuck port lease from the port broker, then re-run Self-Check."],
      );
    }
    if (leases.length === 0) {
      return item("active-port-leases", "Active port leases", "green", "No active port leases", []);
    }
    return item(
      "active-port-leases",
      "Active port leases",
      "green",
      `${leases.length} active port leases`,
      [],
    );
  }

  private async bounded(
    id: string,
    name: string,
    timeoutMs: number,
    run: () => Promise<Omit<SelfCheckItem, "durationMs">> | Omit<SelfCheckItem, "durationMs">,
  ): Promise<SelfCheckItem> {
    const started = performance.now();
    const outcome = await withTimeout(
      Promise.resolve().then(() => {
        try {
          return run();
        } catch (error) {
          const message = error instanceof Error ? error.message : "probe failed";
          return item(id, name, "red", message, [
            `The ${name} probe failed. Re-run Self-Check after that subsystem recovers.`,
          ]);
        }
      }),
      timeoutMs,
      () =>
        item(id, name, "red", `${name} timed out`, [
          `The ${name} probe did not finish in time. Re-run Self-Check after that subsystem recovers.`,
        ]),
    );
    return { ...outcome, id, name, durationMs: performance.now() - started };
  }
}

export function classifyDiskHeadroom(
  drive: string,
  freeBytes: number,
): { readonly status: SelfCheckStatus; readonly detail: string; readonly fixSteps: readonly string[] } {
  const label = `${drive} has ${freeBytes} bytes free`;
  if (freeBytes < DISK_STOP_BYTES) {
    return {
      status: "red",
      detail: `${label}, below the 2 GB emergency floor`,
      fixSteps: [
        "Free space immediately and pause builds before SQLite or Git hit a full disk, then re-run Self-Check.",
      ],
    };
  }
  if (freeBytes < DISK_PAUSE_BYTES) {
    return {
      status: "red",
      detail: `${label}, below the 5 GB dispatch floor`,
      fixSteps: ["Free space on the reported drive or run safe cache cleanup, then re-run Self-Check."],
    };
  }
  if (freeBytes < DISK_WARN_BYTES) {
    return {
      status: "amber",
      detail: `${label}, below the 15 GB warning line`,
      fixSteps: ["Run safe cache cleanup or move worktrees before free space reaches 5 GB."],
    };
  }
  return { status: "green", detail: label, fixSteps: [] };
}

function quickCheckDetail(name: string, path: string): { readonly ok: boolean; readonly detail: string } {
  if (!existsSync(path)) return { ok: false, detail: `${name}: missing` };
  let database: DatabaseSync | null = null;
  try {
    database = new DatabaseSync(path, { readOnly: true });
    const rows = database.prepare("PRAGMA quick_check").all();
    const details = rows.map((row) => {
      const value = row.quick_check;
      return typeof value === "string" ? value : String(value);
    });
    const text = details.join("; ");
    return { ok: text === "ok", detail: `${name}: ${text}` };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unreadable";
    return { ok: false, detail: `${name}: ${message}` };
  } finally {
    database?.close();
  }
}

function item(
  id: string,
  name: string,
  status: SelfCheckStatus,
  detail: string,
  fixSteps: readonly string[],
): Omit<SelfCheckItem, "durationMs"> {
  return { id, name, status, detail, fixSteps };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, onTimeout: () => T): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(onTimeout()), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(onTimeout());
      },
    );
  });
}
