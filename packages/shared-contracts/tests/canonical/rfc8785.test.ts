import { describe, expect, it } from "vitest";
import { CanonicalizationError, canonicalizeJson } from "../../src/canonical/index.js";

const RFC_SAMPLE_HEX = [
  "7b 22 6c 69 74 65 72 61 6c 73 22 3a 5b 6e 75 6c 6c 2c 74 72",
  "75 65 2c 66 61 6c 73 65 5d 2c 22 6e 75 6d 62 65 72 73 22 3a",
  "5b 33 33 33 33 33 33 33 33 33 2e 33 33 33 33 33 33 33 2c 31",
  "65 2b 33 30 2c 34 2e 35 2c 30 2e 30 30 32 2c 31 65 2d 32 37",
  "5d 2c 22 73 74 72 69 6e 67 22 3a 22 e2 82 ac 24 5c 75 30 30",
  "30 66 5c 6e 41 27 42 5c 22 5c 5c 5c 5c 5c 22 2f 22 7d",
]
  .join(" ")
  .replaceAll(" ", "");

/** Parsed form of the object in RFC 8785 section 3.2.2. */
const RFC_SAMPLE = {
  string: "€$\u000F\nA'B\"\\\\\"/",
  numbers: [333333333.33333329, 1e30, 4.5, 0.002, 1e-27],
  literals: [null, true, false],
};

const APPENDIX_B: { hex: string; json: string | null }[] = [
  { hex: "0000000000000000", json: "0" },
  { hex: "8000000000000000", json: "0" },
  { hex: "0000000000000001", json: "5e-324" },
  { hex: "8000000000000001", json: "-5e-324" },
  { hex: "7fefffffffffffff", json: "1.7976931348623157e+308" },
  { hex: "ffefffffffffffff", json: "-1.7976931348623157e+308" },
  { hex: "4340000000000000", json: "9007199254740992" },
  { hex: "c340000000000000", json: "-9007199254740992" },
  { hex: "4430000000000000", json: "295147905179352830000" },
  { hex: "7fffffffffffffff", json: null },
  { hex: "7ff0000000000000", json: null },
  { hex: "44b52d02c7e14af5", json: "9.999999999999997e+22" },
  { hex: "44b52d02c7e14af6", json: "1e+23" },
  { hex: "44b52d02c7e14af7", json: "1.0000000000000001e+23" },
  { hex: "444b1ae4d6e2ef4e", json: "999999999999999700000" },
  { hex: "444b1ae4d6e2ef4f", json: "999999999999999900000" },
  { hex: "444b1ae4d6e2ef50", json: "1e+21" },
  { hex: "3eb0c6f7a0b5ed8c", json: "9.999999999999997e-7" },
  { hex: "3eb0c6f7a0b5ed8d", json: "0.000001" },
  { hex: "41b3de4355555553", json: "333333333.3333332" },
  { hex: "41b3de4355555554", json: "333333333.33333325" },
  { hex: "41b3de4355555555", json: "333333333.3333333" },
  { hex: "41b3de4355555556", json: "333333333.3333334" },
  { hex: "41b3de4355555557", json: "333333333.33333343" },
  { hex: "becbf647612f3696", json: "-0.0000033333333333333333" },
  { hex: "43143ff3c1cb0959", json: "1424953923781206.2" },
];

function numberFromIeeeHex(hex: string): number {
  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);
  view.setBigUint64(0, BigInt(`0x${hex}`));
  return view.getFloat64(0);
}

