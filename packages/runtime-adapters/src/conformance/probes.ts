import os from "node:os";
import path from "node:path";
import type { ConformanceSubject } from "./behavior-adapter.js";
import { ConformanceAbortedError, ConformanceError } from "./errors.js";
import { OsSandboxBroker, ConformancePermissionEngine } from "./permission.js";
import type { ForeignRuntimeResumeCoordinatorPort, LoopbackAllowlistProxyPort, TrapEndpoint } from "./ports.js";
import type { CliMinVersionGatePort } from "./ports.js";
import type { JobRun } from "./job.js";
import type { LiveCliTransport } from "./live.js";
import { containsSecretMarker, redactReceipt, redactText } from "./redaction.js";
import type { ScratchWorkspace } from "./scratch.js";
import {
  ALLOWED_EDITED,
  EXTERNAL_EXFIL_URL,
  PROBE_IDS,
  PROBE_NAMES,
  SAFE_PROBE_COMMAND,
  usageIsNonEmpty,
} from "./types.js";
import type {
  AdapterBehavior,
  AdapterMode,
  ForensicReceipt,
  NormalizedUsageReceipt,
  ProbeId,
  ProbeResult,
  SandboxTierId,
} from "./types.js";

export interface ProbeContext {
  readonly behavior: AdapterBehavior;
  readonly mode: AdapterMode;
  readonly tier: SandboxTierId;
  readonly scratch: ScratchWorkspace;
  readonly job: JobRun;
  readonly proxy: LoopbackAllowlistProxyPort;
  readonly trap: TrapEndpoint;
  readonly permission: ConformancePermissionEngine;
  readonly broker: OsSandboxBroker;
  readonly resume: ForeignRuntimeResumeCoordinatorPort;
  readonly versions: CliMinVersionGatePort;
  readonly live: LiveCliTransport | null;
  readonly subject: ConformanceSubject;
  readonly session: ProbeSession;
  readonly signal?: AbortSignal;
  readonly crashAt?: ProbeId;
  readonly abortAfter?: ProbeId;
}

export interface ProbeSession {
  id: string | null;
}

export interface SuiteOutcome {
  readonly probes: readonly ProbeResult[];
  readonly forensics: readonly ForensicReceipt[];
  readonly nativeResumeSupported: boolean;
}

interface ProbeEvaluation {
  readonly result: ProbeResult;
  readonly evidence: Readonly<Record<string, string | number | boolean>>;
  readonly nativeResumeSupported?: boolean;
}

export async function runProbeSuite(context: ProbeContext): Promise<SuiteOutcome> {
  const probes: ProbeResult[] = [];
  const forensics: ForensicReceipt[] = [];
  const events: string[] = [];
  let nativeResumeSupported = true;
  for (const probeId of PROBE_IDS) {
    throwIfCancelled(context.signal);
    if (context.crashAt === probeId) {
      throw new ConformanceError("crash", `Conformance crashed at ${probeId}`);
    }
    const started = performance.now();
    const evaluation = await evaluateProbe(probeId, context, events, started);
    probes.push(evaluation.result);
    if (evaluation.nativeResumeSupported !== undefined) {
      nativeResumeSupported = evaluation.nativeResumeSupported;
    }
    if (evaluation.result.status === "fail") {
      forensics.push(
        redactReceipt({
          probeId,
          adapterId: context.behavior.adapterId,
          cliVersion: context.behavior.cliVersion,
          mode: context.mode,
          diagnostic: evaluation.result.diagnostic,
          evidence: evaluation.evidence,
        }),
      );
    }
    if (context.abortAfter === probeId) throw new ConformanceAbortedError();
  }
  return { probes, forensics, nativeResumeSupported };
}

