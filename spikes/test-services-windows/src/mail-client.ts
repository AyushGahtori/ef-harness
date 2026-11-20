import { connect } from "node:net";
import { LOOPBACK_HOST, MAILPIT_ROUTES } from "./constants.ts";
import { SpikeError } from "./errors.ts";

export interface MailAddress {
  Name: string;
  Address: string;
}

export interface MailSummary {
  ID: string;
  Subject: string;
  To: MailAddress[];
  Snippet: string;
}

export interface MailSearchResult {
  total: number;
  messages: MailSummary[];
}

export async function sendSmtp(options: {
  port: number;
  from: string;
  to: string;
  subject: string;
  body: string;
}): Promise<void> {
  const socket = connect({ host: LOOPBACK_HOST, port: options.port });
  const lines: string[] = [];
  let buffer = "";
  socket.setEncoding("utf8");
  socket.on("data", (chunk: string) => {
    buffer += chunk;
    while (buffer.includes("\n")) {
      const index = buffer.indexOf("\n");
      lines.push(buffer.slice(0, index).replace(/\r$/, ""));
      buffer = buffer.slice(index + 1);
    }
  });
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", () => resolve());
    socket.once("error", reject);
  });
  const read = async (): Promise<string> => {
    const deadline = Date.now() + 5000;
    while (lines.length === 0) {
      if (Date.now() > deadline) throw new SpikeError("smtp_timeout", "SMTP server did not reply.");
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return lines.shift() ?? "";
  };
  const expect = async (prefix: string): Promise<void> => {
    let line = await read();
    if (!line.startsWith(prefix)) {
      throw new SpikeError("smtp_rejected", `Expected ${prefix}, received ${line}`);
    }
    while (line.length >= 4 && line[3] === "-") {
      line = await read();
      if (!line.startsWith(prefix)) {
        throw new SpikeError("smtp_rejected", `Expected ${prefix}, received ${line}`);
      }
    }
  };
  const write = (line: string) => {
    socket.write(`${line}\r\n`);
  };
  await expect("220");
  write("EHLO spike.test");
  await expect("250");
  write(`MAIL FROM:<${options.from}>`);
  await expect("250");
  write(`RCPT TO:<${options.to}>`);
  await expect("250");
  write("DATA");
  await expect("354");
  write(`From: ${options.from}`);
  write(`To: ${options.to}`);
  write(`Subject: ${options.subject}`);
  write("");
  write(options.body);
  write(".");
  await expect("250");
  write("QUIT");
  socket.end();
}

export async function searchMail(httpPort: number, query: string): Promise<MailSearchResult> {
  const url = `http://${LOOPBACK_HOST}:${httpPort}${MAILPIT_ROUTES.search}?query=${encodeURIComponent(query)}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new SpikeError("mailpit_search_failed", `Mail search returned ${response.status} for ${query}.`);
  }
  const body = (await response.json()) as Partial<MailSearchResult>;
  return {
    total: body.total ?? body.messages?.length ?? 0,
    messages: body.messages ?? [],
  };
}

export function messageMatchesQuery(message: { to: string; subject: string; body: string }, query: string): boolean {
  const to = /^to:(?:"([^"]+)"|(\S+))/i.exec(query.trim());
  if (!to) return message.subject.toLowerCase().includes(query.toLowerCase());
  const expected = (to[1] ?? to[2] ?? "").toLowerCase();
  return message.to.toLowerCase() === expected;
}
