import http from "node:http";

const port = Number(process.env.PORT);
if (!Number.isInteger(port) || port <= 0) {
  console.error("missing PORT");
  process.exit(1);
}

const server = http.createServer((request, response) => {
  const url = request.url ?? "/";
  if (url === "/api/health" || url === "/ready") {
    response.writeHead(200, { "content-type": "text/plain" });
    response.end("ok");
    return;
  }
  if (url === "/env") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        database: process.env.DATABASE_URL ?? null,
        extra: process.env.EXTRA_ONLY ?? null,
      }),
    );
    return;
  }
  response.writeHead(404);
  response.end();
});

server.on("error", (error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

server.listen(port, "127.0.0.1");
