import { KERNEL_RULES_TEXT, LEAF_WORKER_ROLE_INSTRUCTION, ZONE_MARKER } from "./constants.js";
import {
  collapsedToolText,
  isReadTool,
  primaryToolPath,
  supersededMarker,
  verbatimStepSet,
} from "./history.js";
import type { ModelProfile, ShouldEntry, TaskPacketV1 } from "./ports.js";
import { escapeProvenanceText } from "./ports.js";
import type { TokenEstimator } from "./token-estimator.js";
import type { TokenKind } from "./token-kinds.js";
import {
  LARGE_MODEL_MAX_READ_LINES,
  LARGE_MODEL_MAX_TEST_FAILURES,
  SMALL_CONTEXT_WINDOW_MAX,
  SMALL_MODEL_MAX_READ_LINES,
  SMALL_MODEL_MAX_TEST_FAILURES,
  SMALL_MODEL_VERBATIM_STEPS,
  type ContextCaps,
  type ContextMessage,
  type ContextZone,
  type RenderStep,
  type RenderToolCall,
  type WorkingMemory,
} from "./types.js";
import { canonicalWorkingMemoryJson, sha256Hex } from "./working-memory.js";

export interface Assembly {
  readonly kernelRules: string;
  readonly roleInstruction: string;
  readonly packet: TaskPacketV1;
  readonly shouldItems: readonly ShouldEntry[];
  readonly memory: WorkingMemory;
  readonly brief: string | null;
  readonly progressNote: string | null;
  readonly steps: readonly RenderStep[];
  readonly currentStep: number;
  readonly caps: ContextCaps;
  readonly toolSchemaJson: string | null;
}

export interface RenderedContext {
  readonly zones: readonly [
    ContextZone,
    ContextZone,
    ContextZone,
    ContextZone,
    ContextZone,
    ContextZone,
  ];
  readonly messages: readonly ContextMessage[];
  readonly prefixText: string;
  readonly prefixHash: string;
  readonly text: string;
  readonly verbatimStepNumbers: readonly number[];
}

export function resolveContextCaps(profile: Pick<ModelProfile, "contextWindow">): ContextCaps {
  if (profile.contextWindow <= SMALL_CONTEXT_WINDOW_MAX) {
    return {
      smallModel: true,
      verbatimSteps: SMALL_MODEL_VERBATIM_STEPS,
      maxReadLines: SMALL_MODEL_MAX_READ_LINES,
      maxTestFailures: SMALL_MODEL_MAX_TEST_FAILURES,
      windowedSymbolOutline: true,
    };
  }
  let verbatimSteps = 8;
  if (profile.contextWindow > 65_536) verbatimSteps = 12;
  if (profile.contextWindow > 131_072) verbatimSteps = 16;
  return {
    smallModel: false,
    verbatimSteps,
    maxReadLines: LARGE_MODEL_MAX_READ_LINES,
    maxTestFailures: LARGE_MODEL_MAX_TEST_FAILURES,
    windowedSymbolOutline: false,
  };
}

export function minimalReserveTokens(profile: Pick<ModelProfile, "maxOutputTokens">): number {
  return Math.min(1024, Math.max(256, profile.maxOutputTokens));
}

export function compactionTargetTokens(contextWindow: number, tightened: boolean): number {
  const base = Math.floor(contextWindow * 0.7);
  return tightened ? Math.floor(base * 0.85) : base;
}

export function defaultKernelRules(): string {
  return KERNEL_RULES_TEXT;
}

export function defaultRoleInstruction(): string {
  return LEAF_WORKER_ROLE_INSTRUCTION;
}

export function renderZone1(kernelRules: string, roleInstruction: string): string {
  return [
    ZONE_MARKER[1],
    `<instruction source="kernel">`,
    escapeProvenanceText(kernelRules),
    `</instruction>`,
    `<instruction source="leaf-worker@1">`,
    escapeProvenanceText(roleInstruction),
    `</instruction>`,
  ].join("\n");
}

