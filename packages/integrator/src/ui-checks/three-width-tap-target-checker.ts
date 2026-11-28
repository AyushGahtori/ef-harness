import {
  CANONICAL_VIEWPORTS,
  HORIZONTAL_OVERFLOW_TOLERANCE_PX,
  MIN_TAP_TARGET_PX,
  RECOMMENDED_MOBILE_TAP_PX,
} from "./constants.js";
import type { RenderedElement, RenderedRouteAudit, ThemeMode, UiConsistencyFinding } from "./types.js";

function boxesOverlap(a: RenderedElement, b: RenderedElement): number {
  if (!a.interactive || !b.interactive) return 0;
  const left = Math.max(a.box.x, b.box.x);
  const top = Math.max(a.box.y, b.box.y);
  const right = Math.min(a.box.x + a.box.width, b.box.x + b.box.width);
  const bottom = Math.min(a.box.y + a.box.height, b.box.y + b.box.height);
  if (right <= left || bottom <= top) return 0;
  return (right - left) * (bottom - top);
}

export class ThreeWidthLayoutAndTapTargetChecker {
  run(input: {
    readonly audits: readonly RenderedRouteAudit[];
    readonly darkModeEnabled: boolean;
  }): UiConsistencyFinding[] {
    const findings: UiConsistencyFinding[] = [];
    const expectedThemes: ThemeMode[] = input.darkModeEnabled ? ["light", "dark"] : ["light"];
    for (const route of groupByRoute(input.audits)) {
      for (const viewport of CANONICAL_VIEWPORTS) {
        for (const theme of expectedThemes) {
          const audit = route.find(
            (entry) => entry.viewportId === viewport.id && entry.theme === theme && entry.width === viewport.width,
          );
          if (!audit) {
            findings.push({
              stage: "three_width_tap_target",
              rule: "missing-viewport-coverage",
              severity: "error",
              message: `missing ${viewport.id} (${viewport.width}px) ${theme} audit for ${route[0]?.route ?? "unknown"}`,
            });
            continue;
          }
          findings.push(...auditOne(audit));
        }
      }
    }
    return findings;
  }
}

function groupByRoute(audits: readonly RenderedRouteAudit[]): RenderedRouteAudit[][] {
  const map = new Map<string, RenderedRouteAudit[]>();
  for (const audit of audits) {
    const list = map.get(audit.route) ?? [];
    list.push(audit);
    map.set(audit.route, list);
  }
  return [...map.values()];
}

function auditOne(audit: RenderedRouteAudit): UiConsistencyFinding[] {
  const findings: UiConsistencyFinding[] = [];
  if (audit.scrollWidth > audit.clientWidth + HORIZONTAL_OVERFLOW_TOLERANCE_PX) {
    findings.push({
      stage: "three_width_tap_target",
      rule: "horizontal-overflow",
      severity: "error",
      message: `horizontal overflow on ${audit.route} at ${audit.viewportId}: scrollWidth ${audit.scrollWidth} > clientWidth ${audit.clientWidth}`,
    });
  }
  const interactive = audit.elements.filter((element) => element.interactive);
  for (const element of interactive) {
    if (element.box.width < MIN_TAP_TARGET_PX || element.box.height < MIN_TAP_TARGET_PX) {
      findings.push({
        stage: "three_width_tap_target",
        rule: "tap-target-floor",
        severity: "error",
        message: `WCAG 2.2 tap target ${element.box.width}×${element.box.height} < ${MIN_TAP_TARGET_PX}×${MIN_TAP_TARGET_PX} px on ${element.selector}`,
        ...(element.source ? { location: element.source } : {}),
      });
    } else if (
      audit.viewportId === "mobile" &&
      element.role === "button" &&
      (element.box.width < RECOMMENDED_MOBILE_TAP_PX || element.box.height < RECOMMENDED_MOBILE_TAP_PX)
    ) {
      findings.push({
        stage: "three_width_tap_target",
        rule: "tap-target-recommended",
        severity: "warning",
        message: `primary mobile control ${element.selector} is below recommended ${RECOMMENDED_MOBILE_TAP_PX}px`,
        ...(element.source ? { location: element.source } : {}),
      });
    }
  }
  for (let i = 0; i < interactive.length; i += 1) {
    for (let j = i + 1; j < interactive.length; j += 1) {
      const a = interactive[i];
      const b = interactive[j];
      if (!a || !b) continue;
      const overlap = boxesOverlap(a, b);
      if (overlap > 0) {
        findings.push({
          stage: "three_width_tap_target",
          rule: "interactive-overlap",
          severity: "error",
          message: `${a.selector} overlaps ${b.selector} by ${overlap}px² at ${audit.viewportId}`,
          ...(a.source ? { location: a.source } : {}),
        });
      }
    }
  }
  for (const image of audit.images) {
    if (!image.complete || image.naturalWidth <= 0) {
      findings.push({
        stage: "three_width_tap_target",
        rule: "broken-image",
        severity: "error",
        message: `broken image ${image.selector}`,
        ...(image.source ? { location: image.source } : {}),
      });
    }
  }
  if (audit.primaryContentHeight <= 0) {
    findings.push({
      stage: "three_width_tap_target",
      rule: "zero-height-content",
      severity: "error",
      message: `primary content container has zero height on ${audit.route}`,
    });
  }
  return findings;
}