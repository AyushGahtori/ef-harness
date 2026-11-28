/** Canonical 11 operational office rooms (Task 162). */
export const ROOM_IDS = [
  "ceo-office",
  "front-desk",
  "discovery-lounge",
  "research-library",
  "architecture-studio",
  "planning-war-room",
  "engineering-bullpen",
  "qa-verification-lab",
  "integration-merge-bay",
  "shipping-dock",
  "break-room",
] as const;

export type OfficeRoomId = (typeof ROOM_IDS)[number];

export const ROOM_JUMP_PILLS: ReadonlyArray<{ label: string; roomId: OfficeRoomId }> = [
  { label: "CEO", roomId: "ceo-office" },
  { label: "Bullpen", roomId: "engineering-bullpen" },
  { label: "QA Lab", roomId: "qa-verification-lab" },
  { label: "Merge Bay", roomId: "integration-merge-bay" },
  { label: "Shipping", roomId: "shipping-dock" },
];