export function renderMustBand(packet: TaskPacketV1): string {
  const lines: string[] = [
    ZONE_MARKER[2],
    `<instruction source="task-packet-must">`,
    `TASK ${escapeProvenanceText(packet.task)} ATTEMPT ${packet.attempt} EPOCH ${packet.epoch} BRIEF ${packet.brief_version}`,
    `BASE ${escapeProvenanceText(packet.base.branch)} ${escapeProvenanceText(packet.base.commit)}`,
    "GOAL",
    escapeProvenanceText(packet.goal),
    "WRITE_SCOPE",
  ];
  for (const scope of packet.write_scope) lines.push(`- ${escapeProvenanceText(scope)}`);
  lines.push("CONTRACTS");
  for (const contract of packet.contracts) {
    const suffix = contract.text === undefined ? "" : ` ${escapeProvenanceText(contract.text)}`;
    lines.push(
      `- ${escapeProvenanceText(contract.id)}@${contract.v} (${contract.role})${suffix}`,
    );
  }
  lines.push("MUST");
  for (const item of packet.must) {
    lines.push(`- ${escapeProvenanceText(item.id)}@${item.v} ${escapeProvenanceText(item.text)}`);
  }
  lines.push("VISIBLE_CHECKS");
  for (const check of packet.checks_visible) lines.push(`- ${escapeProvenanceText(check)}`);
  lines.push(`HIDDEN_CHECKS: ${packet.checks_hidden_count}`);
  lines.push("PINNED_SKILLS");
  for (const skill of packet.skills) {
    lines.push(`- ${escapeProvenanceText(skill.id)} ${escapeProvenanceText(skill.digest)}`);
  }
  lines.push("TOOLS");
  for (const tool of packet.tools) lines.push(`- ${escapeProvenanceText(tool)}`);
  lines.push("LIMITS");
  lines.push(`wall_min=${packet.limits.wall_min} max_steps=${packet.limits.max_steps}`);
  lines.push("BUDGET");
  const allowanceKeys = Object.keys(packet.budget.allowance_ppm).sort();
  const allowance = allowanceKeys
    .map((key) => `${key}=${packet.budget.allowance_ppm[key] ?? 0}`)
    .join(",");
  lines.push(
    `usd_micro=${packet.budget.usd_micro} local_slots=${packet.budget.local_slots} allowance_ppm=${allowance}`,
  );
  lines.push("</instruction>");
  return lines.join("\n");
}

export function renderShouldBand(items: readonly ShouldEntry[]): string {
  const lines = [ZONE_MARKER[3], `<data source="task_packet_should" trust="kernel">`];
  for (const item of items) lines.push(`- ${escapeProvenanceText(shouldText(item))}`);
  lines.push("</data>");
  return lines.join("\n");
}

export function renderWorkingMemoryZone(memory: WorkingMemory): string {
  return [
    ZONE_MARKER[4],
    `<data source="working_memory" trust="untrusted">`,
    escapeProvenanceText(canonicalWorkingMemoryJson(memory)),
    "</data>",
  ].join("\n");
}

export function renderTailChecklist(packet: TaskPacketV1, step: number): string {
  return [
    ZONE_MARKER[6],
    `<instruction source="tail-checklist">`,
    `MUST_IDS: ${packet.must.map((item) => item.id).join(" ")}`,
    `CHECKS: ${packet.checks_visible.join(" ")}`,
    `WRITE_SCOPE: ${packet.write_scope.join(" ")}`,
    `CURRENT_STEP: ${step}`,
    "</instruction>",
  ].join("\n");
}

