import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { AnimationFrameClock } from "./clock.js";
import { ManualClock } from "./clock.js";
import { DaemonStore, DaemonStoreProvider, createDaemonSnapshot } from "./daemon-store.js";
import { needsYouCount, spendLines, spendPrimary, unreadActionableCount } from "./format.js";
import { UiLatencyHeartbeatMonitor } from "./heartbeat.js";
import { clampInspectorWidth, clampLeftWidth, resolveLayout } from "./layout.js";
import {
  BridgeKernelStopController,
  EventStreamSubscriber,
  MemoryLatencySink,
  MemoryPreloadPort,
  MemoryPressureHysteresis,
  defaultProject,
  type HardwareGovernorLatencySink,
  type ImmediateKernelStopController,
  type KernelStopResult,
  type PreloadMessagePort,
  type PressureHysteresisStateMachine,
} from "./ports.js";
import {
  DEFAULT_PREFERENCES,
  MemoryPreferenceStore,
  type ShellPreferenceStore,
} from "./preferences.js";
import { commandForKey, type KeyInput } from "./shortcuts.js";
import { SingleAppShellView } from "./shell-view.js";
import { resolveTheme } from "./theme.js";
import type { AppliedPhasePreset, CenterTab, LifecyclePhase } from "../presets/types.js";
import {
  CENTER_TABS,
  STOP_LATENCY_BUDGET_MS,
  emptyTabScratch,
  isCenterTabId,
  isPhaseId,
  type CanvasViewportState,
  type CenterTabId,
  type ConnectionState,
  type DaemonSnapshot,
  type FocusZone,
  type InspectorSelection,
  type PhaseId,
  type PhaseLayoutHints,
  type ProjectBadge,
  type RailFilter,
  type ResolvedThemeName,
  type ShellSlotRegistry,
  type ShellViewModel,
  type ThemePreference,
} from "./types.js";

export interface SingleAppShellOptions {
  windowId?: string;
  clock: AnimationFrameClock;
  client: PreloadMessagePort;
  bridge: PreloadMessagePort;
  stop?: ImmediateKernelStopController;
  pressure: PressureHysteresisStateMachine;
  heartbeatSink: HardwareGovernorLatencySink;
  preferences: ShellPreferenceStore;
  initialSnapshot?: DaemonSnapshot;
  viewport?: { width: number; height: number };
  systemTheme?: ResolvedThemeName;
  projects?: readonly ProjectBadge[];
  composerTarget?: string;
  onOpenProject?: (projectId: string) => void;
  onOpenSettings?: () => void;
  onComposerSubmit?: (draft: string) => void;
  slots?: ShellSlotRegistry;
}

export class SingleAppShell {
  readonly windowId: string;
  readonly daemon: DaemonStoreProvider;
  readonly stream: EventStreamSubscriber;
  readonly context: ShellLayoutContext;
  reactCommitCount = 0;
  lastStop: KernelStopResult | null = null;
  lastStopLatencyMs = 0;
  stopOverBudget = false;
  lastInputToPaintMs = 0;
  projectOpenRequests: string[] = [];
  submittedDrafts: string[] = [];
  settingsOpens = 0;

  private readonly clock: AnimationFrameClock;
  private readonly store: DaemonStore;
  private readonly stop: ImmediateKernelStopController;
  private readonly heartbeat: UiLatencyHeartbeatMonitor;
  private readonly preferences: ShellPreferenceStore;
  private readonly onOpenProject: ((projectId: string) => void) | null;
  private readonly onOpenSettings: (() => void) | null;
  private readonly onComposerSubmit: ((draft: string) => void) | null;
  private slots: ShellSlotRegistry;
  private viewport: { width: number; height: number };
  private systemTheme: ResolvedThemeName;
  private projects: readonly ProjectBadge[];
  private composerTarget: string;
  private phase: PhaseId = "discover";
  private centerTab: CenterTabId = "office";
  private tabScratch = emptyTabScratch();
  private connection: ConnectionState = "live";
  private themePreference: ThemePreference;
  private focusMode: boolean;
  private leftWidth: number;
  private inspectorWidth: number;
  private userLeftCollapsed: boolean;
  private userInspectorCollapsed: boolean;
  private leftOpenedAt = 1;
  private inspectorOpenedAt = 2;
  private openedTick = 2;
  private leftScrollTop = 0;
  private railFilter: RailFilter = "all";
  private composerDraft = "";
  private dictating = false;
  private projectMenuOpen = false;
  private spendOpen = false;
  private stopConfirmOpen = false;
  private settingsOpen = false;
  private inspectorSelection: InspectorSelection | null = null;
  private focusId = "topbar-stop";
  private focusZone: FocusZone = "shell";
  private keyboardModality = false;
  private pendingUiInput: number | null = null;
  private canvasState: CanvasViewportState = { x: 0, y: 0, zoom: 1, filters: [] };
  private revision = 0;
  private cachedHtml = "";
  private readonly releaseStore: () => void;
  private readonly releasePressure: () => void;

