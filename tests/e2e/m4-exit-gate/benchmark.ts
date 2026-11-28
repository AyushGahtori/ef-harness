import { FIVE_HOUR_WINDOW_MS, PPM_SCALE } from "./constants.js";
import { KitchenHiddenAcceptanceSuite, loadM4Fixtures, offlineHiddenFailures } from "./kitchen.js";
import { AllowancePacingController, reservePpm, runReserveBoundary } from "./pacing.js";
import type { GateFaults, M4Fixtures } from "./types.js";
import { buildDirectRequest, postJson, SiwcTokenRefresher, wireProblems } from "./wire.js";
import type { MockPlane } from "./servers.js";

export interface PacedBuild {
  readonly passRate: number;
  readonly hiddenPassed: number;
  readonly hiddenTotal: number;
  readonly hiddenLeak: boolean;
  readonly prematureLockouts: number;
  readonly personalReserveRemainingPpm: number;
  readonly reserveFraction: number;
  readonly ceilingPpm: number;
  readonly windDownPpm: number;
  readonly startCwnd: number;
  readonly peakCwnd: number;
  readonly cwndAfter429: number;
  readonly cwndCapHolds: boolean;
  readonly usageLimitDuringPacedBuild: number;
  readonly withinFiveHours: boolean;
  readonly virtualElapsedMs: number;
  readonly refreshAtMs: number;
  readonly tokenRefreshOk: boolean;
  readonly failedTurns: number;
  readonly lostWip: number;
  readonly threadId: string;
  readonly pacingProfileOk: boolean;
  readonly aimdOk: boolean;
  readonly reserveBoundaryOk: boolean;
  readonly queuedStartedAt89: number;
  readonly wireOk: boolean;
  readonly wireProblems: readonly string[];
}

export class M4AllowancePacedBenchmark {
  async run(plane: MockPlane, faults: GateFaults = {}): Promise<PacedBuild> {
    const fixtures = loadM4Fixtures();
    return runPaced(plane, fixtures, faults);
  }
}

async function runPaced(plane: MockPlane, fixtures: M4Fixtures, faults: GateFaults): Promise<PacedBuild> {
  const profile = fixtures.profile;
  const pacing = new AllowancePacingController(profile.reserveFraction, profile.startCwnd);
  const cwndCapHolds = probeCwnd(pacing);
  const boundary = runReserveBoundary(faults.ignoreWindDown === true);
  const suite = new KitchenHiddenAcceptanceSuite(fixtures.suite);
  const offline = await offlineHiddenFailures();
  const score = suite.score([...(faults.failHiddenIds ?? []), ...offline]);
  const refresher = new SiwcTokenRefresher();
  const sample = buildDirectRequest({
    model: profile.modelId,
    text: "kitchen",
    threadId: profile.threadId,
    ...(faults.wireTemperature === undefined ? {} : { temperature: faults.wireTemperature, leakForbidden: true }),
  });
  const problems = wireProblems(sample);
  let now = 0;
  let refreshed = false;
  let refreshOk = false;
  let failedTurns = 0;
  let lostWip = 0;
  let lockoutInjected = false;
  const prompts: string[] = [];
  const turnReserve = reservePpm(profile.turnTokens, profile.ppmPer1kTokens, profile.safetyMargin);

  for (const task of fixtures.tasks) {
    if (!refreshed && now >= profile.refreshAtMs) {
      for (let burst = 0; burst < profile.burst429Count; burst += 1) pacing.noteTransient429(now);
      const refresh = await refresher.refresh(plane.origin, faults.refreshFails === true);
      refreshed = true;
      refreshOk = refresh.ok && refresh.accessReady;
      if (!refreshOk) {
        failedTurns += 1;
        lostWip = 1;
        break;
      }
    }
    const prompt = suite.buildPrompt(fixtures.opening, task.id, faults.leakHiddenPrompt === true);
    prompts.push(prompt);
    const decision = pacing.requestSlot(turnReserve);
    if (decision !== "granted") {
      failedTurns += 1;
      break;
    }
    if (faults.prematureLockout === true && !lockoutInjected) {
      pacing.noteAbruptUsageLimit();
      pacing.abortInFlight(turnReserve);
      failedTurns += 1;
      lockoutInjected = true;
      break;
    }
    const body = buildDirectRequest({
      model: profile.modelId,
      text: prompt,
      threadId: profile.threadId,
      ...(faults.wireTemperature === undefined ? {} : { temperature: faults.wireTemperature, leakForbidden: true }),
    });
    const posted = await postJson(`${plane.origin}/v1/responses`, body);
    if (posted.status !== 200 || !posted.text.includes(profile.threadId)) {
      pacing.abortInFlight(turnReserve);
      failedTurns += 1;
      break;
    }
    const completedAt = now + profile.turnVirtualMs;
    pacing.settle(turnReserve, turnReserve, completedAt);
    now = completedAt;
  }

  const hiddenLeak = suite.promptsLeak(prompts);
  const mainRemaining = PPM_SCALE - pacing.usedPpm;
  const personalReserveRemainingPpm = Math.min(mainRemaining, boundary.remainingPpm);
  const withinFiveHours =
    now < FIVE_HOUR_WINDOW_MS && now <= profile.windowMs && pacing.usageLimitEvents === 0 && failedTurns === 0;
  const pacingProfileOk =
    pacing.ceilingPpm === 800_000 &&
    pacing.windDownPpm === 720_000 &&
    profile.startCwnd === 2 &&
    profile.reserveFraction === 0.2 &&
    profile.ppmPer1kTokens === 20_000 &&
    profile.refreshAtMs === 3_600_000;
  const cwndAfter429 = pacing.cwndAfter429 ?? -1;
  const aimdOk = profile.startCwnd === 2 && pacing.peakCwnd >= 3 && cwndAfter429 === 1 && pacing.usageLimitEvents === 0;
  const wireOk = problems.length === 0 && plane.rejectedWire.length === 0;
  return {
    passRate: score.rate,
    hiddenPassed: score.passed,
    hiddenTotal: score.total,
    hiddenLeak,
    prematureLockouts: pacing.prematureLockouts,
    personalReserveRemainingPpm,
    reserveFraction: profile.reserveFraction,
    ceilingPpm: pacing.ceilingPpm,
    windDownPpm: pacing.windDownPpm,
    startCwnd: profile.startCwnd,
    peakCwnd: pacing.peakCwnd,
    cwndAfter429,
    cwndCapHolds,
    usageLimitDuringPacedBuild: pacing.usageLimitEvents,
    withinFiveHours,
    virtualElapsedMs: now,
    refreshAtMs: profile.refreshAtMs,
    tokenRefreshOk: refreshOk && lostWip === 0 && refreshed,
    failedTurns,
    lostWip,
    threadId: profile.threadId,
    pacingProfileOk,
    aimdOk,
    reserveBoundaryOk: boundary.ok,
    queuedStartedAt89: boundary.started,
    wireOk,
    wireProblems: problems,
  };
}

function probeCwnd(pacing: AllowancePacingController): boolean {
  const first = pacing.requestSlot(1);
  const second = pacing.requestSlot(1);
  const third = pacing.requestSlot(1);
  if (first === "granted") pacing.abortInFlight(1);
  if (second === "granted") pacing.abortInFlight(1);
  if (third === "granted") pacing.abortInFlight(1);
  return first === "granted" && second === "granted" && third === "cwnd" && pacing.active === 0;
}
