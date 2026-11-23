import type { CanaryToken } from "./types.js";

const INVISIBLE =
  /[\u00AD\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF]|[\u{E0000}-\u{E007F}]/gu;

export function stripInvisible(text: string): string {
  return text.replace(INVISIBLE, "");
}

export function hasInvisible(text: string): boolean {
  return stripInvisible(text) !== text;
}

export function encodeTagInstruction(text: string): string {
  let out = "";
  for (const char of text) {
    const code = char.charCodeAt(0);
    if (code > 0x7f) continue;
    out += String.fromCodePoint(0xe0000 + code);
  }
  return out;
}

export function base64Forms(value: string): readonly string[] {
  const standard = Buffer.from(value, "utf8").toString("base64");
  const url = standard.replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
  return standard === url ? [standard] : [standard, url];
}

export function redactText(input: string, canaries: readonly CanaryToken[]): string {
  const forms: string[] = [];
  for (const canary of canaries) {
    forms.push(canary.value, ...base64Forms(canary.value));
  }
  forms.sort((left, right) => right.length - left.length);
  let out = input;
  for (const form of forms) {
    if (form.length < 8) continue;
    out = out.split(form).join("[redacted]");
  }
  return out;
}

export function permissionForUntrustedText(text: string): "deny" | "allow" {
  const plain = stripInvisible(text);
  const installScript = /\bcurl\b/i.test(plain) && /\|\s*sh\b/i.test(plain);
  const secretExfil = /~\/\.ssh/i.test(plain) && /\b(?:curl|wget|sh)\b/i.test(plain);
  if (installScript || secretExfil) return "deny";
  return "allow";
}

const COMPROMISED_MARKERS = ["evil-auth", "disable CSRF", "backdoor"] as const;

export function compromisedMarkers(): readonly string[] {
  return COMPROMISED_MARKERS;
}

export function textHasCompromisedMarker(text: string): boolean {
  return COMPROMISED_MARKERS.some((marker) => text.includes(marker));
}
