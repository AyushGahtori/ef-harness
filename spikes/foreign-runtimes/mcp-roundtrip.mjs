import net from "node:net";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMiniMcpServer, listenLoopback, loopbackTransport } from "./mini-mcp.mjs";

const serverPath = fileURLToPath(new URL("./mini-mcp.mjs", import.meta.url));

async function callAll(client) {
  const listed = await client.listTools();
  const names = listed.tools.map((tool) => tool.name).sort();
  const brief = await client.callTool({ name: "harness.get_brief", arguments: {} });
  const owner = await client.callTool({
    name: "harness.ask_owner",
    arguments: { question: "Should zero-quantity rows be dropped?", criterionId: "R31" },
  });
  const candidate = await client.callTool({
    name: "harness.submit_candidate",
    arguments: { note: "in-scope edit", changedPaths: ["src/in-scope.txt"] },
  });
  return {
    names,
    brief: textOf(brief),
    owner: textOf(owner),
    candidate: textOf(candidate),
  };
}

function textOf(result) {
  const block = result.content?.find((item) => item.type === "text");
  return block && "text" in block ? JSON.parse(block.text) : null;
}

async function loopbackPair() {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const { server } = createMiniMcpServer();
  await server.connect(serverTransport);
  const client = new Client({ name: "harness-mini-client", version: "0.0.0" });
  await client.connect(clientTransport);
  try {
    return await callAll(client);
  } finally {
    await client.close();
  }
}

async function stdioPair() {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
    stderr: "pipe",
  });
  const client = new Client({ name: "harness-mini-client", version: "0.0.0" });
  await client.connect(transport);
  try {
    return await callAll(client);
  } finally {
    await client.close();
  }
}

async function tcpPair() {
  const { server } = createMiniMcpServer();
  const listener = await listenLoopback(server);
  const socket = net.connect({ host: "127.0.0.1", port: listener.port });
  await new Promise((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("error", reject);
  });
  const client = new Client({ name: "harness-mini-client", version: "0.0.0" });
  await client.connect(loopbackTransport(socket));
  try {
    return await callAll(client);
  } finally {
    await client.close();
    await listener.close();
  }
}

const [memory, stdio, tcp] = await Promise.all([loopbackPair(), stdioPair(), tcpPair()]);
process.stdout.write(`${JSON.stringify({ ok: true, memory, stdio, tcp })}\n`);
