import type { ReactNode } from "react";
import type { CSSProperties } from "react";

export const TOP_BAR_HEIGHT_PX = 48;
export const LEFT_RAIL_MIN_PX = 300;
export const LEFT_RAIL_MAX_PX = 420;
export const LEFT_RAIL_COLLAPSED_PX = 48;
export const INSPECTOR_MIN_PX = 340;
export const INSPECTOR_MAX_PX = 480;
export const CENTER_MIN_PX = 420;
export const MICROBATCH_MS = 16;
export const SIMULATED_FRAME_MS = 15;
export const STOP_LATENCY_BUDGET_MS = 100;
export const HEARTBEAT_INTERVAL_MS = 1000;

export const PHASES = [
  { id: "discover", label: "Discover", shortcut: "1" },
  { id: "plan", label: "Plan", shortcut: "2" },
  { id: "build", label: "Build", shortcut: "3" },
  { id: "ship", label: "Ship", shortcut: "4" },
] as const;

export type PhaseId = (typeof PHASES)[number]["id"];

export const CENTER_TABS = [
  { id: "office", label: "Office", ownerTask: "Task 162" },
  { id: "board", label: "Board", ownerTask: "Task 124" },
  { id: "canvas", label: "Canvas", ownerTask: "Task 153" },
  { id: "spec-plan", label: "Spec / Plan", ownerTask: "Task 159" },
  { id: "preview", label: "Preview", ownerTask: "Task 160" },
  { id: "ship", label: "Ship", ownerTask: "Task 178" },
  { id: "diagnostics", label: "Diagnostics", ownerTask: "Task 133" },
] as const;

export type CenterTabId = (typeof CENTER_TABS)[number]["id"];

export type ThemePreference = "light" | "dark" | "system";
export type ResolvedThemeName = "light" | "dark";
export type PressureLevel = "green" | "yellow" | "orange" | "red";
export type RailFilter = "all" | "needs-you" | "chat";
export type RunMode = "idle" | "running" | "paused" | "stopped";
export type ConnectionState = "live" | "reconnecting";
export type InspectorKind = "worker" | "canvas-node" | "chosen-for-you" | "diff";
export type FocusZone = "shell" | "tablist" | "composer";

export interface ProjectBadge {
  id: string;
  name: string;
  branch: string;
}

export interface InboxItem {
  id: string;
  bucket: "needs-you" | "chat" | "fyi";
  title: string;
  unread: boolean;
}

export interface WorkerView {
  id: string;
  status: string;
  detail: string;
  updatedSeq: number;
}

export interface ApiSpend {
  kind: "api";
  connectionLabel: string;
  spentUsd: number;
  capUsd: number;
}

export interface SubscriptionSpend {
  kind: "subscription";
  connectionLabel: string;
  percentOfWindow: number;
  windowLabel: string;
}

export type SpendEntry = ApiSpend | SubscriptionSpend;

export interface SpendState {
  active: SpendEntry;
  breakdown: readonly SpendEntry[];
}

export interface PressureSnapshot {
  level: PressureLevel;
  driver: string;
}

export interface InspectorSelection {
  kind: InspectorKind;
  id: string;
  title: string;
}

export interface ThemeTokens {
  name: ResolvedThemeName;
  canvas: string;
  text: string;
  muted: string;
  topBar: string;
  topBarText: string;
  stopBg: string;
  stopFg: string;
  pauseBg: string;
  pauseFg: string;
  resumeBg: string;
  resumeFg: string;
  greenBg: string;
  greenFg: string;
  yellowBg: string;
  yellowFg: string;
  orangeBg: string;
  orangeFg: string;
  redBg: string;
  redFg: string;
  focusRing: string;
  border: string;
  composerBg: string;
  composerText: string;
  railBg: string;
  inspectorBg: string;
}

export interface PaneRequest {
  viewportWidth: number;
  viewportHeight: number;
  leftWidthPx: number;
  leftCollapsed: boolean;
  leftOpenedAt: number;
  inspectorWidthPx: number;
  inspectorCollapsed: boolean;
  inspectorOpenedAt: number;
}

