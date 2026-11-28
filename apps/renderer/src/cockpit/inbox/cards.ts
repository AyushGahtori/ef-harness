import { laneFor, blockingCopy } from "./text.js";
import {
  AUTH_EXPIRY_TOAST,
  type BatchSubject,
  type CardDraft,
  type DecisionOption,
  type InboxCard,
  type ReviewItem,
} from "./types.js";

export function createInboxCard(draft: CardDraft, now: number): InboxCard {
  const subscribers =
    draft.blockedTaskIds !== undefined ? [...draft.blockedTaskIds] : defaultSubscribers(draft);
  const copy = blockingCopy(subscribers.length);
  const condition = draft.condition ?? null;
  const subject = draft.subject ?? defaultSubject(draft);
  return {
    id: draft.id,
    type: draft.type,
    priority: draft.priority,
    condition,
    title: draft.title,
    whyThisMatters: copy.whyThisMatters,
    blockingLabel: copy.blockingLabel,
    blockedTaskCount: subscribers.length,
    provenance: draft.provenance,
    createdAt: now,
    subscribers,
    onCriticalPath: draft.onCriticalPath ?? false,
    optionsVersion: draft.optionsVersion ?? 1,
    options: buildOptions(draft),
    status: laneFor({ priority: draft.priority, condition }) === "fyi" ? "fyi" : "queued",
    lane: laneFor({ priority: draft.priority, condition }),
    subject,
    inlinePrompt: null,
    pendingOptionId: null,
    settledOptionId: null,
    retiredBy: null,
    motion: "none",
    historyLabel: null,
    payload: payloadFor(draft),
    needsAction: draft.priority !== "P4",
    elementKey: draft.id,
    groupKey: draft.groupKey ?? null,
  };
}

export function applySubscribers(card: InboxCard, subscribers: readonly string[]): void {
  card.subscribers = [...subscribers];
  const copy = blockingCopy(subscribers.length);
  card.blockedTaskCount = subscribers.length;
  card.whyThisMatters = copy.whyThisMatters;
  card.blockingLabel = copy.blockingLabel;
}

function defaultSubscribers(draft: CardDraft): string[] {
  if (draft.priority === "P4") return [];
  return ["waiting-task"];
}

function defaultSubject(draft: CardDraft): BatchSubject {
  if (draft.priority === "P4") return "update";
  if (draft.type === "decision") return "decision";
  return "action";
}

function buildOptions(draft: CardDraft): DecisionOption[] {
  if (draft.type !== "decision") return [];
  const supplied = draft.options ?? [
    { id: "opt-1", label: "Accept the recommended option", recommended: true },
    { id: "opt-2", label: "Choose a different option" },
  ];
  const marked = supplied.some((option) => option.recommended === true);
  return supplied.map((option, index) => ({
    number: index + 1,
    id: option.id,
    label: option.label,
    recommended: marked ? option.recommended === true : index === 0,
  }));
}

function payloadFor(draft: CardDraft): InboxCard["payload"] {
  if (draft.type === "decision") {
    return { kind: "decision", questionId: draft.id, selectedOptionId: null };
  }
  if (draft.type === "secret") {
    return {
      kind: "secret",
      secretName: draft.secretName ?? "SECRET",
      envScope: draft.envScope ?? "test",
      mockAvailable: draft.mockAvailable === true,
      refusalMessage: null,
      inputLength: 0,
      saved: false,
      secretId: null,
      probeStatus: "idle",
    };
  }
  if (draft.type === "tool") {
    return {
      kind: "tool",
      toolName: draft.toolName ?? "Docker Desktop",
      diagnosis: draft.diagnosis ?? "Probe has not run",
      commandPreview: draft.commandPreview ?? "",
      badge: draft.badge ?? "Attested",
      stepId: draft.stepId ?? draft.id,
    };
  }
  if (draft.type === "account") {
    const provider = draft.provider ?? "GitHub";
    return {
      kind: "account",
      provider,
      allowanceResetLabel: draft.allowanceResetLabel ?? null,
      toastBody:
        draft.toastBody ??
        (provider === "ChatGPT Plus" && draft.condition === "auth_expiry"
          ? AUTH_EXPIRY_TOAST
          : `EF Harness needs you: ${draft.title}`),
    };
  }
  if (draft.type === "approval") {
    return {
      kind: "approval",
      sideEffect: draft.sideEffect ?? "open_pr",
      impactSummary: draft.impactSummary ?? draft.title,
      decision: "pending",
    };
  }
  const item: ReviewItem = {
    id: `${draft.id}:item`,
    title: draft.reviewItemTitle ?? draft.title,
    summary: draft.reviewItemSummary ?? draft.title,
    disposition: "pending",
  };
  return {
    kind: "review",
    groupKey: draft.groupKey ?? draft.id,
    source: draft.reviewSource ?? "spec_proposal",
    expanded: false,
    items: [item],
  };
}
