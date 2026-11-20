import type { MutableCounts } from "./types.js";

function emailPattern(): RegExp {
  return /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
}

function phonePattern(): RegExp {
  return /(?:\+\d{1,3}[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]\d{3}[\s.-]\d{4}/g;
}

function ipv4Pattern(): RegExp {
  return /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g;
}

function validIpv4(ip: string): boolean {
  const octets = ip.split(".");
  if (octets.length !== 4) return false;
  return octets.every((part) => {
    if (!/^\d{1,3}$/.test(part)) return false;
    if (part.length > 1 && part.startsWith("0")) return false;
    const value = Number(part);
    return value >= 0 && value <= 255;
  });
}

/**
 * Stable within one capture. The first distinct email becomes [EMAIL_1], the next [EMAIL_2].
 * The same address always keeps its token so a cross-tenant swap stays visible.
 */
export class Pseudonymizer {
  private readonly emails = new Map<string, string>();
  private readonly phones = new Map<string, string>();
  private readonly ips = new Map<string, string>();

  apply(input: string, counts: MutableCounts): string {
    const withEmails = input.replace(emailPattern(), (email) => this.token(this.emails, email.toLowerCase(), "EMAIL", counts, "emails"));
    const withPhones = withEmails.replace(phonePattern(), (phone) =>
      this.token(this.phones, phone.replace(/\s+/g, " ").trim(), "PHONE", counts, "phones"),
    );
    return withPhones.replace(ipv4Pattern(), (ip) => {
      if (!validIpv4(ip)) return ip;
      return this.token(this.ips, ip, "IP", counts, "ips");
    });
  }

  private token(
    table: Map<string, string>,
    key: string,
    prefix: "EMAIL" | "PHONE" | "IP",
    counts: MutableCounts,
    field: "emails" | "phones" | "ips",
  ): string {
    const existing = table.get(key);
    if (existing) return existing;
    const token = `[${prefix}_${table.size + 1}]`;
    table.set(key, token);
    counts[field] += 1;
    return token;
  }
}