  constructor(options: SingleAppShellOptions) {
    this.windowId = options.windowId ?? "main";
    this.clock = options.clock;
    this.preferences = options.preferences;
    this.stop =
      options.stop ?? new BridgeKernelStopController(options.bridge, options.clock);
    this.heartbeat = new UiLatencyHeartbeatMonitor(options.heartbeatSink);
    this.onOpenProject = options.onOpenProject ?? null;
    this.onOpenSettings = options.onOpenSettings ?? null;
    this.onComposerSubmit = options.onComposerSubmit ?? null;
    this.slots = options.slots ?? {};
    this.viewport = options.viewport ?? { width: 1440, height: 900 };
    this.systemTheme = options.systemTheme ?? "light";
    this.composerTarget = options.composerTarget ?? "Composer";
    const saved = this.preferences.read(this.windowId) ?? DEFAULT_PREFERENCES;
    this.leftWidth = clampLeftWidth(saved.leftWidthPx);
    this.inspectorWidth = clampInspectorWidth(saved.inspectorWidthPx);
    this.userLeftCollapsed = saved.leftCollapsed;
    this.userInspectorCollapsed = saved.inspectorCollapsed;
    this.themePreference = saved.theme;
    this.focusMode = saved.focusMode;
    const initial = options.initialSnapshot ?? createDaemonSnapshot();
    this.projects = options.projects ?? [initial.project];
    this.store = new DaemonStore({
      clock: this.clock,
      heartbeat: this.heartbeat,
      initial,
    });
    this.store.setGovernor(options.pressure.snapshot());
    this.daemon = new DaemonStoreProvider(this.store);
    this.stream = new EventStreamSubscriber(
      options.client,
      initial.project.id,
      {
        onEvent: (event) => {
          this.store.ingest(event);
        },
        onDisconnect: () => {
          this.connection = "reconnecting";
          this.refresh();
        },
        onResyncRequired: () => {
          this.connection = "reconnecting";
          this.refresh();
        },
        onSnapshot: (snapshot) => {
          this.connection = "live";
          this.store.hydrate(snapshot);
        },
      },
      this.store.cursor,
    );
    this.stream.start();
    this.releaseStore = this.store.subscribe(() => {
      this.refresh();
    });
    this.releasePressure = options.pressure.subscribe((snapshot) => {
      this.store.setGovernor(snapshot);
    });
    this.context = new ShellLayoutContext(this);
    this.refresh();
  }

  renderHtml(): string {
    return this.cachedHtml;
  }

