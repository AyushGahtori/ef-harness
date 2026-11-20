import { describe, expect, it } from "vitest";
import { ImportBatchSummarizer } from "../../src/extraction/batch-summary.js";
import { InMemoryKnowledgeGraph } from "../../src/extraction/graph.js";
import { DeterministicSchemaContractImporter } from "../../src/extraction/schema-importer.js";

const importer = new DeterministicSchemaContractImporter();

describe("DeterministicSchemaContractImporter", () => {
  it("parses OpenAPI 3.0 JSON with exact methods, fields, and status codes at zero model tokens", () => {
    const result = importer.importSource({
      filename: "openapi.json",
      text: JSON.stringify({
        openapi: "3.0.3",
        info: { title: "Orders", version: "1.0.0" },
        paths: {
          "/orders": {
            post: {
              operationId: "createOrder",
              parameters: [
                {
                  name: "idempotency_key",
                  in: "header",
                  required: true,
                  schema: { type: "string" },
                },
              ],
              requestBody: {
                required: true,
                content: {
                  "application/json": {
                    schema: {
                      type: "object",
                      required: ["ready_at"],
                      properties: {
                        ready_at: { type: "string" },
                        note: { type: "string" },
                      },
                    },
                  },
                },
              },
              responses: {
                "201": { description: "Created" },
                "409": { description: "Conflict" },
              },
            },
          },
        },
      }),
    });
    expect(result.ok).toBe(true);
    expect(result.llmTokens).toBe(0);
    expect(result.modelCalls).toBe(0);
    expect(result.contracts).toHaveLength(1);
    const contract = result.contracts[0];
    expect(contract?.method).toBe("POST");
    expect(contract?.path).toBe("/orders");
    expect(contract?.statusCodes).toEqual(["201", "409"]);
    expect(contract?.parameters).toEqual([
      expect.objectContaining({ name: "idempotency_key", type: "string", required: true }),
    ]);
    expect(contract?.requestFields).toEqual([
      expect.objectContaining({ name: "ready_at", type: "string", required: true, enumValues: [] }),
      expect.objectContaining({ name: "note", type: "string", required: false }),
    ]);
    expect(contract?.basis).toBe("observed");
  });

  it("resolves a cyclic OpenAPI 3.1 $ref and reports the YAML line of a broken file", () => {
    const cyclic = importer.importSource({
      filename: "openapi.yaml",
      text: [
        "openapi: \"3.1.0\"",
        "info:",
        "  title: Nodes",
        "  version: \"1.0.0\"",
        "paths: {}",
        "components:",
        "  schemas:",
        "    Node:",
        "      type: object",
        "      required: [id]",
        "      properties:",
        "        id:",
        "          type: string",
        "        children:",
        "          type: array",
        "          items:",
        "            $ref: \"#/components/schemas/Node\"",
        "",
      ].join("\n"),
    });
    expect(cyclic.ok).toBe(true);
    expect(cyclic.llmTokens).toBe(0);
    const node = cyclic.entities.find((entity) => entity.name === "Node");
    expect(node?.fields.find((field) => field.name === "id")).toMatchObject({ type: "string", required: true });
    expect(node?.fields.find((field) => field.name === "children")).toMatchObject({
      type: "array",
      circular: true,
      ref: "#/components/schemas/Node",
    });

    const broken = [
      "openapi: 3.1.0",
      "info:",
      "  title: Bad",
      "  version: \"1.0.0\"",
      "paths:",
      "  /orders:",
      "    post",
      "      responses: {}",
      "",
    ].join("\n");
    const failed = importer.importSource({ filename: "broken.yaml", text: broken });
    expect(failed.ok).toBe(false);
    expect(failed.errors[0]?.line).toBe(broken.slice(0, broken.indexOf("    post")).split("\n").length);
    expect(failed.errors[0]?.message).toContain("post");
    expect(failed.contracts).toEqual([]);
  });

  it("parses JSON Schema draft 7 and 2020-12, SQL DDL, Prisma, and GraphQL", () => {
    const draft7 = importer.importSource({
      filename: "money.schema.json",
      text: JSON.stringify({
        $schema: "http://json-schema.org/draft-07/schema#",
        title: "Order",
        type: "object",
        required: ["id"],
        properties: { id: { type: "string" } },
        definitions: {
          Money: {
            type: "object",
            required: ["currency"],
            properties: { currency: { type: "string", enum: ["usd", "eur"] } },
          },
        },
      }),
    });
    expect(draft7.entities.find((entity) => entity.name === "Money")).toMatchObject({ draft: "draft-07" });
    expect(draft7.entities.find((entity) => entity.name === "Money")?.fields[0]).toMatchObject({
      name: "currency",
      required: true,
      enumValues: ["usd", "eur"],
    });

    const draft2020 = importer.importSource({
      filename: "node.schema.json",
      text: JSON.stringify({
        $schema: "https://json-schema.org/draft/2020-12/schema",
        title: "Tree",
        $defs: {
          Node: {
            type: "object",
            properties: {
              children: { type: "array", items: { $ref: "#/$defs/Node" } },
            },
          },
        },
      }),
    });
    expect(draft2020.entities.find((entity) => entity.name === "Node")?.draft).toBe("2020-12");
    expect(draft2020.entities.find((entity) => entity.name === "Node")?.fields[0]?.circular).toBe(true);

    const sql = importer.importSource({
      filename: "orders.sql",
      text: `CREATE TABLE orders (
  id TEXT PRIMARY KEY NOT NULL,
  status TEXT NOT NULL,
  note TEXT,
  kind TEXT CHECK (kind IN ('pickup', 'delivery'))
);`,
    });
    const table = sql.entities[0];
    expect(table?.name).toBe("orders");
    expect(table?.fields.map((field) => [field.name, field.type, field.required, field.enumValues])).toEqual([
      ["id", "TEXT", true, []],
      ["status", "TEXT", true, []],
      ["note", "TEXT", false, []],
      ["kind", "TEXT", false, ["pickup", "delivery"]],
    ]);

    const prisma = importer.importSource({
      filename: "schema.prisma",
      text: `model Order {
  id     String @id
  status OrderStatus
  note   String?
}

enum OrderStatus {
  OPEN
  PAID
}`,
    });
    expect(prisma.entities.find((entity) => entity.name === "Order")?.fields).toEqual([
      expect.objectContaining({ name: "id", type: "String", required: true }),
      expect.objectContaining({ name: "status", type: "OrderStatus", required: true, ref: "OrderStatus" }),
      expect.objectContaining({ name: "note", type: "String", required: false, nullable: true }),
    ]);
    expect(prisma.entities.find((entity) => entity.name === "OrderStatus")?.enumValues).toEqual(["OPEN", "PAID"]);

    const graphql = importer.importSource({
      filename: "schema.graphql",
      text: `type Order {
  id: ID!
  status: OrderStatus
}

enum OrderStatus {
  OPEN
  PAID
}

type Query {
  order(id: ID!): Order
}`,
    });
    expect(graphql.entities.find((entity) => entity.name === "Order")?.fields).toEqual([
      expect.objectContaining({ name: "id", type: "ID!", required: true }),
      expect.objectContaining({ name: "status", type: "OrderStatus", required: false }),
    ]);
    expect(graphql.contracts[0]).toMatchObject({
      method: "QUERY",
      path: "order",
      responseType: "Order",
      basis: "observed",
    });
    expect(graphql.contracts[0]?.parameters[0]).toMatchObject({ name: "id", type: "ID!", required: true });
    expect(graphql.llmTokens).toBe(0);
  });

  it("commits entities as arch nodes and contracts as contract nodes with observed basis", () => {
    const result = importer.importSource({
      filename: "openapi.json",
      text: JSON.stringify({
        openapi: "3.1.0",
        info: { title: "Orders", version: "1.0.0" },
        paths: { "/orders": { get: { responses: { "200": { description: "Ok" } } } } },
        components: {
          schemas: {
            Order: {
              type: "object",
              required: ["id"],
              properties: { id: { type: "string" } },
            },
          },
        },
      }),
    });
    const graph = new InMemoryKnowledgeGraph();
    importer.commit(result, graph);
    const nodes = graph.listNodes();
    expect(nodes.find((node) => node.kind === "arch_node")?.basis).toBe("observed");
    expect(nodes.find((node) => node.kind === "contract")?.title).toBe("GET /orders");
    expect(graph.listEvidence().every((item) => item.verified)).toBe(true);
  });
});

