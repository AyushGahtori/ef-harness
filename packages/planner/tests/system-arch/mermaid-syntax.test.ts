import { describe, expect, it } from "vitest";
import { quoteFlowchartLabels, verifyMermaidSyntax } from "../../src/system-arch/index.js";
import { PAREN_MERMAID } from "./kitchen-fixture.js";

describe("Mermaid syntax", () => {
  it("rejects unescaped parentheses and accepts the quoted repair", async () => {
    const broken = await verifyMermaidSyntax(PAREN_MERMAID);
    expect(broken.ok).toBe(false);
    if (!broken.ok) expect(broken.message).toMatch(/Parse error/);

    const quoted = quoteFlowchartLabels(PAREN_MERMAID);
    expect(quoted).toContain('A["User (Admin)"]');
    const parsed = await verifyMermaidSyntax(quoted);
    expect(parsed.ok).toBe(true);
  }, 60_000);

  it("parses sequence and state diagrams with the real parser", async () => {
    const sequence = await verifyMermaidSyntax("sequenceDiagram\n  Alice->>Bob: hi");
    const state = await verifyMermaidSyntax("stateDiagram-v2\n  [*] --> Idle");
    expect(sequence.ok).toBe(true);
    expect(state.ok).toBe(true);
    if (sequence.ok) expect(sequence.diagramType).toBe("sequence");
    if (state.ok) expect(state.diagramType).toBe("stateDiagram");
  }, 60_000);
});
