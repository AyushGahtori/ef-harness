import type { ConverterWarning } from "./types.js";

const STEALTH =
  /[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]|[\uDB40][\uDC00-\uDC7F]/g;

export function normalizeNfc(text: string): string {
  return text.normalize("NFC");
}

export function stripStealthUnicode(text: string): { readonly text: string; readonly stripped: boolean } {
  const normalized = normalizeNfc(text);
  const stripped = STEALTH.test(normalized);
  STEALTH.lastIndex = 0;
  if (!stripped) return { text: normalized, stripped: false };
  return { text: normalized.replace(STEALTH, ""), stripped: true };
}

export function stealthWarning(): ConverterWarning {
  return {
    name: "StealthUnicodeStrippedWarning",
    code: "stealth_unicode_stripped",
    message: "Stealth Unicode was stripped before text left the converter.",
  };
}

export function hiddenTextWarning(): ConverterWarning {
  return {
    name: "HiddenTextStrippedWarning",
    code: "hidden_text_detected",
    message: "Hidden text was stripped before text left the converter.",
  };
}