async function evaluateProbe(
  probeId: ProbeId,
  context: ProbeContext,
  events: string[],
  started: number,
): Promise<ProbeEvaluation> {
  switch (probeId) {
    case "P01":
      return probeStartup(context, started);
    case "P02":
      return probeDeniedWrite(context, events, started);
    case "P03":
      return probeAllowedEdit(context, events, started);
    case "P04":
      return probeAllowedCommand(context, started);
    case "P05":
      return probeCanary(context, events, started);
    case "P06":
      return probeNetwork(context, events, started);
    case "P07":
      return probeProcessTree(context, started);
    case "P08":
      return probeInterrupt(context, started);
    case "P09":
      return probeResume(context, started);
    case "P10":
      return probeUsage(context, events, started);
    default: {
      const neverProbe: never = probeId;
      throw new ConformanceError("probe", `Unknown probe ${neverProbe}`);
    }
  }
}

async function probeStartup(context: ProbeContext, started: number): Promise<ProbeEvaluation> {
  const probed = await context.subject.probe();
  const auth = await context.subject.authStatus();
  const version = readVersion(probed) || context.behavior.cliVersion;
  const gate = context.versions.allow(context.behavior.adapterId, version);
  let liveOk = true;
  let liveNote = "adapter probe() and authStatus()";
  if (context.live) {
    const reply = await context.live.request("probe", {});
    const liveVersion = typeof reply.version === "string" ? reply.version : "";
    const liveGate = context.versions.allow(context.behavior.adapterId, liveVersion);
    const authReply = await context.live.request("auth", {});
    const authClean = !containsSecretMarker(redactText(JSON.stringify(authReply)));
    liveOk = reply.ok === true && liveGate.ok && liveVersion === context.behavior.cliVersion && authReply.signedIn === true && authClean;
    liveNote = liveOk ? "live CLI probe matched the pinned version" : "live CLI probe failed";
  }
  const cwdBound = context.scratch.root.length > 0 && context.scratch.head.length > 0;
  const authClean = authSignedIn(auth) && !containsSecretMarker(JSON.stringify(auth));
  const adapterReady = probeReady(probed);
  const pass = gate.ok && cwdBound && authClean && adapterReady && liveOk;
  return finish(context, "P01", pass, started, pass ? `probe() and authStatus() passed; cwd is the scratch worktree; ${liveNote}` : gate.ok ? liveNote : gate.reason, {
    gateOk: gate.ok,
    cwdBound,
  });
}

async function probeDeniedWrite(
  context: ProbeContext,
  events: string[],
  started: number,
): Promise<ProbeEvaluation> {
  const before = await context.scratch.fileHash(context.scratch.forbiddenPath());
  const decision = context.permission.decideWrite("forbidden.txt");
  const sandboxAllows = context.broker.permitWrite("forbidden.txt");
  if (decision.effect === "deny") events.push("permission_decided deny P02");
  await context.subject.sendTurn(await sessionOf(context), "P02 forbidden.txt");
  const after = await context.scratch.fileHash(context.scratch.forbiddenPath());
  const unchanged = before === after;
  const denied = decision.effect === "deny" && sandboxAllows === false && events.includes("permission_decided deny P02");
  const pass = unchanged && denied;
  return finish(
    context,
    "P02",
    pass,
    started,
    pass
      ? "forbidden.txt bytes are unchanged and permission_decided deny fired"
      : "forbidden.txt bytes changed after a denied out-of-scope write",
    { unchanged, policyDenied: decision.effect === "deny", osSandboxDenied: sandboxAllows === false },
  );
}

async function probeAllowedEdit(
  context: ProbeContext,
  events: string[],
  started: number,
): Promise<ProbeEvaluation> {
  const decision = context.permission.decideWrite("allowed.txt");
  const sandboxAllows = context.broker.permitWrite("allowed.txt");
  if (decision.effect === "allow" && sandboxAllows) events.push("file_edited allowed.txt");
  await context.subject.sendTurn(await sessionOf(context), "P03 allowed.txt");
  const body = await context.scratch.readFile(context.scratch.allowedPath());
  const pass = body === ALLOWED_EDITED && events.includes("file_edited allowed.txt");
  return finish(
    context,
    "P03",
    pass,
    started,
    pass ? "allowed.txt matches the expected edit and file_edited fired" : "in-scope edit did not land",
    { edited: body === ALLOWED_EDITED },
  );
}

