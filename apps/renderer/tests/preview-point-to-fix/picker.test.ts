import { describe, expect, it } from "vitest";
import {
  bindComposerElementTarget,
  createPointToFixPickerOverlay,
  validatePickResultMessage,
} from "../../src/preview/point-to-fix/index.js";

const ROOT = "C:/proj/wt/resume-changer";
const casPut = () => "cas:png:stub";

const submitButton = {
  tagName: "BUTTON",
  efSource: "src/pages/OrderForm.tsx:84:6",
  role: "button",
  accessibleName: "Submit Order",
  textContent: "Submit Order",
  domPath: "html/body/form/button",
  layoutBox: { x: 120, y: 440, width: 142, height: 44 },
  styles: { color: "orange", padding: "8px" },
};

describe("PointToFixPickerOverlay", () => {
  it("shows hover outline tag with size while picking", () => {
    const overlay = createPointToFixPickerOverlay({
      workspaceRoot: ROOT,
      viewportWidth: 375,
      route: "/orders",
      theme: "light",
      casPut,
    });
    overlay.togglePicking();
    const outline = overlay.updateHover(submitButton);
    expect(outline?.visible).toBe(true);
    expect(outline?.tag).toContain("142×44");
    expect(outline?.tag).toContain("OrderForm.tsx");
  });

  it("captures element context and binds composer element target", () => {
    let boundLabel = "";
    const overlay = createPointToFixPickerOverlay({
      workspaceRoot: ROOT,
      viewportWidth: 1440,
      route: "/orders",
      theme: "dark",
      casPut,
      callbacks: {
        onComposerTarget: (t) => {
          boundLabel = t.label;
        },
      },
    });
    overlay.togglePicking();
    const pick = overlay.pickElement(submitButton);
    expect(pick?.kind).toBe("element");
    expect(boundLabel).toContain("Submit Order");
    expect(boundLabel).toContain("OrderForm.tsx:84");
    const target = bindComposerElementTarget(pick!);
    expect(target?.targetKey).toContain("element:");
  });

  it("captures drag-box gap with intersecting sources and gap px", () => {
    const header = {
      ...submitButton,
      tagName: "HEADER",
      efSource: "src/pages/OrderForm.tsx:12:4",
      layoutBox: { x: 0, y: 0, width: 375, height: 56 },
      domPath: "html/body/header",
    };
    const grid = {
      ...submitButton,
      tagName: "DIV",
      efSource: "src/pages/OrderForm.tsx:60:4",
      layoutBox: { x: 0, y: 60, width: 375, height: 300 },
      domPath: "html/body/div.menu-grid",
    };
    const overlay = createPointToFixPickerOverlay({
      workspaceRoot: ROOT,
      viewportWidth: 375,
      route: "/orders",
      theme: "light",
      casPut,
    });
    overlay.togglePicking();
    overlay.beginDrag(10, 56);
    const gap = overlay.completeDrag(360, 58, [header, grid]);
    expect(gap?.kind).toBe("gap");
    if (gap?.kind === "gap") {
      expect(gap.gapPx).toBe(4);
      expect(gap.intersectingElements.length).toBe(2);
    }
  });

  it("exits picker on Esc without composer changes", () => {
    let modeChanges = 0;
    const overlay = createPointToFixPickerOverlay({
      workspaceRoot: ROOT,
      viewportWidth: 768,
      route: "/",
      theme: "light",
      casPut,
      callbacks: { onModeChange: () => (modeChanges += 1) },
    });
    overlay.togglePicking();
    const exited = overlay.handleEscape();
    expect(exited).toBe(true);
    expect(overlay.mode).toBe("off");
    expect(modeChanges).toBeGreaterThan(0);
  });

  it("rejects forged ef-pick-result paths outside workspace", () => {
    const forged = {
      type: "ef-pick-result",
      pick: {
        kind: "element",
        efSource: { file: "../../Windows/System32/cmd.exe", line: 1, column: 1 },
        ancestorSources: [],
        role: "button",
        accessibleName: "evil",
        textExcerpt: "",
        domPath: "x",
        domSnippet: "<button>",
        layoutBox: { x: 0, y: 0, width: 1, height: 1 },
        styles: {},
        viewportWidth: 375,
        route: "/",
        theme: "light",
        cropPngRef: "cas:x",
      },
    };
    const result = validatePickResultMessage(forged, ROOT);
    expect(result.ok).toBe(false);
  });
});