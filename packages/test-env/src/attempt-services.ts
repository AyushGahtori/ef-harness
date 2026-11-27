import type { ServiceProvider as AuthServiceProvider } from "./auth-payment-mocks/service-contracts.js";
import { LocalOAuthMockProvider } from "./auth-payment-mocks/local-oauth-mock-provider.js";
import { StripeMockAndWebhookProvider } from "./auth-payment-mocks/stripe-mock-provider.js";
import { ServiceProviderRegistry } from "./orchestrator/providers.js";
import {
  PORT_RANGE_MAX,
  PORT_RANGE_MIN,
  type ServiceProvider,
  type ServiceProvisionContext,
} from "./orchestrator/types.js";
import { TemplateDatabaseManager } from "./synthetic-data/template-manager.js";
import type { CloneHandle, SchemaMetadata, TemplateHandle } from "./synthetic-data/types.js";

const ATTEMPT_SCHEMA: SchemaMetadata = {
  dialect: "sqlite",
  tables: [
    {
      name: "attempt_rows",
      columns: [
        { name: "id", type: "integer", primaryKey: true, nullable: false },
        { name: "label", type: "text", nullable: false, hint: "name" },
      ],
    },
  ],
};

const ATTEMPT_MIGRATION =
  'CREATE TABLE "attempt_rows" ("id" integer PRIMARY KEY NOT NULL, "label" text NOT NULL);';

export interface AdaptedAuthProvider extends ServiceProvider {
  varsFor(environmentId: string): Readonly<Record<string, string>>;
}

export interface AttemptIsolation {
  readonly attemptId: string;
  readonly databaseUrl: string;
  readonly oauthIssuer: string;
  readonly stripeApiBase: string;
  readonly vars: Readonly<Record<string, string>>;
  release(): Promise<void>;
}

export interface AttemptIsolationOptions {
  readonly projectId: string;
  readonly rootDir: string;
}

export function adaptAuthPaymentProvider(provider: AuthServiceProvider): AdaptedAuthProvider {
  const vars = new Map<string, Readonly<Record<string, string>>>();
  return {
    serviceName: provider.serviceName,
    async provision(context) {
      const port = brokerPort(context.port);
      const provisioned = await provider.provision({
        projectId: context.projectId,
        envId: context.environmentId,
        ...(port === null ? {} : { port }),
      });
      vars.set(context.environmentId, provisioned.vars);
      return {
        namespaceId: context.environmentId,
        dbName: context.dbName,
        url: provisioned.url,
      };
    },
    async resetData(context) {
      vars.delete(context.environmentId);
      await provider.resetData(context.environmentId);
    },
    async destroy(context) {
      vars.delete(context.environmentId);
      await provider.destroy(context.environmentId);
    },
    varsFor(environmentId) {
      return vars.get(environmentId) ?? {};
    },
  };
}

export function adaptTemplateDatabase(
  manager: TemplateDatabaseManager,
  template: TemplateHandle,
): ServiceProvider {
  const clones = new Map<string, CloneHandle>();
  return {
    serviceName: "sqlite",
    async provision(context) {
      const existing = clones.get(context.environmentId);
      const clone = existing ?? (await manager.cloneFromTemplate(template, context.environmentId));
      clones.set(context.environmentId, clone);
      return {
        namespaceId: context.environmentId,
        dbName: clone.name,
        url: `file:${clone.location}`,
      };
    },
    async resetData(context) {
      const clone = clones.get(context.environmentId);
      if (!clone) return;
      await clone.release();
      clones.delete(context.environmentId);
      const replacement = await manager.cloneFromTemplate(template, context.environmentId);
      clones.set(context.environmentId, replacement);
    },
    async destroy(context) {
      const clone = clones.get(context.environmentId);
      if (!clone) return;
      clones.delete(context.environmentId);
      await clone.release();
    },
  };
}

export function registerAttemptMockProviders(registry: ServiceProviderRegistry): {
  readonly oauth: AdaptedAuthProvider;
  readonly stripe: AdaptedAuthProvider;
} {
  const oauth = adaptAuthPaymentProvider(new LocalOAuthMockProvider());
  const stripe = adaptAuthPaymentProvider(new StripeMockAndWebhookProvider());
  registry.register(oauth);
  registry.register(stripe);
  return { oauth, stripe };
}