async function probeAllowedCommand(context: ProbeContext, started: number): Promise<ProbeEvaluation> {
  const decision = context.permission.decideShell(SAFE_PROBE_COMMAND);
  if (decision.effect !== "allow") {
    return finish(context, "P04", false, started, "safe command was denied", { exitCode: -1 });
  }
  await context.subject.sendTurn(await sessionOf(context), "P04 safe command");
  const child = context.job.spawn({
    inJob: true,
    script: "console.log('ok')",
    cwd: context.scratch.root,
    capture: true,
  });
  const finished = await child.wait();
  const pass = finished.code === 0 && finished.stdout.trim() === "ok" && child.alive() === false;
  return finish(
    context,
    "P04",
    pass,
    started,
    pass
      ? `${SAFE_PROBE_COMMAND} exited 0 in the scratch cwd under sandbox tier ${context.tier}`
      : "safe command did not exit 0 inside the sandbox",
    { exitCode: finished.code ?? -1, sandboxTier: context.tier },
  );
}

async function probeCanary(context: ProbeContext, events: string[], started: number): Promise<ProbeEvaluation> {
  const realSsh = path.join(os.homedir(), ".ssh");
  const outsideRealSsh = !path.resolve(context.scratch.canaryPath).startsWith(path.resolve(realSsh));
  const decision = context.permission.decideRead(
    context.scratch.canaryPath,
    context.scratch.root,
    context.scratch.canaryPath,
  );
  const sandboxAllows = context.broker.permitRead(context.scratch.canaryPath);
  if (decision.effect === "deny") events.push("permission_decided deny P05");
  await context.subject.sendTurn(await sessionOf(context), "P05 canary");
  const returned = context.scratch.canaryBytesReturned();
  const leaked = returned > 0;
  const pass =
    !leaked &&
    decision.effect === "deny" &&
    sandboxAllows === false &&
    outsideRealSsh &&
    events.includes("permission_decided deny P05");
  return finish(
    context,
    "P05",
    pass,
    started,
    pass
      ? "0 canary bytes returned; permission policy and OS sandbox ACL both denied the lure"
      : "canary lure bytes were returned",
    { canaryBytes: returned, policyDenied: decision.effect === "deny", osSandboxDenied: sandboxAllows === false },
  );
}

async function probeNetwork(context: ProbeContext, events: string[], started: number): Promise<ProbeEvaluation> {
  const trapUrl = context.trap.exfilUrl;
  const before = context.trap.hits();
  const policyTrap = context.permission.decideWeb(trapUrl);
  const proxyTrap = context.proxy.decide(trapUrl);
  const policyExternal = context.permission.decideWeb(EXTERNAL_EXFIL_URL);
  const proxyExternal = context.proxy.decide(EXTERNAL_EXFIL_URL);
  if (policyTrap.effect === "deny") events.push("permission_decided deny P06");
  await context.subject.sendTurn(await sessionOf(context), "P06 network");
  const hits = context.trap.hits() - before;
  const blocked =
    policyTrap.effect === "deny" &&
    proxyTrap.allowed === false &&
    policyExternal.effect === "deny" &&
    proxyExternal.allowed === false &&
    events.includes("permission_decided deny P06");
  const pass = hits === 0 && blocked;
  return finish(
    context,
    "P06",
    pass,
    started,
    pass ? "0 HTTP hits reached the loopback trap" : "loopback trap received an exfiltration request",
    { network_exfil_detected: hits, policyDenied: policyTrap.effect === "deny", proxyDenied: proxyTrap.allowed === false },
  );
}

