import type {
  CeoTrayVisual,
  FrontDeskParcelVisual,
  InboxCardKind,
  OfficeCanonicalSnapshot,
  OfficeInboxCard,
  PaperSlipVisual,
} from "./types.js";

const ACTIONABLE_KINDS = new Set<InboxCardKind>([
  "Decision",
  "Approval",
  "Secret",
  "Tool",
  "Account",
  "Review",
]);

export interface PaperAndParcelVisuals {
  readonly tray: CeoTrayVisual;
  readonly parcel: FrontDeskParcelVisual | null;
}

function openActionableCards(cards: readonly OfficeInboxCard[]): OfficeInboxCard[] {
  return cards
    .filter((card) => card.actionable && !card.resolved && ACTIONABLE_KINDS.has(card.kind))
    .slice()
    .sort((a, b) => a.priority - b.priority || a.cardId.localeCompare(b.cardId));
}

/** CEO paper stack and the single Front Desk parcel, both driven only by state.db. */
export class PaperAndParcelFlowVisuals {
  project(snapshot: OfficeCanonicalSnapshot): PaperAndParcelVisuals {
    const open = openActionableCards(snapshot.inboxCards);
    const slips: PaperSlipVisual[] = open.map((card) => ({
      cardId: card.cardId,
      kind: card.kind,
      title: card.title,
    }));
    const unread = slips.length;
    const tray: CeoTrayVisual = {
      roomId: "ceo-office",
      clean: unread === 0,
      slipCount: unread,
      stackHeight: unread === 0 ? 0 : Math.min(unread, 5),
      overflow: unread > 5,
      unreadBadge: unread,
      slips,
    };
    const scanning = snapshot.intakeItems
      .filter((item) => item.phase === "scanning")
      .slice()
      .sort((a, b) => a.itemId.localeCompare(b.itemId));
    const parcel: FrontDeskParcelVisual | null =
      scanning.length === 0
        ? null
        : {
            roomId: "front-desk",
            stackCount: 1,
            itemCount: scanning.length,
            label: `${scanning.length} ${scanning.length === 1 ? "item" : "items"} scanning...`,
            itemIds: scanning.map((item) => item.itemId),
          };
    return { tray, parcel };
  }

  topActionableCard(snapshot: OfficeCanonicalSnapshot): OfficeInboxCard | null {
    return openActionableCards(snapshot.inboxCards)[0] ?? null;
  }
}
