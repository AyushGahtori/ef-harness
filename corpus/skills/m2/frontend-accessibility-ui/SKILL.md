---
id: frontend-accessibility-ui
version: 1
status: vetted
description: Semantic HTML, keyboard focus, WCAG AA contrast, and design-token discipline for user-facing screens.
tools: none
license: MIT
---

# Frontend accessibility and UI

SPDX-License-Identifier: MIT
Attribution: Offline vendor of the public accessible-UI practice for the EF Harness M2 catalog. Instruction-only. No scripts, no network, no user-config writes.
Upstream: offline-vendor:frontend-accessibility-ui

Build controls that a keyboard user and a screen-reader user can operate. Visual polish does not replace a real control.

## Semantic structure

- Use a `button` for an action, an `a` with a real href for navigation, a `label` tied to its input, and lists, headings, and tables for those structures.
- Do not turn a `div` or `span` into a click target.
- Give every control an accessible name from its visible label or an explicit name that matches the visible text.
- Keep heading levels in order. Do not skip from a page title to a deep heading with nothing in between.

## Keyboard focus

- Every action is reachable in a sensible tab order and is operable with Enter or Space.
- Focus is visible against the surrounding surface. Do not remove the focus ring.
- A dialog traps focus while it is open and returns focus to the control that opened it.
- Escape closes a dismissible dialog. Do not trap the user.

## Contrast and tokens

- Body text meets WCAG AA contrast of 4.5:1. Large text and meaningful icons meet 3:1.
- Color is not the only signal for state. Pair it with text or a shape.
- Take color, spacing, type, and radius from a design token. Do not invent a one-off hex value for a single screen.
- If a needed token does not exist, add it to the shared token source and use that name. Do not copy a raw value into the component.

## States

A screen that loads data shows empty, loading, populated, and error. Forms also show a validation message next to the field. Do not leave a blank page while data is missing.

## Smoke check

The worker uses semantic controls, keeps keyboard access, meets the contrast rule, and styles the screen from a design token.

## Output

Name the controls added, the keyboard path through them, the token names used, and the empty and error states a reviewer can see.