  viewModel(): ShellViewModel {
    const daemon = this.store.view();
    const layout = this.currentLayout();
    const tokens = resolveTheme(this.themePreference, this.systemTheme);
    return {
      windowId: this.windowId,
      project: daemon.project,
      projects: this.projects,
      projectMenuOpen: this.projectMenuOpen,
      phase: this.phase,
      centerTab: this.centerTab,
      tabScratch: this.tabScratch,
      connection: this.connection,
      run: daemon.run,
      spendOpen: this.spendOpen,
      spendPrimary: spendPrimary(daemon.spend),
      spendLines: spendLines(daemon.spend),
      governor: daemon.governor,
      focusMode: this.focusMode,
      themePreference: this.themePreference,
      tokens,
      layout,
      leftRequestedWidthPx: this.leftWidth,
      inspectorRequestedWidthPx: this.inspectorWidth,
      leftScrollTop: this.leftScrollTop,
      railFilter: this.railFilter,
      needsYouCount: needsYouCount(daemon.inbox),
      unreadCount: unreadActionableCount(daemon.inbox),
      inbox: daemon.inbox,
      composerDraft: this.composerDraft,
      dictating: this.dictating,
      composerTarget: this.composerTarget,
      stopEnabled: this.connection === "live" && daemon.run === "running",
      pauseEnabled: this.connection === "live" && daemon.run === "running",
      resumeEnabled:
        this.connection === "live" && (daemon.run === "paused" || daemon.run === "stopped"),
      sendEnabled: this.connection === "live" && this.composerDraft.trim().length > 0,
      stopConfirmOpen: this.stopConfirmOpen,
      settingsOpen: this.settingsOpen,
      inspectorSelection: this.inspectorSelection,
      workers: daemon.workers,
      workerCount: daemon.workers.length,
      focusId: this.focusId,
      keyboardModality: this.keyboardModality,
      revision: this.revision,
    };
  }

  handleKey(input: KeyInput): void {
    this.keyboardModality = true;
    this.pendingUiInput = this.clock.now();
    const command = commandForKey(input, this.focusZone);
    if (!command) {
      this.refresh();
      return;
    }
    this.activate(command);
  }

  activate(command: string): void {
    if (command === "dismiss") {
      this.dismiss();
      return;
    }
    if (command === "stop") {
      this.fireStop("top-bar");
      return;
    }
    if (command === "stop-confirm") {
      this.stopConfirmOpen = true;
      this.refresh();
      return;
    }
    if (command === "confirm-stop") {
      this.stopConfirmOpen = false;
      this.fireStop("shortcut-confirm");
      return;
    }
    if (command === "cancel-stop") {
      this.stopConfirmOpen = false;
      this.refresh();
      return;
    }
    if (command === "pause") {
      if (this.viewModel().pauseEnabled) {
        this.stop.pauseAll({ projectId: this.projectId(), requestedAtMs: this.clock.now() });
        this.store.setRun("paused");
      } else {
        this.refresh();
      }
      return;
    }
    if (command === "resume") {
      if (this.viewModel().resumeEnabled) {
        this.stop.resume({ projectId: this.projectId(), requestedAtMs: this.clock.now() });
        this.store.setRun("running");
      } else {
        this.refresh();
      }
      return;
    }
    if (command === "toggle-left") {
      if (this.currentLayout().leftCollapsed) {
        this.userLeftCollapsed = false;
        this.touchOpened("left");
      } else {
        this.userLeftCollapsed = true;
      }
      this.persist();
      this.refresh();
      return;
    }
    if (command === "toggle-inspector") {
      if (this.currentLayout().inspectorCollapsed) {
        this.userInspectorCollapsed = false;
        this.touchOpened("inspector");
      } else {
        this.userInspectorCollapsed = true;
      }
      this.persist();
      this.refresh();
      return;
    }
    if (command === "toggle-focus") {
      this.focusMode = !this.focusMode;
      this.persist();
      this.refresh();
      return;
    }
    if (command === "toggle-project-menu") {
      this.projectMenuOpen = !this.projectMenuOpen;
      this.focusId = "project-switcher";
      this.refresh();
      return;
    }
    if (command === "toggle-spend") {
      this.spendOpen = !this.spendOpen;
      this.refresh();
      return;
    }
    if (command === "open-settings") {
      this.settingsOpen = true;
      this.settingsOpens += 1;
      this.onOpenSettings?.();
      this.refresh();
      return;
    }
    if (command === "dictate") {
      if (this.currentLayout().leftCollapsed) {
        this.userLeftCollapsed = false;
        this.touchOpened("left");
      }
      this.dictating = !this.dictating;
      this.focusZone = "composer";
      this.focusId = "composer-input";
      this.refresh();
      return;
    }
    if (command === "send-composer") {
      if (this.viewModel().sendEnabled) {
        this.submittedDrafts.push(this.composerDraft);
        this.onComposerSubmit?.(this.composerDraft);
      }
      this.refresh();
      return;
    }
    if (command === "tab-next") {
      this.moveTab(1);
      return;
    }
    if (command === "tab-previous") {
      this.moveTab(-1);
      return;
    }
    if (command === "tab-first") {
      this.selectTab(CENTER_TABS[0]?.id ?? "office");
      return;
    }
    if (command === "tab-last") {
      this.selectTab(CENTER_TABS[CENTER_TABS.length - 1]?.id ?? "diagnostics");
      return;
    }
    if (command.startsWith("phase:")) {
      const phase = command.slice("phase:".length);
      if (isPhaseId(phase)) {
        this.phase = phase;
        this.focusId = `phase-${phase}`;
      }
      this.refresh();
      return;
    }
    if (command.startsWith("tab:")) {
      const tab = command.slice("tab:".length);
      if (isCenterTabId(tab)) this.selectTab(tab);
      else this.refresh();
      return;
    }
    if (command.startsWith("filter:")) {
      const filter = command.slice("filter:".length);
      if (filter === "all" || filter === "needs-you" || filter === "chat") this.railFilter = filter;
      this.refresh();
      return;
    }
    if (command.startsWith("theme:")) {
      const theme = command.slice("theme:".length);
      if (theme === "light" || theme === "dark" || theme === "system") {
        this.themePreference = theme;
        this.persist();
      }
      this.refresh();
      return;
    }
    if (command.startsWith("project:")) {
      const projectId = command.slice("project:".length);
      this.projectMenuOpen = false;
      this.projectOpenRequests.push(projectId);
      this.onOpenProject?.(projectId);
      this.refresh();
      return;
    }
    this.refresh();
  }

