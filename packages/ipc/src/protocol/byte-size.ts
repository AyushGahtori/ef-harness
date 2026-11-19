const encoder = new TextEncoder();

export function utf8Size(value: unknown): number {
  const json = JSON.stringify(value);
  if (typeof json !== "string") return 0;
  return encoder.encode(json).byteLength;
}

export function encodeJsonCursor(value: unknown): string {
  const bytes = encoder.encode(JSON.stringify(value));
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

export function decodeJsonCursor(value: string): unknown {
  const pad = (4 - (value.length % 4)) % 4;
  const padded = value.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat(pad);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  const text = new TextDecoder().decode(bytes);
  return JSON.parse(text) as unknown;
}
