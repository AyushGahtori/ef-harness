import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { LogSink } from "../../src/telemetry/types.js";

export function piece(...parts: readonly string[]): string {
  return parts.join("");
}

export const prefixes = {
  stripeLive: piece("sk", "_live_"),
  stripeTest: piece("sk", "_test_"),
  anthropic: piece("sk-ant", "-"),
  openaiProject: piece("sk-proj", "-"),
  openRouter: piece("sk-or", "-v1-"),
  github: piece("ghp", "_"),
  githubOauth: piece("gho", "_"),
  githubFine: piece("github", "_pat_"),
  aws: piece("AK", "IA"),
  google: "AIza",
} as const;

export function repeatAlphabet(length: number, seed = "Abcdefghijklmno0123456789XYZ"): string {
  let output = "";
  for (let index = 0; index < length; index += 1) {
    output += seed[index % seed.length] ?? "a";
  }
  return output;
}

export function upperAlphabet(length: number): string {
  const seed = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  return repeatAlphabet(length, seed);
}

export const entropySample = "q7Kx9Lm2Np4Rv8Tc1Wy6Za3Qb5Hs0";

export function pemHeader(kind = ""): string {
  const middle = kind.length === 0 ? " " : ` ${kind} `;
  return piece("-----", "BEGIN", middle, "PRIVATE KEY", "-----");
}

export function pemFooter(kind = ""): string {
  const middle = kind.length === 0 ? " " : ` ${kind} `;
  return piece("-----", "END", middle, "PRIVATE KEY", "-----");
}

export function pemBlock(body = "QUJDREVGR0hJSktMTU5PUA==", kind = ""): string {
  return `${pemHeader(kind)}\n${body}\n${pemFooter(kind)}\n`;
}

export function fakeJwt(): string {
  const part = repeatAlphabet(16, "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789");
  return `eyJ${part}.${part}.${part}`;
}

export function tempDir(name: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `ef-task011-${name}-`));
}

export function readTree(directory: string): string {
  if (!fs.existsSync(directory)) return "";
  const parts: string[] = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) parts.push(readTree(full));
    else if (entry.isFile()) parts.push(fs.readFileSync(full, "utf8"));
  }
  return parts.join("");
}

export function memorySink(): LogSink & { lines: string[] } {
  const lines: string[] = [];
  return {
    lines,
    write(line: string) {
      lines.push(line);
    },
    flush() {},
    close() {},
  };
}

export function assertNoSecret(text: string, forms: readonly string[]): void {
  for (const form of forms) {
    if (form.length < 8) continue;
    if (text.includes(form)) {
      throw new Error(`secret form survived redaction (${form.length} chars)`);
    }
  }
}

export function secretForms(secret: string): string[] {
  const base64 = Buffer.from(secret, "utf8").toString("base64");
  const base64Url = Buffer.from(secret, "utf8").toString("base64url");
  return [
    secret,
    base64,
    base64Url,
    encodeURIComponent(secret),
    encodeURIComponent(base64),
    encodeURIComponent(base64Url),
    JSON.stringify(secret).slice(1, -1),
  ];
}
