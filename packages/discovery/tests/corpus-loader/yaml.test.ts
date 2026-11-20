import { describe, expect, it } from "vitest";
import { JsonParseError, YamlParseError } from "../../src/corpus-loader/errors.js";
import { corpusBundleHash } from "../../src/corpus-loader/hash.js";
import { parseStrictJson } from "../../src/corpus-loader/json-document.js";
import { parseStrictYaml } from "../../src/corpus-loader/yaml.js";

describe("strict corpus parsers", () => {
  it("parses mappings, sequences, and flow collections", () => {
    const parsed = parseStrictYaml(
      [
        "kind: question_pack",
        "version: 1",
        "touches: [user_content, authn]",
        "empty: []",
        "settles: {product.audience: known_group}",
        "questions:",
        "  - id: Q-CORE-01",
        "    title: Who is this for?",
        "    explain: >",
        "      The audience decides",
        "      the first job.",
        "criteria:",
        "  - product.audience",
      ].join("\n"),
      "sample.yaml",
    );
    expect(parsed).toMatchObject({
      kind: "question_pack",
      version: 1,
      touches: ["user_content", "authn"],
      empty: [],
      settles: { "product.audience": "known_group" },
      questions: [{ id: "Q-CORE-01", title: "Who is this for?", explain: "The audience decides the first job." }],
      criteria: ["product.audience"],
    });
  });

  it("rejects a duplicate YAML key with a line number and keeps the earlier key from winning silently", () => {
    const source = ["id: one", "title: Kept", "id: two"].join("\n");
    expect(() => parseStrictYaml(source, "C:/corpus/dup.yaml")).toThrow(YamlParseError);
    try {
      parseStrictYaml(source, "C:/corpus/dup.yaml");
    } catch (error) {
      expect(error).toBeInstanceOf(YamlParseError);
      const parsed = error as YamlParseError;
      expect(parsed.line).toBe(3);
      expect(parsed.filePath).toBe("C:/corpus/dup.yaml");
      expect(parsed.message).toContain('Duplicate YAML key "id"');
      expect(parsed.message).toContain("line 3");
    }
  });

  it("rejects malformed indentation with a line number", () => {
    const source = ["questions:", "   - id: Q-CORE-01", "  title: broken"].join("\n");
    expect(() => parseStrictYaml(source, "C:/corpus/indent.yaml")).toThrow(YamlParseError);
    try {
      parseStrictYaml(source, "C:/corpus/indent.yaml");
    } catch (error) {
      const parsed = error as YamlParseError;
      expect(parsed.line).toBe(3);
      expect(parsed.filePath).toBe("C:/corpus/indent.yaml");
      expect(parsed.message).toContain("Malformed YAML indentation");
    }
  });

  it("rejects duplicate JSON keys with a line number", () => {
    const source = '{\n  "id": "one",\n  "id": "two"\n}\n';
    try {
      parseStrictJson(source, "C:/corpus/dup.json");
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(JsonParseError);
      const parsed = error as JsonParseError;
      expect(parsed.line).toBe(3);
      expect(parsed.message).toContain('Duplicate JSON key "id"');
    }
  });

  it("hashes the same documents identically when key order differs", () => {
    const left = parseStrictYaml("b: 1\na: two\n", "left.yaml");
    const right = parseStrictYaml("a: two\nb: 1\n", "right.yaml");
    expect(corpusBundleHash([{ path: "pack.yaml", document: left }])).toBe(
      corpusBundleHash([{ path: "pack.yaml", document: right }]),
    );
  });
});
