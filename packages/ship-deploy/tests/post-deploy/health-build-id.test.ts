import { afterEach, describe, expect, it } from "vitest";
import {
  DevArtifactLeakError,
  HealthCheckTimeoutError,
  PostDeployVerifier,
  StackTraceLeakError,
  StaleDeploymentBuildIdMismatch,
  TlsCertificateError,
  createFallbackPacketSecurityRedactor,
  InMemoryCasBlobStore,
} from "../../src/post-deploy/index.js";
import { NEW_SHA, OLD_SHA, startMockDeploy, type MockDeploy } from "./helpers.js";

const redactor = createFallbackPacketSecurityRedactor();
let app: MockDeploy | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

function verifier(): PostDeployVerifier {
  return new PostDeployVerifier({ redactor, cas: new InMemoryCasBlobStore() });
}

describe("post-deploy health and build id", () => {
  it("accepts a loopback 200 whose JSON build id matches the expected commit", async () => {
    app = await startMockDeploy();
    const result = await verifier().verifyHealthAndBuildId({
      env: "production",
      liveUrl: app.origin,
      expectedCommitSha: NEW_SHA,
      maxWaitMs: 50,
      intervalMs: 10,
    });
    expect(result.status).toBe(200);
    expect(result.buildId).toBe(NEW_SHA);
    expect(result.tls.mode).toBe("loopback-plaintext");
    expect(result.tls.valid).toBe(true);
    expect(result.styleguideStatus).toBe(404);
    expect(result.attempts).toBe(1);
  });

  it("reads the build id from a deploy header or a meta tag", async () => {
    app = await startMockDeploy({ buildIdVia: "header" });
    const fromHeader = await verifier().verifyHealthAndBuildId({
      env: "staging",
      liveUrl: app.origin,
      expectedCommitSha: NEW_SHA,
      maxWaitMs: 20,
      intervalMs: 10,
    });
    expect(fromHeader.buildId).toBe(NEW_SHA);
    await app.close();
    app = await startMockDeploy({ buildIdVia: "meta" });
    const fromMeta = await verifier().verifyHealthAndBuildId({
      env: "staging",
      liveUrl: app.origin,
      expectedCommitSha: NEW_SHA,
      maxWaitMs: 20,
      intervalMs: 10,
    });
    expect(fromMeta.buildId).toBe(NEW_SHA);
  });

  it("retries warmup and then accepts the new build id", async () => {
    app = await startMockDeploy({ buildId: OLD_SHA, flipTo: NEW_SHA, flipAfter: 2 });
    const result = await verifier().verifyHealthAndBuildId({
      env: "staging",
      liveUrl: app.origin,
      expectedCommitSha: NEW_SHA,
      maxWaitMs: 400,
      intervalMs: 15,
    });
    expect(result.buildId).toBe(NEW_SHA);
    expect(result.attempts).toBeGreaterThanOrEqual(3);
  });

  it("flags a stale build id instead of declaring the deploy green", async () => {
    app = await startMockDeploy({ buildId: OLD_SHA });
    const error = await verifier()
      .verifyHealthAndBuildId({
        env: "staging",
        liveUrl: app.origin,
        expectedCommitSha: NEW_SHA,
        maxWaitMs: 40,
        intervalMs: 10,
      })
      .then(
        () => {
          throw new Error("stale build id was treated as success");
        },
        (caught: unknown) => caught,
      );
    expect(error).toBeInstanceOf(StaleDeploymentBuildIdMismatch);
    if (error instanceof StaleDeploymentBuildIdMismatch) {
      expect(error.actualBuildId).toBe(OLD_SHA);
      expect(error.expectedCommitSha).toBe(NEW_SHA);
      expect(error.attempts).toBeGreaterThan(1);
    }
  });

  it("rejects a remote plaintext URL and an invalid TLS certificate", async () => {
    await expect(
      verifier().verifyHealthAndBuildId({
        env: "production",
        liveUrl: "http://example.com",
        expectedCommitSha: NEW_SHA,
        maxWaitMs: 0,
      }),
    ).rejects.toBeInstanceOf(TlsCertificateError);
    app = await startMockDeploy();
    await expect(
      verifier().verifyHealthAndBuildId({
        env: "production",
        liveUrl: app.origin,
        expectedCommitSha: NEW_SHA,
        maxWaitMs: 0,
      }),
    ).resolves.toMatchObject({ buildId: NEW_SHA });
    const expired = new PostDeployVerifier({
      redactor,
      cas: new InMemoryCasBlobStore(),
      tlsProbe: async () => ({ valid: false, mode: "https", reason: "TLS certificate is expired" }),
    });
    await expect(
      expired.verifyHealthAndBuildId({
        env: "production",
        liveUrl: app.origin,
        expectedCommitSha: NEW_SHA,
        maxWaitMs: 0,
      }),
    ).rejects.toBeInstanceOf(TlsCertificateError);
  });

  it("rejects production styleguide, data-ef-source, and stack traces", async () => {
    app = await startMockDeploy({ styleguideStatus: 200 });
    const styleguide = await verifier()
      .verifyHealthAndBuildId({
        env: "production",
        liveUrl: app.origin,
        expectedCommitSha: NEW_SHA,
        maxWaitMs: 20,
        intervalMs: 10,
      })
      .catch((error: unknown) => error);
    expect(styleguide).toBeInstanceOf(DevArtifactLeakError);
    if (styleguide instanceof DevArtifactLeakError) expect(styleguide.kind).toBe("styleguide");

    await app.close();
    app = await startMockDeploy({ leakSource: true });
    const leaked = await verifier()
      .verifyHealthAndBuildId({
        env: "production",
        liveUrl: app.origin,
        expectedCommitSha: NEW_SHA,
        maxWaitMs: 20,
        intervalMs: 10,
      })
      .catch((error: unknown) => error);
    expect(leaked).toBeInstanceOf(DevArtifactLeakError);
    if (leaked instanceof DevArtifactLeakError) expect(leaked.kind).toBe("data-ef-source");

    await app.close();
    app = await startMockDeploy({ leakSource: true, styleguideStatus: 200 });
    await expect(
      verifier().verifyHealthAndBuildId({
        env: "staging",
        liveUrl: app.origin,
        expectedCommitSha: NEW_SHA,
        maxWaitMs: 20,
        intervalMs: 10,
      }),
    ).resolves.toMatchObject({ buildId: NEW_SHA, styleguideStatus: null });

    await app.close();
    app = await startMockDeploy({ stackTrace: true });
    await expect(
      verifier().verifyHealthAndBuildId({
        env: "staging",
        liveUrl: app.origin,
        expectedCommitSha: NEW_SHA,
        maxWaitMs: 20,
        intervalMs: 10,
      }),
    ).rejects.toBeInstanceOf(StackTraceLeakError);
  });

  it("times out when the health endpoint never returns 200", async () => {
    app = await startMockDeploy({ healthStatus: 503 });
    await expect(
      verifier().verifyHealthAndBuildId({
        env: "preview",
        liveUrl: app.origin,
        expectedCommitSha: NEW_SHA,
        maxWaitMs: 30,
        intervalMs: 10,
      }),
    ).rejects.toBeInstanceOf(HealthCheckTimeoutError);
  });
});
