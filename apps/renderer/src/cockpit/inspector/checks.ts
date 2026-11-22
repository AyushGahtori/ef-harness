import { DIFF_CHUNK_BYTES } from "./constants.js";
import { el, type InspectorElement } from "./elements.js";
import { RangeLimitError, isAbortError } from "./errors.js";
import { ResidentLedger } from "./memory.js";
import type { BinaryStreamClient } from "./ports.js";
import type { CheckLayer, CheckReceipt } from "./types.js";

const LAYER_ORDER: readonly CheckLayer[] = [
  "STATIC_AUDIT",
  "typecheck",
  "lint",
  "unit",
  "playwright",
  "reviewer@1",
  "taste-reviewer@1",
  "hidden",
];

interface Lightbox {
  readonly checkId: string;
  readonly bytes: Uint8Array;
  readonly totalBytes: number;
  readonly zoomed: boolean;
}

/**
 * Verification receipts. Sealed hidden-check source stays out of the tree
 * while retries are still running and the receipt asks to hide it.
 */
export class ChecksAndReceiptsTab {
  private receipts: readonly CheckReceipt[] = [];
  private retriesActive = false;
  private lightbox: Lightbox | null = null;

  constructor(
    private readonly binary: BinaryStreamClient,
    private readonly ledger: ResidentLedger,
  ) {}

  setReceipts(receipts: readonly CheckReceipt[], retriesActive: boolean): void {
    this.discardShot();
    this.receipts = receipts;
    this.retriesActive = retriesActive;
  }

  async openScreenshot(
    checkId: string,
    signal: AbortSignal,
    live: () => boolean,
  ): Promise<"applied" | "discarded" | "missing"> {
    const receipt = this.receipts.find((item) => item.id === checkId);
    if (!receipt?.screenshotArtifactId) return "missing";
    let chunk;
    try {
      chunk = await this.binary.fetchScreenshot(
        receipt.screenshotArtifactId,
        0,
        DIFF_CHUNK_BYTES,
        signal,
      );
    } catch (error) {
      if (isAbortError(error) || !live()) return "discarded";
      throw error;
    }
    if (!live()) return "discarded";
    if (chunk.bytes.byteLength > DIFF_CHUNK_BYTES) {
      throw new RangeLimitError("screenshot chunk exceeded 64 KB");
    }
    this.discardShot();
    this.ledger.retain(`shot:${checkId}`, chunk.bytes.byteLength);
    this.lightbox = {
      checkId,
      bytes: chunk.bytes,
      totalBytes: chunk.totalBytes,
      zoomed: true,
    };
    return "applied";
  }

  closeLightbox(): void {
    this.discardShot();
  }

  discard(): void {
    this.discardShot();
    this.receipts = [];
  }

  render(): InspectorElement {
    const rows = LAYER_ORDER.flatMap((layer) =>
      this.receipts.filter((receipt) => receipt.layer === layer).map((receipt) => this.renderReceipt(receipt)),
    );
    const children = [...rows];
    if (this.lightbox) children.push(this.renderLightbox(this.lightbox));
    return el("tabpanel", "Checks", "", children);
  }

  private renderReceipt(receipt: CheckReceipt): InspectorElement {
    const children: InspectorElement[] = [
      el("item", receipt.layer, this.safeSummary(receipt), [], { status: receipt.status }),
    ];
    if (receipt.screenshotArtifactId) {
      children.push(el("button", `View screenshot ${receipt.id}`, "View screenshot"));
    }
    if (receipt.disputeAvailable) {
      children.push(el("button", "DisputeTest", receipt.id));
    }
    return el("row", receipt.id, receipt.layer, children, { status: receipt.status });
  }

  private renderLightbox(lightbox: Lightbox): InspectorElement {
    const partial = lightbox.bytes.byteLength < lightbox.totalBytes;
    const note = partial
      ? `PNG thumbnail ${lightbox.bytes.byteLength} bytes — Showing first 64 KB`
      : `PNG thumbnail ${lightbox.bytes.byteLength} bytes`;
    return el("dialog", "Screenshot", note, [el("button", "Close screenshot", "Close")], {
      zoomed: lightbox.zoomed,
      checkId: lightbox.checkId,
    });
  }

  private safeSummary(receipt: CheckReceipt): string {
    if (!this.hideSource(receipt)) return receipt.summary;
    const source = receipt.sealedSource;
    if (source && receipt.summary.includes(source)) {
      return "Hidden check failed. Open DisputeTest to challenge it. Source stays sealed during retries.";
    }
    return receipt.summary;
  }

  private hideSource(receipt: CheckReceipt): boolean {
    return receipt.hideSealedSource && this.retriesActive;
  }

  private discardShot(): void {
    if (!this.lightbox) return;
    this.ledger.release(`shot:${this.lightbox.checkId}`);
    this.lightbox = null;
  }
}
