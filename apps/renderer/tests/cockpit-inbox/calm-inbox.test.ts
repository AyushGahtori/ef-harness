import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { textContent } from "../../src/cockpit/inbox/a11y.js";
import { MemoryHumanStepProbe, MemorySecretIpc } from "../../src/cockpit/inbox/memory-ports.js";
import { CalmInboxPanel } from "../../src/cockpit/inbox/panel.js";
import { liveSecretPrefix } from "../../src/cockpit/inbox/text.js";
import { SecretCard } from "../../src/cockpit/inbox/view.js";
import {
  AUTH_EXPIRY_TOAST,
  CALM_BATCH_MS,
  LIVE_KEY_REFUSAL,
  RETIRED_LABEL,
  SNOOZE_LABEL,
  SNOOZE_MS,
  STALE_VS_CODE_PROMPT,
  ZEN_MESSAGE,
  type CardDraft,
  type InboxCard,
} from "../../src/cockpit/inbox/types.js";

function provenance(label = "Provenance"): CardDraft["provenance"] {
  return { label, href: "ef://provenance/source" };
}

function question(id: string, extra: Partial<CardDraft> = {}): CardDraft {
  return {
    id,
    type: "decision",
    priority: "P3",
    subject: "question",
    title: `Question ${id}`,
    provenance: provenance(),
    blockedTaskIds: [`task-${id}`],
    ...extra,
  };
}

function decision(id: string, extra: Partial<CardDraft> = {}): CardDraft {
  return question(id, {
    subject: "decision",
    title: `Decision ${id}`,
    options: [
      { id: "opt-1", label: "Ship the kitchen list", recommended: true },
      { id: "opt-2", label: "Ship the customer list" },
    ],
    ...extra,
  });
}

