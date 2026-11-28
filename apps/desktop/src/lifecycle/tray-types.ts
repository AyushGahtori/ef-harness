import type { TrayBadge } from "./types.js";

export interface TrayImage {
  readonly badge: TrayBadge;
  readonly width: number;
  readonly height: number;
}

export interface TrayMenuItem {
  readonly id: "open" | "status" | "pause-build" | "stop-build" | "quit";
  readonly label: string;
  readonly enabled: boolean;
  readonly onSelect: () => void;
}

export interface TrayMenuSpec {
  readonly items: readonly TrayMenuItem[];
}

export interface TrayActions {
  open: () => void;
  pause: () => void;
  stop: () => void;
  quit: () => void;
  restore: () => void;
}
