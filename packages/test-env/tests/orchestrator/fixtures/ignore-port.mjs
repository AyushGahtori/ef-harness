import http from "node:http";

const server = http.createServer((request, response) => {
  response.writeHead(200, { "content-type": "text/plain" });
  response.end("ok");
});

const port = 3000;
const deadline = Date.now() + 4_000;

function bind() {
  const onError = (error) => {
    server.off("listening", onListening);
    if (error && error.code === "EADDRINUSE" && Date.now() < deadline) {
      setTimeout(bind, 20);
      return;
    }
    console.error(error);
    process.exit(1);
  };
  const onListening = () => {
    server.off("error", onError);
    console.log("bound-3000");
  };
  server.once("error", onError);
  server.once("listening", onListening);
  server.listen(port, "127.0.0.1");
}

bind();
