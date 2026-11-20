import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createServer as createTcpServer, type Server, type Socket } from "node:net";
import { randomUUID } from "node:crypto";
import { LOOPBACK_HOST, MAILPIT_ROUTES } from "./constants.ts";
import { messageMatchesQuery } from "./mail-client.ts";
import { assertLoopbackHost, assertPortInRange } from "./ports.ts";

interface StoredMail {
  ID: string;
  Subject: string;
  To: Array<{ Name: string; Address: string }>;
  Snippet: string;
  to: string;
  subject: string;
  body: string;
}

export class InProcessMailpit {
  readonly host = LOOPBACK_HOST;
  private readonly smtp: Server;
  private readonly messages: StoredMail[] = [];
  private http: ReturnType<typeof createHttpServer> | undefined;

  readonly smtpPort: number;
  readonly httpPort: number;

  private constructor(smtp: Server, smtpPort: number, httpPort: number) {
    this.smtp = smtp;
    this.smtpPort = smtpPort;
    this.httpPort = httpPort;
  }

  static async start(smtpPort: number, httpPort: number): Promise<InProcessMailpit> {
    assertPortInRange(smtpPort);
    assertPortInRange(httpPort);
    assertLoopbackHost(LOOPBACK_HOST);
    const mail = new InProcessMailpit(createTcpServer(), smtpPort, httpPort);
    mail.smtp.on("connection", (socket) => mail.handleSmtp(socket));
    await listen(mail.smtp, smtpPort);
    mail.http = createHttpServer((request, response) => mail.handleHttp(request, response));
    await new Promise<void>((resolve, reject) => {
      mail.http?.once("error", reject);
      mail.http?.listen(httpPort, LOOPBACK_HOST, () => {
        mail.http?.off("error", reject);
        resolve();
      });
    });
    return mail;
  }

  async stop(): Promise<void> {
    await closeTcp(this.smtp);
    if (this.http) {
      const http = this.http;
      await new Promise<void>((resolve) => http.close(() => resolve()));
    }
  }

  private handleSmtp(socket: Socket): void {
    socket.setEncoding("utf8");
    let buffer = "";
    let dataMode = false;
    const data: string[] = [];
    let to = "";
    socket.write("220 spike.mailpit.local ESMTP ready\r\n");
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      while (buffer.includes("\n")) {
        const index = buffer.indexOf("\n");
        const line = buffer.slice(0, index).replace(/\r$/, "");
        buffer = buffer.slice(index + 1);
        if (dataMode) {
          if (line === ".") {
            dataMode = false;
            this.store(to, data.join("\n"));
            socket.write("250 queued\r\n");
            data.length = 0;
          } else {
            data.push(line);
          }
          continue;
        }
        const upper = line.toUpperCase();
        if (upper.startsWith("EHLO") || upper.startsWith("HELO")) socket.write("250 OK\r\n");
        else if (upper.startsWith("MAIL FROM:")) socket.write("250 OK\r\n");
        else if (upper.startsWith("RCPT TO:")) {
          to = line.slice(line.indexOf(":") + 1).trim().replace(/^</, "").replace(/>$/, "");
          socket.write("250 OK\r\n");
        } else if (upper === "DATA") {
          dataMode = true;
          socket.write("354 start mail input\r\n");
        } else if (upper === "QUIT") {
          socket.write("221 bye\r\n");
          socket.end();
        } else if (upper === "RSET") {
          to = "";
          socket.write("250 OK\r\n");
        } else socket.write("250 OK\r\n");
      }
    });
  }

  private store(to: string, raw: string): void {
    const subject = /^Subject:\s*(.*)$/im.exec(raw)?.[1]?.trim() ?? "";
    const headerEnd = raw.indexOf("\n\n");
    const body = headerEnd >= 0 ? raw.slice(headerEnd + 2).trim() : raw.trim();
    this.messages.push({
      ID: randomUUID(),
      Subject: subject,
      To: [{ Name: "", Address: to }],
      Snippet: body.slice(0, 160),
      to,
      subject,
      body,
    });
  }

  private handleHttp(request: IncomingMessage, response: ServerResponse): void {
    const url = new URL(request.url ?? "/", `http://${LOOPBACK_HOST}`);
    if (url.pathname === MAILPIT_ROUTES.info) {
      sendJson(response, 200, { Version: "spike-fake", Database: this.messages.length });
      return;
    }
    if (url.pathname === MAILPIT_ROUTES.search) {
      const query = url.searchParams.get("query") ?? "";
      const messages = this.messages.filter((message) => messageMatchesQuery(message, query));
      sendJson(response, 200, {
        total: messages.length,
        unread: messages.length,
        count: messages.length,
        messages_count: messages.length,
        start: 0,
        messages: messages.map(({ ID, Subject, To, Snippet }) => ({ ID, Subject, To, Snippet })),
      });
      return;
    }
    sendJson(response, 404, { error: "not found" });
  }
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload),
  });
  response.end(payload);
}

function listen(server: Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, LOOPBACK_HOST, () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function closeTcp(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}
