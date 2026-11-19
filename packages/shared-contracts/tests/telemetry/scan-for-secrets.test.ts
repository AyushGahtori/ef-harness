import { describe, expect, it } from "vitest";
import { scanForSecrets, SecretRedactor } from "../../src/telemetry/redactor.js";
import { SECRET_LABEL } from "../../src/telemetry/patterns.js";
import {
  entropySample,
  fakeJwt,
  pemBlock,
  pemHeader,
  prefixes,
  repeatAlphabet,
  upperAlphabet,
} from "./helpers.js";

describe("scanForSecrets", () => {
  it("returns exact character ranges for pasted api keys and pem headers", () => {
    const key = `${prefixes.stripeLive}${repeatAlphabet(20)}`;
    const header = pemHeader();
    const text = `please use ${key} then ${header} thanks`;
    const findings = scanForSecrets(text);
    const keyHit = findings.find((hit) => hit.label === SECRET_LABEL.stripeLive);
    const pemHit = findings.find((hit) => hit.label === SECRET_LABEL.pem);
    expect(keyHit).toBeDefined();
    expect(pemHit).toBeDefined();
    expect(text.slice(keyHit?.start, keyHit?.end)).toBe(key);
    expect(text.slice(pemHit?.start, pemHit?.end)).toBe(header);
    expect(findings.map((hit) => hit.start)).toEqual([...findings.map((hit) => hit.start)].sort((a, b) => a - b));
  });

  it("covers a full private key block, not only the header", () => {
    const block = pemBlock("QUJDREVGR0hJSktMTU5PUA==", "RSA");
    const text = `start\n${block}end`;
    const hit = scanForSecrets(text).find((finding) => finding.label === SECRET_LABEL.pem);
    expect(hit).toBeDefined();
    expect(text.slice(hit?.start, hit?.end)).toContain(pemHeader("RSA"));
    expect(text.slice(hit?.start, hit?.end)).toContain("QUJDREVGR0hJSktMTU5PUA==");
    expect(text.slice(hit?.start, hit?.end)).toContain(pemFooterSafe());
  });

  it("locates github, aws, google, bearer, and basic-auth secrets", () => {
    const github = `${prefixes.github}${repeatAlphabet(36)}`;
    const aws = `${prefixes.aws}${upperAlphabet(16)}`;
    const google = `${prefixes.google}${repeatAlphabet(35, "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-")}`;
    const jwt = fakeJwt();
    const text = `gh ${github} aws ${aws} g ${google} Bearer ${jwt} https://admin:Sup3rS3cret!!@db.internal/app`;
    const findings = scanForSecrets(text);
    expect(slice(text, findings, SECRET_LABEL.github)).toBe(github);
    expect(slice(text, findings, SECRET_LABEL.aws)).toBe(aws);
    expect(slice(text, findings, SECRET_LABEL.google)).toBe(google);
    expect(slice(text, findings, SECRET_LABEL.bearerJwt)).toBe(`Bearer ${jwt}`);
    expect(slice(text, findings, SECRET_LABEL.urlBasicAuth)).toBe("admin:Sup3rS3cret!!");
  });

  it("locates a vault value and a high-entropy assignment with value-only offsets", () => {
    const redactor = new SecretRedactor();
    const secret = "VaultOnlyValue99";
    redactor.register("vault.token", secret);
    const text = `note ${secret} and api_key="${entropySample}" done`;
    const findings = scanForSecrets(text, redactor);
    expect(slice(text, findings, "VAULT_TOKEN")).toBe(secret);
    expect(slice(text, findings, SECRET_LABEL.highEntropy)).toBe(entropySample);
  });

  it("does not flag ordinary code snippets", () => {
    const code = [
      "export function add(left: number, right: number) {",
      '  const name = "development";',
      "  const enabled = true;",
      "  const port = 3000;",
      "  return left + right;",
      "}",
      'const token = "short";',
      'const api_key = "replace_me";',
      'const password = "hunter2";',
      "class AuthorizationError extends Error {}",
      'function bearerTokenName() { return "none"; }',
      'const url = "https://example.com/docs";',
      'const id = "123e4567-e89b-12d3-a456-426614174000";',
      "const hash = \"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855\";",
    ].join("\n");
    expect(scanForSecrets(code)).toEqual([]);
  });
});

function slice(
  text: string,
  findings: readonly { start: number; end: number; label: string }[],
  label: string,
): string {
  const hit = findings.find((finding) => finding.label === label);
  expect(hit).toBeDefined();
  return text.slice(hit?.start, hit?.end);
}

function pemFooterSafe(): string {
  return pemHeader("RSA").replace(pieceBegin(), pieceEnd());
}

function pieceBegin(): string {
  return ["BEGIN"].join("");
}

function pieceEnd(): string {
  return ["END"].join("");
}
