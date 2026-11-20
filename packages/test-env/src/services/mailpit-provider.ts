import { systemClock, type Clock } from "./clock.js";
import { asStartFailure, ServiceStartFailedError } from "./errors.js";
import { TrackingWindowsJobManager, type JobHandle, type WindowsJobManager } from "./job.js";
import { reserveLoopbackPort, waitForTcp } from "./net-util.js";
import { efHarnessHome, existingComponent } from "./paths.js";
import { NodeBinaryLauncher, type SpawnedServiceProcess } from "./binary-launcher.js";
import {
  mailpitDeleteBody,
  mailpitLaunchArgs,
  mailpitRecipientDomain,
  mailpitSearchQuery,
  messageMatchesEnv,
  parseMailpitSearch,
  type MailpitMessage,
} from "./mailpit.js";
import { ProjectSharedServerPool } from "./shared-server.js";
import type { ProcessExitEvent, ServiceConnection, ServiceCreateRequest, ServiceProvider } from "./types.js";

export interface MailpitRuntime {
  readonly pid: number;
  readonly smtpPort: number;
  readonly httpPort: number;
  stderr(): string;
  onExit(listener: (event: ProcessExitEvent) => void): void;
  stop(): Promise<void>;
}

export interface MailpitLaunchRequest {
  readonly projectId: string;
  readonly smtpPort: number;
  readonly httpPort: number;
  readonly job: JobHandle;
  readonly jobManager: WindowsJobManager;
  readonly componentsHome?: string;
}

export interface MailpitLauncher {
  launch(request: MailpitLaunchRequest): Promise<MailpitRuntime>;
}

export interface MailpitConnection extends ServiceConnection {
  readonly service: "mail";
  readonly smtpUrl: string;
  readonly httpUrl: string;
  readonly recipientDomain: string;
}

interface MailEnvRecord {
  projectId: string;
  domain: string;
}

export interface MailpitProviderOptions {
  readonly jobManager?: WindowsJobManager;
  readonly launcher?: MailpitLauncher;
  readonly clock?: Clock;
  readonly idleGraceMs?: number;
  readonly home?: string;
  readonly fetchImpl?: typeof fetch;
  readonly pollMs?: number;
}

export class MailpitProvider implements ServiceProvider {
  readonly service = "mail" as const;
  private readonly jobManager: WindowsJobManager;
  private readonly launcher: MailpitLauncher;
  private readonly home: string;
  private readonly fetchImpl: typeof fetch;
  private readonly pollMs: number;
  private readonly envs = new Map<string, MailEnvRecord>();
  private readonly jobs = new Map<string, JobHandle>();
  private readonly pool: ProjectSharedServerPool<MailpitRuntime>;

  constructor(options: MailpitProviderOptions = {}) {
    this.jobManager = options.jobManager ?? new TrackingWindowsJobManager();
    this.launcher = options.launcher ?? new MailpitBinaryLauncher();
    this.home = options.home ?? efHarnessHome();
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.pollMs = options.pollMs ?? 25;
    this.pool = new ProjectSharedServerPool({
      idleGraceMs: options.idleGraceMs ?? 5_000,
      clock: options.clock ?? systemClock(),
      start: (projectId) => this.startServer(projectId),
      stop: async (_projectId, runtime) => {
        await runtime.stop();
      },
    });
  }

  async create(request: ServiceCreateRequest): Promise<MailpitConnection> {
    if (this.envs.has(request.envId)) {
      throw new Error(`mail environment ${request.envId} already exists`);
    }
    const preferredSmtp = request.ports?.smtp;
    const preferredHttp = request.ports?.mailHttp ?? request.ports?.mail;
    if (preferredSmtp !== undefined) this.preferredSmtp.set(request.projectId, preferredSmtp);
    if (preferredHttp !== undefined) this.preferredHttp.set(request.projectId, preferredHttp);
    await this.pool.acquire(request.projectId);
    const runtime = this.pool.runtimeOf(request.projectId);
    if (!runtime) {
      await this.pool.release(request.projectId);
      throw new ServiceStartFailedError("mailpit", "mailpit did not stay running");
    }
    const domain = mailpitRecipientDomain(request.envId);
    this.envs.set(request.envId, { projectId: request.projectId, domain });
    const smtpUrl = `smtp://127.0.0.1:${runtime.smtpPort}`;
    const httpUrl = `http://127.0.0.1:${runtime.httpPort}`;
    return {
      service: "mail",
      envId: request.envId,
      projectId: request.projectId,
      smtpUrl,
      httpUrl,
      recipientDomain: domain,
      variables: {
        SMTP_URL: smtpUrl,
        MAILPIT_HTTP: httpUrl,
        MAIL_RECIPIENT_DOMAIN: domain,
      },
    };
  }

  async listMessagesForEnv(envId: string): Promise<MailpitMessage[]> {
    const record = this.record(envId);
    const runtime = await this.server(record.projectId);
    const url = new URL("/api/v1/search", `http://127.0.0.1:${runtime.httpPort}`);
    url.searchParams.set("query", mailpitSearchQuery(envId));
    const response = await this.fetchImpl(url);
    if (!response.ok) {
      throw new Error(`Mailpit search failed with HTTP ${response.status}`);
    }
    const payload: unknown = await response.json();
    return parseMailpitSearch(payload).filter((message) => messageMatchesEnv(message, envId));
  }

