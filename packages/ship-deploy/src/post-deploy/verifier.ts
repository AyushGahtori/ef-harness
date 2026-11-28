import { verifyHealthAndBuildId, type HealthVerifierOptions } from "./health.js";
import { createPostDeployCleanVerifier } from "./clean-verifier.js";
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
  private readonly cleanVerifier: ReturnType<typeof createPostDeployCleanVerifier>;

  constructor(private readonly deps: PostDeployVerifierDeps) {
    this.playwright =
      deps.playwright ??
      createHttpLoopbackPlaywrightProbe(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : undefined);
    this.cleanVerifier = createPostDeployCleanVerifier();
  }

  verifyHealthAndBuildId(input: HealthCheckInput): Promise<HealthCheckResult> {
    return verifyHealthAndBuildId(input, {
      ...(this.deps.clock ? { clock: this.deps.clock } : {}),
      ...(this.deps.tlsProbe ? { tlsProbe: this.deps.tlsProbe } : {}),
      ...(this.deps.fetchImpl ? { fetchImpl: this.deps.fetchImpl } : {}),
    });
  }

  async runDeployedSmoke(input: SmokeCheckInput): Promise<DeployedSmokeReceipt> {
    const receipt = await runDeployedSmoke(input, {
      playwright: this.playwright,
      redactor: this.deps.redactor,
      cas: this.deps.cas,
    });
    this.cleanVerifier.parseCollectedCaseIds(
      JSON.stringify({ smoke: receipt.receiptSha256, screenshot: receipt.screenshotSha256 }),
    );
    return receipt;
  }
}
