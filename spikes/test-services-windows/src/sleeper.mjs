import net from "node:net";
const port = Number(process.argv[2]);
const role = process.argv[3] ?? "service";
if (!Number.isInteger(port)) {
  process.stderr.write("sleeper needs a port\n");
  process.exit(1);
}
process.title = `ef-spike-${role}`;
const server = net.createServer();
server.listen(port, "127.0.0.1");
setInterval(() => undefined, 1000);