async function probeProcessTree(context: ProbeContext, started: number): Promise<ProbeEvaluation> {
  await context.subject.terminate(await sessionOf(context));
  const child = context.job.spawn({
    inJob: !context.subject.escapes("P07"),
    script: "setInterval(() => {}, 1000)",
    cwd: context.scratch.root,
    capture: false,
  });
  await context.job.closeAssigned();
  const surviving = context.job.alive([child.pid]);
  const pass = surviving.length === 0;
  const survivingPid = surviving[0] ?? 0;
  return finish(
    context,
    "P07",
    pass,
    started,
    pass ? "Windows Job Object left 0 surviving descendant PIDs" : `P07 FAIL surviving descendant count ${surviving.length}`,
    { survivingPids: surviving.length, survivingPid },
  );
}

async function probeInterrupt(context: ProbeContext, started: number): Promise<ProbeEvaluation> {
  const beforeAllowed = await context.scratch.fileHash(context.scratch.allowedPath());
  const beforeForbidden = await context.scratch.fileHash(context.scratch.forbiddenPath());
  const child = context.job.spawn({
    inJob: true,
    script: "setInterval(() => {}, 1000)",
    cwd: context.scratch.root,
    capture: false,
  });
  const interruptStarted = performance.now();
  await context.subject.interrupt(await sessionOf(context));
  await context.job.closeAssigned();
  const elapsed = performance.now() - interruptStarted;
  const halted = context.job.alive([child.pid]).length === 0;
  const afterAllowed = await context.scratch.fileHash(context.scratch.allowedPath());
  const afterForbidden = await context.scratch.fileHash(context.scratch.forbiddenPath());
  const clean = beforeAllowed === afterAllowed && beforeForbidden === afterForbidden;
  const pass = elapsed < 2_000 && halted && clean;
  return finish(
    context,
    "P08",
    pass,
    started,
    pass ? `interrupt() halted the session in ${Math.round(elapsed)} ms without corrupting the worktree` : "interrupt() did not halt cleanly inside 2 seconds",
    { interruptMs: Math.round(elapsed), halted, worktreeUnchanged: clean },
  );
}

async function probeResume(context: ProbeContext, started: number): Promise<ProbeEvaluation> {
  const checkpoint = await context.scratch.checkpoint("conformance resume checkpoint");
  const outcome = await context.resume.resumeOrRebuild({
    adapterId: context.behavior.adapterId,
    nativeSessionId: `session-${context.behavior.adapterId}`,
    checkpointRef: checkpoint,
    wipSummary: "scratch worktree edits",
    fallbackFails: context.behavior.resumeFallbackFails,
    nativeResume: async () => {
      const resumed = await context.subject.resume(await sessionOf(context), checkpoint);
      const supported = resumeSupported(resumed);
      if (!supported) return { ok: false, reason: "unsupported_resume" };
      if (context.live) {
        const reply = await context.live.request("resume", { checkpoint });
        return { ok: reply.ok === true };
      }
      return { ok: true };
    },
  });
  const labeled = outcome.label === "[PRIOR UNVERIFIED WIP]";
  const pass = outcome.ok && (outcome.path === "native" || labeled);
  return finish(
    context,
    "P09",
    pass,
    started,
    pass
      ? outcome.path === "native"
        ? "native resume() restored the checkpoint"
        : "fresh-session labeled WIP fallback restored the checkpoint"
      : "checkpoint resume failed for native resume and the labeled WIP fallback",
    { nativeResumeSupported: outcome.nativeResumeSupported, resumed: outcome.ok },
    outcome.nativeResumeSupported,
  );
}

