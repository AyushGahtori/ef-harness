import { LocalizationArtifactStore } from "./artifacts.js";
import type { BrowserRunnerPort } from "./ports.js";
import type { BrowserEngine, BrowserRunSnapshot, CrossBrowserDiff } from "./types.js";

export type CrossBrowserDiffRunnerOptions = {
  readonly scriptRef: string;
  readonly browsers?: readonly BrowserEngine[];
  readonly runner: BrowserRunnerPort;
  readonly artifactStore?: LocalizationArtifactStore;
};

function collectDivergences(
  a: BrowserRunSnapshot | null,
  b: BrowserRunSnapshot | null,
  label: string,
): string[] {
  if (!a || !b) {
    return [];
  }
  const divergences: string[] = [];
  if (a.passed !== b.passed) {
    divergences.push(`${label}: pass/fail mismatch (chromium=${a.passed}, other=${b.passed})`);
  }
  if (a.errorMessage !== b.errorMessage) {
    divergences.push(
      `${label}: error message mismatch (${a.errorMessage ?? "none"} vs ${b.errorMessage ?? "none"})`,
    );
  }
  const styleKeys = new Set([...Object.keys(a.computedStyles), ...Object.keys(b.computedStyles)]);
  for (const key of styleKeys) {
    if (a.computedStyles[key] !== b.computedStyles[key]) {
      divergences.push(`${label}: computed style ${key} differs`);
    }
  }
  return divergences;
}

export class CrossBrowserDiffRunner {
  async run(options: CrossBrowserDiffRunnerOptions): Promise<CrossBrowserDiff> {
    const store = options.artifactStore ?? new LocalizationArtifactStore();
    const engines = options.browsers ?? (["chromium", "webkit", "firefox"] as const);
    let chromium: BrowserRunSnapshot | null = null;
    let webkit: BrowserRunSnapshot | null = null;
    let firefox: BrowserRunSnapshot | null = null;
    let webkitMissing = false;
    let toolCardHint: string | undefined;

    for (const engine of engines) {
      const installed = await options.runner.isEngineInstalled(engine);
      if (!installed) {
        if (engine === "webkit") {
          webkitMissing = true;
          toolCardHint = "Install Playwright WebKit?";
        }
        continue;
      }
      const snapshot = await options.runner.runPlaywrightRepro(engine, options.scriptRef);
      if (engine === "chromium") {
        chromium = snapshot;
      } else if (engine === "webkit") {
        webkit = snapshot;
      } else {
        firefox = snapshot;
      }
    }

    const divergences = [
      ...collectDivergences(chromium, webkit, "webkit"),
      ...collectDivergences(chromium, firefox, "firefox"),
    ];

    const payload: CrossBrowserDiff = {
      chromium,
      webkit,
      firefox,
      divergences,
      artifactRef: "",
      webkitMissing,
      ...(toolCardHint ? { toolCardHint } : {}),
    };
    const artifactRef = store.put({ crossBrowserDiff: payload });
    return { ...payload, artifactRef };
  }
}