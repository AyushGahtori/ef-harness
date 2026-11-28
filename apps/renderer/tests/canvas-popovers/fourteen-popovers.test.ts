import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { h, runAxeCoreAudit } from "../../src/canvas/popovers/a11y.js";
import {
  SEALED_ORACLE_SOURCE,
  canvasEdges,
  canvasNodes,
  primaryNodes,
} from "../../src/canvas/popovers/fixtures.js";
import { createCanvasPopoverHost, renderedText } from "../../src/canvas/popovers/host.js";
import { NodeTypePopoverRegistry, popoverOmitsSealedSource } from "../../src/canvas/popovers/registry.js";
import {
  CANONICAL_NODE_TYPES,
  FEATURE_RUNTIMES,
  INK,
  PAPER,
  PROJECT_STAGES,
  UnknownCanvasNodeTypeError,
} from "../../src/canvas/popovers/types.js";
import { projectNode, ruleNode } from "../../src/canvas/popovers/fixtures.js";

const here = path.dirname(fileURLToPath(import.meta.url));

function host() {
  return createCanvasPopoverHost({ nodes: canvasNodes(), edges: canvasEdges() });
}

describe("all 14 canonical node popovers", () => {
  it("registers exactly the 14 canonical types and their aliases", () => {
    expect(CANONICAL_NODE_TYPES).toHaveLength(14);
    const registry = new NodeTypePopoverRegistry();
    expect(registry.resolve("scope")).toBe("project");
    expect(registry.resolve("api_endpoint")).toBe("contract");
    expect(registry.resolve("oracle")).toBe("check");
    expect(registry.resolve("brownfield_module")).toBe("brand_asset");
    expect(() => registry.resolve("widget")).toThrow(UnknownCanvasNodeTypeError);
  });

  it("renders tailored fields, provenance, and quick actions with no JSON dump", () => {
    const surface = host();
    const expected: Record<string, readonly string[]> = {
      "project-meal": ["MVP", "16/19", "Edit stage / View readiness", "turn 4 · page 2"],
      "D-17": ["11:00", "explicit", "Cutoff is 11:00", "turn 4 · page 2", "Correct (misheard)", "Change", "Explain impact"],
      "R-22": ["When the cutoff passes the system shall reject edits.", "oracle_sketch", "edits after 11:00 are rejected", "Split"],
      "F-Orders": ["WORKING", "4/6", "Wave", "Undo feature", "Open preview", "Add requirement", "Pause feature"],
      "entity-order": ["pii", "money", "Locked", "Add field", "View relations", "quantity"],
      "contract-totals": ["POST", "/orders", "kitchen-totals/v1", "locked", "Propose CCR", "View schema", "Orders"],
      "screen-kitchen": ["/kitchen", "empty ✓", "loading ✓", "populated ✓", "error ✓", "Open wireframe", "Open Live Preview", "Low-fi wireframe"],
      "rule-x01": ["X-01", "Reject orders after cutoff.", "any: orders, time", "6", "Show matched tasks", "Edit rule"],
      "seam-print": ["timeout", "duplicate submit", "kitchen-totals/v1", "Inspect seam tests"],
      "fact-layout": ["ELK computes layered layouts for directed graphs.", "https://example.com/docs/elk", "v1.2.0", "d.ts verified", "Refresh fact", "Open source"],
      "task-a0014": ["A0014 · Kitchen print", "Sr", "re-verify", "apps/renderer/src/canvas/popovers/**", "Open Worker Inspector", "I fixed it myself", "Pause"],
      "check-sealed": ["Sealed check · 4 cases · Independent family · Pending", "Run check", "View receipt"],
      "conflict-cutoff": ["Z3 minimal UNSAT core", "cutoff 10:30 violates both windows", "Resolve conflict now", "Cutoff Rule R17"],
      "asset-mark": ["cleared for product UI", "Swap asset", "Brand asset thumbnail: Kitchen mark"],
    };
    expect(Object.keys(expected)).toHaveLength(14);

    for (const node of primaryNodes()) {
      surface.click(node.id);
      const text = surface.popoverText();
      const rendered = renderedText(surface.render());
      expect(surface.dialogCount()).toBe(1);
      expect(text).not.toContain("{");
      expect(text).not.toContain("}");
      expect(text).not.toContain(SEALED_ORACLE_SOURCE);
      expect(rendered).not.toContain(SEALED_ORACLE_SOURCE);
      const needles = expected[node.id];
      expect(needles, node.id).toBeDefined();
      for (const needle of needles ?? []) {
        expect(text, `${node.id} missing ${needle}`).toContain(needle);
      }
      expect(text).toContain("Pin to Inspector");
      expect(text).toContain("Evidence");
      const audit = runAxeCoreAudit(surface.render());
      expect(audit.seriousOrCritical, node.id).toEqual([]);
    }
  });

  it("covers stage chips, feature runtimes, rule families, and the paired variants", () => {
    const registry = new NodeTypePopoverRegistry();
    for (const stage of PROJECT_STAGES) {
      expect(registry.describe(projectNode(stage)).fields.some((item) => item.value === stage)).toBe(true);
    }
    for (const runtime of FEATURE_RUNTIMES) {
      const described = registry.describe({
        ...primaryNodes().find((node) => node.type === "feature")!,
        runtime,
      });
      expect(described.fields.some((item) => item.value === runtime)).toBe(true);
    }
    const surface = host();
    surface.click("scope-mvp");
    expect(surface.popoverText()).toContain("Production");
    expect(surface.popoverText()).toContain("18/20");
    surface.click("endpoint-orders");
    expect(surface.popoverText()).toContain("POST");
    expect(surface.popoverText()).toContain("/orders");
    surface.click("rule-up03");
    expect(surface.popoverText()).toContain("UP-03");
    surface.click("module-auth");
    expect(surface.popoverText()).toContain("L2");
    expect(surface.popoverText()).toContain("file_rank");
    expect(surface.popoverText()).toContain("12");
    expect(surface.popoverText()).toContain("signIn, signOut");
    expect(surface.popoverText()).toContain("src/router.ts");
    expect(surface.popoverText()).toContain("Inspect callers");
    expect(surface.popoverText()).not.toContain("Swap asset");
    surface.click("oracle-idle");
    expect(surface.popoverText()).toContain("Sealed — 4 diverse examples");
    expect(surface.popoverText()).not.toContain(SEALED_ORACLE_SOURCE);
    surface.click("check-visible");
    expect(surface.popoverText()).toContain("Four visible examples passed");
    expect(surface.popoverText()).toContain("pass");
    expect(surface.popoverText()).not.toContain(SEALED_ORACLE_SOURCE);
    expect(ruleNode("rule-up03", "UP-03").ruleId).toBe("UP-03");
  });

  it("keeps sealed oracle source out of the active-build popover and receipt", () => {
    const surface = host();
    surface.click("check-sealed");
    const model = surface.model();
    expect(model).not.toBeNull();
    if (!model) return;
    expect(popoverOmitsSealedSource(model, SEALED_ORACLE_SOURCE)).toBe(true);
    expect(surface.popoverText()).not.toContain("Visible summary must stay hidden");
    surface.activatePopoverAction("view-receipt");
    const receipt = surface.siblings.calls.at(-1);
    expect(receipt?.method).toBe("viewReceipt");
    expect(receipt?.detail).not.toContain(SEALED_ORACLE_SOURCE);
  });

  it("does not stringify nodes anywhere in the popover sources", () => {
    const srcDir = path.resolve(here, "../../src/canvas/popovers");
    const files = readdirSync(srcDir).filter((name) => name.endsWith(".ts"));
    expect(files.length).toBeGreaterThan(8);
    for (const name of files) {
      const text = readFileSync(path.join(srcDir, name), "utf8");
      expect(text, name).not.toContain("JSON.stringify");
    }
  });

  it("flags an unlabeled button and accepts the real popovers", () => {
    const bad = h("button", { fg: INK, bg: PAPER }, []);
    expect(runAxeCoreAudit(bad).seriousOrCritical.some((item) => item.id === "button-name")).toBe(true);
  });
});
