import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { InstalledTypeApiVerifier } from "../src/public.js";

const fixtureDts = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "stripe16",
  "index.d.ts",
);

function installPackage(name: string, version: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ef-research-"));
  fs.copyFileSync(fixtureDts, path.join(root, "index.d.ts"));
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({
      name,
      version,
      types: "index.d.ts",
      exports: { ".": { types: "./index.d.ts" } },
    }),
  );
  return root;
}

describe("InstalledTypeApiVerifier", () => {
  const verifier = new InstalledTypeApiVerifier();

  it("confirms real exports from fixture .d.ts files and overrides stale web docs", () => {
    const root = installPackage("stripe", "16.4.0");
    const surface = verifier.describeInstalled(root);
    expect(surface.checkedWith).toBe("ts.createProgram");
    expect(surface.emit).toBe(false);
    expect(surface.installedVersion).toBe("16.4.0");
    expect(surface.exports.some((item) => item.name === "paymentIntents.create")).toBe(true);

    const [confirmed, renamed, staleOption, staleExport, staleVersion] = verifier.verifyPackage({
      packageRoot: root,
      approvedPackages: ["stripe"],
      claims: [
        {
          functionName: "paymentIntents.create",
          exportPath: ".",
          optionKeys: ["amount", "currency", "payment_method"],
          docVersion: "16.4.0",
        },
        { functionName: "charges.create", docVersion: "18.0.0" },
        {
          functionName: "paymentIntents.create",
          optionKeys: ["automatic_payment_methods"],
          docVersion: "18.2.0",
        },
        { functionName: "paymentIntents.create", exportPath: "./legacy", docVersion: "16.4.0" },
        { functionName: "paymentIntents.create", docVersion: "18.0.0" },
      ],
    });

    expect(confirmed?.status).toBe("confirmed");
    expect(confirmed?.optionKeys).toEqual(expect.arrayContaining(["amount", "currency", "payment_method"]));
    expect(confirmed?.webDocSuperseded).toBe(false);

    expect(renamed?.status).toBe("version_mismatch");
    expect(renamed?.webDocSuperseded).toBe(true);
    expect(renamed?.installedSignature).toContain("paymentIntents.create");
    expect(renamed?.installedSignature).not.toContain("charges.create");

    expect(staleOption?.status).toBe("version_mismatch");
    expect(staleOption?.installedSignature).toContain("paymentIntents.create");
    expect(staleOption?.installedSignature).toContain("PaymentIntentCreateParams");
    expect(staleOption?.reason).toContain("automatic_payment_methods");

    expect(staleExport?.status).toBe("version_mismatch");
    expect(staleVersion?.status).toBe("version_mismatch");
    expect(staleVersion?.installedMajorMinor).toBe("16.4");
  });

  it("rejects an unapproved package claim", () => {
    const root = installPackage("evil-helper", "1.0.0");
    const [proof] = verifier.verifyPackage({
      packageRoot: root,
      approvedPackages: ["stripe"],
      claims: [{ functionName: "paymentIntents.create" }],
    });
    expect(proof?.status).toBe("unapproved_package");
    expect(proof?.installedSignature).toBeNull();
  });
});
