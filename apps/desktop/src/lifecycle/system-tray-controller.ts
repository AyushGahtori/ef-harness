import type { TrayActions, TrayImage, TrayMenuSpec } from "./tray-types.js";
import {
  hasActiveExecution,
  trayBadge,
  trayStatusLine,
  type BuildActivity,
  type TrayBadge,
} from "./types.js";

export interface TrayHandle {
  setToolTip(tooltip: string): void;
  setImage(image: TrayImage): void;
  setContextMenu(menu: TrayMenuSpec): void;
  on(event: "click" | "double-click", listener: () => void): void;
  destroy(): void;
}

export interface TrayFactory {
  createImage(badge: TrayBadge): TrayImage;
  createTray(image: TrayImage): TrayHandle;
}

export interface TrayNotification {
  readonly title: string;
  readonly body: string;
  readonly onClick: () => void;
}

export interface DesktopNotifier {
  show(notification: TrayNotification): void;
}

export class SystemTrayController {
  private tray: TrayHandle | null = null;
  private badge: TrayBadge = "neutral";
  private status = "Idle";
  private firstToastShown = false;
  private visible = false;
  private readonly notifications: TrayNotification[] = [];

  constructor(
    private readonly factory: TrayFactory,
    private readonly actions: TrayActions,
    private readonly notifier: DesktopNotifier,
  ) {}

  get isVisible(): boolean {
    return this.visible;
  }

  get currentBadge(): TrayBadge {
    return this.badge;
  }

  get currentStatus(): string {
    return this.status;
  }

  get toastsShown(): number {
    return this.firstToastShown ? 1 : 0;
  }

  listNotifications(): readonly TrayNotification[] {
    return this.notifications;
  }

  sync(activity: BuildActivity, forceVisible: boolean): void {
    const shouldShow = forceVisible || hasActiveExecution(activity);
    this.status = trayStatusLine(activity);
    this.badge = trayBadge(activity);
    if (!shouldShow) {
      this.destroy();
      return;
    }
    this.ensure(activity);
  }

  presentForBackgroundBuild(activity: BuildActivity): void {
    this.ensure(activity);
  }

  showFirstMinimizeToast(activity: BuildActivity): void {
    if (this.firstToastShown) return;
    this.firstToastShown = true;
    const workers = activity.activeWorkers;
    const noun = workers === 1 ? "worker" : "workers";
    this.notify({
      title: "EF Harness",
      body: `Still building · ${workers} ${noun} · click to reopen`,
      onClick: () => this.actions.restore(),
    });
  }

  notify(notification: TrayNotification): void {
    this.notifications.push(notification);
    this.notifier.show(notification);
  }

  clickNotification(index: number): void {
    this.notifications[index]?.onClick();
  }

  click(): void {
    this.actions.restore();
  }

  doubleClick(): void {
    this.actions.restore();
  }

  private ensure(activity: BuildActivity): void {
    this.status = trayStatusLine(activity);
    this.badge = trayBadge(activity);
    const image = this.factory.createImage(this.badge);
    if (!this.tray) {
      this.tray = this.factory.createTray(image);
      this.tray.on("click", () => this.click());
      this.tray.on("double-click", () => this.doubleClick());
    } else {
      this.tray.setImage(image);
    }
    this.tray.setToolTip(this.status);
    this.tray.setContextMenu(this.menu(activity));
    this.visible = true;
  }

  private menu(activity: BuildActivity): TrayMenuSpec {
    const busy =
      activity.state === "BUILDING" ||
      activity.state === "VERIFYING" ||
      activity.state === "MERGE_QUEUE" ||
      activity.verificationActive ||
      activity.mergeQueueActive;
    return {
      items: [
        { id: "open", label: "Open EF Harness", enabled: true, onSelect: () => this.actions.open() },
        { id: "status", label: this.status, enabled: false, onSelect: () => undefined },
        {
          id: "pause-build",
          label: "Pause Build",
          enabled: busy,
          onSelect: () => this.actions.pause(),
        },
        {
          id: "stop-build",
          label: "Stop Build",
          enabled: busy,
          onSelect: () => this.actions.stop(),
        },
        { id: "quit", label: "Quit", enabled: true, onSelect: () => this.actions.quit() },
      ],
    };
  }

  destroy(): void {
    this.tray?.destroy();
    this.tray = null;
    this.visible = false;
  }
}