  setComposerDraft(draft: string): void {
    this.composerDraft = draft;
    this.refresh();
  }

  setTabScratch(tab: CenterTabId, scratch: string): void {
    this.tabScratch = { ...this.tabScratch, [tab]: scratch };
    this.refresh();
  }

  setRailScroll(scrollTop: number): void {
    this.leftScrollTop = scrollTop;
    this.refresh();
  }

  setViewport(width: number, height: number): void {
    this.viewport = { width, height };
    this.refresh();
  }

  setSystemTheme(theme: ResolvedThemeName): void {
    this.systemTheme = theme;
    this.refresh();
  }

  dragLeftRail(widthPx: number): void {
    this.leftWidth = clampLeftWidth(widthPx);
    this.userLeftCollapsed = false;
    this.touchOpened("left");
    this.persist();
    this.refresh();
  }

  dragInspector(widthPx: number): void {
    this.inspectorWidth = clampInspectorWidth(widthPx);
    this.userInspectorCollapsed = false;
    this.touchOpened("inspector");
    this.persist();
    this.refresh();
  }

  openInspector(selection: InspectorSelection): void {
    this.inspectorSelection = selection;
    this.userInspectorCollapsed = false;
    this.touchOpened("inspector");
    this.refresh();
  }

  registerSlots(slots: ShellSlotRegistry): void {
    this.slots = slots;
    this.refresh();
  }

  phaseHints(): PhaseLayoutHints | null {
    const slot = this.slots.phasePreset;
    return slot ? slot.hintsFor(this.phase) : null;
  }

  applyLayoutPreset(preset: AppliedPhasePreset): void {
    if (isPhaseId(preset.phase)) this.phase = preset.phase;
    const tab = shellTabForPreset(preset.center.primaryTab);
    if (tab) this.centerTab = tab;
    this.userLeftCollapsed = preset.leftRail.presentation === "compact";
    this.userInspectorCollapsed = preset.inspector.collapsed;
    this.persist();
    this.refresh();
  }

  readCanvas(): CanvasViewportState {
    return {
      x: this.canvasState.x,
      y: this.canvasState.y,
      zoom: this.canvasState.zoom,
      filters: [...this.canvasState.filters],
    };
  }

