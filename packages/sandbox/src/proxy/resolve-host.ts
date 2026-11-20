import { lookup } from "node:dns/promises";
import net from "node:net";
import type { ResolvedAddress } from "./types.js";

export async function resolveHostDefault(hostname: string): Promise<readonly ResolvedAddress[]> {
  const literal = net.isIP(hostname);
  if (literal === 4 || literal === 6) return [{ address: hostname, family: literal }];
  const records = await lookup(hostname, { all: true, verbatim: true });
  return records.map((record) => ({
    address: record.address,
    family: record.family === 6 ? 6 : 4,
  }));
}