  async waitForMessage(
    envId: string,
    predicate: (message: MailpitMessage) => boolean,
    options: { readonly timeoutMs?: number; readonly pollMs?: number } = {},
  ): Promise<MailpitMessage> {
    const timeoutMs = options.timeoutMs ?? 5_000;
    const pollMs = options.pollMs ?? this.pollMs;
    const started = Date.now();
    for (;;) {
      const found = (await this.listMessagesForEnv(envId)).find(predicate);
      if (found) return found;
      if (Date.now() - started >= timeoutMs) {
        throw new Error(`timed out waiting for mail for ${envId}`);
      }
      await delay(pollMs);
    }
  }

  async clearMessagesForEnv(envId: string): Promise<readonly string[]> {
    const messages = await this.listMessagesForEnv(envId);
    const ids = messages.map((message) => message.id);
    if (ids.length === 0) return [];
    const record = this.record(envId);
    const runtime = await this.server(record.projectId);
    const response = await this.fetchImpl(`http://127.0.0.1:${runtime.httpPort}/api/v1/messages`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: mailpitDeleteBody(ids),
    });
    if (!response.ok) {
      throw new Error(`Mailpit delete failed with HTTP ${response.status}`);
    }
    return ids;
  }

  async resetData(envId: string): Promise<void> {
    await this.clearMessagesForEnv(envId);
  }

  async destroy(envId: string): Promise<void> {
    const record = this.envs.get(envId);
    if (!record) return;
    try {
      await this.clearMessagesForEnv(envId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/Mailpit search failed|ECONNREFUSED|not running|fetch failed/i.test(message)) {
        throw error;
      }
    }
    this.envs.delete(envId);
    await this.pool.release(record.projectId);
  }

  async closeProject(projectId: string): Promise<void> {
    const ids = [...this.envs.entries()]
      .filter(([, record]) => record.projectId === projectId)
      .map(([envId]) => envId);
    for (const envId of ids) await this.destroy(envId);
    await this.pool.close(projectId);
    const job = this.jobs.get(projectId);
    if (job) {
      this.jobs.delete(projectId);
      await this.jobManager.terminateJob(job);
    }
  }

  private readonly preferredSmtp = new Map<string, number>();
  private readonly preferredHttp = new Map<string, number>();

  private record(envId: string): MailEnvRecord {
    const record = this.envs.get(envId);
    if (!record) throw new Error(`unknown mail environment ${envId}`);
    return record;
  }

  private async server(projectId: string): Promise<MailpitRuntime> {
    const current = this.pool.runtimeOf(projectId);
    if (current) return current;
    await this.pool.acquire(projectId);
    await this.pool.release(projectId);
    const restarted = this.pool.runtimeOf(projectId);
    if (!restarted) throw new ServiceStartFailedError("mailpit", "mailpit is not running");
    return restarted;
  }

  private async startServer(projectId: string): Promise<MailpitRuntime> {
    const job = await this.jobFor(projectId);
    const smtpPort = this.preferredSmtp.get(projectId) ?? (await reserveLoopbackPort());
    const httpPort = this.preferredHttp.get(projectId) ?? (await reserveLoopbackPort());
    try {
      return await this.launcher.launch({
        projectId,
        smtpPort,
        httpPort,
        job,
        jobManager: this.jobManager,
        componentsHome: this.home,
      });
    } catch (error) {
      throw asStartFailure("mailpit", error);
    }
  }

  private async jobFor(projectId: string): Promise<JobHandle> {
    const existing = this.jobs.get(projectId);
    if (existing) return existing;
    const created = await this.jobManager.createJob(`project-service:${projectId}:mailpit`, {
      killOnJobClose: true,
    });
    this.jobs.set(projectId, created);
    return created;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export class MailpitBinaryLauncher implements MailpitLauncher {
  constructor(private readonly binaries: NodeBinaryLauncher = new NodeBinaryLauncher()) {}

  async launch(request: MailpitLaunchRequest): Promise<MailpitRuntime> {
    const binary = existingComponent("mailpit", request.componentsHome);
    if (!binary) {
      const root = request.componentsHome ?? efHarnessHome();
      throw new ServiceStartFailedError(
        "mailpit",
        `missing Mailpit binary under ${root}\\components. Antivirus quarantine can also prevent startup.`,
      );
    }
    const server = await this.binaries.spawn({
      binary,
      args: mailpitLaunchArgs(request.smtpPort, request.httpPort),
      job: request.job,
      jobManager: request.jobManager,
    });
    try {
      await waitForTcp("127.0.0.1", request.httpPort, 10_000);
    } catch (error) {
      const logs = `${server.stderr()}\n${error instanceof Error ? error.message : String(error)}`;
      await server.stop();
      throw new ServiceStartFailedError("mailpit", logs);
    }
    return wrapMailpit(server, request.smtpPort, request.httpPort);
  }
}

function wrapMailpit(proc: SpawnedServiceProcess, smtpPort: number, httpPort: number): MailpitRuntime {
  let stopped = false;
  return {
    pid: proc.pid,
    smtpPort,
    httpPort,
    stderr: () => proc.stderr(),
    onExit(listener) {
      proc.onExit((event) => listener({ ...event, intentional: stopped || event.intentional }));
    },
    async stop() {
      stopped = true;
      await proc.stop();
    },
  };
}
