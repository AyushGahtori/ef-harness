import { ConsentRequiredError } from "./errors.js";
import type { SettingsConsent } from "./types.js";

export function isExplicitConsent(value: unknown, action: "provision" | "unprovision"): value is SettingsConsent {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    record.source === "settings_sandbox_setup" &&
    record.explicit === true &&
    record.uacAccepted === true &&
    record.action === action
  );
}

export function assertExplicitConsent(value: unknown, action: "provision" | "unprovision"): SettingsConsent {
  if (!isExplicitConsent(value, action)) throw new ConsentRequiredError(action);
  return value;
}
