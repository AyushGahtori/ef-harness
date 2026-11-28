import { expect, it } from "vitest";
import {
  DOC_COUNT,
  EXPECTED_OFFICE_TAG,
  PINNED_COMMIT,
  PLAN_FILE_COUNT,
  PLAN_LINE_COUNT,
} from "../m5-exit-gate/constants.js";
import { formatAgentOfficeTag } from "../m5-exit-gate/office-tag.js";
import { M5ExitGateReport, signReport } from "../m5-exit-gate/report.js";
import { runLiveCertification, runM5Certification } from "../m5-exit-gate/runner.js";
import { ZeroStashLandingExecutor, loadGuidedChangeFixture } from "../m5-exit-gate/brownfield.js";
import { fixtureJsonPath } from "../m5-exit-gate/paths.js";
import { greyThenBlack, ProjectVerifiedSpokenIdNormalizer } from "../m5-exit-gate/ux.js";
import { VERIFIED_IDS } from "../m5-exit-gate/constants.js";

it("passes the resume-changer M5 ci-replay exit gate", async () => {
  const report = await runM5Certification();
  expect(report.reasons.join(",")).toBe("");
  expect(report.exitCode).toBe(0);
  expect(report.claimedCertification).toBe(true);
  expect(report.mode).toBe("ci-replay");
  const facts = report.facts;
  expect(facts).not.toBeNull();
  if (!facts) return;
  expect(facts.commit).toBe(PINNED_COMMIT);
  expect(facts.docCount).toBe(DOC_COUNT);
  expect(facts.planFileCount).toBe(PLAN_FILE_COUNT);
  expect(facts.planLineCount).toBe(PLAN_LINE_COUNT);
  expect(facts.stackNext).toBe(true);
  expect(facts.stackTailwind).toBe(true);
  expect(facts.stackVitest).toBe(true);
  expect(facts.secretBytesRead).toBe(0);
  expect(facts.l0ElapsedMs).toBeLessThan(2_000);
  expect(facts.symbolCount).toBeGreaterThan(0);
  expect(facts.rankedFileCount).toBeGreaterThan(0);
  expect(facts.codeIndexDb).toBe("code-index.db");
  expect(facts.focusCount).toBeGreaterThan(0);
  expect(facts.focusCount).toBeLessThanOrEqual(20);
  expect(facts.focusIncludesDeleted).toBe(false);
  expect(facts.staleFlagged).toBe(true);
  expect(facts.staleIgnored).toBe(true);
  expect(facts.preSpendShown).toBe(true);
  expect(facts.stackQuestions).toBe(0);
  expect(facts.todayChangeConfirmed).toBe(true);
  expect(facts.secondUiKit).toBe(false);
  expect(facts.baselinePassRate).toBe(1);
  expect(facts.newChecksPass).toBe(true);
  expect(facts.interruptions).toBe(0);
  expect(facts.shaPreserved).toBe(true);
  expect(facts.stashCount).toBe(0);
  expect(facts.humanOwned).toBe(true);
  expect(facts.developerAuthorship).toBe(true);
  expect(facts.scopeFenceOk).toBe(true);
  expect(facts.uiStagesPassed).toBe(6);
  expect(facts.contrastOk).toBe(true);
  expect(facts.rhythmOk).toBe(true);
  expect(facts.pinnedCount).toBe(3);
  expect(facts.pinnedSurvived).toBe(true);
  expect(facts.zoomTrail).toEqual(["L1", "L2", "L3", "L4"]);
  expect(facts.impactLlmCalls).toBe(0);
  expect(facts.impactElapsedMs).toBeLessThan(15);
  expect(facts.driftPromptShown).toBe(true);
  expect(facts.highlightExact).toBe(true);
  expect(facts.streamedGreyThenBlack).toBe(true);
  expect(facts.draftsPreserved).toBe(true);
  expect(facts.mismatchBlocked).toBe(true);
  expect(facts.dictationAutoSend).toBe(false);
  expect(facts.hintAt3s).toBe(true);
  expect(facts.micOnAt3s).toBe(true);
  expect(facts.micOffAt60s).toBe(true);
  expect(facts.draftKept).toBe(true);
  expect(facts.amberTimes).toBe(true);
  expect(facts.amberNegations).toBe(true);
  expect(facts.supabasePromoted).toBe(true);
  expect(facts.spokenRuleSeventeen).toBe("change R17");
  expect(facts.spokenThereSeventeen).toBe("there are seventeen menus");
  expect(facts.spokenMissingId).toBe("rule ninety nine");
  expect(facts.previewIsolated).toBe(true);
  expect(facts.demoRowsKept).toBe(2);
  expect(facts.prodSourceTagsCount).toBe(0);
  expect(facts.clickCaptured).toBe(true);
  expect(facts.gapCaptured).toBe(true);
  expect(facts.baselineUpdated).toBe(true);
  expect(facts.roomCount).toBe(11);
  expect(facts.castTruthful).toBe(true);
  expect(facts.officeTag).toBe(EXPECTED_OFFICE_TAG);
  expect(facts.helperVisible).toBe(3);
  expect(facts.helperPill).toBe("+2");
  expect(facts.iconLagMs).toBe(0);
  expect(facts.maxVisualLagMs).toBeLessThanOrEqual(2_000);
  expect(facts.teleported).toBe(true);
  expect(facts.burstQueueLen).toBeLessThanOrEqual(2);
  expect(facts.idleCpuPercent).toBeLessThan(5);
  expect(facts.hiddenCpuPercent).toBe(0);
  expect(facts.reducedMotionStatic).toBe(true);
  expect(facts.orangeBoard).toBe(true);
  expect(facts.hotDeskWorkers).toBeGreaterThanOrEqual(30);
  expect(facts.hotDeskOverflow).toBe(facts.hotDeskWorkers - 28);
  expect(facts.axeSerious).toBe(0);
  expect(facts.decorativeNpcs).toBe(0);
  expect(report.hostElapsedMs).toBeLessThan(120_000);
  expect(report.signature.startsWith("sha256:")).toBe(true);
  expect(signReport(report.payload())).toBe(report.signature);
  expect(report.renderScorecard()).toContain("Exit: 0");
  expect(report.renderScorecard()).toContain(PINNED_COMMIT);
  expect(report.renderScorecard()).toContain("73");
  expect(report.renderScorecard()).toContain("4906");
  expect(report.renderScorecard()).toContain(EXPECTED_OFFICE_TAG);
}, 30_000);

