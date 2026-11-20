import {
  deriveBoundaryCases,
  requestSchemaFor,
  responseSchemaFor,
  sharedErrorFormatIssues,
  validateJsonSchema,
  type JsonSchema,
  type OpenApiDocument,
} from "./openapi-validator.js";
import { appUrl, headerIncludes, joinUrl, requestJson } from "./http.js";
import { environmentFailure, implementationFailure, parseCheck, passing } from "./result.js";
import { ApiContractCheckSchema, type ApiContractCheck } from "./schemas.js";
import type { SurfaceCheckResult, SurfaceVerifierAdapter, SurfaceVerifierContext } from "./types.js";

type CallResult = { readonly status: number; readonly headers: Readonly<Record<string, string>>; readonly body: unknown };

function componentsOf(spec: ApiContractCheck): Record<string, JsonSchema> {
  return (spec.openapi.components?.schemas ?? {}) as Record<string, JsonSchema>;
}

function documentOf(spec: ApiContractCheck): OpenApiDocument {
  return spec.openapi as OpenApiDocument;
}

export class ApiContractVerifier implements SurfaceVerifierAdapter {
  readonly id = "api-contract";
  readonly surface = "api";

  async verify(spec: unknown, context: SurfaceVerifierContext): Promise<readonly SurfaceCheckResult[]> {
    const parsed = parseCheck(ApiContractCheckSchema, spec, context);
    if (!parsed.ok) return parsed.results;
    const check = parsed.value;
    let base: string;
    try {
      base = appUrl(context.env.vars());
    } catch (error) {
      return [environmentFailure(check.checkId, context, error instanceof Error ? error.message : String(error))];
    }
    try {
      const callResults: SurfaceCheckResult[] = [];
      const errorBodies: unknown[] = [];
      for (const call of check.calls) {
        const response = await this.send(base, check, call.method, call.path, call.role, call.body);
        callResults.push(this.judgeCall(check, call, response, context));
        if (response.status >= 400) errorBodies.push(response.body);
      }
      const roleResults = await this.roleMatrix(base, check, context, errorBodies);
      const invalidResults = await this.invalidInputs(base, check, context, errorBodies);
      const formatResult = this.errorFormat(check, context, errorBodies);
      return [...callResults, ...roleResults, invalidResults, formatResult];
    } catch (error) {
      return [
        environmentFailure(
          check.checkId,
          context,
          error instanceof Error ? error.message : String(error),
        ),
      ];
    }
  }