  writeCanvas(state: CanvasViewportState): void {
    this.canvasState = {
      x: state.x,
      y: state.y,
      zoom: state.zoom,
      filters: [...state.filters],
    };
  }

  focusTablist(): void {
    this.focusZone = "tablist";
    this.focusId = `tab-${this.centerTab}`;
    this.keyboardModality = true;
    this.refresh();
  }

  dispose(): void {
    this.releaseStore();
    this.releasePressure();
    this.stream.dispose();
    this.store.dispose();
  }

  private fireStop(source: "top-bar" | "shortcut-confirm"): void {
    if (!this.viewModel().stopEnabled) {
      this.refresh();
      return;
    }
    const result = this.stop.stopNow({
      projectId: this.projectId(),
      source,
      requestedAtMs: this.clock.now(),
    });
    this.lastStop = result;
    this.lastStopLatencyMs = result.latencyMs;
    this.stopOverBudget = result.latencyMs >= STOP_LATENCY_BUDGET_MS;
    this.focusId = "topbar-stop";
    this.store.setRun("stopped");
  }

  private dismiss(): void {
    if (this.stopConfirmOpen) {
      this.stopConfirmOpen = false;
    } else if (this.spendOpen) {
      this.spendOpen = false;
    } else if (this.projectMenuOpen) {
      this.projectMenuOpen = false;
    } else if (this.settingsOpen) {
      this.settingsOpen = false;
    } else if (!this.currentLayout().inspectorCollapsed) {
      this.userInspectorCollapsed = true;
      this.persist();
    } else if (this.dictating) {
      this.dictating = false;
    }
    this.refresh();
  }

  private selectTab(tab: CenterTabId): void {
    this.centerTab = tab;
    this.focusZone = "tablist";
    this.focusId = `tab-${tab}`;
    this.refresh();
  }

  private moveTab(delta: number): void {
    const index = CENTER_TABS.findIndex((tab) => tab.id === this.centerTab);
    const count = CENTER_TABS.length;
    const next = CENTER_TABS[(index + delta + count) % count];
    this.selectTab(next?.id ?? this.centerTab);
  }

  private touchOpened(pane: "left" | "inspector"): void {
    this.openedTick += 1;
    if (pane === "left") this.leftOpenedAt = this.openedTick;
    else this.inspectorOpenedAt = this.openedTick;
  }

  private currentLayout() {
    return resolveLayout({
      viewportWidth: this.viewport.width,
      viewportHeight: this.viewport.height,
      leftWidthPx: this.leftWidth,
      leftCollapsed: this.userLeftCollapsed,
      leftOpenedAt: this.leftOpenedAt,
      inspectorWidthPx: this.inspectorWidth,
      inspectorCollapsed: this.userInspectorCollapsed,
      inspectorOpenedAt: this.inspectorOpenedAt,
    });
  }

  private projectId(): string {
    return this.store.view().project.id;
  }

  private persist(): void {
    this.preferences.write(this.windowId, {
      leftWidthPx: this.leftWidth,
      leftCollapsed: this.userLeftCollapsed,
      inspectorWidthPx: this.inspectorWidth,
      inspectorCollapsed: this.userInspectorCollapsed,
      theme: this.themePreference,
      focusMode: this.focusMode,
    });
  }

  private refresh(): void {
    if (this.pendingUiInput !== null) {
      this.lastInputToPaintMs = this.clock.now() - this.pendingUiInput;
      this.heartbeat.noteSample(this.lastInputToPaintMs, this.clock.now(), this.clock.hidden());
      this.pendingUiInput = null;
    }
    this.revision += 1;
    this.reactCommitCount += 1;
    this.cachedHtml = renderToStaticMarkup(
      createElement(SingleAppShellView, { model: this.viewModel(), slots: this.slots }),
    );
  }
}

const PRESET_TAB: Readonly<Record<string, CenterTabId>> = {
  office: "office",
  board: "board",
  canvas: "canvas",
  "architecture-canvas": "canvas",
  "spec-plan": "spec-plan",
  "plan-preview": "spec-plan",
  "spec-tree": "spec-plan",
  preview: "preview",
  "live-preview": "preview",
  ship: "ship",
  "landing-summary": "ship",
  "pr-ci-loop": "ship",
  "deploy-pipeline": "ship",
  diagnostics: "diagnostics",
};

