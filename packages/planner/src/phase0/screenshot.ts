import { launchChromium } from "@ef-harness/verifier";

interface CapturingPage {
  setViewportSize(size: { readonly width: number; readonly height: number }): Promise<void>;
  setContent(html: string, options?: { readonly waitUntil?: "load"; readonly timeout?: number }): Promise<void>;
  screenshot(options?: { readonly type?: "png" }): Promise<Uint8Array>;
}

/** Real Chromium captures of `/__styleguide` at the Gate 0 viewports. */
export async function captureStyleguidePair(html: string): Promise<{ readonly mobile: Buffer; readonly desktop: Buffer }> {
  const browser = await launchChromium();
  try {
    const context = await browser.newContext();
    const page = (await context.newPage()) as unknown as CapturingPage;
    await page.setViewportSize({ width: 375, height: 812 });
    await page.setContent(html, { waitUntil: "load", timeout: 15_000 });
    const mobile = Buffer.from(await page.screenshot({ type: "png" }));
    await page.setViewportSize({ width: 1440, height: 900 });
    const desktop = Buffer.from(await page.screenshot({ type: "png" }));
    await context.close();
    return { mobile, desktop };
  } finally {
    await browser.close();
  }
}
