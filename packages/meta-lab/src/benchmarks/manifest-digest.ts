import fs from "node:fs";
import { createCanonicalHash, stableJson } from "./canonical-hash.js";
import type { SuiteDefinition } from "./types.js";
import { fixtureAbsolutePath } from "./fixture-paths.js";

export interface FixturePin {
  readonly relativePath: string;
  readonly contentSha256: string;
}

export function hashFixtureContent(relativePath: string): string {
  const hash = createCanonicalHash();
  const bytes = fs.readFileSync(fixtureAbsolutePath(relativePath));
  return hash.sha256(bytes);
}

export function computeSuiteManifestDigest(suite: {
  readonly id: string;
  readonly suiteVersion: string;
  readonly cases: readonly { readonly id: string; readonly fixtureRelativePath: string }[];
}): { digest: string; pins: FixturePin[] } {
  const hash = createCanonicalHash();
  const pins: FixturePin[] = suite.cases.map((benchmarkCase) => ({
    relativePath: benchmarkCase.fixtureRelativePath,
    contentSha256: hashFixtureContent(benchmarkCase.fixtureRelativePath),
  }));
  const body = {
    id: suite.id,
    suiteVersion: suite.suiteVersion,
    fixturePins: pins.map((pin) => ({
      contentSha256: pin.contentSha256,
      relativePath: pin.relativePath,
    })),
    caseIds: suite.cases.map((benchmarkCase) => benchmarkCase.id).sort(),
  };
  return { digest: hash.sha256Utf8(stableJson(body)), pins };
}

export function verifySuiteFixturePins(suite: SuiteDefinition): void {
  for (const benchmarkCase of suite.cases) {
    const actual = hashFixtureContent(benchmarkCase.fixtureRelativePath);
    const expected = computeSuiteManifestDigest({
      id: suite.id,
      suiteVersion: suite.suiteVersion,
      cases: suite.cases,
    });
    const pin = expected.pins.find((p) => p.relativePath === benchmarkCase.fixtureRelativePath);
    if (pin && pin.contentSha256 !== actual) {
      throw new Error(`fixture tamper detected for ${benchmarkCase.id}`);
    }
  }
  const { digest } = computeSuiteManifestDigest({
    id: suite.id,
    suiteVersion: suite.suiteVersion,
    cases: suite.cases,
  });
  if (digest !== suite.manifestDigest) {
    throw new Error(`manifest digest mismatch for ${suite.id}`);
  }
}