it("fails closed on stash, prod tags, lag, auto-send, stale docs, and UI drift", async () => {
  const passed = await runM5Certification();
  expect(passed.exitCode).toBe(0);
  const facts = passed.facts;
  expect(facts).not.toBeNull();
  if (!facts) return;
  const gated = M5ExitGateReport.evaluate({ ...facts, prodSourceTagsCount: 1, maxVisualLagMs: 2_300 }, 1);
  expect(gated.exitCode).toBe(1);
  expect(gated.claimedCertification).toBe(false);
  expect(gated.reasons).toContain("prodSourceTags");
  expect(gated.reasons).toContain("officeVisualLag");

  const stash = await runM5Certification({ faults: { silentStash: true } });
  expect(stash.reasons).toContain("silentStash");
  expect(stash.facts?.stashCount).toBeGreaterThan(0);

  const leak = await runM5Certification({ faults: { prodSourceTagCount: 1 } });
  expect(leak.facts?.prodSourceTagsCount).toBeGreaterThan(0);
  expect(leak.reasons).toContain("prodSourceTags");

  const lag = await runM5Certification({ faults: { disableLagTeleport: true } });
  expect(lag.facts?.maxVisualLagMs).toBe(2_300);
  expect(lag.reasons).toContain("officeVisualLag");

  const autoSend = await runM5Certification({ faults: { dictationAutoSend: true } });
  expect(autoSend.facts?.dictationAutoSend).toBe(true);
  expect(autoSend.reasons).toContain("dictationAutoSend");

  const stale = await runM5Certification({ faults: { ignoreStaleDoc: true } });
  expect(stale.facts?.focusIncludesDeleted).toBe(true);
  expect(stale.reasons).toContain("staleDocs");

  const contrast = await runM5Certification({ faults: { contrastDrift: true } });
  expect(contrast.reasons).toContain("uiContrast");
  expect(contrast.reasons).toContain("uiConsistency");

  const rhythm = await runM5Certification({ faults: { headerDrift: true } });
  expect(rhythm.reasons).toContain("uiRhythm");

  const scope = await runM5Certification({ faults: { editUntouchedFile: true } });
  expect(scope.reasons).toContain("scopeFence");

  const kit = await runM5Certification({ faults: { installSecondUiKit: true } });
  expect(kit.reasons).toContain("secondUiKit");

  const secrets = await runM5Certification({ faults: { readEnvSecrets: true } });
  expect(secrets.facts?.secretBytesRead).toBeGreaterThan(0);
  expect(secrets.reasons).toContain("l0Secrets");

  const author = await runM5Certification({ faults: { spoofHumanAuthor: true } });
  expect(author.reasons).toContain("humanAuthorship");
}, 30_000);

