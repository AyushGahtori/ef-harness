import { describe, expect, it } from "vitest";
import {
  InMemoryMainShell,
  InMemoryScreenPort,
  InMemoryTrayLifecycle,
  InMemoryWindow,
  InMemoryWindowFactory,
  PopOutWindowCoordinator,
  SharedHarnessdStream,
  type ConnectedDisplay,
  type DipRect,
  type HarnessdEvent,
} from "../../src/windows/index.js";

function area(x: number, y: number, width: number, height: number): DipRect {
  return { x, y, width, height };
}

function display(input: {
  id: number;
  primary: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  scaleFactor: number;
}): ConnectedDisplay {
  const workArea = area(input.x, input.y, input.width, input.height);
  return {
    id: input.id,
    primary: input.primary,
    scaleFactor: input.scaleFactor,
    bounds: workArea,
    workArea,
  };
}

function laptop(): ConnectedDisplay {
  return display({ id: 1, primary: true, x: 0, y: 0, width: 1920, height: 1080, scaleFactor: 1 });
}

function external(): ConnectedDisplay {
  return display({
    id: 2,
    primary: false,
    x: 2560,
    y: 0,
    width: 3840,
    height: 2160,
    scaleFactor: 1,
  });
}

function harness(displays: readonly ConnectedDisplay[] = [laptop(), external()]) {
  const screen = new InMemoryScreenPort(displays);
  const factory = new InMemoryWindowFactory();
  const stream = new SharedHarnessdStream();
  const shell = new InMemoryMainShell();
  const tray = new InMemoryTrayLifecycle();
  const main = new InMemoryWindow("main", "EF Harness", area(80, 40, 1440, 900), "main");
  const coordinator = new PopOutWindowCoordinator({
    screen,
    factory,
    stream,
    shell,
    tray,
    main,
  });
  return { screen, factory, stream, shell, tray, main, coordinator };
}

function previewEvent(seq: number): HarnessdEvent {
  return {
    seq,
    type: "preview.state",
    projectId: "kitchen-app",
    payload: { url: "preview://kitchen" },
  };
}

