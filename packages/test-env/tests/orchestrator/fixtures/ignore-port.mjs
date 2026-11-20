import http from "node:http";

const server = http.createServer((request, response) => {
  response.writeHead(200, { "content-type": "text/plain" });
  response.end("ok");
});

server.listen(3000, "127.0.0.1", () => {
  console.log("bound-3000");
});
