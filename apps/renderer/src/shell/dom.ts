import { createElement, type CSSProperties, type ReactNode } from "react";
import type { ToneAttrs } from "./types.js";

type AttrValue = string | number | boolean | CSSProperties | undefined;

export function h(
  tag: string,
  attrs: Readonly<Record<string, AttrValue>>,
  ...children: readonly ReactNode[]
): ReactNode {
  const props: Record<string, string | number | boolean | CSSProperties> = {};
  for (const [key, value] of Object.entries(attrs)) {
    if (value !== undefined) {
      props[key] = value;
    }
  }
  return createElement(tag, props, ...children);
}

export function tone(fg: string, bg: string, extra?: CSSProperties): ToneAttrs {
  return {
    style: extra ? { color: fg, backgroundColor: bg, ...extra } : { color: fg, backgroundColor: bg },
    "data-fg": fg,
    "data-bg": bg,
  };
}

export function focusedOutline(active: boolean, ring: string): CSSProperties | undefined {
  if (!active) return undefined;
  return { outline: `2px solid ${ring}`, outlineOffset: "2px" };
}
