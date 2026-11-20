import { describe, expect, it } from "vitest";
import { PACKET_SCHEMAS, exportPacketJsonSchemas } from "../../src/packets/index.js";

describe("packet JSON Schema export", () => {
  it("exports every registered schema without unsupported-construct errors", () => {
    const exported = exportPacketJsonSchemas();
    expect(Object.keys(exported).sort()).toEqual(Object.keys(PACKET_SCHEMAS).sort());
    for (const [name, schema] of Object.entries(exported)) {
      expect(schema, name).toBeTypeOf("object");
      expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    }
    expect(exported["candidate@1"]).toMatchObject({ additionalProperties: false });
    expect(exported["ccr@1"]).toMatchObject({ additionalProperties: false });
    expect(exported["task-packet@1"]).toMatchObject({
      properties: {
        budget: {
          properties: {
            usd: { type: "integer" },
            local_slots: { type: "integer" },
          },
        },
      },
    });
  });
});