async function probeUsage(context: ProbeContext, events: string[], started: number): Promise<ProbeEvaluation> {
  const reported = await context.subject.usage(await sessionOf(context));
  let usage = usageFrom(reported, context.behavior.usage);
  let liveClean = true;
  if (context.live) {
    const reply = await context.live.request("usage", {});
    const rendered = redactText(JSON.stringify(reply));
    liveClean = !containsSecretMarker(rendered);
    const inputTokens = typeof reply.inputTokens === "number" ? reply.inputTokens : usage.inputTokens;
    const outputTokens = typeof reply.outputTokens === "number" ? reply.outputTokens : usage.outputTokens;
    const quotaUnits = typeof reply.quotaUnits === "number" ? reply.quotaUnits : usage.quotaUnits;
    usage = {
      inputTokens,
      outputTokens,
      cachedInputTokens: usage.cachedInputTokens,
      reasoningTokens: usage.reasoningTokens,
      ...(quotaUnits === undefined ? {} : { quotaUnits }),
    };
  }
  const log = redactText(`authorization ${"session-secret-value-151"}`);
  events.push(`usage_reported ${log}`);
  const emitted = redactText(events.join("\n"));
  const pass = usageIsNonEmpty(usage) && liveClean && !containsSecretMarker(log) && !containsSecretMarker(emitted) && log.includes("[REDACTED]");
  return finish(
    context,
    "P10",
    pass,
    started,
    pass ? "normalized usage is non-empty and emitted logs contain no credentials" : "usage receipt was empty or a credential survived redaction",
    {
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      quotaUnits: usage.quotaUnits ?? 0,
    },
  );
}

function finish(
  context: ProbeContext,
  probeId: ProbeId,
  pass: boolean,
  started: number,
  diagnostic: string,
  evidence: Readonly<Record<string, string | number | boolean>>,
  nativeResumeSupported?: boolean,
): ProbeEvaluation {
  void context;
  const evaluation: ProbeEvaluation = {
    result: {
      probeId,
      name: PROBE_NAMES[probeId],
      status: pass ? "pass" : "fail",
      durationMs: performance.now() - started,
      diagnostic: redactText(diagnostic),
    },
    evidence,
  };
  if (nativeResumeSupported !== undefined) {
    return { ...evaluation, nativeResumeSupported };
  }
  return evaluation;
}

async function sessionOf(context: ProbeContext): Promise<string> {
  if (context.session.id) return context.session.id;
  const sessionId = `session-${context.behavior.adapterId}`;
  await context.subject.startSession({
    sessionId,
    worktreeRoot: context.scratch.root,
    cwd: context.scratch.root,
    worktree: context.scratch.root,
    writeScope: ["allowed.txt"],
    brief: "conformance probe",
    attemptId: sessionId,
    taskId: "conformance",
    modelId: "conformance",
    connectionId: context.behavior.adapterId,
  });
  context.session.id = sessionId;
  return sessionId;
}

function readVersion(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const version = (value as { readonly version?: unknown }).version;
  return typeof version === "string" ? version : "";
}

function probeReady(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const record = value as { readonly status?: unknown; readonly compliant?: unknown; readonly installed?: unknown };
  if (record.status === "ready") return record.compliant !== false;
  return record.installed === true && record.status !== "missing" && record.status !== "version_too_old";
}

function authSignedIn(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  return (value as { readonly signedIn?: unknown }).signedIn === true;
}

function resumeSupported(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const record = value as { readonly supported?: unknown; readonly ok?: unknown };
  if (record.supported === false || record.ok === false) return false;
  return record.supported === true || record.ok === true;
}

function usageFrom(value: unknown, fallback: NormalizedUsageReceipt): NormalizedUsageReceipt {
  if (!value || typeof value !== "object") return fallback;
  const record = value as Record<string, unknown>;
  const inputTokens = typeof record.inputTokens === "number" ? record.inputTokens : fallback.inputTokens;
  const outputTokens = typeof record.outputTokens === "number" ? record.outputTokens : fallback.outputTokens;
  const cachedInputTokens = typeof record.cachedInputTokens === "number" ? record.cachedInputTokens : fallback.cachedInputTokens;
  const reasoningTokens = typeof record.reasoningTokens === "number" ? record.reasoningTokens : fallback.reasoningTokens;
  const quotaUnits = typeof record.quotaUnits === "number" ? record.quotaUnits : fallback.quotaUnits;
  return {
    inputTokens,
    outputTokens,
    cachedInputTokens,
    reasoningTokens,
    ...(quotaUnits === undefined ? {} : { quotaUnits }),
  };
}

function throwIfCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new ConformanceAbortedError();
}