describe("PopOutWindowCoordinator", () => {
  it("focuses the existing preview window instead of opening a second one", () => {
    const { coordinator, factory } = harness();
    const first = coordinator.popOut("preview");
    const second = coordinator.popOut("preview");
    const window = coordinator.windowFor("preview");

    expect(first).toMatchObject({
      ok: true,
      action: "created",
      view: "preview",
      windowId: "popout:preview",
      spawned: true,
      dockLabel: "Dock back into main window",
      title: "Live App Preview",
    });
    expect(second).toMatchObject({
      ok: true,
      action: "focused",
      windowId: "popout:preview",
      spawned: false,
    });
    expect(factory.created).toHaveLength(1);
    expect(window?.focusCount).toBe(1);
    expect(window?.id).toBe("popout:preview");
  });

  it("caps simultaneous pop-outs at three", () => {
    const { coordinator } = harness();
    expect(coordinator.popOut("preview").ok).toBe(true);
    expect(coordinator.popOut("office").ok).toBe(true);
    expect(coordinator.popOut("board").ok).toBe(true);

    expect(coordinator.popOut("canvas")).toEqual({
      ok: false,
      action: "rejected",
      reason: "popout-cap",
      limit: 3,
      view: "canvas",
    });
    expect(coordinator.isPoppedOut("canvas")).toBe(false);
    expect(coordinator.popOut("office")).toMatchObject({ action: "focused", spawned: false });
    expect(coordinator.centerWorkspaceTabs().tabs).toEqual(["canvas", "inspector"]);
  });

  it("re-docks a board closed from the operating system", () => {
    const { coordinator } = harness();
    coordinator.popOut("board");
    expect(coordinator.centerWorkspaceTabs().tabs).not.toContain("board");

    coordinator.windowFor("board")?.close();

    expect(coordinator.isPoppedOut("board")).toBe(false);
    expect(coordinator.centerWorkspaceTabs().tabs).toContain("board");
    expect(coordinator.centerWorkspaceTabs().active).toBe("board");
    expect(coordinator.popOut("board")).toMatchObject({ action: "created", windowId: "popout:board" });
  });

  it("docks a pop-out back from its own button", () => {
    const { coordinator, shell } = harness();
    const opened = coordinator.popOut("office");
    expect(opened.ok).toBe(true);
    if (opened.ok) {
      expect(opened.dockLabel).toBe("Dock back into main window");
    }

    coordinator.dockBack("office");

    expect(coordinator.isPoppedOut("office")).toBe(false);
    expect(shell.active).toBe("office");
    expect(shell.docked.has("office")).toBe(true);
  });

  it("syncs theme and focus mode to every open pop-out", () => {
    const { coordinator, main, shell } = harness();
    coordinator.popOut("office");
    coordinator.popOut("preview");

    coordinator.setTheme("dark");
    coordinator.setFocusMode(true);

    expect(main.theme).toBe("dark");
    expect(main.focusMode).toBe(true);
    expect(coordinator.windowFor("office")?.theme).toBe("dark");
    expect(coordinator.windowFor("preview")?.theme).toBe("dark");
    expect(coordinator.windowFor("preview")?.focusMode).toBe(true);
    expect(shell.theme).toBe("dark");
    expect(shell.focusMode).toBe(true);

    coordinator.popOut("board");
    expect(coordinator.windowFor("board")?.theme).toBe("dark");
    expect(coordinator.windowFor("board")?.focusMode).toBe(true);
  });

  it("shares one harnessd stream and does not fork daemon events", () => {
    const { coordinator, stream } = harness();
    const before = coordinator.daemonSnapshot();
    expect(coordinator.subscriberCount()).toBe(1);

    coordinator.popOut("preview");
    coordinator.popOut("office");
    expect(coordinator.subscriberCount()).toBe(3);

    stream.publish(previewEvent(1));
    const after = coordinator.daemonSnapshot();

    expect(after.events).toBe(before.events);
    expect(after.events).toBe(stream.snapshot().events);
    expect(after.lastSeq).toBe(1);
    expect(coordinator.sharedEventSeq()).toBe(1);
    expect(coordinator.observedSeq("preview")).toBe(1);
    expect(coordinator.observedSeq("office")).toBe(1);

    coordinator.windowFor("office")?.close();
    expect(coordinator.subscriberCount()).toBe(2);
    expect(coordinator.daemonSnapshot().events).toHaveLength(1);
  });

  it("routes a popped-out canvas click to the main composer and inspector", () => {
    const { coordinator, main, shell } = harness();
    coordinator.popOut("canvas");
    const route = coordinator.routeCanvasEntity({ entityId: "box-orders", kind: "box" });

    expect(route).toEqual({
      sourceView: "canvas",
      entityId: "box-orders",
      kind: "box",
      composerTargetId: "box-orders",
      inspectorSelectedId: "box-orders",
      focusStolen: false,
      mainWindowFocused: false,
    });
    expect(shell.lastRoute).toEqual(route);
    expect(main.focusCount).toBe(0);
  });

  it("minimizes to the tray while building and closes pop-outs when idle", () => {
    const building = harness();
    building.shell.building = true;
    building.coordinator.popOut("preview");
    const preview = building.coordinator.windowFor("preview");
    const hidden = building.coordinator.onPrimaryWindowClose();

    expect(hidden).toEqual({
      action: "minimize-to-tray",
      popOutsClosed: 0,
      popOutsHidden: 0,
      building: true,
    });
    expect(building.tray.isMinimized()).toBe(true);
    expect(building.tray.lastReason).toBe("building");
    expect(preview?.isDestroyed()).toBe(false);
    expect(preview?.isVisible()).toBe(true);
    expect(building.main.isVisible()).toBe(false);

    building.coordinator.restoreFromTray();
    expect(preview?.isVisible()).toBe(true);
    expect(building.main.isVisible()).toBe(true);
    expect(building.coordinator.isPoppedOut("preview")).toBe(true);

    const idle = harness();
    idle.coordinator.popOut("preview");
    idle.coordinator.popOut("board");
    const closedPreview = idle.coordinator.windowFor("preview");
    const closedBoard = idle.coordinator.windowFor("board");
    const quit = idle.coordinator.onPrimaryWindowClose();

    expect(quit.action).toBe("close-popouts");
    expect(quit.popOutsClosed).toBe(2);
    expect(idle.tray.isMinimized()).toBe(false);
    expect(closedPreview?.isDestroyed()).toBe(true);
    expect(closedBoard?.isDestroyed()).toBe(true);
    expect(idle.coordinator.isPoppedOut("preview")).toBe(false);
    expect(idle.coordinator.isPoppedOut("board")).toBe(false);
  });

  it("moves a live preview off an unplugged monitor without losing its window or stream", () => {
    const { coordinator, screen, stream } = harness();
    coordinator.popOut("preview");
    const window = coordinator.windowFor("preview");
    window?.setBounds(area(2560, 100, 1280, 800));
    stream.publish(previewEvent(1));
    const subscribers = coordinator.subscriberCount();

    screen.replaceDisplays([laptop()], "display-removed", 2);

    expect(coordinator.windowFor("preview")).toBe(window);
    expect(window?.isDestroyed()).toBe(false);
    expect(coordinator.subscriberCount()).toBe(subscribers);
    expect(coordinator.daemonSnapshot().lastSeq).toBe(1);
    expect(coordinator.daemonSnapshot().events[0]?.payload.url).toBe("preview://kitchen");
    expect(window?.getBounds()).toEqual({ x: 320, y: 140, width: 1280, height: 800 });
  });

  it("restores saved main and pop-out bounds onto the primary display at startup", () => {
    const { coordinator, main } = harness([laptop()]);
    const saved = { x: 2560, y: 100, width: 1600, height: 900, displayId: 2 };

    const mainRecovery = coordinator.restore(main, saved);
    const popped = coordinator.popOut("preview", saved);

    expect(mainRecovery.centeredOnPrimary).toBe(true);
    expect(mainRecovery.reason).toBe("offscreen-monitor");
    expect(main.getBounds()).toEqual({ x: 160, y: 90, width: 1600, height: 900 });
    expect(popped).toMatchObject({ ok: true, action: "created", windowId: "popout:preview" });
    expect(coordinator.windowFor("preview")?.getBounds()).toEqual({
      x: 160,
      y: 90,
      width: 1600,
      height: 900,
    });
  });

  it("reflows a pop-out when display metrics change so Stop stays visible", () => {
    const scaled = display({
      id: 1,
      primary: true,
      x: 0,
      y: 0,
      width: 1280,
      height: 720,
      scaleFactor: 1.5,
    });
    const { coordinator, screen } = harness([scaled]);
    coordinator.popOut("preview");
    const window = coordinator.windowFor("preview");
    window?.setBounds(area(0, -20, 1920, 1080));

    screen.replaceDisplays([scaled], "display-metrics-changed");

    expect(window?.getBounds()).toEqual({ x: 0, y: 0, width: 1280, height: 720 });
    expect(window?.isDestroyed()).toBe(false);
    expect(coordinator.isPoppedOut("preview")).toBe(true);
  });
});

describe("SharedHarnessdStream", () => {
  it("resets the ring when a new stream epoch restarts at seq 1", () => {
    const stream = new SharedHarnessdStream();
    const seen: number[] = [];
    stream.subscribe((event) => {
      seen.push(event.seq);
    });
    stream.publish({ ...previewEvent(4), streamEpoch: "epoch-1" });
    stream.publish({ ...previewEvent(1), streamEpoch: "epoch-2" });
    expect(seen).toEqual([4, 1]);
    const snap = stream.snapshot();
    expect(snap.lastSeq).toBe(1);
    expect(snap.streamEpoch).toBe("epoch-2");
    expect(snap.events).toHaveLength(1);
    stream.publish({ ...previewEvent(1), streamEpoch: "epoch-2" });
    expect(stream.snapshot().events).toHaveLength(1);
    const filler = Array.from({ length: 300 }, (_, index) => index + 2);
    for (const seq of filler) {
      stream.publish({ ...previewEvent(seq), streamEpoch: "epoch-2" });
    }
    expect(stream.snapshot().events.length).toBeLessThanOrEqual(256);
    expect(stream.snapshot().lastSeq).toBe(301);
  });
});
