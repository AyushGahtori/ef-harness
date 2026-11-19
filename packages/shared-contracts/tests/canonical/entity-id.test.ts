import { describe, expect, it } from "vitest";
import {
  EntityIdError,
  assertValidEntityId,
  formatEntityId,
  isValidEntityId,
  parseEntityId,
} from "../../src/canonical/index.js";

const CANONICAL_IDS: { prefix: string; sequence: number; id: string }[] = [
  { prefix: "T", sequence: 1, id: "T01" },
  { prefix: "R", sequence: 17, id: "R17" },
  { prefix: "SI-", sequence: 212, id: "SI-212" },
  { prefix: "EC-", sequence: 114, id: "EC-114" },
  { prefix: "C-", sequence: 14, id: "C-014" },
  { prefix: "AC-", sequence: 31, id: "AC-31" },
  { prefix: "A", sequence: 14, id: "A0014" },
  { prefix: "F", sequence: 12, id: "F12" },
  { prefix: "D-", sequence: 12, id: "D-0012" },
  { prefix: "CS-", sequence: 88, id: "CS-88" },
  { prefix: "EV-", sequence: 55120, id: "EV-55120" },
  { prefix: "CCR-", sequence: 14, id: "CCR-14" },
  { prefix: "VR-", sequence: 7781, id: "VR-7781" },
  { prefix: "RS-", sequence: 1, id: "RS-1" },
  { prefix: "SRC-", sequence: 7, id: "SRC-07" },
  { prefix: "W", sequence: 1, id: "W1" },
  { prefix: "S-", sequence: 1, id: "S-1" },
];

describe("formatEntityId", () => {
  it("formats every canonical example and parses it back", () => {
    for (const example of CANONICAL_IDS) {
      expect(formatEntityId(example.prefix, example.sequence)).toBe(example.id);
      expect(isValidEntityId(example.id)).toBe(true);
      expect(parseEntityId(example.id)).toEqual({
        prefix: example.prefix,
        sequence: example.sequence,
      });
      expect(() => assertValidEntityId(example.id)).not.toThrow();
    }
  });

  it("grows past the pad width instead of truncating", () => {
    expect(formatEntityId("T", 99)).toBe("T99");
    expect(formatEntityId("T", 100)).toBe("T100");
    expect(formatEntityId("A", 9999)).toBe("A9999");
    expect(formatEntityId("A", 10000)).toBe("A10000");
    expect(isValidEntityId("T100")).toBe(true);
    expect(isValidEntityId("A10000")).toBe(true);
    expect(formatEntityId("EV-", 100000)).toBe("EV-100000");
  });

  it("rejects under-padded, over-padded, zero, and unknown forms", () => {
    for (const id of ["T1", "T001", "C-14", "A14", "A00014", "CS-1", "SRC-7", "SI-21", "W01", ""]) {
      expect(isValidEntityId(id)).toBe(false);
      expect(() => parseEntityId(id)).toThrow(EntityIdError);
    }
    expect(isValidEntityId("AC-31")).toBe(true);
    expect(isValidEntityId("A0014")).toBe(true);
    expect(() => formatEntityId("T", 0)).toThrow(EntityIdError);
    expect(() => formatEntityId("T", -1)).toThrow(EntityIdError);
    expect(() => formatEntityId("T", 1.5)).toThrow(EntityIdError);
    expect(() => formatEntityId("NOPE", 1)).toThrow(EntityIdError);
    expect(() => formatEntityId("SI", 212)).toThrow(EntityIdError);
  });

  it("prefers the longest prefix", () => {
    expect(parseEntityId("SRC-07").prefix).toBe("SRC-");
    expect(parseEntityId("S-1").prefix).toBe("S-");
    expect(parseEntityId("CS-88").prefix).toBe("CS-");
    expect(parseEntityId("C-014").prefix).toBe("C-");
    expect(parseEntityId("CCR-14").prefix).toBe("CCR-");
    expect(parseEntityId("AC-31").prefix).toBe("AC-");
    expect(parseEntityId("A0014").prefix).toBe("A");
    expect(parseEntityId("SI-212").prefix).toBe("SI-");
    expect(parseEntityId("RS-1").prefix).toBe("RS-");
    expect(parseEntityId("R17").prefix).toBe("R");
  });
});
