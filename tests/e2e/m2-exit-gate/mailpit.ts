import http from "node:http";

export interface MailMessage {
  ID: string;
  Subject: string;
  Text: string;
  To: string[];
}

export class MailpitProvider {
  private readonly messages: MailMessage[] = [];
  private server: http.Server | null = null;
  private sequence = 0;

  constructor(private readonly port: number) {}

  get url(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  start(): Promise<void> {
    this.server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", this.url);
      if (req.method === "POST" && url.pathname === "/api/v1/send") {
        const chunks: Buffer[] = [];
        req.on("data", (chunk: Buffer) => chunks.push(chunk));
        req.on("end", () => {
          const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
            Subject?: string;
            Text?: string;
            To?: { Email?: string }[];
          };
          this.sequence += 1;
          this.messages.push({
            ID: `mp-${this.sequence}`,
            Subject: body.Subject ?? "",
            Text: body.Text ?? "",
            To: (body.To ?? []).map((item) => item.Email ?? ""),
          });
          const payload = JSON.stringify({ ID: `mp-${this.sequence}` });
          res.writeHead(200, { "content-type": "application/json" });
          res.end(payload);
        });
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/v1/messages") {
        const payload = JSON.stringify({ messages_count: this.messages.length, messages: this.messages });
        res.writeHead(200, { "content-type": "application/json" });
        res.end(payload);
        return;
      }
      if (req.method === "DELETE" && url.pathname === "/api/v1/messages") {
        this.messages.splice(0, this.messages.length);
        res.writeHead(200, { "content-type": "application/json" });
        res.end("{}");
        return;
      }
      res.writeHead(404, { "content-type": "application/json" });
      res.end("{\"error\":\"not_found\"}");
    });
    return new Promise((resolve, reject) => {
      this.server?.once("error", reject);
      this.server?.listen(this.port, "127.0.0.1", () => resolve());
    });
  }

  stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    if (!server) return Promise.resolve();
    return new Promise((resolve) => {
      server.close(() => resolve());
    });
  }
}
