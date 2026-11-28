import { h } from "./a11y.js";
import {
  DANGER_INK,
  DANGER_PAPER,
  INK,
  PAPER,
  RETIRED_LABEL,
  SNOOZE_LABEL,
  type InboxCard,
  type VChild,
  type VNode,
  type VProps,
} from "./types.js";

export interface InboxRenderModel {
  readonly surfaced: readonly InboxCard[];
  readonly history: readonly InboxCard[];
  readonly digest: readonly InboxCard[];
  readonly digestOpen: boolean;
  readonly headline: string | null;
  readonly zen: string | null;
  readonly peek: string | null;
  readonly snoozeVisible: boolean;
  readonly focusMode: boolean;
  readonly unread: number;
  readonly focusedId: string | null;
  readonly digestText: string;
}

export function DecisionCard(card: InboxCard): VNode {
  return cardFrame(card, decisionBody(card));
}

export function SecretCard(card: InboxCard): VNode {
  return cardFrame(card, secretBody(card));
}

export function ToolCard(card: InboxCard): VNode {
  return cardFrame(card, toolBody(card));
}

export function AccountCard(card: InboxCard): VNode {
  return cardFrame(card, accountBody(card));
}

export function ApprovalCard(card: InboxCard): VNode {
  return cardFrame(card, approvalBody(card));
}

export function ReviewCard(card: InboxCard): VNode {
  return cardFrame(card, reviewBody(card));
}

export function renderCard(card: InboxCard): VNode {
  if (card.type === "decision") return DecisionCard(card);
  if (card.type === "secret") return SecretCard(card);
  if (card.type === "tool") return ToolCard(card);
  if (card.type === "account") return AccountCard(card);
  if (card.type === "approval") return ApprovalCard(card);
  return ReviewCard(card);
}

export function renderCalmInbox(model: InboxRenderModel): VNode {
  const children: VChild[] = [h("h2", {}, `Inbox ${model.unread}`)];
  if (model.focusMode) children.push(h("p", {}, "Focus mode"));
  if (model.headline !== null) children.push(h("p", {}, model.headline));
  if (model.snoozeVisible) {
    children.push(
      button(`snooze`, SNOOZE_LABEL, {
        action: "snooze",
        primary: true,
      }),
    );
  }
  for (const card of model.surfaced) {
    const view = renderCard(card);
    children.push(view);
  }
  if (model.zen !== null) children.push(h("p", {}, model.zen));
  if (model.peek !== null) {
    children.push(button("peek-fyi", model.peek, { action: "peek-fyi" }));
  }
  if (model.digest.length > 0) {
    const digestChildren: VChild[] = [
      button("digest-toggle", model.digestText, {
        action: "toggle-digest",
        ariaExpanded: model.digestOpen,
      }),
    ];
    if (model.digestOpen) {
      for (const card of model.digest) digestChildren.push(renderCard(card));
    }
    children.push(h("section", { ariaLabel: model.digestText }, ...digestChildren));
  }
  if (model.history.length > 0) {
    const historyChildren: VChild[] = [h("h2", {}, RETIRED_LABEL)];
    for (const card of model.history) historyChildren.push(renderCard(card));
    children.push(h("section", { ariaLabel: RETIRED_LABEL }, ...historyChildren));
  }
  return h(
    "section",
    { id: "calm-inbox", ariaLabel: "Inbox", fg: INK, bg: PAPER },
    ...children,
  );
}

function cardFrame(card: InboxCard, body: readonly VChild[]): VNode {
  const props: VProps = {
    id: `card-${card.id}`,
    cardId: card.id,
    fg: INK,
    bg: PAPER,
    ariaLabel: card.title,
    ariaLive: card.lane === "interrupt_now" ? "polite" : "off",
    dataState: card.status === "retired" ? card.motion : card.status,
    titleLines: 1,
  };
  const frame: VChild[] = [
    h("h3", { titleLines: 1 }, card.title),
    h("p", {}, card.whyThisMatters),
    h("p", {}, card.blockingLabel),
    provenance(card),
    ...body,
  ];
  if (card.historyLabel !== null) frame.push(h("p", {}, card.historyLabel));
  if (card.lane === "interrupt_now") {
    return h("article", { ...props, indicator: "subtle" }, ...frame);
  }
  return h("article", props, ...frame);
}

function provenance(card: InboxCard): VNode {
  return h(
    "a",
    { href: card.provenance.href, fg: INK, bg: PAPER, minTargetPx: 24 },
    card.provenance.label,
  );
}

