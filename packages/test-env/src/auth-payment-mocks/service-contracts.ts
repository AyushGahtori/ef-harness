/**
 * Structural contracts consumed from Task 040 (`WindowsJobManager` / `JobHandle`)
 * and Task 049 (`ServiceProvider`). Those packages are parallel and same-layer,
 * so this subtree cannot import them. A JobHandle satisfies `JobTerminationHandle`.
 */

export interface JobTerminationHandle {
  readonly jobId: string;
  readonly terminated?: boolean;
  onTerminate(listener: () => void): () => void;
}

export interface ServiceProvisionRequest {
  readonly projectId: string;
  readonly envId: string;
  readonly port?: number;
  readonly issuerStyle?: "loopback" | "env-localhost";
  readonly clientId?: string;
  readonly redirectUris?: readonly string[];
  readonly job?: JobTerminationHandle;
}

export interface ProvisionedService {
  readonly serviceName: string;
  readonly url: string;
  readonly vars: Readonly<Record<string, string>>;
}

export interface ServiceProvider {
  readonly serviceName: string;
  provision(request: ServiceProvisionRequest): Promise<ProvisionedService>;
  resetData(envId: string): Promise<void>;
  destroy(envId: string): Promise<void>;
}
