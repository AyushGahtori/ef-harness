import type { CrewTier, OfficeWorkerRole, RankOutfit } from "./types.js";

const JUNIOR: RankOutfit = {
  id: "junior-hoodie-tee",
  tierLabel: "Jr",
  garments: ["hoodie", "tee"],
  props: [],
};

const MID: RankOutfit = {
  id: "mid-collared-vest",
  tierLabel: "Mid",
  garments: ["collared-shirt", "vest"],
  props: [],
};

const SENIOR: RankOutfit = {
  id: "senior-blazer-cardigan",
  tierLabel: "Sr",
  garments: ["blazer", "cardigan"],
  props: ["glasses", "headset"],
};

const PRINCIPAL: RankOutfit = {
  id: "principal-jacket",
  tierLabel: "Principal",
  garments: ["jacket"],
  props: [],
};

const ARCHITECT: RankOutfit = {
  id: "architect-scarf",
  tierLabel: "Principal",
  garments: ["jacket"],
  props: ["scarf"],
};

const INTEGRATOR: RankOutfit = {
  id: "integrator-hard-hat",
  tierLabel: "Principal",
  garments: ["jacket"],
  props: ["hard-hat"],
};

/** Rank outfit from the assigned crew tier, with architect and integrator props. */
export function rankOutfitFor(worker: { tier: CrewTier; role: OfficeWorkerRole }): RankOutfit {
  if (worker.role === "integrator" || worker.tier === "integrator") return INTEGRATOR;
  if (worker.role === "architect" || worker.tier === "architect") return ARCHITECT;
  switch (worker.tier) {
    case "junior":
      return JUNIOR;
    case "mid":
      return MID;
    case "senior":
      return SENIOR;
    case "principal":
      return PRINCIPAL;
    default: {
      const unexpected: never = worker.tier;
      throw new Error(`Unhandled crew tier ${String(unexpected)}`);
    }
  }
}
