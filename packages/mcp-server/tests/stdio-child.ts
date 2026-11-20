import { createWorld } from "./support.ts";

const world = createWorld({
  tools: ["harness.get_brief"],
  goal: "stdio brief",
  memory: true,
});

await world.server.startStdio();
