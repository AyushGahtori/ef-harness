import { verifyHealthAndBuildId, type HealthVerifierOptions } from "./health.js";
import { createHttpLoopbackPlaywrightProbe, runDeployedSmoke } from "./smoke.js";
import type {
  CasBlobStore,
  DeployedSmokeReceipt,
  HealthCheckInput,
  HealthCheckResult,
  PacketSecurityRedactor,
  SmokeCheckInput,
  TlsProbe,
  UiPlaywrightContractVerifier,
} from "./types.js";

export interface PostDeployVerifierDeps extends HealthVerifierOptions {
  readonly redactor: PacketSecurityRedactor;
  readonly cas: CasBlobStore;
  readonly playwright?: UiPlaywrightContractVerifier;
  readonly tlsProbe?: TlsProbe;
}

export class PostDeployVerifier {
  private readonly playwright: UiPlaywrightContractVerifier;

  constructor(private readonly deps: PostDeployVerifierDeps) {
    this.playwright =
      deps.playwright ??
      createHttpLoopbackPlaywrightProbe(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : undefined);
  }

  verifyHealthAndBuildId(input: HealthCheckInput): Promise<HealthCheckResult> {
    return verifyHealthAndBuildId(input, {
      ...(this.deps.clock ? { clock: this.deps.clock } : {}),
      ...(this.deps.tlsProbe ? { tlsProbe: this.deps.tlsProbe } : {}),
      ...(this.deps.fetchImpl ? { fetchImpl: this.deps.fetchImpl } : {}),
    });
  }

  runDeployedSmoke(input: SmokeCheckInput): Promise<DeployedSmokeReceipt> {
    return runDeployedSmoke(input, {
      playwright: this.playwright,
      redactor: this.deps.redactor,
      cas: this.deps.cas,
    });
  }
}
