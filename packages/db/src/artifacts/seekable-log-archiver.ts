import type { CasHolderKind, CasPutReceipt } from "../cas/types.js";
import type { CasBlobStore } from "../cas/store.js";
import { SEEKABLE_FRAME_BYTES, SEEKABLE_TEXT_THRESHOLD_BYTES } from "./constants.js";
import { encodeSeekableLog } from "./seekable-zstd.js";

export interface SeekableLogArchivePin {
  readonly holderKind: CasHolderKind;
  readonly holderId: string;
}

/**
 * Archives a text log into the unified `CasBlobStore`.
 * Logs larger than 1 MB are stored as pre-framed `zstd-seekable` bytes, not wrapped again.
 */
export class SeekableLogArchiver {
  constructor(
    private readonly cas: CasBlobStore,
    private readonly frameBytes = SEEKABLE_FRAME_BYTES,
  ) {}

  async archive(text: string, pin: SeekableLogArchivePin): Promise<CasPutReceipt> {
    const uncompressed = Buffer.from(text, "utf8");
    if (uncompressed.byteLength > SEEKABLE_TEXT_THRESHOLD_BYTES) {
      const framed = encodeSeekableLog(text, this.frameBytes);
      return this.cas.putBlob(framed.uncompressed, {
        holderKind: pin.holderKind,
        holderId: pin.holderId,
        format: "zstd-seekable",
        storedPayload: framed.stored,
      });
    }
    return this.cas.putBlob(uncompressed, {
      holderKind: pin.holderKind,
      holderId: pin.holderId,
      format: "zstd",
    });
  }
}
