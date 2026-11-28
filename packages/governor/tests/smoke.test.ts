import { describe, expect, it } from "vitest";
import {
  AttestedVsVerifiedBadgePolicy,
  HumanStepProbeRegistry,
  LiveKeyTestRefusalGuard,
  RuntimeOnlyEnvInjector,
  WindowsDpapiSecretsVault,
  admission,
  capacityPools,
  humanSteps,
  layer,
  packageName,
  telemetry,
  vault,
} from "../src/index.js";

describe("@ef-harness/governor", () => {
  it("publishes a stable package identity", () => {
    expect(packageName).toBe("@ef-harness/governor");
    expect(layer).toBe(3);
  });

  it("exports telemetry, admission, capacity pools, vault, and human steps", () => {
    expect(telemetry).toBeTypeOf("object");
    expect(admission).toBeTypeOf("object");
    expect(capacityPools).toBeTypeOf("object");
    expect(vault.WindowsDpapiSecretsVault).toBe(WindowsDpapiSecretsVault);
    expect(humanSteps.HumanStepProbeRegistry).toBe(HumanStepProbeRegistry);
    expect(humanSteps.AttestedVsVerifiedBadgePolicy).toBe(AttestedVsVerifiedBadgePolicy);
    expect(RuntimeOnlyEnvInjector).toBeTypeOf("function");
    expect(LiveKeyTestRefusalGuard).toBeTypeOf("function");
  });
});
