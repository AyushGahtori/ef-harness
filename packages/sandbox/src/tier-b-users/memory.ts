import { SANDBOX_ACCOUNTS } from "./constants.js";
import { CreateProcessAsUserError, TierBError } from "./errors.js";
import { firewallRuleHash } from "./firewall.js";
import { comparablePath } from "./paths.js";
import { explainCreateProcessAsUserFailure } from "./provision-errors.js";
import type {
  AclAce,
  AclCommand,
  AclPort,
  DenialAuditEvent,
  FirewallObservation,
  FirewallRuleSpec,
  JobAccounting,
  JobHandle,
  JobLimits,
  LaunchLatencySample,
  LogonExecutor,
  LogonLaunchResult,
  RestrictedLogonPlan,
  SandboxAuditEntry,
  SandboxAuditLogger,
  SandboxGovernorSink,
  ScriptInvocation,
  ScriptResult,
  ScriptRunner,
  TierBHostInspector,
} from "./types.js";

export class RecordingAclPort implements AclPort {
  readonly commands: AclCommand[] = [];
  private readonly byTarget = new Map<string, AclAce[]>();

  apply(command: AclCommand): void {
    if (command.recursive || command.args.includes("/T") || command.args.includes("/t")) {
      throw new TierBError("recursive_acl", "Recursive ACL propagation is forbidden");
    }
    this.commands.push(command);
    const key = comparablePath(command.ace.target);
    const existing = this.byTarget.get(key) ?? [];
    existing.push(command.ace);
    this.byTarget.set(key, existing);
  }

  list(target: string): readonly AclAce[] {
    return this.byTarget.get(comparablePath(target)) ?? [];
  }
}

export class MemoryJobManager {
  readonly created: { readonly id: string; readonly name: string; readonly limits: JobLimits; readonly parentId: string | null }[] = [];
  readonly assigned: { readonly jobId: string; readonly pid: number }[] = [];
  readonly closed: string[] = [];
  private sequence = 0;

  async createJob(name: string, limits: JobLimits, parent?: JobHandle): Promise<JobHandle> {
    this.sequence += 1;
    const id = `job-${this.sequence}`;
    this.created.push({ id, name, limits, parentId: parent?.id ?? null });
    const closed = this.closed;
    return {
      id,
      name,
      close(): Promise<void> {
        closed.push(id);
        return Promise.resolve();
      },
    };
  }

  async assignProcess(job: JobHandle, pid: number): Promise<void> {
    this.assigned.push({ jobId: job.id, pid });
  }

  async queryJobAccounting(): Promise<JobAccounting> {
    return {
      peakJobMemoryUsed: 0,
      currentWorkingSet: 0,
      totalUserTimeMs: 0,
      totalKernelTimeMs: 0,
      activeProcesses: 0,
    };
  }

  async terminateJob(job: JobHandle): Promise<void> {
    await job.close();
  }
}

export class MemoryAuditLog implements SandboxAuditLogger {
  readonly entries: SandboxAuditEntry[] = [];

  write(entry: SandboxAuditEntry): void {
    this.entries.push(entry);
  }
}

export class MemoryGovernor implements SandboxGovernorSink {
  readonly latencies: LaunchLatencySample[] = [];
  readonly denials: DenialAuditEvent[] = [];

  reportLaunchLatency(sample: LaunchLatencySample): void {
    this.latencies.push(sample);
  }

  reportDenial(event: DenialAuditEvent): void {
    this.denials.push(event);
  }
}

export class RecordingLogonExecutor implements LogonExecutor {
  readonly enforcement = "test_double" as const;
  readonly launches: RestrictedLogonPlan[] = [];
  failWin32: number | null = null;
  delayMs = 0;

  async launch(plan: RestrictedLogonPlan): Promise<LogonLaunchResult> {
    this.launches.push(plan);
    if (this.delayMs > 0) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, this.delayMs);
      });
    }
    if (this.failWin32 !== null) {
      const explained = explainCreateProcessAsUserFailure(this.failWin32);
      throw new CreateProcessAsUserError(this.failWin32, explained.message, explained.edrHint);
    }
    return { pid: 4242, exitCode: 0, stdout: "", stderr: "", enforcement: "test_double" };
  }
}

export class RefusingLogonExecutor implements LogonExecutor {
  readonly enforcement = "test_double" as const;

  launch(): Promise<LogonLaunchResult> {
    return Promise.reject(new TierBError("live_logon_disabled", "Tier B logon is not enabled for this process"));
  }
}

export class RecordingScriptRunner implements ScriptRunner {
  readonly invocations: ScriptInvocation[] = [];
  exitCode = 0;

  async run(invocation: ScriptInvocation): Promise<ScriptResult> {
    this.invocations.push(invocation);
    return { exitCode: this.exitCode, stdout: "", stderr: "" };
  }
}

export class RefusingScriptRunner implements ScriptRunner {
  async run(): Promise<ScriptResult> {
    throw new TierBError("live_provision_disabled", "Tier B provisioning was not given a script runner");
  }
}

export function readyInspector(rules: readonly FirewallRuleSpec[]): TierBHostInspector {
  const hashes = new Map(rules.map((rule) => [rule.name, firewallRuleHash(rule)]));
  return {
    accountExists(name: string): boolean {
      return SANDBOX_ACCOUNTS.some((account) => account === name);
    },
    firewallRule(name: string): FirewallObservation {
      const specHash = hashes.get(name) ?? null;
      return { name, present: specHash !== null, enabled: specHash !== null, specHash };
    },
    dpapiCredentialValid(account: string): boolean {
      return SANDBOX_ACCOUNTS.some((name) => name === account);
    },
  };
}

export function nearestRankPercentile(samples: readonly number[], percentile: number): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((percentile / 100) * sorted.length) - 1));
  return sorted[index] ?? 0;
}
