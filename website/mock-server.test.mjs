import http from "node:http";
import readline from "node:readline";

const defaultStatus = Number(process.env.RESPONDER_STATUS ?? 200);
const defaultBody = process.env.RESPONDER ?? JSON.stringify({ results: [{ ceremony: "oscar", edition: 97, ok: true }] });
const queue = [];

const server = http.createServer(async (request, response) => {
  let raw = "";
  for await (const chunk of request) raw += chunk;
  const payload = raw ? JSON.parse(raw) : undefined;
  process.stdout.write(`REQ ${JSON.stringify({ method: request.method, url: request.url, auth: request.headers.authorization, body: payload })}\n`);
  const isManifestSync = request.url?.endsWith("/manifest/sync");
  const isCoverage = request.url?.startsWith("/api/awards/coverage");
  const queued = queue[0];
  const queuedMatchesRoute = !isCoverage || queued?.body.includes("byCeremony");
  const next = isManifestSync || !queuedMatchesRoute ? null : queue.shift();
  const fallback = isManifestSync
    ? JSON.stringify({ ok: true, synced: 110 })
    : isCoverage
      ? JSON.stringify({ byCeremony: { oscar: { pendingEditions: [63, 64] } } })
      : defaultBody;
  const status = next?.status ?? (isManifestSync || isCoverage ? 200 : defaultStatus);
  const body = next?.body ?? fallback;
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(body);
});

server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  process.stdout.write(`MOCK http://127.0.0.1:${address.port}\n`);
});

const input = readline.createInterface({ input: process.stdin });
input.on("line", line => {
  const separator = line.indexOf("\t");
  if (separator < 0) return;
  const status = Number(line.slice(0, separator));
  const body = line.slice(separator + 1);
  if (Number.isInteger(status)) queue.push({ status, body });
});

function close() {
  input.close();
  server.close(() => process.exit(0));
}
process.on("SIGTERM", close);
process.on("SIGINT", close);
