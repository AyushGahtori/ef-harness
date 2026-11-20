import type { SecretVariant, SecretVariantKind } from "./types.js";

const MINIMUM_PURGE_LENGTH = 8;

export function isTriviallyShort(secret: string): boolean {
  return secret.length < MINIMUM_PURGE_LENGTH;
}

/** Raw, standard Base64, Base64URL, and URL-encoded forms. Duplicate encodings collapse. */
export function secretVariants(secret: string): SecretVariant[] {
  const base64 = Buffer.from(secret, "utf8").toString("base64");
  const base64url = base64.replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
  const url = encodeURIComponent(secret);
  const candidates: readonly SecretVariant[] = [
    { kind: "raw", value: secret },
    { kind: "base64", value: base64 },
    { kind: "base64url", value: base64url },
    { kind: "url", value: url },
  ];
  const seen = new Set<string>();
  const unique: SecretVariant[] = [];
  for (const candidate of candidates) {
    if (candidate.value.length === 0 || seen.has(candidate.value)) continue;
    seen.add(candidate.value);
    unique.push(candidate);
  }
  return unique;
}

export function replaceVariants(
  input: string,
  variants: readonly SecretVariant[],
  placeholder: string,
): { readonly text: string; readonly replaced: boolean } {
  let text = input;
  const ordered = [...variants].sort((left, right) => right.value.length - left.value.length);
  for (const variant of ordered) {
    if (!text.includes(variant.value)) continue;
    text = text.split(variant.value).join(placeholder);
  }
  return { text, replaced: text !== input };
}

export function redactBuffer(
  bytes: Uint8Array,
  variants: readonly SecretVariant[],
  placeholder: string,
): Buffer | null {
  let current = Buffer.from(bytes);
  let changed = false;
  const replacement = Buffer.from(placeholder, "utf8");
  const ordered = [...variants].sort((left, right) => right.value.length - left.value.length);
  for (const variant of ordered) {
    const needle = Buffer.from(variant.value, "utf8");
    if (needle.length === 0 || !current.includes(needle)) continue;
    const parts: Buffer[] = [];
    let start = 0;
    let index = current.indexOf(needle, start);
    while (index !== -1) {
      parts.push(current.subarray(start, index), replacement);
      start = index + needle.length;
      index = current.indexOf(needle, start);
      changed = true;
    }
    parts.push(current.subarray(start));
    current = Buffer.concat(parts);
  }
  return changed ? current : null;
}

export function bufferContainsVariant(bytes: Uint8Array, variants: readonly SecretVariant[]): boolean {
  const buffer = Buffer.from(bytes);
  for (const variant of variants) {
    if (variant.value.length === 0) continue;
    if (buffer.includes(Buffer.from(variant.value, "utf8"))) return true;
  }
  return false;
}

export function textContainsVariant(text: string, variants: readonly SecretVariant[]): boolean {
  for (const variant of variants) {
    if (variant.value.length > 0 && text.includes(variant.value)) return true;
  }
  return false;
}

export function matchingVariantKind(
  text: string,
  variants: readonly SecretVariant[],
): SecretVariantKind | null {
  const ordered = [...variants].sort((left, right) => right.value.length - left.value.length);
  for (const variant of ordered) {
    if (variant.value.length > 0 && text.includes(variant.value)) return variant.kind;
  }
  return null;
}

export function sanitizeSensitiveText(message: string, variants: readonly SecretVariant[]): string {
  let text = message;
  const ordered = [...variants].sort((left, right) => right.value.length - left.value.length);
  for (const variant of ordered) {
    if (variant.value.length === 0) continue;
    text = text.split(variant.value).join("[REDACTED]");
  }
  return text;
}
