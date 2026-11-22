import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { h, runAxeCoreAudit, textContent } from "../../src/cockpit/inbox/a11y.js";
import { CalmInboxPanel } from "../../src/cockpit/inbox/panel.js";
import { ReviewCard } from "../../src/cockpit/inbox/view.js";
import type { CardDraft } from "../../src/cockpit/inbox/types.js";

describe("grouped review card", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });
  it("coalesces twelve proposals and passes the axe-core rules", () => {
    const panel = new CalmInboxPanel();
    for (let index = 1; index <= 12; index += 1) {
      const draft: CardDraft = {
        id: `proposal-${index}`,
        type: "review",
        priority: "P3",
        title: `Proposal ${index}`,
        provenance: { label: "Spec proposals", href: "ef://reviews/medium-risk" },
        groupKey: "medium-risk",
        reviewSource: "spec_proposal",
        reviewItemTitle: `Detail ${index}`,
        reviewItemSummary: `Impact ${index}`,
        blockedTaskIds: [],
      };
      panel.enqueue(draft);
    }
    const card = panel.card("review:medium-risk");
    expect(card?.title).toBe("12 proposed details — Approve all or expand");
    expect(card?.payload.kind === "review" ? card.payload.items.length : 0).toBe(12);
    expect(panel.queuedIds()).toEqual(["review:medium-risk"]);
    if (!card) throw new Error("missing grouped review");
    panel.toggleReview(card.id);
    const view = ReviewCard(card);
    const rendered = textContent(view);
    expect(rendered).toContain("12 proposed details — Approve all or expand");
    expect(rendered).toContain("Approve all");
    expect(rendered).toContain("Edit");
    expect(rendered).toContain("Reject");
    expect(rendered).toContain("Why this matters (blocks 0 tasks)");
    expect(runAxeCoreAudit(view).seriousOrCritical).toEqual([]);

    panel.approveAll(card.id);
    expect(card.payload.kind === "review" ? card.payload.items.every((item) => item.disposition === "approved") : false).toBe(
      true,
    );
    panel.editReviewItem(card.id, "proposal-1");
    panel.rejectReviewItem(card.id, "proposal-2");
    const items = card.payload.kind === "review" ? card.payload.items : [];
    expect(items.find((item) => item.id === "proposal-1")?.disposition).toBe("editing");
    expect(items.find((item) => item.id === "proposal-2")?.disposition).toBe("rejected");
    expect(runAxeCoreAudit(ReviewCard(card)).seriousOrCritical).toEqual([]);
    expect(panel.audit().seriousOrCritical).toEqual([]);
  });

  it("flags a nameless button as a critical axe-core failure", () => {
    const report = runAxeCoreAudit(h("div", { fg: "#1c1917", bg: "#fafaf9" }, h("button", {})));
    expect(report.seriousOrCritical.some((item) => item.id === "button-name")).toBe(true);
  });
});