export interface ResolvedLayout {
  topBarHeightPx: number;
  leftWidthPx: number;
  leftCollapsed: boolean;
  leftForceCollapsed: boolean;
  leftOverlay: boolean;
  inspectorWidthPx: number;
  inspectorCollapsed: boolean;
  inspectorForceCollapsed: boolean;
  inspectorOverlay: boolean;
  centerWidthPx: number;
  centerHeightPx: number;
}

export interface DaemonEvent {
  seq: number;
  streamEpoch: string;
  topic: string;
  type: string;
  payload: unknown;
}

export interface DaemonSnapshot {
  asOfSeq: number;
  streamEpoch: string;
  project: ProjectBadge;
  run: RunMode;
  workers: readonly WorkerView[];
  inbox: readonly InboxItem[];
  spend: SpendState;
  governor: PressureSnapshot;
}

export interface DaemonView {
  asOfSeq: number;
  streamEpoch: string;
  project: ProjectBadge;
  run: RunMode;
  workers: readonly WorkerView[];
  inbox: readonly InboxItem[];
  spend: SpendState;
  governor: PressureSnapshot;
}

export interface ShellViewModel {
  windowId: string;
  project: ProjectBadge;
  projects: readonly ProjectBadge[];
  projectMenuOpen: boolean;
  phase: PhaseId;
  centerTab: CenterTabId;
  tabScratch: Readonly<Record<CenterTabId, string>>;
  connection: ConnectionState;
  run: RunMode;
  spendOpen: boolean;
  spendPrimary: string;
  spendLines: readonly string[];
  governor: PressureSnapshot;
  focusMode: boolean;
  themePreference: ThemePreference;
  tokens: ThemeTokens;
  layout: ResolvedLayout;
  leftRequestedWidthPx: number;
  inspectorRequestedWidthPx: number;
  leftScrollTop: number;
  railFilter: RailFilter;
  needsYouCount: number;
  unreadCount: number;
  inbox: readonly InboxItem[];
  composerDraft: string;
  dictating: boolean;
  composerTarget: string;
  stopEnabled: boolean;
  pauseEnabled: boolean;
  resumeEnabled: boolean;
  sendEnabled: boolean;
  stopConfirmOpen: boolean;
  settingsOpen: boolean;
  inspectorSelection: InspectorSelection | null;
  workers: readonly WorkerView[];
  workerCount: number;
  focusId: string;
  keyboardModality: boolean;
  revision: number;
}

export interface CenterTabSlot {
  ownerTask: string;
  render: (model: ShellViewModel) => ReactNode;
}

export interface InspectorSlot {
  ownerTask: string;
  render: (selection: InspectorSelection, model: ShellViewModel) => ReactNode;
}

export interface LeftRailInboxSlot {
  ownerTask: "Task 127";
  render: (model: ShellViewModel) => ReactNode;
}

export interface PhasePresetSlot {
  ownerTask: "Task 123";
  hintsFor: (phase: PhaseId) => PhaseLayoutHints;
}

export interface PhaseLayoutHints {
  leftCollapsed?: boolean;
  inspectorCollapsed?: boolean;
  centerTab?: CenterTabId;
}

export interface ShellSlotRegistry {
  center?: Partial<Record<CenterTabId, CenterTabSlot>>;
  inspector?: Partial<Record<InspectorKind, InspectorSlot>>;
  inbox?: LeftRailInboxSlot;
  phasePreset?: PhasePresetSlot;
}

export interface ToneAttrs {
  style: CSSProperties;
  "data-fg": string;
  "data-bg": string;
}

export function isPhaseId(value: string): value is PhaseId {
  return PHASES.some((phase) => phase.id === value);
}

export function isCenterTabId(value: string): value is CenterTabId {
  return CENTER_TABS.some((tab) => tab.id === value);
}

export function centerTabById(id: CenterTabId): (typeof CENTER_TABS)[number] {
  const tab = CENTER_TABS.find((item) => item.id === id);
  if (!tab) {
    throw new Error(`Unknown center tab ${id}`);
  }
  return tab;
}

export function phaseById(id: PhaseId): (typeof PHASES)[number] {
  const phase = PHASES.find((item) => item.id === id);
  if (!phase) {
    throw new Error(`Unknown phase ${id}`);
  }
  return phase;
}

export function emptyTabScratch(): Record<CenterTabId, string> {
  return {
    office: "",
    board: "",
    canvas: "",
    "spec-plan": "",
    preview: "",
    ship: "",
    diagnostics: "",
  };
}
