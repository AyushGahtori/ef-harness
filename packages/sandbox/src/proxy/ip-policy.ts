import net from "node:net";

const IPV4_BLOCK_BITS: readonly (readonly [number, number])[] = [
  [0x00000000, 8],
  [0x0a000000, 8],
  [0x7f000000, 8],
  [0xa9fe0000, 16],
  [0xac100000, 12],
  [0xc0a80000, 16],
  [0xe0000000, 4],
  [0xf0000000, 4],
];

export function canonicalIp(address: string): string | undefined {
  const bytes = ipBytes(address);
  if (!bytes) return undefined;
  if (bytes.length === 16 && isIpv4Mapped(bytes)) return formatIpv4(bytes.subarray(12));
  if (bytes.length === 4) return formatIpv4(bytes);
  const groups: string[] = [];
  for (let index = 0; index < 16; index += 2) {
    const hi = bytes[index] ?? 0;
    const lo = bytes[index + 1] ?? 0;
    groups.push(((hi << 8) | lo).toString(16));
  }
  return compressIpv6(groups);
}

export function isPublicIp(address: string): boolean {
  const bytes = ipBytes(address);
  if (!bytes) return false;
  if (bytes.length === 16) {
    if (
      isUnspecified(bytes) ||
      isIpv6Loopback(bytes) ||
      isUniqueLocal(bytes) ||
      isIpv6LinkLocal(bytes)
    ) {
      return false;
    }
    if (isIpv4Mapped(bytes)) return isPublicIpv4(bytes.subarray(12));
    if ((bytes[0] ?? 0) === 0xff) return false;
    return true;
  }
  return isPublicIpv4(bytes);
}

export function addressPermitted(address: string, testOnlyPrivateIps: readonly string[]): boolean {
  if (isPublicIp(address)) return true;
  const canonical = canonicalIp(address);
  if (!canonical) return false;
  return testOnlyPrivateIps.some((entry) => canonicalIp(entry) === canonical);
}

export function everyAddressPermitted(
  addresses: readonly string[],
  testOnlyPrivateIps: readonly string[],
): boolean {
  if (addresses.length === 0) return false;
  return addresses.every((address) => addressPermitted(address, testOnlyPrivateIps));
}

function formatIpv4(bytes: Uint8Array): string {
  return `${bytes[0] ?? 0}.${bytes[1] ?? 0}.${bytes[2] ?? 0}.${bytes[3] ?? 0}`;
}

function isPublicIpv4(bytes: Uint8Array): boolean {
  const value = ipv4Value(bytes);
  if (value === null) return false;
  for (const [base, bits] of IPV4_BLOCK_BITS) {
    if (inCidr(value, base, bits)) return false;
  }
  return true;
}

function ipv4Value(bytes: Uint8Array): number | null {
  if (bytes.length !== 4) return null;
  const b0 = bytes[0] ?? 0;
  const b1 = bytes[1] ?? 0;
  const b2 = bytes[2] ?? 0;
  const b3 = bytes[3] ?? 0;
  return ((b0 << 24) | (b1 << 16) | (b2 << 8) | b3) >>> 0;
}

function inCidr(value: number, base: number, bits: number): boolean {
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (value & mask) === (base & mask);
}

function ipBytes(address: string): Uint8Array | undefined {
  const raw = address.trim().toLowerCase().split("%")[0] ?? "";
  if (!raw) return undefined;
  if (raw.includes(".")) {
    if (raw.includes(":")) {
      const mapped = raw.slice(raw.lastIndexOf(":") + 1);
      const v4 = parseIpv4(mapped);
      if (!v4) return undefined;
      if (raw.startsWith("::ffff:")) {
        const bytes = new Uint8Array(16);
        bytes[10] = 0xff;
        bytes[11] = 0xff;
        bytes.set(v4, 12);
        return bytes;
      }
      return undefined;
    }
    return parseIpv4(raw);
  }
  return parseIpv6(raw);
}

