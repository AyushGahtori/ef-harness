import { SingleComposerView } from "../../src/composer/index.js";
import type {
  CanvasBox,
  ComposerTarget,
  PreviewElement,
  QuestionTarget,
} from "../../src/composer/index.js";

export function composer(): SingleComposerView {
  return new SingleComposerView();
}

export function authQuestion(overrides?: Partial<QuestionTarget>): QuestionTarget {
  return {
    kind: "Question",
    questionId: "Q-04",
    title: "Auth Method",
    optionsVersion: 2,
    options: [
      { position: 1, label: "Magic link" },
      { position: 2, label: "Email+Password" },
      { position: 3, label: "Google" },
    ],
    selectedOptionPosition: 1,
    ...overrides,
  };
}

export function dietaryQuestion(): QuestionTarget {
  return {
    kind: "Question",
    questionId: "Q-Diet",
    title: "Dietary Notes",
    optionsVersion: 1,
    options: [
      { position: 1, label: "No peanuts" },
      { position: 2, label: "Gluten free" },
    ],
  };
}

export function budgetCard(): QuestionTarget {
  return {
    kind: "Question",
    questionId: "Q-Budget",
    title: "Budget",
    optionsVersion: 9,
    options: [
      { position: 1, label: "Keep the cap" },
      { position: 2, label: "Raise the cap" },
    ],
  };
}

export function cutoffBox(revision = 3): CanvasBox {
  return { nodeId: "D-17", revision, label: "Cutoff Rule R17" };
}

export function cateringBox(): CanvasBox {
  return { nodeId: "D-Email", revision: 2, label: "Catering Email" };
}

export function ordersBox(): CanvasBox {
  return { nodeId: "F-Orders", revision: 8, label: "Orders" };
}

export function menuBox(): CanvasBox {
  return { nodeId: "F-Menu", revision: 1, label: "Menu" };
}

export function printButton(): CanvasBox {
  return { nodeId: "D-Print", revision: 1, label: "Print Button" };
}

export function orderEntity(): CanvasBox {
  return { nodeId: "entity:Order", revision: 4, label: "Order" };
}

export function submitElement(): PreviewElement {
  return {
    elementId: "E-9",
    label: "Submit Order button",
    source: "OrderForm.tsx:84",
  };
}

export function headerLogo(): PreviewElement {
  return {
    elementId: "E-Logo",
    label: "Header Logo",
    source: "Header.tsx:12",
  };
}

export function boxTarget(boxes: readonly CanvasBox[]): ComposerTarget {
  return { kind: "Box", boxes };
}

export function elementTarget(element: PreviewElement): ComposerTarget {
  return { kind: "Element", element };
}
