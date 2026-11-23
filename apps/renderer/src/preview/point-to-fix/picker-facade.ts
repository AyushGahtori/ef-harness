import { bindComposerElementTarget } from "./composer-binding.js";
import {
  captureElementContext,
  captureGapRegion,
  type CaptureEnvironment,
  type DomLikeElement,
} from "./capture.js";
import type {
  HoverOutlineState,
  LayoutBox,
  PickContextBundle,
  PointToFixMode,
  PreviewTheme,
  PreviewViewportWidth,
} from "./types.js";

export interface PointToFixPickerCallbacks {
  readonly onComposerTarget?: (target: NonNullable<ReturnType<typeof bindComposerElementTarget>>) => void;
  readonly onModeChange?: (mode: PointToFixMode) => void;
}

export interface PointToFixPickerOverlayOptions {
  readonly workspaceRoot: string;
  readonly viewportWidth: PreviewViewportWidth;
  readonly route: string;
  readonly theme: PreviewTheme;
  readonly casPut: (bytes: Uint8Array, mime: string) => string;
  readonly callbacks?: PointToFixPickerCallbacks;
}

export interface PointToFixPickerFacade {
  readonly mode: PointToFixMode;
  togglePicking(): void;
  updateHover(element: DomLikeElement): HoverOutlineState | null;
  pickElement(element: DomLikeElement): PickContextBundle | null;
  beginDrag(clientX: number, clientY: number): void;
  completeDrag(
    clientX: number,
    clientY: number,
    candidates: readonly DomLikeElement[],
  ): PickContextBundle | null;
  handleEscape(): boolean;
}

function captureEnv(
  options: PointToFixPickerOverlayOptions,
): CaptureEnvironment {
  return {
    viewportWidth: options.viewportWidth,
    route: options.route,
    theme: options.theme,
    casPut: options.casPut,
  };
}

function hoverTagFor(element: DomLikeElement): HoverOutlineState {
  const parsed = element.efSource?.match(/^(.+?):(\d+):(\d+)$/);
  const file = parsed?.[1] ?? "unknown";
  const base = file.split("/").pop() ?? file;
  const line = parsed ? Number(parsed[2]) : 0;
  const w = Math.round(element.layoutBox.width);
  const h = Math.round(element.layoutBox.height);
  const tag =
    element.tagName.toLowerCase() === "button"
      ? `<Button> · ${base}:${line} · ${w}×${h} px`
      : `<${element.tagName}> · ${base}:${line} · ${w}×${h} px`;
  return { visible: true, tag };
}

export function createPointToFixPickerOverlay(
  options: PointToFixPickerOverlayOptions,
): PointToFixPickerFacade {
  let mode: PointToFixMode = "off";
  let dragStart: { readonly x: number; readonly y: number } | null = null;
  const env = captureEnv(options);

  const setMode = (next: PointToFixMode): void => {
    if (mode === next) return;
    mode = next;
    options.callbacks?.onModeChange?.(mode);
  };

  return {
    get mode() {
      return mode;
    },
    togglePicking() {
      setMode(mode === "off" ? "picking" : "off");
    },
    updateHover(element) {
      if (mode !== "picking") return null;
      return hoverTagFor(element);
    },
    pickElement(element) {
      if (mode !== "picking") return null;
      const pick = captureElementContext(element, env);
      const target = bindComposerElementTarget(pick);
      if (target) {
        options.callbacks?.onComposerTarget?.(target);
      }
      return pick;
    },
    beginDrag(clientX, clientY) {
      dragStart = { x: clientX, y: clientY };
    },
    completeDrag(clientX, clientY, candidates) {
      if (!dragStart) return null;
      const x = Math.min(dragStart.x, clientX);
      const y = Math.min(dragStart.y, clientY);
      const region: LayoutBox = {
        x,
        y,
        width: Math.abs(clientX - dragStart.x),
        height: Math.abs(clientY - dragStart.y),
      };
      dragStart = null;
      return captureGapRegion(region, candidates, env);
    },
    handleEscape() {
      if (mode !== "picking") return false;
      setMode("off");
      return true;
    },
  };
}