describe("RFC 8785 vectors", () => {
  it("matches the section 3.2.4 sample byte-for-byte", () => {
    const text = canonicalizeJson(RFC_SAMPLE);
    expect(Buffer.from(text, "utf8").toString("hex")).toBe(RFC_SAMPLE_HEX);
    expect(text.includes(" ")).toBe(false);
    expect(JSON.parse(text)).toEqual(JSON.parse(Buffer.from(RFC_SAMPLE_HEX, "hex").toString("utf8")));
  });

  it("serializes every Appendix B number sample", () => {
    for (const sample of APPENDIX_B) {
      const value = numberFromIeeeHex(sample.hex);
      if (sample.json === null) {
        expect(() => canonicalizeJson(value)).toThrow(CanonicalizationError);
        continue;
      }
      expect(canonicalizeJson(value)).toBe(sample.json);
    }
  });

  it("sorts the section 3.2.3 property names by UTF-16 code unit", () => {
    const sorting = {
      "\u20ac": "Euro Sign",
      "\r": "Carriage Return",
      "\ufb33": "Hebrew Letter Dalet With Dagesh",
      "1": "One",
      "\ud83d\ude00": "Emoji: Grinning Face",
      "\u0080": "Control",
      "\u00f6": "Latin Small Letter O With Diaeresis",
    };
    const expectedOrder = [
      ["\r", "Carriage Return"],
      ["1", "One"],
      ["\u0080", "Control"],
      ["\u00f6", "Latin Small Letter O With Diaeresis"],
      ["\u20ac", "Euro Sign"],
      ["\u{1F600}", "Emoji: Grinning Face"],
      ["\ufb33", "Hebrew Letter Dalet With Dagesh"],
    ] as const;
    const expected = `{${expectedOrder
      .map(([key, item]) => `${JSON.stringify(key)}:${JSON.stringify(item)}`)
      .join(",")}}`;
    expect(canonicalizeJson(sorting)).toBe(expected);
    const output = canonicalizeJson(sorting);
    const positions = expectedOrder.map(([, item]) => output.indexOf(JSON.stringify(item)));
    expect(positions.every((position, index) => index === 0 || position > (positions[index - 1] ?? -1))).toBe(
      true,
    );
  });

  it("keeps surrogate pairs as UTF-8 characters and rejects lone surrogates", () => {
    const grinning = "\u{1F600}";
    expect(canonicalizeJson(grinning)).toBe(`"${grinning}"`);
    expect(canonicalizeJson("\uD83D\uDE00")).toBe(canonicalizeJson(grinning));
    expect(canonicalizeJson(grinning).includes("\\u")).toBe(false);
    expect(() => canonicalizeJson("\uDEAD")).toThrow(CanonicalizationError);
    expect(() => canonicalizeJson("\uD800")).toThrow(CanonicalizationError);
    expect(() => canonicalizeJson("a\uD800b")).toThrow(CanonicalizationError);
    expect(() => canonicalizeJson({ "\uDEAD": 1 })).toThrow(CanonicalizationError);
    try {
      canonicalizeJson("\uDEAD");
    } catch (error) {
      expect(error).toBeInstanceOf(CanonicalizationError);
      expect((error as CanonicalizationError).code).toBe("lone_surrogate");
    }
  });

  it("canonicalizes the Appendix E string-subtype example", () => {
    expect(
      canonicalizeJson({
        time: "2019-01-28T07:45:10Z",
        big: "055",
        val: 3.5,
      }),
    ).toBe('{"big":"055","time":"2019-01-28T07:45:10Z","val":3.5}');
  });

  it("uses minimal string escapes and leaves solidus and line separators raw", () => {
    expect(canonicalizeJson("\u0000")).toBe('"\\u0000"');
    expect(canonicalizeJson("\u000f")).toBe('"\\u000f"');
    expect(canonicalizeJson("\b\t\n\f\r")).toBe('"\\b\\t\\n\\f\\r"');
    expect(canonicalizeJson('"\\')).toBe('"\\"\\\\"');
    expect(canonicalizeJson("/")).toBe('"/"');
    expect(canonicalizeJson("\u2028\u2029")).toBe('"\u2028\u2029"');
    expect(canonicalizeJson("\u007f")).toBe('"\u007f"');
  });
});