describe("calm inbox cadence", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("releases three routine questions together at 10 minutes", () => {
    const panel = new CalmInboxPanel();
    panel.enqueue(question("a"));
    vi.advanceTimersByTime(2 * 60 * 1000);
    panel.enqueue(question("b"));
    vi.advanceTimersByTime(2 * 60 * 1000);
    panel.enqueue(question("c"));
    expect(panel.surfaced()).toHaveLength(0);
    expect(panel.unreadCount()).toBe(0);
    vi.advanceTimersByTime(CALM_BATCH_MS - 4 * 60 * 1000 - 1);
    expect(panel.surfaced()).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(panel.surfaced().map((card) => card.id)).toEqual(["a", "b", "c"]);
    expect(panel.batchHeadline()).toBe("3 quick questions");
    expect(panel.unreadCount()).toBe(3);
    expect(panel.releases().every((release) => release.sound === false && release.modal === false)).toBe(true);
    expect(textContent(panel.render())).not.toContain("dialog");
  });

  it("uses the decisions-ready headline for decision batches", () => {
    const panel = new CalmInboxPanel();
    panel.enqueue(decision("d1"));
    panel.enqueue(decision("d2"));
    panel.enqueue(decision("d3"));
    vi.advanceTimersByTime(CALM_BATCH_MS);
    expect(panel.batchHeadline()).toBe("3 quick decisions ready");
  });

  it("flushes only the critical-path card before the window", () => {
    const panel = new CalmInboxPanel();
    panel.enqueue(question("a"));
    vi.advanceTimersByTime(2 * 60 * 1000);
    panel.enqueue(question("b"));
    vi.advanceTimersByTime(2 * 60 * 1000);
    panel.enqueue(question("c"));
    vi.advanceTimersByTime(30 * 1000);
    panel.setCriticalPath("b", true);
    expect(panel.surfaced().map((card) => card.id)).toEqual(["b"]);
    expect(panel.queuedIds()).toEqual(["a", "c"]);
    vi.advanceTimersByTime(CALM_BATCH_MS - (4 * 60 * 1000 + 30 * 1000));
    expect(panel.surfaced().map((card) => card.id).sort()).toEqual(["a", "b", "c"]);
    expect(panel.batchHeadline()).toBe("2 quick questions");
  });

  it("flushes a card as soon as two tasks are waiting on it", () => {
    const panel = new CalmInboxPanel();
    const card = panel.enqueue(question("shared", { blockedTaskIds: ["T1"] }));
    expect(card.blockingLabel).toBe("Blocking 1 task");
    expect(panel.surfaced()).toHaveLength(0);
    panel.scrollTop = 80;
    const key = panel.elementKey(card.id);
    panel.addSubscriber(card.id, "T2");
    panel.addSubscriber(card.id, "T3");
    const current = panel.card(card.id);
    expect(current?.status).toBe("surfaced");
    expect(current?.blockingLabel).toBe("Blocking 3 tasks");
    expect(current?.whyThisMatters).toBe("Why this matters (blocks 3 tasks)");
    expect(panel.elementKey(card.id)).toBe(key);
    expect(panel.scrollTop).toBe(80);
  });

  it("keeps FYI updates out of the actionable badge", () => {
    const panel = new CalmInboxPanel();
    panel.enqueue(question("quiet"));
    panel.enqueue({
      id: "fyi-1",
      type: "review",
      priority: "P4",
      title: "Feature landed",
      provenance: provenance("Landing note"),
      reviewSource: "landing_summary",
    });
    vi.advanceTimersByTime(CALM_BATCH_MS);
    expect(panel.unreadCount()).toBe(1);
    expect(panel.digestCount()).toBe(1);
    expect(panel.digestText()).toBe("Updates (1)");
    expect(textContent(panel.render())).toContain("Updates (1)");
    expect(textContent(panel.render())).not.toContain("Feature landed");
    panel.peekFyi();
    expect(textContent(panel.render())).toContain("Feature landed");
  });

  it("holds routine batches in focus mode and still shows a disk emergency", () => {
    const panel = new CalmInboxPanel();
    panel.setWindow("background");
    panel.setFocusMode(true);
    panel.enqueue(question("a"));
    vi.advanceTimersByTime(2 * 60 * 1000);
    panel.enqueue(question("b"));
    vi.advanceTimersByTime(2 * 60 * 1000);
    panel.enqueue(question("c"));
    vi.advanceTimersByTime(6 * 60 * 1000);
    expect(panel.queuedIds()).toEqual(["a", "b", "c"]);
    expect(panel.unreadCount()).toBe(0);
    expect(panel.notifications.notices()).toHaveLength(0);
    panel.enqueue({
      id: "disk",
      type: "approval",
      priority: "P0",
      condition: "disk_red",
      title: "Disk space is under 2 GB",
      provenance: provenance("Disk guard"),
      sideEffect: "destructive_migration",
      impactSummary: "Free space is under 2 GB. Stop writes before the database is corrupted.",
    });
    expect(panel.unreadCount()).toBe(1);
    expect(panel.surfaced().map((card) => card.id)).toEqual(["disk"]);
    expect(panel.notifications.notices()).toHaveLength(0);
    expect(textContent(panel.render())).toContain("Focus mode");
    panel.setFocusMode(false);
    expect(panel.surfaced().map((card) => card.id).sort()).toEqual(["a", "b", "c", "disk"]);
  });

  it("caps routine batch releases at four per hour and offers a 30 minute snooze", () => {
    const panel = new CalmInboxPanel();
    for (let index = 0; index < 4; index += 1) {
      panel.enqueue(question(`q-${index}`));
      vi.advanceTimersByTime(CALM_BATCH_MS);
      expect(panel.card(`q-${index}`)?.status).toBe("surfaced");
    }
    panel.enqueue(question("q-4"));
    vi.advanceTimersByTime(CALM_BATCH_MS);
    expect(panel.card("q-4")?.status).toBe("queued");
    expect(panel.releases().filter((release) => release.reason === "window")).toHaveLength(4);
    expect(panel.snoozeControlVisible()).toBe(true);
    expect(textContent(panel.render())).toContain(SNOOZE_LABEL);
  });

  it("pauses routine questions for 30 minutes after snooze", () => {
    const panel = new CalmInboxPanel();
    panel.snooze();
    panel.enqueue(question("held"));
    vi.advanceTimersByTime(CALM_BATCH_MS);
    expect(panel.card("held")?.status).toBe("queued");
    vi.advanceTimersByTime(SNOOZE_MS - CALM_BATCH_MS);
    expect(panel.card("held")?.status).toBe("surfaced");
  });

  it("shows the zen line when nothing actionable is waiting", () => {
    const panel = new CalmInboxPanel();
    expect(panel.zenMessage()).toBe(ZEN_MESSAGE);
    expect(textContent(panel.render())).toContain(ZEN_MESSAGE);
    panel.enqueue({
      id: "note",
      type: "review",
      priority: "P4",
      title: "Cache cleaned",
      provenance: provenance(),
    });
    expect(panel.unreadCount()).toBe(0);
    expect(panel.peekText()).toBe("Peek at 1 queued FYI updates");
    expect(textContent(panel.render())).toContain("Peek at 1 queued FYI updates");
  });

  it("sends one tray notification for a minimized auth-expiry card", () => {
    const panel = new CalmInboxPanel();
    panel.setWindow("minimized");
    const card = panel.enqueue({
      id: "chatgpt",
      type: "account",
      priority: "P1",
      condition: "auth_expiry",
      title: "ChatGPT sign-in expired",
      provider: "ChatGPT Plus",
      provenance: provenance("ChatGPT connection"),
    });
    const notices = panel.notifications.notices();
    expect(notices).toHaveLength(1);
    expect(notices[0]?.body).toBe(AUTH_EXPIRY_TOAST);
    panel.enqueue({
      id: "chatgpt",
      type: "account",
      priority: "P1",
      condition: "auth_expiry",
      title: "ChatGPT sign-in expired",
      provider: "ChatGPT Plus",
      provenance: provenance("ChatGPT connection"),
    });
    expect(panel.notifications.notices()).toHaveLength(1);
    panel.clickNotification(notices[0]?.id ?? "");
    expect(panel.focusedCardId()).toBe(card.id);
    expect(panel.windowPresence()).toBe("foreground");
  });

  it("does not toast an interrupt while the window is in the foreground", () => {
    const panel = new CalmInboxPanel();
    panel.enqueue({
      id: "stop",
      type: "approval",
      priority: "P0",
      condition: "stop",
      title: "Stop the build",
      provenance: provenance(),
      impactSummary: "A stop was requested.",
    });
    expect(panel.unreadCount()).toBe(1);
    expect(panel.notifications.notices()).toHaveLength(0);
    expect(panel.releases()[0]?.reason).toBe("interrupt");
  });
});

