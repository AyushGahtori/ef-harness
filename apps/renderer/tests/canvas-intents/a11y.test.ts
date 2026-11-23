import { describe, expect, it } from "vitest";
import { runAxeCoreKeyboardFocusTrapAudit } from "../../src/canvas/intents/a11y.js";
import { createBoxChatIntentController } from "../../src/canvas/intents/controller.js";
import { CorrectVsChangeTogglePreset } from "../../src/canvas/intents/toggle.js";
import { seedImpactGraph, TrackingModel, TrackingNetwork } from "./fixtures.js";

describe("modal and toggle accessibility", () => {
  it("ZeroTokenImpactPreviewModal passes axe-style keyboard and focus-trap audit", () => {
    const host = createBoxChatIntentController({
      graph: seedImpactGraph(),
      model: new TrackingModel(),
      network: new TrackingNetwork(),
    });
    host.beginComposer(["D-17"], "10:30 AM", 0);
    const preview = host.submit({ intent: "change", nodeIds: ["D-17"], draft: "10:30 AM" }) as {
      modal: { surface: ReturnType<typeof runAxeCoreKeyboardFocusTrapAudit> extends never ? never : object };
    };
    const audit = runAxeCoreKeyboardFocusTrapAudit(preview.modal.surface as never);
    expect(audit.violations).toEqual([]);
    expect(audit.passes.length).toBeGreaterThan(0);
  });

  it("CorrectVsChangeTogglePreset passes segmented keyboard audit", () => {
    const toggle = new CorrectVsChangeTogglePreset("correct");
    toggle.press("ArrowRight");
    expect(toggle.mode).toBe("change");
    const audit = runAxeCoreKeyboardFocusTrapAudit(toggle.surface);
    expect(audit.violations).toEqual([]);
  });
});