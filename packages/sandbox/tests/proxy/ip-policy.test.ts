import { describe, expect, it } from "vitest";
import { canonicalIp, isPublicIp } from "../../src/proxy/index.js";

describe("proxy private-address policy", () => {
  it("blocks loopback, private, link-local, and metadata ranges", () => {
    const blocked = [
      "0.0.0.0",
      "10.0.0.1",
      "10.255.255.255",
      "127.0.0.1",
      "127.255.255.254",
      "169.254.1.1",
      "169.254.169.254",
      "172.16.0.0",
      "172.31.255.255",
      "192.168.0.1",
      "224.0.0.1",
      "255.255.255.255",
      "::",
      "::1",
      "fc00::1",
      "fd00::1",
      "fe80::1",
      "::ffff:127.0.0.1",
      "::ffff:10.0.0.1",
      "::ffff:169.254.169.254",
    ];
    for (const address of blocked) expect(isPublicIp(address), address).toBe(false);
  });

  it("allows ordinary public addresses and the 172.16 boundary", () => {
    for (const address of [
      "1.1.1.1",
      "8.8.8.8",
      "172.15.255.255",
      "172.32.0.1",
      "11.0.0.1",
      "192.169.1.1",
      "::ffff:8.8.8.8",
    ]) {
      expect(isPublicIp(address), address).toBe(true);
    }
    expect(canonicalIp("::1")).toBe("::1");
    expect(canonicalIp("127.0.0.1")).toBe("127.0.0.1");
    expect(canonicalIp("::ffff:127.0.0.1")).toBe("127.0.0.1");
  });
});
