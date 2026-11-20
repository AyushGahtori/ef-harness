export type BackingServiceKind =
  | "sqlite"
  | "postgres"
  | "redis"
  | "mail"
  | "s3"
  | "http_replay";

export type EnvironmentKind = "attempt" | "verifier" | "migration" | "preview";

export type ServiceTier = 0 | 1 | 2 | 3;

/**
 * Shape Task 049's orchestrator uses to provision one backing service.
 * Task 049 owns the canonical `ServiceProvider` export; this is the same
 * contract so the registry can adapt it without a second lifecycle.
 */
export interface ServiceProvider {
  readonly service: BackingServiceKind;
  create(request: ServiceCreateRequest): Promise<ServiceConnection>;
  resetData(envId: string): Promise<void>;
  destroy(envId: string): Promise<void>;
  closeProject(projectId: string): Promise<void>;
}

export interface ServiceCreateRequest {
  readonly projectId: string;
  readonly envId: string;
  readonly kind: EnvironmentKind;
  readonly tempDir: string;
  readonly tier?: ServiceTier;
  readonly ports?: Readonly<Record<string, number>>;
  readonly templatePath?: string;
  readonly templateDatabase?: string;
  readonly extensions?: readonly string[];
  readonly statementTimeoutMs?: number;
  readonly inProcessFake?: boolean;
  readonly redisDatabaseCount?: number;
  readonly httpMode?: "record" | "replay";
  readonly httpApproved?: boolean;
  readonly upstreamBaseUrl?: string;
  readonly cassetteKey?: string;
}

export interface ServiceConnection {
  readonly service: BackingServiceKind;
  readonly envId: string;
  readonly projectId: string;
  readonly variables: Readonly<Record<string, string>>;
}

export interface EnvironmentDegradation {
  readonly service: "postgres" | "redis" | "mailpit";
  readonly projectId: string;
  readonly envId: string;
  readonly state: "degraded";
  readonly stderr: string;
  readonly workerQualityPenalty: false;
  readonly failureScope: "environment";
}

export interface ProcessExitEvent {
  readonly intentional: boolean;
  readonly stderr: string;
  readonly code: number | null;
}
