import type { FeaturePodPlinth, OfficeFeatureRecord, SeatedCastMember } from "./types.js";

/** `Orders · 4/6` plinth for each occupied Engineering Bullpen feature cluster. */
export function buildFeaturePodPlinths(
  seats: readonly SeatedCastMember[],
  features: readonly OfficeFeatureRecord[],
): FeaturePodPlinth[] {
  const groups = new Map<string, SeatedCastMember[]>();
  for (const seat of seats) {
    if (seat.roomId !== "engineering-bullpen" || seat.featureId === null) continue;
    const list = groups.get(seat.featureId);
    if (list) list.push(seat);
    else groups.set(seat.featureId, [seat]);
  }
  const plinths: FeaturePodPlinth[] = [];
  for (const [featureId, members] of groups) {
    const record = features.find((feature) => feature.featureId === featureId);
    const anchor = members.slice().sort((a, b) => a.deskIndex - b.deskIndex)[0];
    if (!anchor) continue;
    const title = record?.title ?? featureId;
    const done = record?.done ?? members.filter((member) => member.status === "done" || member.status === "passed").length;
    const total = record?.total ?? members.length;
    plinths.push({
      featureId,
      roomId: "engineering-bullpen",
      text: `${title} \u00b7 ${done}/${total}`,
      title,
      done,
      total,
      x: anchor.x,
      y: anchor.y - 32,
      occupiedDeskCount: members.length,
    });
  }
  return plinths.sort((a, b) => a.featureId.localeCompare(b.featureId));
}
