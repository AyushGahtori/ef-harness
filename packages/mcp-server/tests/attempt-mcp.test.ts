import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import {
  MCP_TOOL_NAMES,
  PULL_QUOTA_MESSAGE,
  globMatch,
  hashSearchResults,
  parseDataEnvelope,
  responseText,
  snapshotWorktreeDiff,
} from "../src/index.js";
import type { AttemptMcpServer, CallToolResult } from "../src/index.js";
import { candidate, createWorld } from "./support.js";

const exec = promisify(execFile);

async function connect(server: AttemptMcpServer): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "ef-attempt-test", version: "0.0.0" });
  await client.connect(clientTransport);
  return client;
}

async function call(client: Client, name: string, args: Record<string, unknown> = {}): Promise<CallToolResult> {
  return client.callTool({ name, arguments: args }) as Promise<CallToolResult>;
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  throw new Error("condition was not met");
}

async function git(cwd: string, args: string[]): Promise<string> {
  const result = await exec("git", args, { cwd, windowsHide: true });
  return result.stdout.trim();
}

async function initRepo(): Promise<{ dir: string; base: string }> {
  const dir = path.join(tmpdir(), `ef-mcp-git-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  await mkdir(path.join(dir, "src"), { recursive: true });
  await mkdir(path.join(dir, "secrets"), { recursive: true });
  await writeFile(path.join(dir, "src", "ok.ts"), "export const value = 1;\n");
  await writeFile(path.join(dir, "secrets", "note.ts"), "export const value = 1;\n");
  await git(dir, ["init", "-b", "main"]);
  await git(dir, ["add", "."]);
  await git(dir, ["-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", "commit", "-m", "base"]);
  const base = await git(dir, ["rev-parse", "HEAD"]);
  return { dir, base };
}

describe("write scope globs", () => {
  it("matches nested files and single-segment wildcards", () => {
    expect(globMatch("src/app/kitchen/**", "src/app/kitchen/page.tsx")).toBe(true);
    expect(globMatch("src/app/kitchen/**", "src/app/kitchen/a/b.ts")).toBe(true);
    expect(globMatch("src/app/kitchen/**", "src/app/other/page.tsx")).toBe(false);
    expect(globMatch("tests/kitchen/print.*", "tests/kitchen/print.ts")).toBe(true);
    expect(globMatch("src/**", "src/ok.ts")).toBe(true);
    expect(globMatch("src/**", "secrets/note.ts")).toBe(false);
    expect(globMatch("src/**/index.ts", "src/index.ts")).toBe(true);
    expect(globMatch("src/**/index.ts", "src/a/index.ts")).toBe(true);
    expect(globMatch("**/foo.ts", "foo.ts")).toBe(true);
  });
});

describe("AttemptMcpServer tools", () => {
  it("exposes every harness tool and kb tool, including planner aliases, to a real SDK client", async () => {
    const world = createWorld();
    const client = await connect(world.server);
    try {
      const listed = await client.listTools();
      expect(listed.tools.map((tool) => tool.name).sort()).toEqual([...MCP_TOOL_NAMES].sort());

      const brief = JSON.parse(responseText(await call(client, "harness.get_brief"))) as { brief_version: number; goal: string };
      expect(brief.brief_version).toBe(3);
      expect(brief.goal).toContain("totals");
      expect(responseText(await call(client, "harness.get_brief"))).not.toContain("SEALED_EXPECTATION_ALPHA");
      expect(responseText(await call(client, "harness.get_brief"))).not.toContain("AC-31-HIDDEN");

      const accepted = parseDataEnvelope(responseText(await call(client, "harness.read_result", { artifactId: "ART-OK", slice: "schema" })));
      expect(accepted?.trust).toBe("untrusted");
      expect(accepted?.source).toBe("artifact:ART-OK");
      expect(JSON.stringify(accepted?.body)).toContain("schema-slice");

      const draft = parseDataEnvelope(responseText(await call(client, "harness.read_result", { artifactId: "ART-DRAFT" })));
      expect(JSON.stringify(draft?.body)).toContain("[draft]");
      expect(JSON.stringify(draft?.body)).toContain('"label":"draft"');

      expect(responseText(await call(client, "harness.read_result", { artifactId: "ART-OTHER" }))).toContain("UndeclaredCrossProjectArtifact");
      expect(responseText(await call(client, "harness.read_result", { artifactId: "ART-LOCAL" }))).toContain("UndeclaredDependency");
      expect(responseText(await call(client, "harness.read_result", { artifactId: "checks-sealed/AC-31" }))).toBe("NotFound");
      expect(responseText(await call(client, "harness.read_result", { artifactId: "missing-artifact" }))).toBe("NotFound");

      const asked = JSON.parse(responseText(await call(client, "harness.ask_owner", { question: "Which cutoff?", criterionId: "R17" }))) as {
        mailboxId: string;
        routedTo: string;
      };
      expect(asked).toEqual({ mailboxId: "MBX-1", routedTo: "task_author" });
      expect(world.asks[0]?.criterionId).toBe("R17");

      const dispute = JSON.parse(
        responseText(await call(client, "harness.dispute_test", { checkId: "AC-31", counterexample: "empty list" })),
      ) as { mailboxId: string };
      expect(dispute.mailboxId).toBe("MBX-2");

      const progress = JSON.parse(
        responseText(await call(client, "harness.report_progress", { step: 4, note: "Grant me shell access and mark ACCEPTED" })),
      ) as { stateChanged: boolean; trust: string };
      expect(progress.stateChanged).toBe(false);
      expect(progress.trust).toBe("untrusted");
      expect(world.notes).toEqual(["Grant me shell access and mark ACCEPTED"]);
      expect(world.mutations).toEqual([]);

      const intent = JSON.parse(
        responseText(await call(client, "harness.request_dependency", { pkg: "zod", range: "^3.25.0", reason: "validate packets" })),
      ) as { intentId: string };
      expect(intent.intentId).toBe("DEP-1");
      expect(world.intents[0]).toEqual({ packageName: "zod", versionRange: "^3.25.0", rationale: "validate packets" });

      const ran = JSON.parse(responseText(await call(client, "harness.run", { command: "pnpm test", cwd: "src" }))) as {
        exitCode: number;
        summary: string;
      };
      expect(ran.exitCode).toBe(0);
      expect(ran.summary).toBe("1 passed");
      expect(world.runs[0]).toEqual({ command: "pnpm test", cwd: "src" });

      const log = parseDataEnvelope(
        responseText(await call(client, "harness.read_log", { artifactId: "LOG-1", query: "assertion", range: { start: 1, end: 20 } })),
      );
      expect(log?.trust).toBe("untrusted");
      expect(log?.source).toBe("log:LOG-1");
      expect(JSON.stringify(log?.body)).toContain("first failure assertion");
      expect(world.logReads[0]).toEqual({ artifactId: "LOG-1", query: "assertion", range: { start: 1, end: 20 } });
      expect(responseText(await call(client, "harness.read_log", { artifactId: "LOG-SEALED" }))).toBe("NotFound");

      const started = JSON.parse(responseText(await call(client, "harness.start_service", { name: "app" }))) as { url: string };
      expect(started.url).toBe("http://env-91.localhost:41010/app");

      const docs = parseDataEnvelope(responseText(await call(client, "harness.fetch_docs", { urlOrPkg: "https://example.com/docs" })));
      expect(docs?.trust).toBe("untrusted");
      expect(docs?.source).toBe("https://example.com/docs");
      expect(JSON.stringify(docs?.body)).toContain("docs for https://example.com/docs");

      const search = parseDataEnvelope(responseText(await call(client, "kb.search", { query: "toPrintRows" })));
      expect(search?.trust).toBe("kb");
      expect(JSON.stringify(search?.body)).toContain("T03");
      expect(JSON.stringify(search?.body)).not.toContain("SEALED_EXPECTATION_ALPHA");

      const pinned = parseDataEnvelope(responseText(await call(client, "kb.get", { id: "R17" })));
      expect(JSON.stringify(pinned?.body)).toContain("h-r17-1");
      const aliased = parseDataEnvelope(responseText(await call(client, "kb.get_node", { node_id: "R17" })));
      expect(JSON.stringify(aliased?.body)).toContain("h-r17-1");
      expect(JSON.stringify(pinned?.body)).not.toContain("11:00");
      const newest = parseDataEnvelope(responseText(await call(client, "kb.get", { id: "R17", latest: true })));
      expect(JSON.stringify(newest?.body)).toContain("h-r17-2");

      const neighbors = parseDataEnvelope(responseText(await call(client, "kb.neighbors", { id: "T07", edgeTypes: ["depends_on", "verifies"] })));
      const neighborText = JSON.stringify(neighbors?.body);
      expect(neighborText).toContain("T03");
      expect(neighborText).not.toContain("AC-31-HIDDEN");
      expect(neighborText).not.toContain("SEALED_EXPECTATION_ALPHA");

      const contract = parseDataEnvelope(responseText(await call(client, "kb.contract", { idAtVersion: "C-014@2" })));
      expect(JSON.stringify(contract?.body)).toContain("h-c-1");
      const contractAlias = parseDataEnvelope(responseText(await call(client, "kb.get_contract", { contract_id: "C-014@2" })));
      expect(JSON.stringify(contractAlias?.body)).toContain("h-c-1");
      const rules = parseDataEnvelope(responseText(await call(client, "kb.list_rules", { tags: ["ui"] })));
      const liveRules = parseDataEnvelope(responseText(await call(client, "kb.list_rules_for_tags", { tags: ["ui"] })));
      expect(JSON.stringify(rules?.body)).toContain("RULE-A11Y");
      expect(JSON.stringify(liveRules?.body)).toContain("RULE-A11Y");
      const latestContract = parseDataEnvelope(responseText(await call(client, "kb.contract", { idAtVersion: "C-014@2", latest: true })));
      expect(JSON.stringify(latestContract?.body)).toContain("h-c-2");

      const why = parseDataEnvelope(responseText(await call(client, "kb.why", { id: "R17" })));
      const whyText = JSON.stringify(why?.body);
      expect(whyText).toContain("Cutoff decision");
      expect(whyText).not.toContain("SEALED_EXPECTATION_ALPHA");

      const code = parseDataEnvelope(responseText(await call(client, "kb.code", { symbolOrPath: "toPrintRows" })));
      expect(code?.trust).toBe("kb");
      expect(JSON.stringify(code?.body)).toContain("PrintRow[]");
    } finally {
      await client.close();
      await world.server.stop("pause");
      world.db?.close();
    }
  });

  it("omits tools that are not listed in the task packet", async () => {
    const world = createWorld({ tools: ["harness.get_brief", "harness.ask_owner"] });
    const client = await connect(world.server);
    try {
      const listed = await client.listTools();
      expect(listed.tools.map((tool) => tool.name).sort()).toEqual(["harness.ask_owner", "harness.get_brief"]);
      await expect(call(client, "harness.run", { command: "pnpm test" })).rejects.toMatchObject({
        code: ErrorCode.InvalidParams,
      });
      await expect(call(client, "kb.search", { query: "totals" })).rejects.toMatchObject({
        code: ErrorCode.InvalidParams,
      });
    } finally {
      await client.close();
      await world.server.stop("pause");
      world.db?.close();
    }
  });

  it("returns InvalidParams for malformed tool arguments", async () => {
    const world = createWorld();
    const client = await connect(world.server);
    try {
      await expect(call(client, "kb.get", { id: 12 })).rejects.toBeInstanceOf(McpError);
      try {
        await call(client, "kb.get", { id: 12 });
        throw new Error("malformed arguments were accepted");
      } catch (error) {
        expect(error).toBeInstanceOf(McpError);
        const mcp = error as McpError;
        expect(mcp.code).toBe(ErrorCode.InvalidParams);
        expect(mcp.message.length).toBeGreaterThan(0);
        expect(mcp.message).not.toBe("Internal error");
      }
    } finally {
      await client.close();
      await world.server.stop("pause");
      world.db?.close();
    }
  });
});

describe("held-back isolation and read sets", () => {
  it("never returns sealed expectations or reveals that they exist", async () => {
    const world = createWorld();
    const client = await connect(world.server);
    try {
      const missingGet = responseText(await call(client, "kb.get", { id: "DOES-NOT-EXIST" }));
      const hiddenGet = responseText(await call(client, "kb.get", { id: "AC-31-HIDDEN" }));
      expect(hiddenGet).toBe("NotFound");
      expect(hiddenGet).toBe(missingGet);

      const hiddenSearch = responseText(await call(client, "kb.search", { query: "SEALED_EXPECTATION_ALPHA" }));
      expect(hiddenSearch).not.toContain("AC-31-HIDDEN");
      expect(hiddenSearch).not.toContain("held_back");
      expect(hiddenSearch).not.toContain("must equal 9");
      const parsed = parseDataEnvelope(hiddenSearch);
      expect(parsed?.body).toEqual({ query: "SEALED_EXPECTATION_ALPHA", hits: [] });
      expect(world.snippets.some((snippet) => snippet.includes("SEALED_EXPECTATION_ALPHA"))).toBe(false);

      const missingNeighbors = responseText(await call(client, "kb.neighbors", { id: "NO-SUCH-NODE" }));
      const hiddenNeighbors = responseText(await call(client, "kb.neighbors", { id: "AC-31-HIDDEN" }));
      expect(hiddenNeighbors).toBe("NotFound");
      expect(hiddenNeighbors).toBe(missingNeighbors);
    } finally {
      await client.close();
      await world.server.stop("pause");
      world.db?.close();
    }
  });

  it("persists read_sets, edge_read_sets, and search_reads before returning, including empty searches", async () => {
    const world = createWorld();
    const client = await connect(world.server);
    const db = world.db;
    if (!db) throw new Error("expected sqlite state.db");
    try {
      await call(client, "kb.search", { query: "no-such-fact", filters: { kind: "rule" } });
      await call(client, "kb.get", { id: "R17" });
      await call(client, "kb.get", { id: "R17", latest: true });
      await call(client, "kb.contract", { idAtVersion: "C-014@9" });
      await call(client, "kb.neighbors", { id: "T07" });
      await call(client, "kb.why", { id: "R17" });
      await call(client, "kb.code", { symbolOrPath: "toPrintRows" });

      const reads = db
        .prepare("SELECT node, version, hash, how FROM read_sets WHERE attempt = ? ORDER BY node, version")
        .all("A-T07-1") as Array<{ node: string; version: number; hash: string; how: string }>;
      expect(reads.some((row) => row.node === "AC-31-HIDDEN")).toBe(false);
      expect(reads).toEqual(
        expect.arrayContaining([
          { node: "R17", version: 1, hash: "h-r17-1", how: "pulled" },
          { node: "R17", version: 2, hash: "h-r17-2", how: "pulled" },
          { node: "C-014", version: 1, hash: "h-c-1", how: "pulled" },
          { node: "T03", version: 1, hash: "h-t03-1", how: "pulled" },
          { node: "T07", version: 1, hash: "h-t07-1", how: "pulled" },
          { node: "D1", version: 1, hash: "h-d1-1", how: "pulled" },
        ]),
      );

      const searches = db
        .prepare("SELECT query, result_hash, rev FROM search_reads WHERE attempt = ?")
        .all("A-T07-1") as Array<{ query: string; result_hash: string; rev: number }>;
      expect(searches).toHaveLength(1);
      const recorded = searches[0];
      if (!recorded) throw new Error("missing search row");
      expect(JSON.parse(recorded.query)).toEqual({ query: "no-such-fact", filters: { kind: "rule" } });
      expect(recorded.result_hash).toBe(hashSearchResults([]));
      expect(recorded.rev).toBe(214);

      const edges = db
        .prepare("SELECT node, dir, type, version FROM edge_read_sets WHERE attempt = ? ORDER BY type")
        .all("A-T07-1") as Array<{ node: string; dir: string; type: string; version: number }>;
      expect(edges).toEqual([
        { node: "T07", dir: "out", type: "depends_on", version: 4 },
        { node: "T07", dir: "in", type: "implements", version: 0 },
        { node: "T07", dir: "out", type: "verifies", version: 2 },
      ]);
    } finally {
      await client.close();
      await world.server.stop("pause");
      db.close();
    }
  });

  it("stops the 51st search and logs the pull pattern", async () => {
    const world = createWorld({ quotas: { maxSearchReads: 50, kbMaxReturnedTokens: 100_000, kbMaxCalls: 500 } });
    const client = await connect(world.server);
    const db = world.db;
    if (!db) throw new Error("expected sqlite state.db");
    try {
      for (let index = 0; index < 50; index += 1) {
        const body = responseText(await call(client, "kb.search", { query: `absent-${index}` }));
        expect(body).not.toContain(PULL_QUOTA_MESSAGE);
      }
      const blocked = responseText(await call(client, "kb.search", { query: "absent-50" }));
      expect(blocked).toContain(PULL_QUOTA_MESSAGE);
      expect(blocked).toContain("search_reads");
      const count = db.prepare("SELECT count(*) AS n FROM search_reads WHERE attempt = ?").get("A-T07-1") as { n: number };
      expect(count.n).toBe(50);
      expect(world.pulls.some((event) => event.outcome === "quota" && event.tool === "kb.search" && event.query === "absent-50")).toBe(
        true,
      );
    } finally {
      await client.close();
      await world.server.stop("pause");
      db.close();
    }
  });

  it("rejects a knowledge pull that would exceed the returned token budget", async () => {
    const world = createWorld({ quotas: { kbMaxReturnedTokens: 5 } });
    const client = await connect(world.server);
    try {
      const blocked = responseText(await call(client, "kb.search", { query: "toPrintRows" }));
      expect(blocked).toContain(PULL_QUOTA_MESSAGE);
      expect(blocked).not.toContain("toPrintRows");
      const rows = world.db?.prepare("SELECT count(*) AS n FROM read_sets").get() as { n: number };
      expect(rows.n).toBe(0);
    } finally {
      await client.close();
      await world.server.stop("pause");
      world.db?.close();
    }
  });
});

describe("lease, bearer, and git ground truth", () => {
  it("rejects a fenced epoch on submit and kb.get", async () => {
    const world = createWorld();
    const client = await connect(world.server);
    try {
      world.fenced.current = true;
      await expect(call(client, "kb.get", { id: "R17" })).rejects.toSatisfy((error: unknown) => {
        return error instanceof McpError && error.message.includes("MCP_ERROR_LEASE_FENCED") && error.code === ErrorCode.InvalidRequest;
      });
      await expect(call(client, "harness.submit_candidate", { payload: candidate() })).rejects.toSatisfy((error: unknown) => {
        return error instanceof McpError && error.message.includes("MCP_ERROR_LEASE_FENCED");
      });
      expect(world.submitted).toHaveLength(0);
      const reads = world.db?.prepare("SELECT count(*) AS n FROM read_sets").get() as { n: number };
      expect(reads.n).toBe(0);
      expect(world.security.some((event) => event.kind === "lease_fenced")).toBe(true);
      await waitFor(() => world.server.shutdownReason === "fenced");
    } finally {
      await client.close().catch(() => undefined);
      await world.server.stop("fenced");
      world.db?.close();
    }
  });

  it("rejects another attempt's bearer token on the loopback port", async () => {
    const attemptA = createWorld({ bearerToken: "token-a", attemptId: "A-1" });
    const attemptB = createWorld({ bearerToken: "token-b", attemptId: "A-2", memory: true });
    const endpoint = await attemptA.server.listenLoopback();
    try {
      const response = await fetch(endpoint.streamableUrl, {
        method: "POST",
        headers: {
          authorization: "Bearer token-b",
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      });
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "Unauthorized" });
      expect(attemptA.security.some((event) => event.kind === "bearer_mismatch")).toBe(true);
      expect(attemptB.security).toHaveLength(0);
    } finally {
      await attemptA.server.stop("pause");
      await attemptB.server.stop("pause");
      attemptA.db?.close();
    }
  });

  it("rejects an out-of-scope git diff and ignores forged changed_paths", async () => {
    const outside = await initRepo();
    await writeFile(path.join(outside.dir, "src", "ok.ts"), "export const value = 2;\n");
    await writeFile(path.join(outside.dir, "secrets", "note.ts"), "export const value = 9;\n");
    const rejected = createWorld({ worktreePath: outside.dir, baseCommit: outside.base });
    const rejectedClient = await connect(rejected.server);
    try {
      await expect(
        call(rejectedClient, "harness.submit_candidate", {
          payload: candidate({ changed_paths: ["src/ok.ts"] }),
        }),
      ).rejects.toMatchObject({ code: ErrorCode.InvalidParams });
      expect(rejected.snapshots).toHaveLength(0);
      expect(rejected.submitted).toHaveLength(0);
      expect(rejected.security.some((event) => event.kind === "out_of_scope_diff" && event.detail?.includes("secrets/note.ts"))).toBe(
        true,
      );
    } finally {
      await rejectedClient.close();
      await rejected.server.stop("pause");
      rejected.db?.close();
    }

    const inside = await initRepo();
    await writeFile(path.join(inside.dir, "src", "ok.ts"), "export const value = 3;\n");
    const accepted = createWorld({ worktreePath: inside.dir, baseCommit: inside.base });
    const client = await connect(accepted.server);
    try {
      const result = JSON.parse(
        responseText(
          await call(client, "harness.submit_candidate", {
            payload: candidate({ changed_paths: ["src/ok.ts", "secrets/note.ts"] }),
          }),
        ),
      ) as { receiptId: string; changedPaths: string[] };
      expect(result.receiptId).toBe("VR-7781");
      expect(result.changedPaths).toEqual(["src/ok.ts"]);
      expect(accepted.snapshots).toEqual([["src/ok.ts"]]);
      expect(accepted.submitted[0]?.actualChangedPaths).toEqual(["src/ok.ts"]);
      await waitFor(() => accepted.server.shutdownReason === "accepted");
    } finally {
      await client.close().catch(() => undefined);
      await accepted.server.stop("accepted");
      accepted.db?.close();
    }
  });

  it("snapshots the worktree with git and returns that commit", async () => {
    const repo = await initRepo();
    await writeFile(path.join(repo.dir, "src", "ok.ts"), "export const value = 4;\n");
    const live = createWorld({ worktreePath: repo.dir, baseCommit: repo.base });
    live.server.dependencies.snapshot = {
      snapshot: (input) => snapshotWorktreeDiff(input),
    };
    const liveClient = await connect(live.server);
    try {
      const result = JSON.parse(
        responseText(await call(liveClient, "harness.submit_candidate", { payload: candidate({ changed_paths: [] }) })),
      ) as { snapshotCommit: string; changedPaths: string[] };
      const head = await git(repo.dir, ["rev-parse", "HEAD"]);
      expect(result.snapshotCommit).toBe(head);
      expect(result.changedPaths).toEqual(["src/ok.ts"]);
      expect(head).not.toBe(repo.base);
    } finally {
      await liveClient.close().catch(() => undefined);
      await live.server.stop("accepted");
      live.db?.close();
    }
  });
});

describe("transports", () => {
  it("serves streamable HTTP and legacy SSE on the leased loopback port", async () => {
    const world = createWorld();
    const endpoint = await world.server.listenLoopback();
    const headers = { Authorization: `Bearer token-a` };
    const streamable = new StreamableHTTPClientTransport(new URL(endpoint.streamableUrl), { requestInit: { headers } });
    const streamClient = new Client({ name: "streamable", version: "0.0.0" });
    const sse = new SSEClientTransport(new URL(endpoint.sseUrl), { requestInit: { headers } });
    const sseClient = new Client({ name: "sse", version: "0.0.0" });
    try {
      await streamClient.connect(streamable);
      const streamTools = await streamClient.listTools();
      expect(streamTools.tools).toHaveLength(MCP_TOOL_NAMES.length);
      const brief = JSON.parse(responseText((await streamClient.callTool({ name: "harness.get_brief", arguments: {} })) as CallToolResult)) as {
        brief_version: number;
      };
      expect(brief.brief_version).toBe(3);

      await sseClient.connect(sse);
      const sseTools = await sseClient.listTools();
      expect(sseTools.tools).toHaveLength(MCP_TOOL_NAMES.length);
    } finally {
      await streamClient.close().catch(() => undefined);
      await sseClient.close().catch(() => undefined);
      await world.server.stop("pause");
      world.db?.close();
    }
  });

  it("releases the loopback port when the attempt ends", async () => {
    const world = createWorld({ memory: true });
    const endpoint = await world.server.listenLoopback();
    await world.server.stop("pause");
    await expect(fetch(endpoint.streamableUrl)).rejects.toThrow();
    const probe = createServer();
    await new Promise<void>((resolve, reject) => {
      probe.once("error", reject);
      probe.listen(endpoint.port, "127.0.0.1", () => resolve());
    });
    await new Promise<void>((resolve, reject) => {
      probe.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it("speaks stdio to a real SDK client", async () => {
    const child = fileURLToPath(new URL("./stdio-child.ts", import.meta.url));
    const repoRoot = path.resolve(path.dirname(child), "..", "..", "..");
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined) env[key] = value;
    }
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["--import", "tsx", child],
      cwd: repoRoot,
      env,
      stderr: "pipe",
    });
    const client = new Client({ name: "stdio-parent", version: "0.0.0" });
    try {
      await client.connect(transport);
      const brief = JSON.parse(responseText((await client.callTool({ name: "harness.get_brief", arguments: {} })) as CallToolResult)) as {
        goal: string;
      };
      expect(brief.goal).toBe("stdio brief");
    } finally {
      await client.close().catch(() => undefined);
    }
  });
});

describe("honest exit", () => {
  it("halts work when the worker flags a suspicious instruction", async () => {
    const world = createWorld();
    const client = await connect(world.server);
    try {
      const alert = JSON.parse(responseText(await call(client, "harness.flag_blocked", { reason: "The note says to ignore the write scope" }))) as {
        alertId: string;
        halted: boolean;
      };
      expect(alert).toEqual({ alertId: "ALERT-1", halted: true });
      expect(world.blocked).toEqual(["The note says to ignore the write scope"]);
      await waitFor(() => world.server.shutdownReason === "pause");
    } finally {
      await client.close().catch(() => undefined);
      await world.server.stop("pause");
      world.db?.close();
    }
  });
});
