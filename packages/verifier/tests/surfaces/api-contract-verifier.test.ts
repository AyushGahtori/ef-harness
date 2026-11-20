import { describe, expect, it } from "vitest";
import { ApiContractVerifier } from "../../src/surfaces/api-contract-verifier.js";
import { validateJsonSchema } from "../../src/surfaces/openapi-validator.js";
import { listen, sendJson, verifierContext, readBody } from "./support.js";

const errorBody = { code: "rejected", message: "Request rejected", banner: "Check the form" };

function orderDocument() {
  return {
    openapi: "3.0.3",
    paths: {
      "/orders": {
        post: {
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  additionalProperties: false,
                  required: ["name", "quantity"],
                  properties: {
                    name: { type: "string", minLength: 1, maxLength: 40 },
                    quantity: { type: "integer", minimum: 1, maximum: 20 },
                  },
                },
              },
            },
          },
          responses: {
            "201": {
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    required: ["id", "name"],
                    properties: { id: { type: "string" }, name: { type: "string" } },
                  },
                },
              },
            },
          },
        },
      },
    },
  };
}

function spec() {
  return {
    checkId: "api.orders",
    roles: ["admin", "manager", "kitchen_staff", "member", "unauthorized", "anonymous"],
    operations: [
      {
        method: "POST" as const,
        path: "/orders",
        authorizedRoles: ["admin", "manager", "kitchen_staff"],
      },
    ],
    calls: [
      {
        id: "create-soup",
        method: "POST" as const,
        path: "/orders",
        role: "kitchen_staff",
        body: { name: "Soup", quantity: 2 },
        expect: { status: 201, headers: { "content-type": "application/json" } },
      },
    ],
    openapi: orderDocument(),
  };
}

type Mode = "pass" | "leak" | "wrong-role" | "bad-error" | "accept-invalid";

function validOrder(body: unknown): boolean {
  if (typeof body !== "object" || body === null) return false;
  const record = body as { name?: unknown; quantity?: unknown };
  return (
    typeof record.name === "string" &&
    record.name.length >= 1 &&
    record.name.length <= 40 &&
    typeof record.quantity === "number" &&
    Number.isInteger(record.quantity) &&
    record.quantity >= 1 &&
    record.quantity <= 20
  );
}

async function startApi(mode: Mode) {
  return listen(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (request.method !== "POST" || url.pathname !== "/orders") {
      sendJson(response, 404, { code: "missing", message: "Missing route", banner: "Not found" });
      return;
    }
    const role = request.headers["x-test-role"];
    const roleName = Array.isArray(role) ? role[0] : role;
    if (!roleName) {
      sendJson(response, 401, { code: "anonymous", message: "Sign in", banner: "Sign in required" });
      return;
    }
    const allowed = new Set(["admin", "manager", "kitchen_staff"]);
    if (!allowed.has(roleName) && mode !== "wrong-role") {
      sendJson(response, 403, { code: "forbidden", message: "Wrong role", banner: "You cannot do that" });
      return;
    }
    const body = JSON.parse(await readBody(request) || "{}") as unknown;
    if (!validOrder(body) && mode !== "accept-invalid") {
      if (mode === "bad-error") {
        sendJson(response, 400, { error: "nope" });
        return;
      }
      sendJson(response, 400, errorBody);
      return;
    }
    const name = typeof body === "object" && body !== null ? (body as { name?: string }).name : "Soup";
    const payload: Record<string, string> = { id: "ord_1", name: name ?? "Soup" };
    if (mode === "leak") payload.passwordHash = "hidden";
    sendJson(response, 201, payload);
  });
}

describe("ApiContractVerifier", () => {
  it("rejects undeclared passwordHash even when additional properties are otherwise open", () => {
    const issues = validateJsonSchema(
      { type: "object", properties: { id: { type: "string" } } },
      { id: "1", passwordHash: "hidden" },
    );
    expect(issues.some((issue) => issue.sensitiveLeak)).toBe(true);
  });

  it("passes status, schema, X-01, X-02, and X-11 on a correct target", async () => {
    const server = await startApi("pass");
    try {
      const results = await new ApiContractVerifier().verify(spec(), verifierContext(server.url));
      expect(results.every((result) => result.status === "pass")).toBe(true);
      expect(results.map((result) => result.check_id)).toEqual(
        expect.arrayContaining([
          "api.orders:create-soup",
          "api.orders:X-01:POST:/orders",
          "api.orders:X-02",
          "api.orders:X-11",
        ]),
      );
    } finally {
      await server.close();
    }
  });

  it("fails when the response leaks passwordHash outside the OpenAPI schema", async () => {
    const server = await startApi("leak");
    try {
      const results = await new ApiContractVerifier().verify(spec(), verifierContext(server.url));
      const call = results.find((result) => result.check_id === "api.orders:create-soup");
      expect(call?.status).toBe("fail");
      expect(call?.message).toContain("passwordHash");
    } finally {
      await server.close();
    }
  });

  it("fails X-01 when a non-authorized role is accepted", async () => {
    const server = await startApi("wrong-role");
    try {
      const results = await new ApiContractVerifier().verify(spec(), verifierContext(server.url));
      const role = results.find((result) => result.check_id === "api.orders:X-01:POST:/orders");
      expect(role?.status).toBe("fail");
      expect(role?.message).toContain("member");
    } finally {
      await server.close();
    }
  });

  it("fails X-11 when errors omit the shared banner format", async () => {
    const server = await startApi("bad-error");
    try {
      const results = await new ApiContractVerifier().verify(spec(), verifierContext(server.url));
      expect(results.find((result) => result.check_id === "api.orders:X-11")?.status).toBe("fail");
    } finally {
      await server.close();
    }
  });

  it("fails X-02 when invalid input is accepted", async () => {
    const server = await startApi("accept-invalid");
    try {
      const results = await new ApiContractVerifier().verify(spec(), verifierContext(server.url));
      expect(results.find((result) => result.check_id === "api.orders:X-02")?.status).toBe("fail");
    } finally {
      await server.close();
    }
  });
});