describe("cards, keyboard, and stale replies", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders all six card types with shared anatomy and keyboard triage", () => {
    const panel = new CalmInboxPanel();
    const cards = [
      decision("pick"),
      {
        id: "secret-card",
        type: "secret",
        priority: "P2",
        title: "STRIPE_SECRET_KEY",
        provenance: provenance("Secret request"),
        secretName: "STRIPE_SECRET_KEY",
        mockAvailable: true,
      },
      {
        id: "tool-card",
        type: "tool",
        priority: "P2",
        title: "Playwright Chromium is missing",
        provenance: provenance("Tool probe"),
        toolName: "Playwright Chromium",
        diagnosis: "Playwright Chromium is not installed",
        commandPreview: "npx playwright install chromium",
        stepId: "step-playwright",
      },
      {
        id: "account-card",
        type: "account",
        priority: "P2",
        title: "GitHub token expired",
        provenance: provenance("GitHub account"),
        provider: "GitHub",
        allowanceResetLabel: "Allowance resets in 1h 22m",
      },
      {
        id: "approval-card",
        type: "approval",
        priority: "P2",
        title: "Open the pull request",
        provenance: provenance("Merge queue"),
        sideEffect: "open_pr",
        impactSummary: "Opens one pull request from the feature branch.",
      },
      {
        id: "review-seed",
        type: "review",
        priority: "P2",
        title: "Proposed detail",
        provenance: provenance("Spec proposals"),
        groupKey: "medium-risk",
        reviewItemTitle: "Cutoff copy",
      },
    ] satisfies CardDraft[];
    for (const draft of cards) panel.enqueue(draft);
    panel.openManually();
    const rendered = textContent(panel.render());
    for (const title of [
      "Decision pick",
      "STRIPE_SECRET_KEY",
      "Playwright Chromium is missing",
      "GitHub token expired",
      "Open the pull request",
      "1 proposed details — Approve all or expand",
    ]) {
      expect(rendered).toContain(title);
    }
    expect(rendered).toContain("Why this matters (blocks 1 task)");
    expect(rendered).toContain("Ship the kitchen list Recommended");
    expect(rendered).toContain("Reply in composer");
    expect(rendered).toContain("Save");
    expect(rendered).toContain("Test connection");
    expect(rendered).toContain("Use built-in local mock instead");
    expect(rendered).toContain("npx playwright install chromium");
    expect(rendered).toContain("Playwright Chromium is not installed");
    expect(rendered).toContain("Attested");
    expect(rendered).toContain("Check again");
    expect(rendered).toContain("Re-authenticate");
    expect(rendered).toContain("Switch connection");
    expect(rendered).toContain("Allowance resets in 1h 22m");
    expect(rendered).toContain("Approve");
    expect(rendered).toContain("Edit");
    expect(rendered).toContain("Decline");
    expect(rendered).toContain("Opens one pull request from the feature branch.");

    panel.handleKey({ key: "j" });
    expect(panel.focusedCardId()).toBe("secret-card");
    panel.handleKey({ key: "k" });
    expect(panel.focusedCardId()).toBe("pick");
    panel.handleKey({ key: "2" });
    const picked = panel.card("pick");
    expect(picked?.payload.kind === "decision" ? picked.payload.selectedOptionId : null).toBe("opt-2");
    panel.handleKey({ key: "Enter", ctrl: true });
    expect(panel.history().find((card) => card.id === "pick")?.settledOptionId).toBe("opt-2");

    panel.replyInComposer("pick");
    expect(panel.composer.target()).toBe("pick");
    expect(panel.composer.draft()).toBe("");
  });

  it("reconciles a stale option click after a VS Code edit", () => {
    const panel = new CalmInboxPanel();
    const card = panel.enqueue(decision("stale"));
    panel.scrollTop = 120;
    panel.retire(card.id, "vscode");
    expect(panel.scrollTop).toBe(120);
    expect(panel.history()[0]?.motion).toBe("retire-to-history");
    expect(panel.history()[0]?.historyLabel).toBe(RETIRED_LABEL);
    panel.activateOption(card.id, 2);
    expect(panel.card(card.id)?.inlinePrompt).toBe(STALE_VS_CODE_PROMPT);
    expect(panel.card(card.id)?.settledOptionId).toBeNull();
    expect(textContent(panel.render())).toContain(STALE_VS_CODE_PROMPT);
    panel.chooseStale(card.id, "keep");
    expect(panel.card(card.id)?.settledOptionId).toBeNull();
    panel.activateOption(card.id, 2);
    panel.chooseStale(card.id, "change");
    expect(panel.card(card.id)?.settledOptionId).toBe("opt-2");
  });

  it("rejects a reply that carries an older options version", () => {
    const panel = new CalmInboxPanel();
    const card = panel.enqueue(decision("versioned", { optionsVersion: 1 }));
    panel.openManually();
    panel.replaceOptions(card.id, [
      { id: "opt-1", label: "ISO date", recommended: true },
      { id: "opt-2", label: "Locale date" },
    ]);
    expect(panel.card(card.id)?.optionsVersion).toBe(2);
    panel.replyWithVersion(card.id, 1, 2);
    expect(panel.card(card.id)?.inlinePrompt).toBe("Options changed — Keep or Change?");
    expect(panel.card(card.id)?.settledOptionId).toBeNull();
    panel.replyWithVersion(card.id, 2, 1);
    expect(panel.history().find((item) => item.id === card.id)?.settledOptionId).toBe("opt-1");
  });

  it("checks a tool again and keeps attested distinct from verified", async () => {
    const probes = new MemoryHumanStepProbe();
    const panel = new CalmInboxPanel({ probes });
    panel.enqueue({
      id: "docker",
      type: "tool",
      priority: "P2",
      title: "Docker Desktop is stopped",
      provenance: provenance(),
      toolName: "Docker Desktop",
      diagnosis: "Docker Desktop is installed but not running — start Docker Desktop and click Check again",
      commandPreview: "docker info",
      stepId: "step-docker",
      badge: "Attested",
    });
    panel.openManually();
    probes.script = {
      outcome: "pass",
      diagnosis: "Docker is running",
      badge: "Verified",
    };
    await panel.checkAgain("docker");
    const card = panel.card("docker");
    expect(card?.payload.kind === "tool" ? card.payload.badge : null).toBe("Verified");
    expect(card?.payload.kind === "tool" ? card.payload.diagnosis : null).toBe("Docker is running");
    panel.attest("docker");
    expect(panel.card("docker")?.payload.kind === "tool" ? panel.card("docker")?.payload.badge : null).toBe(
      "Attested",
    );
  });

  it("records account and approval actions without a modal", () => {
    const panel = new CalmInboxPanel();
    panel.enqueue({
      id: "cursor",
      type: "account",
      priority: "P2",
      title: "Cursor session expired",
      provenance: provenance(),
      provider: "Cursor",
    });
    panel.enqueue({
      id: "deploy",
      type: "approval",
      priority: "P2",
      title: "Deploy staging",
      provenance: provenance(),
      sideEffect: "deploy_staging",
      impactSummary: "Deploys the current build to Staging.",
    });
    panel.openManually();
    panel.reauthenticate("cursor");
    panel.switchConnection("cursor");
    panel.decide("deploy", "decline");
    expect(panel.accounts.calls()).toEqual(["reauthenticate:Cursor", "switch:Cursor"]);
    expect(panel.approvals.decisions()).toEqual([{ cardId: "deploy", action: "decline" }]);
    expect(panel.audit().seriousOrCritical).toEqual([]);
  });
});

