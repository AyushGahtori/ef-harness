import { createHash } from "node:crypto";

import {
  KERNEL_HOLD_REASONS,
  UNVERIFIED_DRAFT_LABEL,
  type AlternateReading,
  type AmbiguousMidBuildMessage,
  type CompiledBrief,
  type KernelHoldReason,
  type SignedSteeringNote,
  type WipFile,
  HoldEngineError,
} from "./types.js";

export function joinOr(labels: readonly string[]): string {
  if (labels.length === 0) return "";
  if (labels.length === 1) return labels[0] ?? "";
  if (labels.length === 2) return `${labels[0] ?? ""} or ${labels[1] ?? ""}`;
  const head = labels.slice(0, -1).join(", ");
  const last = labels[labels.length - 1] ?? "";
  return `${head}, or ${last}`;
}

/** Board and Inspector sentence for an ambiguous-message hold. */
export function ambiguousHoldExplanation(subject: string, labels: readonly string[]): string {
  return `Held: waiting to confirm whether '${subject}' applies to ${joinOr(labels)}`;
}

export function clarificationQuestion(subject: string, labels: readonly string[]): string {
  return `Which reading did you mean for '${subject}': ${joinOr(labels)}?`;
}

export function holdKey(reasonType: string, reasonRefId: string): string {
  const type = reasonType.trim();
  const ref = reasonRefId.trim();
  if (type.length === 0 || ref.length === 0) {
    throw new HoldEngineError("hold reason type and ref id are required");
  }
  const suffix = `_${ref}`;
  if (type.endsWith(suffix)) return type;
  return `${type}${suffix}`;
}

/**
 * Map a spec reason onto Task 021's closed `task_holds.reason` vocabulary.
 * The full identity stays in `source` so reasons never overwrite each other.
 */
export function kernelReasonFor(reasonType: string): KernelHoldReason {
  const normalized = reasonType.trim().toLowerCase();
  if (normalized.startsWith("user_pause") || normalized.startsWith("user_paused")) return "user_pause";
  if (normalized.startsWith("ccr")) return "ccr";
  if (normalized.startsWith("budget")) return "budget";
  if (normalized.startsWith("governor")) return "governor";
  if ((KERNEL_HOLD_REASONS as readonly string[]).includes(normalized)) {
    return normalized as KernelHoldReason;
  }
  return "requirement_change";
}

export function holdExplanation(input: {
  readonly reasonType: string;
  readonly reasonRefId: string;
  readonly subject: string;
  readonly labels: readonly string[];
}): string {
  if (input.reasonType.toLowerCase().startsWith("ambiguous_message")) {
    return ambiguousHoldExplanation(input.subject, input.labels);
  }
  if (input.reasonType.toLowerCase().startsWith("user_pause")) {
    return "Held: you paused this feature";
  }
  if (input.reasonType.toLowerCase().startsWith("ccr")) {
    return `Held: contract change ${input.reasonRefId} is pending`;
  }
  if (input.reasonType.toLowerCase().startsWith("budget")) {
    return `Held: budget ${input.reasonRefId} is exhausted`;
  }
  if (input.reasonType.toLowerCase().startsWith("governor")) {
    return `Held: governor ${input.reasonRefId}`;
  }
  return `Held: ${input.reasonType} ${input.reasonRefId}`;
}

export function briefDigest(text: string, requirements: readonly string[]): string {
  const body = JSON.stringify({ text, requirements: [...requirements].sort() });
  return createHash("sha256").update(body, "utf8").digest("hex");
}

export function signSteeringNote(deltaNote: string): SignedSteeringNote {
  const text = `Additive clarification: ${deltaNote.trim()}`;
  const signature = createHash("sha256").update(text, "utf8").digest("hex");
  return { text, signature, algorithm: "sha256" };
}

export function selectReadings(
  message: AmbiguousMidBuildMessage,
  reply: string,
): readonly AlternateReading[] {
  const text = reply.trim();
  if (text.length === 0) throw new HoldEngineError("clarification reply is empty");
  if (/\bboth\b/i.test(text) || /\ball of them\b/i.test(text)) {
    return message.alternateReadings;
  }
  const lowered = text.toLowerCase();
  const hits = message.alternateReadings.filter((reading) => {
    return lowered.includes(reading.featureId.toLowerCase()) || lowered.includes(reading.label.toLowerCase());
  });
  if (hits.length === 0) {
    throw new HoldEngineError("clarification reply did not select a reading");
  }
  return hits;
}

export function partitionWip(
  files: readonly WipFile[],
  contradictedTokens: readonly string[],
): {
  readonly kept: readonly { readonly path: string; readonly label: typeof UNVERIFIED_DRAFT_LABEL }[];
  readonly discarded: readonly string[];
} {
  const needles = contradictedTokens.map((token) => token.toLowerCase()).filter((token) => token.length > 0);
  const kept: { path: string; label: typeof UNVERIFIED_DRAFT_LABEL }[] = [];
  const discarded: string[] = [];
  for (const file of files) {
    const content = file.content.toLowerCase();
    const conflict = needles.some((token) => content.includes(token));
    if (conflict) discarded.push(file.path);
    else kept.push({ path: file.path, label: UNVERIFIED_DRAFT_LABEL });
  }
  return { kept, discarded };
}

export function compileBrief(
  pinned: { readonly sliceSha256: string; readonly text: string; readonly requirements: readonly string[] },
  readings: readonly {
    readonly changeKind: "additive" | "contradictory" | "unspecified";
    readonly deltaText: string;
    readonly replacementBrief: string | null;
    readonly contradictedTokens: readonly string[];
  }[],
): CompiledBrief {
  if (readings.length === 0) {
    return {
      sliceSha256: pinned.sliceSha256,
      text: pinned.text,
      requirements: pinned.requirements,
      changeKind: "none",
      deltaNote: "",
      contradictedTokens: [],
    };
  }
  if (readings.some((reading) => reading.changeKind === "contradictory")) {
    const text = readings.map((reading) => reading.replacementBrief ?? reading.deltaText).join("\n");
    const tokens = [...new Set(readings.flatMap((reading) => reading.contradictedTokens))];
    return {
      sliceSha256: briefDigest(text, pinned.requirements),
      text,
      requirements: pinned.requirements,
      changeKind: "contradictory",
      deltaNote: readings.map((reading) => reading.deltaText).join("\n"),
      contradictedTokens: tokens,
    };
  }
  const deltaNote = readings
    .map((reading) => reading.deltaText.trim())
    .filter((line) => line.length > 0)
    .join("\n");
  const text = deltaNote.length > 0 ? `${pinned.text}\n${deltaNote}` : pinned.text;
  const requirements = [...new Set([...pinned.requirements, ...readings.map((reading) => reading.deltaText.trim())])].filter(
    (item) => item.length > 0,
  );
  return {
    sliceSha256: briefDigest(text, requirements),
    text,
    requirements,
    changeKind: "additive",
    deltaNote,
    contradictedTokens: [],
  };
}
