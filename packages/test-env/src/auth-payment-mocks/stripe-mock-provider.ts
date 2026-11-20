import type { DeliverSignedWebhookOptions, WebhookDeliveryReceipt } from "./generic-webhook-deliverer.js";
import { GenericWebhookDeliverer } from "./generic-webhook-deliverer.js";
import type { ProvisionedService, ServiceProvider, ServiceProvisionRequest } from "./service-contracts.js";
import {
  ephemeralTestSecretKey,
  ephemeralWebhookSecret,
  resolveStripeMockBinary,
  startStripeBackend,
  type StripeBackend,
} from "./stripe-api-backend.js";

interface ProjectRuntime {
  readonly projectId: string;
  readonly backend: StripeBackend;
  readonly signingSecret: string;
  readonly secretKey: string;
  readonly envs: Set<string>;
}

export class StripeMockAndWebhookProvider implements ServiceProvider {
  readonly serviceName = "stripe";

  private readonly deliverer: GenericWebhookDeliverer;
  private readonly resolveBinary: () => string | undefined;
  private readonly projects = new Map<string, ProjectRuntime>();
  private readonly envProject = new Map<string, string>();

  constructor(options?: {
    readonly deliverer?: GenericWebhookDeliverer;
    readonly resolveBinary?: () => string | undefined;
  }) {
    this.deliverer = options?.deliverer ?? new GenericWebhookDeliverer();
    this.resolveBinary = options?.resolveBinary ?? (() => resolveStripeMockBinary());
  }

  async provision(request: ServiceProvisionRequest): Promise<ProvisionedService> {
    let runtime = this.projects.get(request.projectId);
    if (!runtime) {
      const binaryPath = this.resolveBinary();
      const backend = await startStripeBackend(binaryPath ? { binaryPath, ...(request.port !== undefined ? { port: request.port } : {}) } : { ...(request.port !== undefined ? { port: request.port } : {}) });
      runtime = {
        projectId: request.projectId,
        backend,
        signingSecret: ephemeralWebhookSecret(),
        secretKey: ephemeralTestSecretKey(),
        envs: new Set(),
      };
      this.projects.set(request.projectId, runtime);
    }
    runtime.envs.add(request.envId);
    this.envProject.set(request.envId, request.projectId);
    return {
      serviceName: this.serviceName,
      url: runtime.backend.baseUrl,
      vars: {
        STRIPE_API_BASE: runtime.backend.baseUrl,
        STRIPE_WEBHOOK_SECRET: runtime.signingSecret,
        STRIPE_SECRET_KEY: runtime.secretKey,
      },
    };
  }

  async resetData(envId: string): Promise<void> {
    if (!this.envProject.has(envId)) return;
  }

  async destroy(envId: string): Promise<void> {
    const projectId = this.envProject.get(envId);
    if (!projectId) return;
    this.envProject.delete(envId);
    const runtime = this.projects.get(projectId);
    if (!runtime) return;
    runtime.envs.delete(envId);
    if (runtime.envs.size > 0) return;
    this.projects.delete(projectId);
    await runtime.backend.close();
  }

  projectSnapshot(projectId: string): {
    readonly mode: StripeBackend["mode"];
    readonly baseUrl: string;
    readonly boundAddress: "127.0.0.1";
    readonly signingSecret: string;
    readonly secretKey: string;
    readonly pid: number | undefined;
  } | undefined {
    const runtime = this.projects.get(projectId);
    if (!runtime) return undefined;
    return {
      mode: runtime.backend.mode,
      baseUrl: runtime.backend.baseUrl,
      boundAddress: runtime.backend.boundAddress,
      signingSecret: runtime.signingSecret,
      secretKey: runtime.secretKey,
      pid: runtime.backend.pid,
    };
  }

  deliverSignedWebhook(
    envUrl: string,
    eventPayload: unknown,
    signingSecret: string,
    options?: DeliverSignedWebhookOptions,
  ): Promise<readonly WebhookDeliveryReceipt[]> {
    return this.deliverer.deliver(envUrl, eventPayload, signingSecret, {
      format: "stripe",
      ...options,
    });
  }

  async close(): Promise<void> {
    const runtimes = [...this.projects.values()];
    this.projects.clear();
    this.envProject.clear();
    await Promise.all(runtimes.map((runtime) => runtime.backend.close()));
  }
}