describe("ImportBatchSummarizer", () => {
  it("shows one card for a folder and holds risky documents", () => {
    const paths = Array.from({ length: 14 }, (_, index) => {
      const number = index + 1;
      return `  /items/${number}:\n    get:\n      operationId: getItem${number}\n      responses:\n        "200":\n          description: Ok`;
    }).join("\n");
    const imported = importer.importSource({
      filename: "openapi.yaml",
      text: `openapi: "3.0.3"\ninfo:\n  title: Items\n  version: "1.0.0"\npaths:\n${paths}\n`,
    });
    expect(imported.contracts).toHaveLength(14);
    expect(imported.llmTokens).toBe(0);
    const summarizer = new ImportBatchSummarizer();
    const card = summarizer.summarize([
      {
        sourceName: "PRD.pdf",
        kind: "prose",
        endpointCount: 0,
        requirementCount: 22,
        conflictCount: 2,
        exact: false,
        risky: true,
      },
      {
        sourceName: "openapi.yaml",
        kind: "openapi",
        endpointCount: imported.contracts.length,
        requirementCount: 0,
        conflictCount: 0,
        exact: true,
        risky: false,
      },
      { sourceName: "brand-guide.pdf", kind: "brand", endpointCount: 0, requirementCount: 0, conflictCount: 0, exact: false, risky: false },
      { sourceName: "wireframes.png", kind: "wireframe", endpointCount: 0, requirementCount: 0, conflictCount: 0, exact: false, risky: false },
      { sourceName: "legacy-notes.md", kind: "notes", endpointCount: 0, requirementCount: 0, conflictCount: 0, exact: false, risky: false },
    ]);
    expect(card.documents).toHaveLength(5);
    expect(card.reviewBeforeCommit).toBe(true);
    expect(card.summary).toBe(
      "Imported 14 API endpoints from openapi.yaml (exact), extracted 22 candidate requirements from PRD.pdf, found 2 conflicts with your prompt",
    );
    expect(summarizer.selectiveAcceptance(card)).toEqual({
      accepted: ["openapi.yaml", "brand-guide.pdf", "wireframes.png", "legacy-notes.md"],
      heldForReview: ["PRD.pdf"],
    });
  });
});
