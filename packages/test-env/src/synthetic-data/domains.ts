import { ProductionDataLeakError } from "./errors.js";
import { RESERVED_EMAIL_DOMAINS, type DataValue } from "./types.js";

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

export function assertSyntheticValue(value: DataValue, label: string): void {
  if (typeof value !== "string" || !value.includes("@")) return;
  const matches = value.match(EMAIL) ?? [];
  for (const email of matches) {
    const domain = email.slice(email.indexOf("@") + 1).toLowerCase();
    if (!RESERVED_EMAIL_DOMAINS.includes(domain as (typeof RESERVED_EMAIL_DOMAINS)[number])) {
      throw new ProductionDataLeakError(`${label}: ${email}`);
    }
  }
}
