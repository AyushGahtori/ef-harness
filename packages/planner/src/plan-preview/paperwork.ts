import { PAPERWORK_CAP_PPM, PAPERWORK_ENVELOPES, PAPERWORK_LINE, UNIT_SCALE } from "./constants.js";
import { PlanPreviewError } from "./errors.js";
import { honestShortLabel } from "./money.js";
import type { ConnectionKind, PaperworkEnvelopeView, PaperworkView } from "./types.js";

export function allocatePaperwork(totalUnits: bigint, connection: ConnectionKind): PaperworkView {
  if (totalUnits < 0n) {
    throw new PlanPreviewError("negative_budget", "Paperwork budget must be non-negative");
  }
  let allocatedPpm = 0;
  const envelopes: PaperworkEnvelopeView[] = PAPERWORK_ENVELOPES.map((envelope) => {
    allocatedPpm += envelope.ppm;
    const reservedUnits = (totalUnits * BigInt(envelope.ppm)) / UNIT_SCALE;
    const reservedLabel =
      connection === "api"
        ? honestShortLabel("api", reservedUnits, 0)
        : honestShortLabel("subscription", 0n, Number(reservedUnits));
    return {
      id: envelope.id,
      label: envelope.label,
      percentLabel: envelope.percentLabel,
      ppm: envelope.ppm,
      reservedUnits,
      reservedLabel,
    };
  });
  if (allocatedPpm !== PAPERWORK_CAP_PPM) {
    throw new PlanPreviewError("paperwork_cap", "Paperwork envelopes must sum to the 20% cap");
  }
  return {
    line: PAPERWORK_LINE,
    capPpm: PAPERWORK_CAP_PPM,
    allocatedPpm,
    withinCap: true,
    envelopes,
  };
}
