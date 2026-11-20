import net from "node:net";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { WireFramer } from "./framing.mjs";

const defaultBrief = {
  task: "T06",
  writeScope: ["src/**"],
  must: ["call harness.submit_candidate when the in-scope edit is done"],
};

function loadBrief(explicit) {
  if (explicit) return explicit;
  const raw = process.env.HARNESS_BRIEF_JSON;
  if (!raw) return defaultBrief;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("brief must be an object");
    }
    return parsed;
  } catch (error) {
    process.stderr.write(`rejected brief: ${error instanceof Error ? error.message : String(error)}\n`);
    return defaultBrief;
  }
}

function textResult(payload) {
  return { content: [{ type: "text", text: JSON.stringify(payload) }] };
}

export function createMiniMcpServer(options = {}) {
  const brief = loadBrief(options.brief);
  const ledger = [];
  const server = new McpServer(
    { name: "harness-mini", version: "0.0.0" },
    { instructions: "Scratch harness tools for foreign runtime probes." },
  );
  server.registerTool(
    "harness.get_brief",
    {
      description: "Return the current task brief and pinned write scope.",
      inputSchema: z.object({}).strict(),
    },
    async () => {
      const payload = { schema: "brief", brief };
      ledger.push({ tool: "harness.get_brief", payload });
      process.stderr.write("mcp harness.get_brief\n");
      return textResult(payload);
    },
  );
  server.registerTool(
    "harness.ask_owner",
    {
      description: "Record a question for the task author. The spike answers without a model call.",
      inputSchema: z.object({
        question: z.string().min(1).max(4000),
        criterionId: z.string().min(1).max(200).optional(),
      }).strict(),
    },
    async (args) => {
      const payload = {
        schema: "owner-answer",
        question: args.question,
        criterionId: args.criterionId ?? null,
        answer: "recorded-for-the-task-author",
      };
      ledger.push({ tool: "harness.ask_owner", payload });
      process.stderr.write("mcp harness.ask_owner\n");
      return textResult(payload);
    },
  );
  server.registerTool(
    "harness.submit_candidate",
    {
      description: "Signal that the attempt is ready for diff snapshot and verification.",
      inputSchema: z.object({
        note: z.string().max(4000).optional(),
        changedPaths: z.array(z.string().min(1).max(2000)).max(200).optional(),
      }).strict(),
    },
    async (args) => {
      const payload = {
        schema: "candidate-receipt",
        accepted: true,
        note: args.note ?? "",
        changedPaths: args.changedPaths ?? [],
      };
      ledger.push({ tool: "harness.submit_candidate", payload });
      process.stderr.write("mcp harness.submit_candidate\n");
      return textResult(payload);
    },
  );
  return { server, ledger, brief };
}

export function loopbackTransport(socket) {
  const framer = new WireFramer();
  return {
    async start() {
      socket.on("data", (chunk) => {
        try {
          for (const message of framer.push(chunk)) {
            this.onmessage?.(message);
          }
        } catch (error) {
          this.onerror?.(error instanceof Error ? error : new Error(String(error)));
        }
      });
      socket.on("error", (error) => {
        this.onerror?.(error);
      });
      socket.on("close", () => {
        this.onclose?.();
      });
    },
    async send(message) {
      socket.write(`${JSON.stringify(message)}\n`);
    },
    async close() {
      socket.end();
    },
  };
}

export function listenLoopback(server) {
  return new Promise((resolve, reject) => {
    const tcp = net.createServer((socket) => {
      const transport = loopbackTransport(socket);
      server.connect(transport).catch((error) => {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        socket.destroy();
      });
    });
    tcp.on("error", reject);
    tcp.listen(0, "127.0.0.1", () => {
      const address = tcp.address();
      const port = typeof address === "object" && address ? address.port : 0;
      process.stderr.write(`loopback-port: ${port}\n`);
      resolve({ port, close: () => tcp.close() });
    });
  });
}

async function main() {
  const { server } = createMiniMcpServer();
  if (process.argv.includes("--loopback")) {
    await listenLoopback(server);
    return;
  }
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

const entry = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (entry && import.meta.url === entry) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