export function renderContext(assembly: Assembly): RenderedContext {
  const zone1 = renderZone1(assembly.kernelRules, assembly.roleInstruction);
  const zone2 = renderMustBand(assembly.packet);
  const zone3 = renderShouldBand(assembly.shouldItems);
  const zone4 = renderWorkingMemoryZone(assembly.memory);
  const history = renderHistory(assembly);
  const zone6 = renderTailChecklist(assembly.packet, assembly.currentStep);
  const zones = [
    zone(1, "kernel_role", true, zone1),
    zone(2, "must", true, zone2),
    zone(3, "should", false, zone3),
    zone(4, "working_memory", false, zone4),
    zone(5, "history", false, history.text),
    zone(6, "tail", true, zone6),
  ] as const;
  const messages: ContextMessage[] = [
    { role: "system", zone: 1, content: zone1 },
    { role: "system", zone: 2, content: zone2 },
    { role: "system", zone: 3, content: zone3 },
    { role: "system", zone: 4, content: zone4 },
    ...history.messages,
    { role: "user", zone: 6, kind: "tail", content: zone6 },
  ];
  const prefixText = `${zone1}\n${zone2}`;
  return {
    zones,
    messages,
    prefixText,
    prefixHash: sha256Hex(prefixText),
    text: zones.map((item) => item.text).join("\n"),
    verbatimStepNumbers: assembly.steps.filter((step) => step.mode === "verbatim").map((step) => step.step),
  };
}

export function estimateAssembly(assembly: Assembly, estimator: TokenEstimator): number {
  const rendered = renderContext(assembly);
  const parts: { text: string; kind: TokenKind }[] = [
    { text: rendered.zones[0].text, kind: "prose" },
    { text: rendered.zones[1].text, kind: "mixed" },
    { text: rendered.zones[2].text, kind: "prose" },
    { text: rendered.zones[3].text, kind: "json" },
    { text: rendered.zones[4].text, kind: "mixed" },
    { text: rendered.zones[5].text, kind: "prose" },
  ];
  if (assembly.toolSchemaJson !== null && assembly.toolSchemaJson.length > 0) {
    parts.push({ text: assembly.toolSchemaJson, kind: "json" });
  }
  return estimator.estimateRequest(parts);
}

export function contentTokens(text: string, kind: TokenKind, estimator: TokenEstimator): number {
  return estimator.estimateText(text, kind);
}

export function displayModes(steps: readonly { readonly step: number }[], caps: ContextCaps): (step: number) => RenderStep["mode"] {
  const verbatim = verbatimStepSet(steps, caps.verbatimSteps);
  return (step) => (verbatim.has(step) ? "verbatim" : "collapsed");
}

export function toolPairViolations(messages: readonly ContextMessage[]): string[] {
  const violations: string[] = [];
  const consumed = new Set<number>();
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (message === undefined) continue;
    if (message.role === "tool") {
      if (!consumed.has(index)) violations.push(`orphaned tool_result ${message.toolUseId}`);
      continue;
    }
    if (message.role !== "assistant") continue;
    for (let toolIndex = 0; toolIndex < message.toolUses.length; toolIndex += 1) {
      const use = message.toolUses[toolIndex];
      const nextIndex = index + 1 + toolIndex;
      const next = messages[nextIndex];
      if (use === undefined) continue;
      if (next === undefined || next.role !== "tool" || next.toolUseId !== use.id || next.step !== message.step) {
        violations.push(`tool_use ${use.id} missing matching tool_result`);
        continue;
      }
      consumed.add(nextIndex);
    }
  }
  return violations;
}

function renderHistory(assembly: Assembly): { text: string; messages: ContextMessage[] } {
  const messages: ContextMessage[] = [
    { role: "user", zone: 5, kind: "history_marker", content: ZONE_MARKER[5] },
  ];
  if (assembly.brief !== null) {
    messages.push({
      role: "user",
      zone: 5,
      kind: "brief",
      content: `<user>\n${escapeProvenanceText(assembly.brief)}\n</user>`,
    });
  }
  if (assembly.progressNote !== null) {
    messages.push({
      role: "user",
      zone: 5,
      kind: "progress_note",
      content: `<data source="progress_note" trust="untrusted">\n${escapeProvenanceText(assembly.progressNote)}\n</data>`,
    });
  }
  for (const step of assembly.steps) {
    if (step.mode === "omitted") continue;
    messages.push(...renderStepMessages(step, assembly.caps));
  }
  return { text: messages.map((message) => message.content).join("\n"), messages };
}

