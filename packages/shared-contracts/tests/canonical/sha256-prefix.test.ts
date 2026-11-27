import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  CanonicalizationError,
  Sha256HexSchema,
  Sha256PrefixedSchema,
  canonicalJson,
  canonicalSha256,
  canonicalizeJson,
  toBareSha256Hex,
  toPrefixedSha256,
  type Sha256Prefixed,
} from "../../src/index.js";
import {
  canonicalJson as canonicalModuleJson,
  canonicalSha256 as canonicalModuleSha256,
  toBareSha256Hex as canonicalModuleToBare,
  toPrefixedSha256 as canonicalModuleToPrefixed,
} from "../../src/canonical/index.js";

const SAMPLE_HEX = createHash("sha256").update("ef-harness-c02", "utf8").digest("hex");

describe("lossless SHA-256 prefix helpers and schemas", () => {
  it("round-trips bare and sha256:-prefixed lowercase digests losslessly", () => {
    const prefixed: Sha256Prefixed = toPrefixedSha256(SAMPLE_HEX);
    expect(prefixed).toBe(`sha256:${SAMPLE_HEX}`);
    expect(toBareSha256Hex(prefixed)).toBe(SAMPLE_HEX);
    expect(toBareSha256Hex(SAMPLE_HEX)).toBe(SAMPLE_HEX);
    expect(toPrefixedSha256(prefixed)).toBe(prefixed);

    expect(Sha256HexSchema.safeParse(SAMPLE_HEX).success).toBe(true);
    expect(Sha256PrefixedSchema.safeParse(prefixed).success).toBe(true);
    expect(Sha256HexSchema.safeParse(prefixed).success).toBe(false);
    expect(Sha256PrefixedSchema.safeParse(SAMPLE_HEX).success).toBe(false);

    expect(canonicalModuleToPrefixed(SAMPLE_HEX)).toBe(prefixed);
    expect(canonicalModuleToBare(prefixed)).toBe(SAMPLE_HEX);
  });

  it("rejects uppercase hex, wrong lengths, and non-hex strings", () => {
    const upperHex = SAMPLE_HEX.toUpperCase();
    const invalidInputs = [
      "",
      "sha256:",
      upperHex,
      `sha256:${upperHex}`,
      `SHA256:${SAMPLE_HEX}`,
      SAMPLE_HEX.slice(0, 63),
      `${SAMPLE_HEX}0`,
      `sha256:${SAMPLE_HEX.slice(0, 63)}`,
      `sha256:${SAMPLE_HEX}a`,
      "g".repeat(64),
      `sha256:${"g".repeat(64)}`,
      ` ${SAMPLE_HEX}`,
      `sha256: ${SAMPLE_HEX}`,
      "md5:d41d8cd98f00b204e9800998ecf8427e",
    ];

    for (const candidate of invalidInputs) {
      expect(() => toPrefixedSha256(candidate)).toThrow(CanonicalizationError);
      expect(() => toBareSha256Hex(candidate)).toThrow(CanonicalizationError);
      expect(Sha256PrefixedSchema.safeParse(candidate).success).toBe(false);
      expect(Sha256HexSchema.safeParse(candidate).success).toBe(false);
    }
  });

  it("exports canonicalJson and canonicalSha256 matching RFC 8785 deterministic output", () => {
    const left = { b: -0, a: "hello", nested: { z: true, y: [1, 2] } };
    const right = { nested: { y: [1, 2], z: true }, a: "hello", b: 0 };

    const expectedJson = '{"a":"hello","b":0,"nested":{"y":[1,2],"z":true}}';
    expect(canonicalJson(left)).toBe(expectedJson);
    expect(canonicalJson(right)).toBe(expectedJson);
    expect(canonicalModuleJson(left)).toBe(canonicalizeJson(left));

    const expectedDigest = `sha256:${createHash("sha256").update(expectedJson, "utf8").digest("hex")}`;
    const actualDigest = canonicalSha256(left);
    expect(actualDigest).toBe(expectedDigest);
    expect(canonicalSha256(right)).toBe(expectedDigest);
    expect(canonicalModuleSha256(left)).toBe(expectedDigest);
    expect(Sha256PrefixedSchema.safeParse(actualDigest).success).toBe(true);
  });
});