function parseIpv4(address: string): Uint8Array | undefined {
  const parts = address.split(".");
  if (parts.length !== 4) return undefined;
  const bytes = new Uint8Array(4);
  for (let index = 0; index < 4; index += 1) {
    const part = parts[index] ?? "";
    if (!/^\d{1,3}$/.test(part)) return undefined;
    if (part.length > 1 && part.startsWith("0")) return undefined;
    const octet = Number(part);
    if (!Number.isInteger(octet) || octet > 255) return undefined;
    bytes[index] = octet;
  }
  return bytes;
}

function parseIpv6(address: string): Uint8Array | undefined {
  if (!address.includes(":") || address.includes(":::")) return undefined;
  const halves = address.split("::");
  if (halves.length > 2) return undefined;
  const parseSide = (side: string): number[] | undefined => {
    if (!side) return [];
    const pieces = side.split(":");
    const groups: number[] = [];
    for (const piece of pieces) {
      if (piece.includes(".")) return undefined;
      if (!/^[0-9a-f]{1,4}$/.test(piece)) return undefined;
      groups.push(Number.parseInt(piece, 16));
    }
    return groups;
  };
  const left = parseSide(halves[0] ?? "");
  const right = halves.length === 2 ? parseSide(halves[1] ?? "") : [];
  if (!left || !right) return undefined;
  if (halves.length === 1 && left.length !== 8) return undefined;
  if (halves.length === 2 && left.length + right.length > 8) return undefined;
  const groups =
    halves.length === 2
      ? [...left, ...new Array<number>(8 - left.length - right.length).fill(0), ...right]
      : left;
  if (groups.length !== 8) return undefined;
  const bytes = new Uint8Array(16);
  for (let index = 0; index < 8; index += 1) {
    const group = groups[index] ?? 0;
    bytes[index * 2] = (group >> 8) & 0xff;
    bytes[index * 2 + 1] = group & 0xff;
  }
  return bytes;
}

function isUnspecified(bytes: Uint8Array): boolean {
  return bytes.every((byte) => byte === 0);
}

function isIpv6Loopback(bytes: Uint8Array): boolean {
  if ((bytes[15] ?? 0) !== 1) return false;
  for (let index = 0; index < 15; index += 1) {
    if ((bytes[index] ?? 0) !== 0) return false;
  }
  return true;
}

function isUniqueLocal(bytes: Uint8Array): boolean {
  return ((bytes[0] ?? 0) & 0xfe) === 0xfc;
}

function isIpv6LinkLocal(bytes: Uint8Array): boolean {
  return (bytes[0] ?? 0) === 0xfe && ((bytes[1] ?? 0) & 0xc0) === 0x80;
}

function isIpv4Mapped(bytes: Uint8Array): boolean {
  for (let index = 0; index < 10; index += 1) {
    if ((bytes[index] ?? 0) !== 0) return false;
  }
  return bytes[10] === 0xff && bytes[11] === 0xff;
}

function compressIpv6(groups: readonly string[]): string {
  let bestStart = -1;
  let bestLength = 0;
  let runStart = -1;
  for (let index = 0; index <= groups.length; index += 1) {
    if (index < groups.length && groups[index] === "0") {
      if (runStart < 0) runStart = index;
    } else if (runStart >= 0) {
      const length = index - runStart;
      if (length > bestLength) {
        bestStart = runStart;
        bestLength = length;
      }
      runStart = -1;
    }
  }
  if (bestLength < 2) return groups.join(":");
  const head = groups.slice(0, bestStart).join(":");
  const tail = groups.slice(bestStart + bestLength).join(":");
  if (!head && !tail) return "::";
  if (!head) return `::${tail}`;
  if (!tail) return `${head}::`;
  return `${head}::${tail}`;
}

export function isIpLiteral(hostname: string): boolean {
  return net.isIP(hostname) !== 0;
}
