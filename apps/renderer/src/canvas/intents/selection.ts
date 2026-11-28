import type { BoxChatIntent, BoxRecord, ToggleMode } from "./types.js";
import { CORE_BOX_CHAT_INTENTS } from "./types.js";

export function presetMode(boxes: readonly BoxRecord[]): ToggleMode {
  if (boxes.some((box) => wantsCorrect(box))) return "correct";
  if (boxes.some((box) => wantsChange(box))) return "change";
  if (boxes.some((box) => box.basis === "derived" || box.basis === "proposed" || box.status === "proposed")) {
    return "correct";
  }
  return "change";
}

export function smartIntent(boxes: readonly BoxRecord[]): BoxChatIntent {
  if (boxes.some((box) => box.status === "conflict")) return "resolve_conflict";
  if (boxes.some((box) => box.amberLowConfidence || box.dictationBadge)) return "correct";
  if (boxes.some((box) => box.status === "proposed" || box.basis === "proposed")) return "approve_edit";
  if (boxes.some((box) => isDoneFeature(box))) return "change";
  if (boxes.some((box) => box.newlyExtracted && (box.basis === "derived" || box.basis === "proposed"))) {
    return "correct";
  }
  if (boxes.some((box) => box.age === "older" && box.basis === "explicit")) return "change";
  return "ask";
}

export function availableIntents(boxes: readonly BoxRecord[]): BoxChatIntent[] {
  const intents: BoxChatIntent[] = [...CORE_BOX_CHAT_INTENTS];
  if (boxes.some((box) => box.status === "conflict")) intents.push("resolve_conflict");
  if (boxes.some((box) => box.status === "proposed" || box.basis === "proposed")) intents.push("approve_edit");
  return intents;
}

export function isBuiltFeature(box: BoxRecord): boolean {
  if (box.kind !== "feature") return false;
  return box.landed || box.built || box.lifecycle === "done" || box.lifecycle === "merged" || box.status === "DONE";
}

export function isPreBuildSpec(box: BoxRecord): boolean {
  return (box.lifecycle === "discovery" || box.lifecycle === "spec") && !box.built && !box.landed;
}

function wantsCorrect(box: BoxRecord): boolean {
  if (box.amberLowConfidence || box.dictationBadge || box.freshlyDictated) return true;
  return box.newlyExtracted && (box.basis === "derived" || box.basis === "proposed" || box.status === "proposed");
}

function wantsChange(box: BoxRecord): boolean {
  if (wantsCorrect(box)) return false;
  if (box.landed || box.built || box.lifecycle === "done" || box.lifecycle === "merged" || box.status === "DONE") {
    return true;
  }
  if (box.age === "older" && box.basis === "explicit") return true;
  return box.kind === "feature" && box.basis === "explicit";
}

function isDoneFeature(box: BoxRecord): boolean {
  return box.kind === "feature" && (box.landed || box.lifecycle === "done" || box.status === "DONE");
}
