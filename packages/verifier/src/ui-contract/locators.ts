import { BrittleLocatorError } from "./errors.js";
import type { GeneratedCheck, RegionScope, UiInteractionContract } from "./types.js";

const ALLOWED_METHODS = new Set(["getByRole", "getByLabel", "getByText", "getByTestId"]);

export function missingControlMessage(role: string, name: string | undefined, route: string): string {
  if (name && name.length > 0) return `No ${role} named '${name}' on ${route}`;
  return `No ${role} on ${route}`;
}

export function duplicateControlMessage(role: string, name: string | undefined, route: string): string {
  const noun = pluralRole(role);
  if (name && name.length > 0) return `Multiple ${noun} named '${name}' on ${route}`;
  return `Multiple ${noun} on ${route}`;
}

export function missingTextMessage(text: string, route: string): string {
  return `No text '${text}' on ${route}`;
}

function pluralRole(role: string): string {
  if (role === "button") return "buttons";
  if (role === "link") return "links";
  if (role === "textbox") return "textboxes";
  if (role === "combobox") return "comboboxes";
  return `${role} elements`;
}

function pushRole(
  checks: GeneratedCheck[],
  role: string,
  name: string | undefined,
  matchMode: GeneratedCheck["matchMode"],
  within: RegionScope | undefined,
): void {
  checks.push({
    method: "getByRole",
    role,
    ...(name !== undefined ? { name } : {}),
    ...(matchMode !== undefined ? { matchMode } : {}),
    ...(within !== undefined ? { within } : {}),
  });
}

/** Compiles a contract into role, label, text, and test-id checks only. */
export function compileContractChecks(contract: UiInteractionContract): readonly GeneratedCheck[] {
  const checks: GeneratedCheck[] = [];
  for (const landmark of contract.landmarks) {
    pushRole(checks, landmark.role, landmark.name?.text, landmark.name?.matchMode, landmark.within);
    for (const column of landmark.columns ?? []) {
      pushRole(checks, "columnheader", column.text, column.matchMode, {
        role: landmark.role,
        ...(landmark.name ? { name: landmark.name } : {}),
      });
    }
  }
  for (const action of contract.actions) {
    if (action.testid && !action.name) {
      checks.push({ method: "getByTestId", testid: action.testid });
      continue;
    }
    pushRole(checks, action.role, action.name?.text, action.name?.matchMode, action.within);
  }
  for (const state of contract.states) {
    if (state.role) pushRole(checks, state.role, state.accessibleName?.text, state.accessibleName?.matchMode, undefined);
    if (state.text) {
      checks.push({
        method: "getByText",
        text: state.text.text,
        matchMode: state.text.matchMode,
      });
    }
  }
  assertNoBrittleLocators(checks);
  return checks;
}

function walkLocator(value: unknown): void {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (
      trimmed.startsWith("//") ||
      trimmed.startsWith("css=") ||
      trimmed.startsWith("xpath=") ||
      trimmed.startsWith("#") ||
      /^\.[A-Za-z_-]/.test(trimmed)
    ) {
      throw new BrittleLocatorError(
        "Verifier checks cannot depend on CSS classes, XPath, or #id selectors",
      );
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) walkLocator(item);
    return;
  }
  if (typeof value === "object" && value !== null) {
    for (const [key, child] of Object.entries(value)) {
      if (/^(css|xpath|selector|class|className)$/i.test(key)) {
        throw new BrittleLocatorError(
          "Verifier checks cannot depend on CSS classes, XPath, or #id selectors",
        );
      }
      walkLocator(child);
    }
  }
}

/** Rejects CSS, XPath, and #id selectors in generated or supplied checks. */
export function assertNoBrittleLocators(checks: readonly unknown[]): void {
  for (const check of checks) {
    if (typeof check !== "object" || check === null || Array.isArray(check)) {
      throw new BrittleLocatorError("Verifier checks must be role, label, text, or test id locators");
    }
    const method = "method" in check ? check.method : undefined;
    if (typeof method !== "string" || !ALLOWED_METHODS.has(method)) {
      throw new BrittleLocatorError(
        "Verifier checks must use getByRole, getByLabel, getByText, or getByTestId",
      );
    }
    walkLocator(check);
  }
}
