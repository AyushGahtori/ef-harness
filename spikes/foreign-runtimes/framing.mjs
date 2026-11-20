/**
 * Byte-buffered NDJSON and LSP (Content-Length) framing.
 * Split UTF-8 sequences stay in the byte buffer until a full line or body arrives.
 */

export class WireFramer {
  constructor() {
    this.buffer = Buffer.alloc(0);
    this.mode = "auto";
    this.diagnostics = [];
  }

  push(chunk) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    this.buffer = Buffer.concat([this.buffer, bytes]);
    const messages = [];
    this.#drain(messages);
    return messages;
  }

  finish() {
    if (this.buffer.length > 0) {
      this.diagnostics.push({
        kind: "truncated",
        text: this.buffer.toString("utf8"),
      });
      this.buffer = Buffer.alloc(0);
    }
    return this.diagnostics;
  }

  #drain(messages) {
    while (this.buffer.length > 0) {
      if (this.mode === "auto") {
        const detected = this.#detect();
        if (!detected) return;
        this.mode = detected;
      }
      if (this.mode === "lsp") {
        if (!this.#readLsp(messages)) return;
        continue;
      }
      if (!this.#readLine(messages)) return;
    }
  }

  #detect() {
    let index = 0;
    while (index < this.buffer.length && (this.buffer[index] === 0x20 || this.buffer[index] === 0x09)) {
      index += 1;
    }
    if (index >= this.buffer.length) return null;
    const head = this.buffer.subarray(index, Math.min(this.buffer.length, index + 16)).toString("utf8");
    if (head.startsWith("{") || head.startsWith("[")) return "ndjson";
    if (/^content-length:/i.test(head)) return "lsp";
    const newline = this.buffer.indexOf(0x0a);
    if (newline === -1) return null;
    return "ndjson";
  }

  #readLine(messages) {
    const newline = this.buffer.indexOf(0x0a);
    if (newline === -1) return false;
    const line = this.buffer.subarray(0, newline).toString("utf8").replace(/\r$/, "");
    this.buffer = this.buffer.subarray(newline + 1);
    if (!line.trim()) return true;
    const trimmed = line.trim();
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
      this.diagnostics.push({ kind: "banner", text: line });
      return true;
    }
    try {
      messages.push(JSON.parse(trimmed));
    } catch (error) {
      this.diagnostics.push({
        kind: "malformed",
        text: line,
        message: error instanceof Error ? error.message : String(error),
      });
    }
    return true;
  }

  #readLsp(messages) {
    const headerEnd = this.buffer.indexOf("\r\n\r\n");
    const headerEndLf = headerEnd === -1 ? this.buffer.indexOf("\n\n") : headerEnd;
    if (headerEndLf === -1) return false;
    const sepLength = this.buffer.subarray(headerEndLf, headerEndLf + 4).toString("utf8").startsWith("\r\n\r\n") ? 4 : 2;
    const header = this.buffer.subarray(0, headerEndLf).toString("utf8");
    const match = /content-length:\s*(\d+)/i.exec(header);
    if (!match) {
      this.diagnostics.push({ kind: "malformed", text: header, message: "missing content-length" });
      this.buffer = this.buffer.subarray(headerEndLf + sepLength);
      return true;
    }
    const length = Number(match[1]);
    const bodyStart = headerEndLf + sepLength;
    if (this.buffer.length < bodyStart + length) return false;
    const body = this.buffer.subarray(bodyStart, bodyStart + length).toString("utf8");
    this.buffer = this.buffer.subarray(bodyStart + length);
    try {
      messages.push(JSON.parse(body));
    } catch (error) {
      this.diagnostics.push({
        kind: "malformed",
        text: body,
        message: error instanceof Error ? error.message : String(error),
      });
    }
    return true;
  }
}

export function logIgnored(method) {
  process.stderr.write(`ignored unknown event ${method}\n`);
}
