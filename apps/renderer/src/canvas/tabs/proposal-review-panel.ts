import { escapeHtml, rootOpen } from "./html.js";
import type { ProposedRequirementReviewQueuePort } from "./ports.js";
import { LocalProposedRequirementReviewQueue } from "./review-queue.js";
import type { CrossTabSelectionContext } from "./selection.js";
import type { CanonicalStateDb } from "./state-db.js";
import type { CanvasTheme, ReviewGroup, ReviewProposal } from "./types.js";
import { validationProblems } from "./validator.js";

interface DraftText {
  ears: string;
  oracle: string;
}

export class MediumRiskProposalReviewPanel {
  theme: CanvasTheme = "light";
  private readonly queue: ProposedRequirementReviewQueuePort;
  private readonly drafts = new Map<string, DraftText>();
  private readonly guidance = new Map<string, readonly string[]>();

  constructor(
    private readonly db: CanonicalStateDb,
    private readonly selection: CrossTabSelectionContext,
    queue?: ProposedRequirementReviewQueuePort,
  ) {
    this.queue = queue ?? new LocalProposedRequirementReviewQueue(db);
  }

  setTheme(theme: CanvasTheme): void {
    this.theme = theme;
  }

  setDraft(cellId: string, field: "ears" | "oracle", value: string): void {
    const proposal = this.find(cellId);
    const current = this.drafts.get(cellId) ?? {
      ears: proposal?.earsText ?? "",
      oracle: proposal?.oracleSketch ?? "",
    };
    this.drafts.set(cellId, field === "ears" ? { ...current, ears: value } : { ...current, oracle: value });
  }

  approve(cellId: string): void {
    const featureId = this.find(cellId)?.featureId ?? null;
    this.queue.settle({ approve: [cellId] });
    this.drafts.delete(cellId);
    this.guidance.delete(cellId);
    this.selection.select({ tab: "spec", requirementId: cellId, featureId });
  }

  reject(cellId: string): void {
    this.queue.settle({ reject: [cellId] });
    this.drafts.delete(cellId);
    this.guidance.delete(cellId);
  }

  edit(cellId: string): void {
    const proposal = this.find(cellId);
    const draft = this.drafts.get(cellId) ?? {
      ears: proposal?.earsText ?? "",
      oracle: proposal?.oracleSketch ?? "",
    };
    try {
      this.queue.settle({ edits: [{ cellId, earsText: draft.ears, oracleSketch: draft.oracle }] });
      this.drafts.delete(cellId);
      this.guidance.delete(cellId);
    } catch (error) {
      const problems = validationProblems(error);
      if (!problems) throw error;
      this.guidance.set(cellId, problems.problems);
    }
  }

  approveAll(featureId: string): void {
    this.queue.approveAll(featureId);
    for (const [cellId, proposal] of this.allProposals()) {
      if (proposal.featureId === featureId) this.drafts.delete(cellId);
    }
  }

  render(): string {
    const readiness = this.db.readiness();
    const groups = this.queue.groups();
    const byFeature = new Map<string, ReviewGroup[]>();
    for (const group of groups) {
      const list = byFeature.get(group.featureId);
      if (list) list.push(group);
      else byFeature.set(group.featureId, [group]);
    }
    const parts = [
      rootOpen(this.theme, "Medium-risk proposal review"),
      `<p class="num" data-readiness="pending">Pending medium-risk: ${readiness.pendingProposals}</p>`,
      `<p class="num" data-readiness="settled">Explicit settled: ${readiness.explicitSettled}</p>`,
      `<p data-readiness="state">Readiness: ${readiness.isReady ? "ready" : "not ready"}</p>`,
    ];
    for (const [featureId, featureGroups] of byFeature) {
      const title = featureGroups[0]?.featureTitle ?? featureId;
      const selected = this.selection.featureId === featureId ? ' data-selected="true"' : "";
      parts.push(
        `<section data-feature-id="${escapeHtml(featureId)}"${selected}><h2>${escapeHtml(title)}</h2><button type="button" data-action="approve-all" data-feature-id="${escapeHtml(featureId)}">Approve all in Feature</button>`,
      );
      for (const group of featureGroups) {
        parts.push(`<h3>${escapeHtml(group.matrixId)}</h3>`);
        for (const proposal of group.proposals) parts.push(this.proposalHtml(proposal));
      }
      parts.push(`</section>`);
    }
    parts.push(`</section>`);
    return parts.join("");
  }

  private proposalHtml(proposal: ReviewProposal): string {
    const draft = this.drafts.get(proposal.cellId) ?? {
      ears: proposal.earsText,
      oracle: proposal.oracleSketch,
    };
    const notes = this.guidance.get(proposal.cellId) ?? [];
    const guidance =
      notes.length > 0 ? `<p role="alert">${notes.map((note) => escapeHtml(note)).join(" ")}</p>` : "";
    return `<article data-cell-id="${escapeHtml(proposal.cellId)}"><h4>${escapeHtml(proposal.title)}</h4><p data-ears="${escapeHtml(proposal.earsText)}">${escapeHtml(draft.ears)}</p><p data-oracle="${escapeHtml(proposal.oracleSketch)}">${escapeHtml(draft.oracle)}</p><label>EARS <textarea data-field="ears" data-cell-id="${escapeHtml(proposal.cellId)}">${escapeHtml(draft.ears)}</textarea></label><label>Oracle <textarea data-field="oracle" data-cell-id="${escapeHtml(proposal.cellId)}">${escapeHtml(draft.oracle)}</textarea></label>${guidance}<button type="button" data-action="approve" data-cell-id="${escapeHtml(proposal.cellId)}">Approve</button><button type="button" data-action="edit" data-cell-id="${escapeHtml(proposal.cellId)}">Edit</button><button type="button" data-action="reject" data-cell-id="${escapeHtml(proposal.cellId)}">Reject</button></article>`;
  }

  private find(cellId: string): ReviewProposal | undefined {
    for (const group of this.queue.groups()) {
      const found = group.proposals.find((proposal) => proposal.cellId === cellId);
      if (found) return found;
    }
    return undefined;
  }

  private allProposals(): Map<string, ReviewProposal> {
    const map = new Map<string, ReviewProposal>();
    for (const group of this.queue.groups()) {
      for (const proposal of group.proposals) map.set(proposal.cellId, proposal);
    }
    return map;
  }
}
