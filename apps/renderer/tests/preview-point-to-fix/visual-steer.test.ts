import { describe, expect, it } from "vitest";
import {
  captureElementContext,
  createVisualSteerRouter,
  type DomLikeElement,
} from "../../src/preview/point-to-fix/index.js";

const ROOT = "C:/proj/wt/resume-changer";

function elementPick(file: string): DomLikeElement {
  return {
    tagName: "BUTTON",
    efSource: `${file}:10:2`,
    role: "button",
    accessibleName: "Submit",
    textContent: "Submit",
    domPath: "form/button",
    layoutBox: { x: 0, y: 0, width: 100, height: 40 },
    styles: {},
  };
}

describe("VisualSteerRouter", () => {
  it("scopes local fixes to the target component file", () => {
    const pick = captureElementContext(elementPick("src/pages/OrderForm.tsx"), {
      viewportWidth: 375,
      route: "/orders",
      theme: "light",
      casPut: () => "cas:a",
    });
    const router = createVisualSteerRouter({ workspaceRoot: ROOT });
    const route = router.route("Make this button align right and add 12px gap above it", pick);
    expect(route.accepted).toBe(true);
    expect(route.writeScope).toEqual(["src/pages/OrderForm.tsx"]);
    expect(route.steer?.needs_question).toBe(false);
  });

  it("prompts only-here vs everywhere for shared primitive color changes", () => {
    const pick = captureElementContext(elementPick("src/components/ui/button.tsx"), {
      viewportWidth: 1440,
      route: "/",
      theme: "light",
      casPut: () => "cas:b",
    });
    const router = createVisualSteerRouter({ workspaceRoot: ROOT });
    const route = router.route("Make this purple instead of orange", pick);
    expect(route.steer?.needs_question).toBe(true);
    expect(route.scopePrompt).toMatch(/only here|shared/i);
  });

  it("rejects out-of-repo forged data-ef-source paths", () => {
    const pick = captureElementContext(
      {
        ...elementPick("src/pages/OrderForm.tsx"),
        efSource: "../../outside/secret.tsx:1:1",
      },
      {
        viewportWidth: 768,
        route: "/",
        theme: "dark",
        casPut: () => "cas:c",
      },
    );
    const router = createVisualSteerRouter({ workspaceRoot: ROOT });
    const route = router.route("Fix color", pick);
    expect(route.accepted).toBe(false);
  });

  it("falls back when data-ef-source is absent using react debug source", () => {
    const pick = captureElementContext(
      {
        ...elementPick(""),
        efSource: null,
        reactDebugSource: "src/legacy/RadixPortal.tsx:22:8",
      },
      {
        viewportWidth: 375,
        route: "/portal",
        theme: "light",
        casPut: () => "cas:d",
      },
    );
    const router = createVisualSteerRouter({ workspaceRoot: ROOT });
    const route = router.route("Tighten modal padding", pick);
    expect(route.accepted).toBe(true);
    expect(route.writeScope?.[0]).toContain("RadixPortal");
  });
});