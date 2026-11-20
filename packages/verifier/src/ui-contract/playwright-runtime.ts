import { HumanStepRequired } from "./errors.js";
import { requireFromRepository } from "./module-root.js";
import type { PlaywrightModule, PwBrowser } from "./ports.js";

const HOST_RESOLVER_RULE = "--host-resolver-rules=MAP *.localhost 127.0.0.1";

export function loadPlaywright(): PlaywrightModule {
  return requireFromRepository<PlaywrightModule>("playwright");
}

export function isMissingChromiumError(error: unknown): boolean {
  const message = error instanceof Error ? `${error.name}\n${error.message}` : String(error);
  return (
    /Executable doesn't exist/i.test(message) ||
    /npx playwright install/i.test(message) ||
    /Please run the following command/i.test(message)
  );
}

/** Launches Playwright Chromium with loopback resolution for `env-<id>.localhost`. */
export async function launchChromium(): Promise<PwBrowser> {
  try {
    const playwright = loadPlaywright();
    return await playwright.chromium.launch({
      headless: true,
      args: [HOST_RESOLVER_RULE],
    });
  } catch (error) {
    if (isMissingChromiumError(error)) {
      throw new HumanStepRequired("install_playwright_chromium");
    }
    throw error;
  }
}
