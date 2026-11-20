import fs from "node:fs";

const target = process.argv[2];
if (!target) {
  process.stderr.write("missing marker path\n");
  process.exit(2);
}
fs.writeFileSync(target, "spawned");
setInterval(() => {}, 1000);
