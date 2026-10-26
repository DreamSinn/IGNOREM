import { createServer } from "node:http";
import { ensureSchema } from "./db.js";
import { startDiscord } from "./discord.js";

const port = Number(process.env.PORT ?? 3000);

async function main(): Promise<void> {
  let databaseReady = false;
  let client: Awaited<ReturnType<typeof startDiscord>> = null;
  const server = createServer((request, response) => {
    if (request.url === "/health" || request.url === "/") {
      response.writeHead(databaseReady ? 200 : 503, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      response.end(JSON.stringify({ ok: databaseReady, database: databaseReady, discord: Boolean(client?.isReady()), service: "mercenary-guild-bot" }));
      return;
    }
    response.writeHead(404, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ error: "not_found" }));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "0.0.0.0", resolve);
  });
  console.log(`Health server listening on ${port}`);

  try {
    await ensureSchema();
    databaseReady = true;
    client = await startDiscord();
  } catch (error) {
    console.error("Falha ao inicializar dependências do serviço", error);
  }
}

main().catch((error) => {
  console.error("Falha ao iniciar o bot", error);
  process.exitCode = 1;
});
