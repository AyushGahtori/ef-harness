import { afterEach, describe, expect, it } from "vitest";
import {
  InMemoryCasBlobStore,
  MutatingSmokeForbiddenError,
  PostDeployVerifier,
  SmokeCheckFailedError,
  assertSmokeRequestAllowed,
  createFallbackPacketSecurityRedactor,
} from "../../src/post-deploy/index.js";
import { NEW_SHA, startMockDeploy, type MockDeploy } from "./helpers.js";

const redactor = createFallbackPacketSecurityRedactor();
let app: MockDeploy | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

function verifier(): PostDeployVerifier {
  return new PostDeployVerifier({ redactor, cas: new InMemoryCasBlobStore() });
}

describe("post-deploy read-only smoke", () => {
  it("loads public routes at 375px and 1440px without mutating or calling Stripe", async () => {
    app = await startMockDeploy();
    const receipt = await verifier().runDeployedSmoke({
      env: "production",
      liveUrl: app.origin,
      protectedRoutes: ["/account"],
    });
    expect(receipt.passed).toBe(true);
    expect(receipt.viewports.map((viewport) => viewport.width)).toEqual([375, 1440]);
    expect(receipt.consoleErrors).toEqual([]);
    expect(receipt.failedAssets).toEqual([]);
    expect(receipt.brokenImages).toEqual([]);
    expect(receipt.routes.some((route) => route.path === "/" && route.title === "Kitchen" && route.shellMounted)).toBe(
      true,
    );
    expect(receipt.routes.some((route) => route.path === "/account" && route.status === 401)).toBe(true);
    expect(receipt.network.every((hop) => hop.method === "GET")).toBe(true);
    expect(receipt.network.some((hop) => hop.url.includes("stripe.com"))).toBe(false);
    expect(receipt.skippedSideEffectUrls.some((url) => url.includes("js.stripe.com"))).toBe(true);
    expect(app.requests.every((request) => request.method === "GET")).toBe(true);
    expect(receipt.receiptSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("fails production smoke on an uncaught ReferenceError and does not post", async () => {
    app = await startMockDeploy({ ordersBroken: true });
    const error = await verifier()
      .runDeployedSmoke({
        env: "production",
        liveUrl: app.origin,
        publicRoutes: ["/orders"],
      })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(SmokeCheckFailedError);
    if (error instanceof SmokeCheckFailedError) {
      expect(error.consoleErrors.some((line) => line === "ReferenceError: window is not defined")).toBe(true);
      expect(error.screenshotSha256).toMatch(/^[a-f0-9]{64}$/);
    }
    expect(app.requests.every((request) => request.method === "GET")).toBe(true);
  });

  it("fails on broken images, missing css, and an unlocked protected route", async () => {
    app = await startMockDeploy({ brokenImage: true });
    const broken = await verifier()
      .runDeployedSmoke({ env: "staging", liveUrl: app.origin, publicRoutes: ["/"] })
      .catch((caught: unknown) => caught);
    expect(broken).toBeInstanceOf(SmokeCheckFailedError);
    if (broken instanceof SmokeCheckFailedError) {
      expect(broken.brokenImages.length).toBeGreaterThan(0);
    }

    await app.close();
    app = await startMockDeploy({ missingCss: true });
    const missing = await verifier()
      .runDeployedSmoke({ env: "staging", liveUrl: app.origin, publicRoutes: ["/"] })
      .catch((caught: unknown) => caught);
    expect(missing).toBeInstanceOf(SmokeCheckFailedError);
    if (missing instanceof SmokeCheckFailedError) {
      expect(missing.failedAssets.some((asset) => asset.kind === "stylesheet" && asset.status === 404)).toBe(true);
    }

    await app.close();
    app = await startMockDeploy({ protectedStatus: 200 });
    const unlocked = await verifier()
      .runDeployedSmoke({
        env: "production",
        liveUrl: app.origin,
        publicRoutes: ["/api/health"],
        protectedRoutes: ["/account"],
      })
      .catch((caught: unknown) => caught);
    expect(unlocked).toBeInstanceOf(SmokeCheckFailedError);
    if (unlocked instanceof SmokeCheckFailedError) {
      expect(unlocked.failures.some((failure) => failure.code === "protected-route-unlocked")).toBe(true);
    }
  });

  it("forbids mutating methods, email endpoints, and live Stripe URLs", () => {
    expect(() => assertSmokeRequestAllowed("POST", `http://127.0.0.1/api/orders`)).toThrow(
      MutatingSmokeForbiddenError,
    );
    expect(() => assertSmokeRequestAllowed("GET", "https://api.stripe.com/v1/charges")).toThrow(
      MutatingSmokeForbiddenError,
    );
    expect(() => assertSmokeRequestAllowed("GET", "mailto:kitchen@example.com")).toThrow(
      MutatingSmokeForbiddenError,
    );
    expect(() => assertSmokeRequestAllowed("GET", "https://app.example.com/api/email/send")).toThrow(
      MutatingSmokeForbiddenError,
    );
    expect(NEW_SHA).toHaveLength(40);
  });
});
