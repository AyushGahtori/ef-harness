import { WireFramer, logIgnored } from "./framing.mjs";

export class RpcPeer {
  constructor(input, output, options = {}) {
    this.output = output;
    this.style = options.style === "codex" ? "codex" : "jsonrpc";
    this.chunked = options.chunked === true;
    this.pending = new Map();
    this.nextId = 1;
    this.framer = new WireFramer();
    this.chain = Promise.resolve();
    this.onMessage = async () => {};
    input.on("data", (chunk) => {
      const messages = this.framer.push(chunk);
      for (const message of messages) {
        this.chain = this.chain.then(() => this.#dispatch(message)).catch((error) => {
          process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        });
      }
    });
    input.on("end", () => {
      this.chain = this.chain.then(() => this.#failPending("abrupt_exit", "child stdout closed"));
    });
    input.on("error", (error) => {
      this.chain = this.chain.then(() => this.#failPending("abrupt_exit", error.message));
    });
  }

  send(message) {
    const payload = this.style === "codex" ? stripJsonRpc(message) : { jsonrpc: "2.0", ...message };
    const line = Buffer.from(`${JSON.stringify(payload)}\n`);
    if (!this.chunked) {
      this.output.write(line);
      return;
    }
    for (let index = 0; index < line.length; index += 3) {
      this.output.write(line.subarray(index, index + 3));
    }
  }

  notify(method, params) {
    this.send({ method, params });
  }

  respond(id, result) {
    this.send({ id, result });
  }

  fail(id, code, message) {
    this.send({ id, error: { code, message } });
  }

  request(method, params) {
    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.send({ id, method, params });
    });
  }

  async #dispatch(message) {
    if (!message || typeof message !== "object") return;
    if (message.id !== undefined && message.method === undefined) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) {
        const error = new Error(message.error.message ?? "rpc error");
        error.code = "rpc_error";
        pending.reject(error);
        return;
      }
      pending.resolve(message.result);
      return;
    }
    if (typeof message.method === "string" && message.id === undefined) {
      const normalized = await this.onMessage(message);
      if (normalized?.type === "ignored") logIgnored(normalized.method);
      return;
    }
    await this.onMessage(message);
  }

  #failPending(code, message) {
    const error = new Error(message);
    error.code = code;
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}

function stripJsonRpc(message) {
  const copy = { ...message };
  delete copy.jsonrpc;
  return copy;
}
