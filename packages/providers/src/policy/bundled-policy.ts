import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function bundledPolicyPath(): string {
  const besideModule = fileURLToPath(new URL("./provider-policy.json", import.meta.url));
  if (existsSync(besideModule)) return besideModule;
  const fromSourceTree = fileURLToPath(
    new URL("../../src/policy/provider-policy.json", import.meta.url),
  );
  if (existsSync(fromSourceTree)) return fromSourceTree;
  return besideModule;
}

export function readBundledPolicyText(): string {
  return readFileSync(bundledPolicyPath(), "utf8");
}
