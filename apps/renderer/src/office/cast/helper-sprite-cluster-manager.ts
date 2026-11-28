import type { HelperCountPill, OfficeHelperRecord, SeatedCastMember, VisibleHelperSprite } from "./types.js";

const HELPER_OFFSETS = [
  { x: -12, y: 8 },
  { x: 12, y: 8 },
  { x: 0, y: 14 },
] as const;

export interface HelperCluster {
  readonly sprites: readonly VisibleHelperSprite[];
  readonly pill: HelperCountPill | null;
}

/** At most 3 helper sprites around a lead desk, then a `+N` pill. */
export class HelperSpriteClusterManager {
  static readonly MAX_VISIBLE = 3;

  cluster(
    lead: { readonly agentId: string; readonly x: number; readonly y: number },
    helpers: readonly OfficeHelperRecord[],
  ): HelperCluster {
    const ordered = helpers.slice().sort((a, b) => a.helperId.localeCompare(b.helperId));
    const visible = ordered.slice(0, HelperSpriteClusterManager.MAX_VISIBLE);
    const sprites: VisibleHelperSprite[] = visible.map((helper, index) => {
      const offset = HELPER_OFFSETS[index] ?? HELPER_OFFSETS[0];
      return {
        source: "state.db",
        helperId: helper.helperId,
        leadAgentId: lead.agentId,
        kind: helper.kind,
        x: lead.x + offset.x,
        y: lead.y + offset.y,
        index,
      };
    });
    const hiddenCount = ordered.length - sprites.length;
    const pill: HelperCountPill | null =
      hiddenCount > 0
        ? {
            leadAgentId: lead.agentId,
            text: `+${hiddenCount}`,
            hiddenCount,
            visibleCount: 3,
            x: lead.x + 18,
            y: lead.y - 16,
          }
        : null;
    return { sprites, pill };
  }

  clusterAll(
    seats: readonly SeatedCastMember[],
    helpersByLead: ReadonlyMap<string, readonly OfficeHelperRecord[]>,
  ): { readonly sprites: readonly VisibleHelperSprite[]; readonly pills: readonly HelperCountPill[] } {
    const sprites: VisibleHelperSprite[] = [];
    const pills: HelperCountPill[] = [];
    const orderedSeats = seats.slice().sort((a, b) => a.agentId.localeCompare(b.agentId));
    for (const seat of orderedSeats) {
      const helpers = helpersByLead.get(seat.agentId) ?? [];
      const cluster = this.cluster(seat, helpers);
      sprites.push(...cluster.sprites);
      if (cluster.pill) pills.push(cluster.pill);
    }
    return { sprites, pills };
  }
}
