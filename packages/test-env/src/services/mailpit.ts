export interface MailpitAddress {
  readonly name: string;
  readonly address: string;
}

export interface MailpitMessage {
  readonly id: string;
  readonly subject: string;
  readonly from: MailpitAddress | null;
  readonly to: readonly MailpitAddress[];
  readonly created: string;
  readonly snippet: string;
}

export function mailpitRecipientDomain(envId: string): string {
  const trimmed = envId.trim();
  if (!trimmed) throw new Error("environment id is empty");
  const slug = /^env/i.test(trimmed) ? trimmed : `env${trimmed}`;
  return `@${slug}.test`;
}

export function mailpitSearchQuery(envId: string): string {
  return `to:${mailpitRecipientDomain(envId)}`;
}

export function addressMatchesDomain(address: string, domain: string): boolean {
  const at = address.lastIndexOf("@");
  if (at < 0) return false;
  return address.slice(at).toLowerCase() === domain.toLowerCase();
}

export function messageMatchesEnv(message: MailpitMessage, envId: string): boolean {
  const domain = mailpitRecipientDomain(envId);
  return message.to.some((recipient) => addressMatchesDomain(recipient.address, domain));
}

interface RawAddress {
  Name?: string;
  Address?: string;
}

interface RawMessage {
  ID?: string;
  Subject?: string;
  From?: RawAddress;
  To?: RawAddress[];
  Created?: string;
  Snippet?: string;
}

export function parseMailpitSearch(payload: unknown): MailpitMessage[] {
  if (!payload || typeof payload !== "object") return [];
  const messages = "messages" in payload ? payload.messages : undefined;
  if (!Array.isArray(messages)) return [];
  const parsed: MailpitMessage[] = [];
  for (const item of messages) {
    if (!item || typeof item !== "object") continue;
    const raw = item as RawMessage;
    if (!raw.ID) continue;
    parsed.push({
      id: raw.ID,
      subject: raw.Subject ?? "",
      from: raw.From?.Address
        ? { name: raw.From.Name ?? "", address: raw.From.Address }
        : null,
      to: (raw.To ?? [])
        .filter((address) => Boolean(address.Address))
        .map((address) => ({ name: address.Name ?? "", address: address.Address ?? "" })),
      created: raw.Created ?? "",
      snippet: raw.Snippet ?? "",
    });
  }
  return parsed;
}

export function mailpitDeleteBody(ids: readonly string[]): string {
  return JSON.stringify({ IDs: ids });
}

export function mailpitLaunchArgs(smtpPort: number, httpPort: number): readonly string[] {
  return ["--smtp", `127.0.0.1:${smtpPort}`, "--listen", `127.0.0.1:${httpPort}`];
}
