import { createServer } from "node:http";
import { ensureSchema } from "./db.js";
import { startDiscord } from "./discord.js";

const port = Number(process.env.PORT ?? 3000);

async function main(): Promise<void> {
  await ensureSchema();
  const client = await startDiscord();
  const server = createServer((request, response) => {
    if (request.url === "/health" || request.url === "/") {
      response.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      response.end(JSON.stringify({ ok: true, discord: Boolean(client?.isReady()), service: "mercenary-guild-bot" }));
      return;
    }
    response.writeHead(404, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ error: "not_found" }));
  });
  server.listen(port, "0.0.0.0", () => console.log(`Health server listening on ${port}`));
}

main().catch((error) => {
  console.error("Falha ao iniciar o bot", error);
  process.exitCode = 1;
});