function renderStepMessages(step: RenderStep, caps: ContextCaps): ContextMessage[] {
  const verbatim = step.mode === "verbatim";
  const reasoning = verbatim ? step.reasoning.map((item) => ({ kind: "reasoning" as const, opaque: item.opaque })) : [];
  const content = verbatim ? renderAssistantContent(step.assistantText, reasoning) : oneLineAssistant(step);
  const assistant: ContextMessage = {
    role: "assistant",
    zone: 5,
    step: step.step,
    content,
    reasoning,
    toolUses: step.toolCalls.map((call) => ({ id: call.id, name: call.name })),
  };
  const tools: ContextMessage[] = step.toolCalls.map((call) => ({
    role: "tool",
    zone: 5,
    step: step.step,
    toolUseId: call.id,
    name: call.name,
    content: renderToolBody(step, call, caps),
    artifactIds: [...call.artifactIds],
  }));
  return [assistant, ...tools];
}

function renderAssistantContent(text: string, reasoning: readonly { readonly opaque: string }[]): string {
  const blocks = [text];
  for (const item of reasoning) {
    blocks.push(`<reasoning-item>\n${item.opaque}\n</reasoning-item>`);
  }
  return blocks.join("\n");
}

function oneLineAssistant(step: RenderStep): string {
  const first = step.assistantText.trim().split("\n")[0] ?? "";
  const clipped = first.length > 160 ? `${first.slice(0, 157)}...` : first;
  if (clipped.length > 0) return clipped;
  const names = step.toolCalls.map((call) => call.name).join(", ");
  return `step ${step.step}: ${names.length > 0 ? names : "no tools"}`;
}

function renderToolBody(step: RenderStep, call: RenderToolCall, caps: ContextCaps): string {
  if (call.superseded && isReadTool(call.name)) {
    return supersededMarker(primaryToolPath(call.input) ?? "unknown", step.step);
  }
  if (step.mode !== "verbatim") return collapsedToolText(call);
  let body = call.content;
  if (isReadTool(call.name)) {
    body = applyReadCap(body, caps, call.symbolOutline, primaryToolPath(call.input) ?? "unknown");
  }
  if (call.testFailures !== undefined && call.testFailures.length > caps.maxTestFailures) {
    const shown = call.testFailures.slice(0, caps.maxTestFailures);
    const omitted = call.testFailures.length - shown.length;
    body = `${call.resultSummary}\n${shown.map((failure) => `- ${failure}`).join("\n")}\nomitted ${omitted} test failures`;
  }
  return body;
}

function applyReadCap(
  content: string,
  caps: ContextCaps,
  outline: string | undefined,
  path: string,
): string {
  const lines = content.split("\n");
  if (lines.length <= caps.maxReadLines) return content;
  const hint = `File has ${lines.length} lines; call read_file(${path}, { start, end }) for specific ranges.`;
  if (caps.windowedSymbolOutline && outline !== undefined && outline.length > 0) {
    return `${outline}\n${hint}`;
  }
  return `${lines.slice(0, caps.maxReadLines).join("\n")}\n${hint}`;
}

function shouldText(item: ShouldEntry): string {
  if (typeof item === "string") return item;
  const kind = item.kind === undefined ? "" : `${item.kind} `;
  const id = item.id === undefined ? "" : `${item.id} `;
  return `${kind}${id}${item.text}`.trim();
}

function zone(
  id: ContextZone["id"],
  name: ContextZone["name"],
  pinned: boolean,
  text: string,
): ContextZone {
  return { id, name, pinned, text };
}
