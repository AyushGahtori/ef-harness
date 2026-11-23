import { ElementAndGapContextCapturer } from "./capturer.js";
import { assertIsolatedScript, pickerInjectionScript, pickerSetActiveScript } from "./injection-script.js";
import type { IsolatedPreviewWebviewHostPort, SingleComposerViewPort } from "./ports.js";
import { parsePickMessage } from "./schema.js";
import type { GroundedContextBundle, LayoutBox } from "./types.js";
import { VIOLET_OUTLINE } from "./types.js";

export interface HoverOutline {
  readonly color: typeof VIOLET_OUTLINE;
  readonly box: LayoutBox;
  readonly tag: string;
}

export class HoverFrameScheduler {
  readonly targetFps = 60;
  readonly frameMs = 1000 / 60;
  private pending: HoverOutline | null = null;
  private lastFlush = -Infinity;

  push(outline: HoverOutline, now: number): HoverOutline | null {
    this.pending = outline;
    if (now - this.lastFlush < this.frameMs) return null;
    return this.flush(now);
  }

  flush(now: number): HoverOutline | null {
    if (!this.pending) return null;
    if (now - this.lastFlush < this.frameMs) return null;
    const outline = this.pending;
    this.pending = null;
    this.lastFlush = now;
    return outline;
  }
}

export function hoverTag(component: string, file: string, line: number, box: LayoutBox): string {
  const base = file.split("/").pop() ?? file;
  const width = Math.round(box.width);
  const height = Math.round(box.height);
  return `<${component}> · ${base}:${line} · ${width}×${height} px`;
}

export interface ToolbarButton {
  readonly label: "Pick element";
  readonly shortcut: "Ctrl+Shift+C";
  readonly pressed: boolean;
}

export type OverlayResult =
  | { readonly kind: "discarded"; readonly reason: string }
  | { readonly kind: "inactive" }
  | { readonly kind: "hover"; readonly outline: HoverOutline | null }
  | { readonly kind: "click"; readonly bundle: GroundedContextBundle; readonly pill: string }
  | { readonly kind: "gap"; readonly bundle: GroundedContextBundle; readonly pill: string }
  | { readonly kind: "escape"; readonly composerChanges: number };

export class LocalPreviewHost implements IsolatedPreviewWebviewHostPort {
  readonly scripts: string[] = [];

  constructor(readonly origin: string) {}

  executeJavaScript(script: string): void {
    assertIsolatedScript(script);
    this.scripts.push(script);
  }
}

export interface PointToFixPickerOptions {
  readonly composer: SingleComposerViewPort;
  readonly capturer: ElementAndGapContextCapturer;
  readonly host: IsolatedPreviewWebviewHostPort;
  readonly projectRoot: string;
  readonly viewportHeight?: number;
  readonly scheduler?: HoverFrameScheduler;
  readonly now?: () => number;
}

export class PointToFixPickerOverlay {
  private active = false;
  private readonly scheduler: HoverFrameScheduler;
  readonly mode: { value: "inspection" | "live" } = { value: "live" };
  lastBundle: GroundedContextBundle | null = null;

  constructor(private readonly options: PointToFixPickerOptions) {
    this.scheduler = options.scheduler ?? new HoverFrameScheduler();
  }

  toolbarButton(): ToolbarButton {
    return { label: "Pick element", shortcut: "Ctrl+Shift+C", pressed: this.active };
  }

  get inspection(): boolean {
    return this.active;
  }

  handleShortcut(input: { readonly ctrlKey: boolean; readonly shiftKey: boolean; readonly key: string }): boolean {
    if (!input.ctrlKey || !input.shiftKey || input.key.toLowerCase() !== "c") return false;
    this.toggle();
    return true;
  }

  toggle(): void {
    if (this.active) this.deactivate();
    else this.activate();
  }

  activate(): void {
    this.active = true;
    this.mode.value = "inspection";
    this.options.host.executeJavaScript(pickerInjectionScript(this.options.host.origin));
    this.options.host.executeJavaScript(pickerSetActiveScript(true));
  }

  deactivate(): void {
    this.active = false;
    this.mode.value = "live";
    this.options.host.executeJavaScript(pickerSetActiveScript(false));
  }

  receiveMessage(input: unknown, now = this.options.now?.() ?? 0): OverlayResult {
    const parsed = parsePickMessage(input, this.options.projectRoot);
    if (!parsed.ok) return { kind: "discarded", reason: parsed.reason };
    if (parsed.kind === "escape") {
      const changes = this.options.composer.changeCount();
      this.deactivate();
      return { kind: "escape", composerChanges: changes };
    }
    if (!this.active) return { kind: "inactive" };
    if (parsed.pick.gesture === "hover") {
      const outline = this.hoverOutline(parsed.pick);
      return { kind: "hover", outline: this.scheduler.push(outline, now) };
    }
    const bundle = this.options.capturer.fromMessage(
      parsed.pick,
      this.options.viewportHeight ?? 900,
    );
    this.bind(bundle);
    return { kind: parsed.pick.gesture === "gap" ? "gap" : "click", bundle, pill: bundle.pill };
  }

  flushHover(now: number): HoverOutline | null {
    return this.scheduler.flush(now);
  }

  private hoverOutline(pick: {
    readonly componentName: string | null;
    readonly source: string | null;
    readonly box: LayoutBox;
  }): HoverOutline {
    const parsed = pick.source?.match(/^(.*):(\d+):\d+$/);
    const file = parsed?.[1] ?? "unknown";
    const line = parsed ? Number(parsed[2]) : 0;
    return {
      color: VIOLET_OUTLINE,
      box: pick.box,
      tag: hoverTag(pick.componentName ?? "element", file, line, pick.box),
    };
  }

  private bind(bundle: GroundedContextBundle): void {
    this.lastBundle = bundle;
    const element = {
      elementId: bundle.elementId,
      label: bundle.label,
      source: bundle.pillSource,
      thumbnailPng: bundle.crop.png,
    };
    this.options.composer.inspectPreviewElement(element);
    this.options.composer.activateTarget({ kind: "Element", element });
  }
}
