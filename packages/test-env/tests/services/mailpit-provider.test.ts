import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import {
  JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE_NAME,
  MailpitProvider,
  mailpitRecipientDomain,
  type JobHandle,
  type MailpitLaunchRequest,
  type MailpitLauncher,
  type MailpitRuntime,
} from "../../src/services/index.js";
import { envRequest, makeTemp, removeTemp } from "./helpers.js";

interface FixtureMessage {
  ID: string;
  Subject: string;
  To: { Name: string; Address: string }[];
}

function startMailpitFixture(ignoreQuery: boolean) {
  const messages: FixtureMessage[] = [];
  const queries: string[] = [];
  const deleted: string[][] = [];
  let globalDeletes = 0;
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/api/v1/search" && req.method === "GET") {
      const query = url.searchParams.get("query") ?? "";
      queries.push(query);
      const domain = query.startsWith("to:") ? query.slice(3) : "";
      const visible = ignoreQuery
        ? messages
        : messages.filter((message) => message.To.some((recipient) => recipient.Address.endsWith(domain)));
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ messages: visible }));
      return;
    }
    if (url.pathname === "/api/v1/messages" && req.method === "DELETE") {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { IDs?: string[] };
      const ids = body.IDs ?? [];
      if (ids.length === 0) globalDeletes += 1;
      deleted.push(ids);
      const doomed = new Set(ids);
      for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index];
        if (message && doomed.has(message.ID)) messages.splice(index, 1);
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{}");
      return;
    }
    res.writeHead(404);
    res.end();
  });
  return new Promise<{
    port: number;
    queries: string[];
    deleted: string[][];
    globalDeletes: () => number;
    add(message: FixtureMessage): void;
    close(): Promise<void>;
  }>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("mailpit fixture did not bind"));
        return;
      }
      resolve({
        port: address.port,
        queries,
        deleted,
        globalDeletes: () => globalDeletes,
        add(message) {
          messages.push(message);
        },
        close() {
          return new Promise((done, fail) => {
            server.close((error) => (error ? fail(error) : done()));
          });
        },
      });
    });
  });
}

class FixtureLauncher implements MailpitLauncher {
  calls = 0;
  readonly jobs: JobHandle[] = [];

  constructor(private readonly httpPort: number) {}

  async launch(request: MailpitLaunchRequest): Promise<MailpitRuntime> {
    this.calls += 1;
    this.jobs.push(request.job);
    return {
      pid: 60_000 + this.calls,
      smtpPort: request.smtpPort,
      httpPort: this.httpPort,
      stderr: () => "",
      onExit() {
        return undefined;
      },
      async stop() {
        return undefined;
      },
    };
  }
}

describe("MailpitProvider", () => {
  const dirs: string[] = [];
  const providers: MailpitProvider[] = [];
  const closers: Array<() => Promise<void>> = [];

  afterEach(async () => {
    for (const provider of providers) await provider.closeProject("project-a");
    providers.length = 0;
    for (const close of closers) await close();
    closers.length = 0;
    for (const dir of dirs) await removeTemp(dir);
    dirs.length = 0;
  });

  it("isolates 500 messages across 4 environments and deletes only one domain", async () => {
    const fixture = await startMailpitFixture(false);
    closers.push(() => fixture.close());
    const root = await makeTemp("mail-");
    dirs.push(root);
    const launcher = new FixtureLauncher(fixture.port);
    const provider = new MailpitProvider({ launcher, home: root, idleGraceMs: 0 });
    providers.push(provider);
    expect(mailpitRecipientDomain("env91")).toBe("@env91.test");
    expect(mailpitRecipientDomain("91")).toBe("@env91.test");
    const envIds = ["env91", "env92", "env93", "env94"];
    const counts = [200, 100, 100, 100];
    for (const [index, envId] of envIds.entries()) {
      const count = counts[index] ?? 0;
      for (let message = 0; message < count; message += 1) {
        fixture.add({
          ID: `${envId}-${message}`,
          Subject: `${envId} note ${message}`,
          To: [{ Name: "", Address: `person${message}@${envId}.test` }],
        });
      }
      await provider.create(envRequest(root, envId));
    }
    expect(launcher.calls).toBe(1);
    expect(launcher.jobs[0]?.killOnCloseFlag).toBe(JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE_NAME);
    const env91 = await provider.listMessagesForEnv("env91");
    expect(env91).toHaveLength(200);
    expect(fixture.queries.some((query) => query === "to:@env91.test")).toBe(true);
    expect(env91.every((message) => message.to.some((recipient) => recipient.address.endsWith("@env91.test")))).toBe(
      true,
    );
    const removed = await provider.clearMessagesForEnv("env91");
    expect(removed).toHaveLength(200);
    expect(fixture.deleted.flat()).toEqual(removed);
    expect(fixture.deleted.flat().some((id) => id.startsWith("env92"))).toBe(false);
    expect(fixture.globalDeletes()).toBe(0);
    expect(await provider.listMessagesForEnv("env92")).toHaveLength(100);
    expect(await provider.listMessagesForEnv("env91")).toHaveLength(0);
  });

  it("still filters to the env domain when the search API returns every message", async () => {
    const fixture = await startMailpitFixture(true);
    closers.push(() => fixture.close());
    const root = await makeTemp("mail-filter-");
    dirs.push(root);
    const provider = new MailpitProvider({
      launcher: new FixtureLauncher(fixture.port),
      home: root,
      idleGraceMs: 0,
    });
    providers.push(provider);
    fixture.add({ ID: "a", Subject: "one", To: [{ Name: "", Address: "a@env91.test" }] });
    fixture.add({ ID: "b", Subject: "two", To: [{ Name: "", Address: "b@env92.test" }] });
    await provider.create(envRequest(root, "env91"));
    await provider.create(envRequest(root, "env92"));
    const listed = await provider.listMessagesForEnv("env91");
    expect(listed.map((message) => message.id)).toEqual(["a"]);
    const removed = await provider.clearMessagesForEnv("env91");
    expect(removed).toEqual(["a"]);
    expect(fixture.globalDeletes()).toBe(0);
  });

  it("waits for a matching message without seeing another environment", async () => {
    const fixture = await startMailpitFixture(false);
    closers.push(() => fixture.close());
    const root = await makeTemp("mail-wait-");
    dirs.push(root);
    const provider = new MailpitProvider({
      launcher: new FixtureLauncher(fixture.port),
      home: root,
      idleGraceMs: 0,
      pollMs: 15,
    });
    providers.push(provider);
    await provider.create(envRequest(root, "env91"));
    setTimeout(() => {
      fixture.add({
        ID: "later",
        Subject: "order ready",
        To: [{ Name: "", Address: "kitchen@env91.test" }],
      });
    }, 30);
    const found = await provider.waitForMessage("env91", (message) => message.subject === "order ready", {
      timeoutMs: 1_000,
    });
    expect(found.id).toBe("later");
  });

  it("reports a missing Mailpit binary as a docker fallback hold", async () => {
    const root = await makeTemp("mail-missing-");
    dirs.push(root);
    const provider = new MailpitProvider({ home: root, idleGraceMs: 0 });
    providers.push(provider);
    await expect(provider.create(envRequest(root, "env91"))).rejects.toMatchObject({
      hint: "Offer Docker fallback",
      holdDependentTaskOnly: true,
    });
  });
});