it("keeps pinned speech, office tags, and the zero-stash landing", () => {
  const tag = formatAgentOfficeTag("A0014", "Implement a printable meal summary page");
  expect(tag.text).toBe(EXPECTED_OFFICE_TAG);
  expect(tag.text.length).toBeLessThanOrEqual(22);
  expect(greyThenBlack()).toBe(true);
  const normalizer = new ProjectVerifiedSpokenIdNormalizer(new Set(VERIFIED_IDS));
  expect(normalizer.normalize("there are seventeen menus", true)).toBe("there are seventeen menus");
  expect(normalizer.normalize("change rule seventeen", false)).toBe("change R17");
  expect(normalizer.normalize("rule ninety nine", false)).toBe("rule ninety nine");
  expect(normalizer.normalize("rule ninety nine", true)).toBe("R99");
  const fixture = loadGuidedChangeFixture(fixtureJsonPath());
  const clean = new ZeroStashLandingExecutor().land(fixture, {
    editUntouchedFile: false,
    installSecondUiKit: false,
    prodSourceTagCount: 0,
    silentStash: false,
    disableLagTeleport: false,
    dictationAutoSend: false,
    ignoreStaleDoc: false,
    contrastDrift: false,
    headerDrift: false,
    dropPinnedDrag: false,
    impactLlmCalls: 0,
    skipDriftPrompt: false,
    allowBareDigit: false,
    normalizeMissingId: false,
    readEnvSecrets: false,
    redundantStackQuestions: 0,
    baselineRegression: false,
    spoofHumanAuthor: false,
    interruptUntouchedEdit: false,
    clobberDirtySha: false,
    iconLagMs: 0,
    idleCpuOverride: null,
    hiddenCpuOverride: null,
    ignoreReducedMotion: false,
    ignoreOrangeFallback: false,
    hideOverflow: false,
    axeSerious: 0,
    decorativeNpcs: 0,
    showAllHelpers: false,
    focusBeyondCap: false,
    l0ElapsedOverrideMs: 0,
    skipHighlight: false,
    leakPreviewPartition: false,
    dropDemoRows: false,
    skipBaselineUpdate: false,
    wipeDraftOnSwitch: false,
  });
  expect(clean.stashCount).toBe(0);
  expect(clean.commands.some((command) => command.includes("stash"))).toBe(false);
  expect(clean.scopeFenceOk).toBe(true);
});

it("does not claim live certification and does not clone", () => {
  const missing = runLiveCertification({});
  expect(missing.exitCode).toBe(2);
  expect(missing.claimedCertification).toBe(false);
  expect(missing.reasons).toContain("liveNotClaimed");
  expect(missing.liveCheckoutSeen).toBe(false);
  const configured = runLiveCertification({ EF_M5_LIVE_CONFIRM: "1", EF_M5_RESUME_CHANGER_ROOT: "" });
  expect(configured.exitCode).toBe(2);
  expect(configured.claimedCertification).toBe(false);
});
