import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createHash } from "node:crypto";

export interface MockVercelState {
  readonly envs: Map<string, { digest: string; target: string }>;
  readonly deployments: Array<{
    id: string;
    url: string;
    effectId: string;
    commitSha: string;
    state: string;
    buildId: string;
  }>;
}

export async function startMockVercelServer(port = 0): Promise<{
  readonly baseUrl: string;
  readonly state: MockVercelState;
  close(): Promise<void>;
}> {
  const state: MockVercelState = {
    envs: new Map(),
    deployments: [],
  };

  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/v2/user") {
      json(res, 200, { user: { username: "ef-test" } });
      return;
    }
    if (url.pathname.startsWith("/v9/projects/") && url.pathname.endsWith("/env")) {
      const envs = [...state.envs.entries()].map(([key, value]) => ({
        key,
        valueDigest: value.digest,
        target: value.target,
      }));
      json(res, 200, { envs });
      return;
    }
    if (url.pathname === "/v10/projects/demo/env" && req.method === "POST") {
      readBody(req).then((body) => {
        const payload = JSON.parse(body) as { key: string; value: string; target: string[] };
        state.envs.set(payload.key, {
          digest: createHash("sha256").update(payload.value).digest("hex"),
          target: payload.target[0] ?? "preview",
        });
        json(res, 200, { ok: true });
      });
      return;
    }
    if (req.method === "DELETE" && url.pathname.startsWith("/v10/projects/demo/env/")) {
      const key = decodeURIComponent(url.pathname.split("/").pop() ?? "");
      state.envs.delete(key);
      json(res, 200, { ok: true });
      return;
    }
    if (url.pathname === "/v13/deployments" && req.method === "POST") {
      readBody(req).then((body) => {
        const payload = JSON.parse(body) as {
          target?: string;
          meta?: { githubCommitSha?: string; "EF-Effect-Id"?: string };
        };
        const id = `dpl_${state.deployments.length + 1}`;
        state.deployments.push({
          id,
          url: `${id}.vercel.app`,
          effectId: payload.meta?.["EF-Effect-Id"] ?? "",
          commitSha: payload.meta?.githubCommitSha ?? "",
          state: "READY",
          buildId: (payload.meta?.githubCommitSha ?? "build").slice(0, 12),
        });
        json(res, 200, {
          id,
          url: `${id}.vercel.app`,
          buildId: (payload.meta?.githubCommitSha ?? "build").slice(0, 12),
          previousDeploymentId: state.deployments.at(-2)?.id ?? null,
        });
      });
      return;
    }
    if (url.pathname === "/v6/deployments") {
      const effectId = url.searchParams.get("meta-EF-Effect-Id") ?? "";
      const commitSha = url.searchParams.get("meta-githubCommitSha") ?? "";
      const match = state.deployments.find(
        (item) => item.effectId === effectId && item.commitSha === commitSha,
      );
      json(res, 200, {
        deployments: match
          ? [{ uid: match.id, url: match.url, state: match.state, meta: { buildId: match.buildId } }]
          : [],
      });
      return;
    }
    if (url.pathname.startsWith("/v9/projects/demo/rollback/") && req.method === "POST") {
      const id = url.pathname.split("/").pop() ?? "";
      json(res, 200, { url: `${id}.vercel.app` });
      return;
    }
    json(res, 404, { error: "not_found" });
  });

  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  const address = server.address();
  const listenPort = typeof address === "object" && address ? address.port : port;
  return {
    baseUrl: `http://127.0.0.1:${listenPort}`,
    state,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}