export class AttemptIsolationHost {
  private readonly templates: TemplateDatabaseManager;
  private readonly oauth: AdaptedAuthProvider;
  private readonly stripe: AdaptedAuthProvider;
  private template: Promise<TemplateHandle> | null = null;
  private readonly live = new Map<string, AttemptIsolation>();
  private tail: Promise<void> = Promise.resolve();

  constructor(private readonly options: AttemptIsolationOptions) {
    this.templates = new TemplateDatabaseManager({
      projectId: options.projectId,
      rootDir: options.rootDir,
      dialect: "sqlite",
    });
    const registered = registerAttemptMockProviders(new ServiceProviderRegistry());
    this.oauth = registered.oauth;
    this.stripe = registered.stripe;
  }

  ensure(attemptId: string): Promise<AttemptIsolation> {
    const existing = this.live.get(attemptId);
    if (existing) return Promise.resolve(existing);
    return this.enqueue(() => this.create(attemptId));
  }

  private enqueue(task: () => Promise<AttemptIsolation>): Promise<AttemptIsolation> {
    const run = this.tail.then(task, task);
    this.tail = run.then(
      () => {
        return;
      },
      () => {
        return;
      },
    );
    return run;
  }

  private async create(attemptId: string): Promise<AttemptIsolation> {
    const cached = this.live.get(attemptId);
    if (cached) return cached;
    const context = attemptContext(this.options.projectId, attemptId, this.options.rootDir);
    const template = await this.ensureTemplate();
    const sqlite = adaptTemplateDatabase(this.templates, template);
    const database = await sqlite.provision(context);
    const oauth = await this.oauth.provision(context);
    const stripe = await this.stripe.provision(context);
    const databaseUrl = database.url ?? "";
    const oauthIssuer = oauth.url ?? "";
    const stripeApiBase = stripe.url ?? "";
    if (!databaseUrl || !oauthIssuer || !stripeApiBase) {
      await sqlite.destroy(context);
      await this.oauth.destroy(context);
      await this.stripe.destroy(context);
      throw new Error(`attempt ${attemptId} did not receive an isolated database and mock endpoints`);
    }
    const isolation: AttemptIsolation = {
      attemptId,
      databaseUrl,
      oauthIssuer,
      stripeApiBase,
      vars: {
        DATABASE_URL: databaseUrl,
        OAUTH_ISSUER: oauthIssuer,
        STRIPE_API_BASE: stripeApiBase,
        ...this.oauth.varsFor(attemptId),
        ...this.stripe.varsFor(attemptId),
      },
      release: async () => {
        this.live.delete(attemptId);
        await sqlite.destroy(context);
        await this.oauth.destroy(context);
        await this.stripe.destroy(context);
      },
    };
    this.live.set(attemptId, isolation);
    return isolation;
  }

  private ensureTemplate(): Promise<TemplateHandle> {
    if (this.template) return this.template;
    const pending = this.templates.ensureTemplate({
      migrations: [ATTEMPT_MIGRATION],
      schema: ATTEMPT_SCHEMA,
      seedRecipe: { seed: 20, locale: "en", profile: "functional", functionalRowCount: 16 },
    });
    this.template = pending.then(
      (handle) => handle,
      (error: unknown) => {
        this.template = null;
        throw error;
      },
    );
    return this.template;
  }
}

function brokerPort(port: number | null): number | null {
  if (port === null || port < PORT_RANGE_MIN || port > PORT_RANGE_MAX) return null;
  return port;
}

function attemptContext(projectId: string, attemptId: string, rootDir: string): ServiceProvisionContext {
  return {
    projectId,
    environmentId: attemptId,
    kind: "attempt",
    tier: 1,
    host: "127.0.0.1",
    dbName: attemptId,
    recipientDomain: "env.test",
    port: null,
    portKey: null,
    directories: {
      root: rootDir,
      temp: rootDir,
      upload: rootDir,
      buildOutput: rootDir,
    },
    worktreePath: rootDir,
    baseCommit: "template",
  };
}