describe("secret isolation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });
  it("saves through the vault IPC and clears React state", async () => {
    const panel = new CalmInboxPanel();
    const ipc = panel.ipc as MemorySecretIpc;
    panel.enqueue({
      id: "stripe",
      type: "secret",
      priority: "P2",
      title: "STRIPE_SECRET_KEY",
      provenance: provenance(),
      secretName: "STRIPE_SECRET_KEY",
      envScope: "test",
      mockAvailable: true,
    });
    const testKey = "sk_test_example";
    panel.typeSecret("stripe", testKey);
    expect(panel.composer.draft()).toBe("");
    await panel.saveSecret("stripe");
    const controller = panel.secretController("stripe");
    expect(ipc.stored.get("secret-1")?.value).toBe(testKey);
    expect(controller?.reactState()).toEqual({ value: "", length: 0 });
    expect(controller?.wasZeroed()).toBe(true);
    expect(controller?.buffer.length()).toBe(0);
    expect(panel.userMessageBytes()).toBe(0);
    expect(panel.chat.messages()).toEqual([]);
    expect(panel.devtools.entries()).toEqual([]);
    expect(panel.leakText()).not.toContain(testKey);
    await panel.testConnection("stripe");
    expect(ipc.probes).toEqual(["secret-1"]);
    const card: InboxCard | null = panel.card("stripe");
    expect(card?.payload.kind === "secret" ? card.payload.probeStatus : null).toBe("verified");
  });

  it("refuses a live key inline and keeps the form", async () => {
    const panel = new CalmInboxPanel();
    const ipc = panel.ipc as MemorySecretIpc;
    panel.enqueue({
      id: "stripe-live",
      type: "secret",
      priority: "P2",
      title: "STRIPE_SECRET_KEY",
      provenance: provenance(),
      secretName: "STRIPE_SECRET_KEY",
      envScope: "test",
    });
    const liveKey = `${liveSecretPrefix()}example`;
    panel.typeSecret("stripe-live", liveKey);
    await expect(panel.saveSecret("stripe-live")).resolves.toBeUndefined();
    const card = panel.card("stripe-live");
    expect(card?.payload.kind === "secret" ? card.payload.refusalMessage : null).toBe(LIVE_KEY_REFUSAL);
    expect(card?.payload.kind === "secret" ? card.payload.inputLength : 0).toBeGreaterThan(0);
    expect(panel.secretController("stripe-live")?.wasZeroed()).toBe(false);
    expect(ipc.stored.size).toBe(0);
    expect(panel.userMessageBytes()).toBe(0);
    expect(panel.leakText()).not.toContain(liveKey);
    if (!card) throw new Error("missing secret card");
    expect(textContent(SecretCard(card))).toContain(LIVE_KEY_REFUSAL);
    panel.openManually();
    expect(textContent(panel.render())).toContain(LIVE_KEY_REFUSAL);
    expect(panel.leakText()).not.toContain(liveKey);
  });

  it("can use the local mock without writing the typed value into chat", async () => {
    const panel = new CalmInboxPanel();
    const ipc = panel.ipc as MemorySecretIpc;
    panel.enqueue({
      id: "mock-secret",
      type: "secret",
      priority: "P2",
      title: "STRIPE_SECRET_KEY",
      provenance: provenance(),
      secretName: "STRIPE_SECRET_KEY",
      mockAvailable: true,
    });
    panel.typeSecret("mock-secret", "sk_test_local");
    await panel.useMock("mock-secret");
    expect(ipc.mocks).toEqual(["STRIPE_SECRET_KEY"]);
    expect(panel.secretController("mock-secret")?.reactState().value).toBe("");
    expect(panel.chat.messages()).toEqual([]);
    expect(panel.userMessageBytes()).toBe(0);
  });
});