function shellTabForPreset(tab: string): CenterTabId | null {
  return PRESET_TAB[tab] ?? null;
}

export class ShellLayoutContext {
  private applied: AppliedPhasePreset | null = null;
  lastReason: "initial" | "user-switch" | null = null;

  constructor(private readonly shell: SingleAppShell) {}

  applyPreset(preset: AppliedPhasePreset, reason: "initial" | "user-switch" = "user-switch"): void {
    this.applied = preset;
    this.lastReason = reason;
    this.shell.applyLayoutPreset(preset);
  }

  currentPhase(): LifecyclePhase | null {
    return this.applied?.phase ?? null;
  }

  currentTab(): CenterTab | null {
    return this.applied?.center.primaryTab ?? null;
  }

  readCanvas(): CanvasViewportState {
    return this.shell.readCanvas();
  }

  writeCanvas(state: CanvasViewportState): void {
    this.shell.writeCanvas(state);
  }

  get phase(): PhaseId {
    return this.shell.viewModel().phase;
  }

  setPhase(phase: PhaseId): void {
    this.shell.activate(`phase:${phase}`);
  }

  get centerTab(): CenterTabId {
    return this.shell.viewModel().centerTab;
  }

  setCenterTab(tab: CenterTabId): void {
    this.shell.activate(`tab:${tab}`);
  }

  get focusMode(): boolean {
    return this.shell.viewModel().focusMode;
  }

  toggleFocusMode(): void {
    this.shell.activate("toggle-focus");
  }

  toggleLeftRail(): void {
    this.shell.activate("toggle-left");
  }

  toggleInspector(): void {
    this.shell.activate("toggle-inspector");
  }

  get composerDraft(): string {
    return this.shell.viewModel().composerDraft;
  }

  setComposerDraft(draft: string): void {
    this.shell.setComposerDraft(draft);
  }

  get connection(): ConnectionState {
    return this.shell.viewModel().connection;
  }

  get centerWidthPx(): number {
    return this.shell.viewModel().layout.centerWidthPx;
  }

  get leftCollapsed(): boolean {
    return this.shell.viewModel().layout.leftCollapsed;
  }

  get inspectorCollapsed(): boolean {
    return this.shell.viewModel().layout.inspectorCollapsed;
  }

  get inspectorOverlay(): boolean {
    return this.shell.viewModel().layout.inspectorOverlay;
  }
}

export interface ConnectedShell {
  shell: SingleAppShell;
  clock: ManualClock;
  client: MemoryPreloadPort;
  bridge: MemoryPreloadPort;
  stop: BridgeKernelStopController;
  pressure: MemoryPressureHysteresis;
  sink: MemoryLatencySink;
  preferences: MemoryPreferenceStore;
}

export function createConnectedShell(options?: {
  snapshot?: DaemonSnapshot;
  viewport?: { width: number; height: number };
  systemTheme?: ResolvedThemeName;
  preferences?: MemoryPreferenceStore;
  windowId?: string;
}): ConnectedShell {
  const clock = new ManualClock();
  const client = new MemoryPreloadPort();
  const bridge = new MemoryPreloadPort();
  const stop = new BridgeKernelStopController(bridge, clock);
  const pressure = new MemoryPressureHysteresis();
  const sink = new MemoryLatencySink();
  const preferences = options?.preferences ?? new MemoryPreferenceStore();
  const shell = new SingleAppShell({
    windowId: options?.windowId ?? "main",
    clock,
    client,
    bridge,
    stop,
    pressure,
    heartbeatSink: sink,
    preferences,
    initialSnapshot: options?.snapshot ?? createDaemonSnapshot(),
    viewport: options?.viewport ?? { width: 1440, height: 900 },
    systemTheme: options?.systemTheme ?? "light",
    projects: [options?.snapshot?.project ?? defaultProject(), { id: "other", name: "other-app", branch: "main" }],
  });
  return { shell, clock, client, bridge, stop, pressure, sink, preferences };
}