function decisionBody(card: InboxCard): VChild[] {
  const selected = card.payload.kind === "decision" ? card.payload.selectedOptionId : null;
  const children: VChild[] = [];
  for (const option of card.options) {
    children.push(
      button(`option-${card.id}-${option.number}`, `${option.number}. ${option.label}${option.recommended ? " Recommended" : ""}`, {
        action: `option-${option.number}`,
        primary: option.recommended,
        ariaPressed: selected === option.id,
      }),
    );
  }
  children.push(button(`reply-${card.id}`, "Reply in composer", { action: "reply-in-composer" }));
  if (card.inlinePrompt !== null) {
    children.push(h("p", { role: "status" }, card.inlinePrompt));
    children.push(button(`keep-${card.id}`, "Keep", { action: "keep" }));
    children.push(button(`change-${card.id}`, "Change", { action: "change" }));
  }
  return children;
}

function secretBody(card: InboxCard): VChild[] {
  if (card.payload.kind !== "secret") return [];
  const payload = card.payload;
  const children: VChild[] = [
    h("label", { id: `label-${card.id}` }, "Secret value"),
    h("input", {
      id: `secret-${card.id}`,
      inputType: "password",
      ariaLabel: "Secret value",
      valueLength: payload.inputLength,
      fg: INK,
      bg: PAPER,
      minTargetPx: 24,
    }),
    button(`save-${card.id}`, "Save", { action: "save-secret", primary: true }),
    button(`probe-${card.id}`, "Test connection", { action: "test-connection" }),
  ];
  if (payload.mockAvailable) {
    children.push(
      button(`mock-${card.id}`, "Use built-in local mock instead", { action: "use-mock" }),
    );
  }
  if (payload.refusalMessage !== null) {
    children.push(
      h(
        "p",
        { role: "status", fg: DANGER_INK, bg: DANGER_PAPER },
        payload.refusalMessage,
      ),
    );
  }
  return children;
}

function toolBody(card: InboxCard): VChild[] {
  if (card.payload.kind !== "tool") return [];
  const payload = card.payload;
  return [
    h("p", {}, payload.toolName),
    h("p", {}, payload.diagnosis),
    h("pre", {}, payload.commandPreview),
    h("p", {}, payload.badge),
    button(`check-${card.id}`, "Check again", { action: "check-again", primary: true }),
    button(`attest-${card.id}`, "I installed it", { action: "attest" }),
  ];
}

function accountBody(card: InboxCard): VChild[] {
  if (card.payload.kind !== "account") return [];
  const payload = card.payload;
  const children: VChild[] = [
    h("p", {}, payload.provider),
    button(`reauth-${card.id}`, "Re-authenticate", { action: "reauthenticate", primary: true }),
    button(`switch-${card.id}`, "Switch connection", { action: "switch-connection" }),
  ];
  if (payload.allowanceResetLabel !== null) children.splice(1, 0, h("p", {}, payload.allowanceResetLabel));
  return children;
}

function approvalBody(card: InboxCard): VChild[] {
  if (card.payload.kind !== "approval") return [];
  return [
    h("p", {}, card.payload.impactSummary),
    button(`approve-${card.id}`, "Approve", { action: "approve", primary: true }),
    button(`edit-${card.id}`, "Edit", { action: "edit" }),
    button(`decline-${card.id}`, "Decline", { action: "decline" }),
  ];
}

function reviewBody(card: InboxCard): VChild[] {
  if (card.payload.kind !== "review") return [];
  const payload = card.payload;
  const children: VChild[] = [
    button(`approve-all-${card.id}`, "Approve all", { action: "approve-all", primary: true }),
    button(`expand-${card.id}`, payload.expanded ? "Collapse" : "Expand", {
      action: "toggle-review",
      ariaExpanded: payload.expanded,
    }),
  ];
  if (payload.expanded) {
    for (const item of payload.items) {
      children.push(
        h(
          "li",
          { id: `review-item-${item.id}` },
          item.title,
          h("p", {}, item.summary),
          h("p", {}, item.disposition),
          button(`edit-${item.id}`, "Edit", { action: `edit-item-${item.id}` }),
          button(`reject-${item.id}`, "Reject", { action: `reject-item-${item.id}` }),
        ),
      );
    }
  }
  return children;
}

function button(
  id: string,
  label: string,
  extra: {
    readonly action: string;
    readonly primary?: boolean;
    readonly ariaPressed?: boolean;
    readonly ariaExpanded?: boolean;
  },
): VNode {
  const props: VProps = {
    id,
    action: extra.action,
    fg: INK,
    bg: PAPER,
    minTargetPx: 24,
    ...(extra.primary === true ? { primary: true } : {}),
    ...(extra.ariaPressed !== undefined ? { ariaPressed: extra.ariaPressed } : {}),
    ...(extra.ariaExpanded !== undefined ? { ariaExpanded: extra.ariaExpanded } : {}),
  };
  return h("button", props, label);
}
