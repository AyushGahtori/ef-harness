import { expect, it } from "vitest";
import { auditPrivacyDeploy } from "./ports/privacy-deploy.ts";

it("pillar 5 — zero-telemetry privacy & deploy secret hygiene", () => {
  const facts = auditPrivacyDeploy();
  expect(facts.crashUploadDisabled).toBe(true);
  expect(facts.telemetryBeacons).toBe(0);
  expect(facts.whisperWritesWav).toBe(0);
  expect(facts.dockerArgvSecrets).toBe(0);
  expect(facts.dockerStrictHostKeyChecking).toBe(true);
  expect(facts.nameOnlyEnvPrints).toBe(0);
  expect(facts.liveSecretBlockedInPreview).toBe(true);
  expect(facts.publicHarnessStatePushDefault).toBe(true);
  expect(facts.ageSealedPlaintextBytes).toBe(0);
  expect(facts.gitStashCalls).toBe(0);
});