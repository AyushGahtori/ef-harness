import type {
  CanvasBox,
  ComposerTarget,
  DraftCaret,
  PreviewElement,
  QuestionTarget,
} from "./types.js";
import { EMPTY_CARET } from "./types.js";

export function assertNever(value: never): never {
  throw new Error(`Unexpected composer value: ${JSON.stringify(value)}`);
}

export function copyQuestion(question: QuestionTarget): QuestionTarget {
  const copy: QuestionTarget = {
    kind: "Question",
    questionId: question.questionId,
    title: question.title,
    optionsVersion: question.optionsVersion,
    options: question.options.map((option) => ({
      position: option.position,
      label: option.label,
    })),
  };
  if (question.selectedOptionPosition === undefined) return copy;
  return { ...copy, selectedOptionPosition: question.selectedOptionPosition };
}

export function copyBoxes(boxes: readonly CanvasBox[]): CanvasBox[] {
  if (boxes.length === 0) {
    throw new Error("Box target requires at least one canvas box");
  }
  return boxes.map((box) => ({
    nodeId: box.nodeId,
    revision: box.revision,
    label: box.label,
  }));
}

export function copyElement(element: PreviewElement): PreviewElement {
  return {
    elementId: element.elementId,
    label: element.label,
    source: element.source,
  };
}

export function copyTarget(target: ComposerTarget): ComposerTarget {
  switch (target.kind) {
    case "Question":
      return copyQuestion(target);
    case "Box":
      return { kind: "Box", boxes: copyBoxes(target.boxes) };
    case "Element":
      return { kind: "Element", element: copyElement(target.element) };
    case "General":
      return { kind: "General" };
    default:
      return assertNever(target);
  }
}

export function targetKey(target: ComposerTarget): string {
  switch (target.kind) {
    case "Question":
      return `question:${target.questionId}`;
    case "Box":
      return `box:${target.boxes
        .map((box) => box.nodeId)
        .slice()
        .sort()
        .join("+")}`;
    case "Element":
      return `element:${target.element.elementId}`;
    case "General":
      return "general";
    default:
      return assertNever(target);
  }
}

export function targetIdOf(target: ComposerTarget): string {
  switch (target.kind) {
    case "Question":
      return target.questionId;
    case "Box":
      return target.boxes.map((box) => box.nodeId).join("+");
    case "Element":
      return target.element.elementId;
    case "General":
      return "general";
    default:
      return assertNever(target);
  }
}

export function selectionSummary(boxes: readonly CanvasBox[]): string {
  const first = boxes[0];
  if (!first) return "selection";
  if (boxes.length === 1) return first.label;
  return `${first.label} (+${boxes.length - 1} more)`;
}

export function sideLabel(target: ComposerTarget): string {
  switch (target.kind) {
    case "Box":
      return selectionSummary(target.boxes);
    case "Element":
      return target.element.label;
    case "Question":
      return target.title;
    case "General":
      return "project";
    default:
      return assertNever(target);
  }
}

export function pillText(target: ComposerTarget): string {
  switch (target.kind) {
    case "Question":
      return `Replying to: ${target.title} [${target.questionId}] · ✕`;
    case "Box":
      return `Talking about: ${selectionSummary(target.boxes)} · ✕`;
    case "Element":
      return `Fixing UI: ${target.element.label} (${target.element.source}) · ✕`;
    case "General":
      return "Message project / steering";
    default:
      return assertNever(target);
  }
}

export function sameTarget(left: ComposerTarget, right: ComposerTarget): boolean {
  return targetKey(left) === targetKey(right) && pillText(left) === pillText(right);
}

export function clampOffset(offset: number, length: number): number {
  if (!Number.isFinite(offset)) return 0;
  return Math.max(0, Math.min(length, Math.trunc(offset)));
}

export function caretFrom(text: string, cursor: number, selectionEnd: number): DraftCaret {
  return {
    text,
    cursor: clampOffset(cursor, text.length),
    selectionEnd: clampOffset(selectionEnd, text.length),
  };
}

export function emptyCaret(): DraftCaret {
  return { ...EMPTY_CARET };
}