  private async send(
    base: string,
    check: ApiContractCheck,
    method: string,
    path: string,
    role: string | undefined,
    body: unknown,
  ): Promise<CallResult> {
    const headerName = check.authHeader ?? "X-Test-Role";
    const headers: Record<string, string> = { accept: "application/json" };
    if (role && role !== "anonymous") headers[headerName] = role;
    if (body !== undefined) headers["content-type"] = "application/json";
    const response = await requestJson(joinUrl(base, path), {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, headers: response.headers, body: response.body };
  }

  private judgeCall(
    check: ApiContractCheck,
    call: ApiContractCheck["calls"][number],
    response: CallResult,
    context: SurfaceVerifierContext,
  ): SurfaceCheckResult {
    const checkId = `${check.checkId}:${call.id}`;
    const problems: string[] = [];
    if (response.status !== call.expect.status) {
      problems.push(`status ${response.status} !== ${call.expect.status}`);
    }
    for (const [name, expected] of Object.entries(call.expect.headers ?? {})) {
      if (!headerIncludes(response.headers, name, expected)) {
        problems.push(`header ${name} does not include ${expected}`);
      }
    }
    const schema = responseSchemaFor(documentOf(check), call.method, call.path, response.status);
    if (schema) {
      const issues = validateJsonSchema(schema, response.body, componentsOf(check));
      for (const issue of issues) {
        problems.push(`${issue.path}: ${issue.message}`);
      }
    }
    if (problems.length > 0) {
      return implementationFailure(checkId, context, problems.join("; "), {
        rule: "openapi",
        status: response.status,
        problems,
      });
    }
    return passing(checkId, context, `OpenAPI call ${call.id} matched status, headers, and schema`, {
      rule: "openapi",
      status: response.status,
    });
  }

  private async roleMatrix(
    base: string,
    check: ApiContractCheck,
    context: SurfaceVerifierContext,
    errorBodies: unknown[],
  ): Promise<SurfaceCheckResult[]> {
    const results: SurfaceCheckResult[] = [];
    for (const operation of check.operations) {
      const checkId = `${check.checkId}:X-01:${operation.method}:${operation.path}`;
      if (operation.public) {
        results.push(passing(checkId, context, "public route skipped the role matrix", { rule: "X-01" }));
        continue;
      }
      const denied = check.roles.filter((role) => !operation.authorizedRoles.includes(role));
      const failures: string[] = [];
      for (const role of denied) {
        const sample = check.calls.find((call) => call.method === operation.method && call.path === operation.path);
        const response = await this.send(base, check, operation.method, operation.path, role, sample?.body);
        if (response.status !== 401 && response.status !== 403) {
          failures.push(`${role} received ${response.status}`);
        } else {
          errorBodies.push(response.body);
        }
      }
      if (failures.length > 0) {
        results.push(
          implementationFailure(checkId, context, `unauthorized roles were not denied: ${failures.join(", ")}`, {
            rule: "X-01",
            failures,
          }),
        );
      } else {
        results.push(
          passing(checkId, context, `every non-authorized role received 401 or 403`, {
            rule: "X-01",
            deniedRoles: denied,
          }),
        );
      }
    }
    return results;
  }

  private async invalidInputs(
    base: string,
    check: ApiContractCheck,
    context: SurfaceVerifierContext,
    errorBodies: unknown[],
  ): Promise<SurfaceCheckResult> {
    const checkId = `${check.checkId}:X-02`;
    const derived = check.deriveBoundaryCases !== false
      ? check.operations.flatMap((operation) =>
          deriveBoundaryCases(documentOf(check), operation.method, operation.path, componentsOf(check)),
        )
      : [];
    const role =
      check.operations.find((operation) => !operation.public)?.authorizedRoles[0] ??
      check.roles.find((item) => item !== "anonymous") ??
      "anonymous";
    const cases = [
      ...(check.invalidInputs ?? []).map((item) => ({
        id: item.id,
        method: item.method,
        path: item.path,
        body: item.body,
        expectStatus: item.expectStatus,
        role: item.role,
      })),
      ...derived.map((item) => ({ ...item, role })),
    ];
    const failures: string[] = [];
    for (const item of cases) {
      const response = await this.send(base, check, item.method, item.path, item.role, item.body);
      if (response.status !== item.expectStatus) {
        failures.push(`${item.id} status ${response.status} !== ${item.expectStatus}`);
      } else if (response.status >= 400) {
        errorBodies.push(response.body);
      }
      const requestSchema = requestSchemaFor(documentOf(check), item.method, item.path);
      if (requestSchema && item.expectStatus < 400) {
        failures.push(`${item.id} expected a rejection`);
      }
    }
    if (cases.length === 0) {
      return implementationFailure(checkId, context, "no invalid-input cases were declared or derived", {
        rule: "X-02",
      });
    }
    if (failures.length > 0) {
      return implementationFailure(checkId, context, failures.join("; "), { rule: "X-02", failures });
    }
    return passing(checkId, context, `${cases.length} boundary and invalid inputs were rejected`, {
      rule: "X-02",
      cases: cases.map((item) => item.id),
    });
  }

  private errorFormat(
    check: ApiContractCheck,
    context: SurfaceVerifierContext,
    errorBodies: unknown[],
  ): SurfaceCheckResult {
    const checkId = `${check.checkId}:X-11`;
    if (errorBodies.length === 0) {
      return implementationFailure(checkId, context, "no error responses were observed to check the shared format", {
        rule: "X-11",
      });
    }
    const failures: string[] = [];
    errorBodies.forEach((body, index) => {
      for (const issue of sharedErrorFormatIssues(body)) failures.push(`response ${index}: ${issue}`);
    });
    if (failures.length > 0) {
      return implementationFailure(checkId, context, failures.join("; "), { rule: "X-11", failures });
    }
    return passing(checkId, context, "error responses use code, message, and banner", {
      rule: "X-11",
      observed: errorBodies.length,
    });
  }
}
