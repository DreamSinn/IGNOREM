import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { ASSET_DIR, assetMimeType } from "./assets.js";
import { closeDatabase, ensureSchema } from "./db.js";
import { startDiscord } from "./discord.js";

const port = Number(process.env.PORT ?? 3000);
let databaseReady = false;
let discordClient: Awaited<ReturnType<typeof startDiscord>> = null;
let server: Server | null = null;

async function main(): Promise<void> {
  server = createServer((request, response) => {
    if (request.url === "/health" || request.url === "/") {
      response.writeHead(databaseReady ? 200 : 503, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      response.end(JSON.stringify({ ok: databaseReady, database: databaseReady, discord: Boolean(discordClient?.isReady()), service: "companhia-lua-de-ferro-bot" }));
      return;
    }
    if (request.url?.startsWith("/assets/")) {
      const name = decodeURIComponent(request.url.slice("/assets/".length).split("?")[0]);
      const mime = assetMimeType(name);
      if (!mime) {
        response.writeHead(404, { "content-type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ error: "not_found" }));
        return;
      }
      readFile(`${ASSET_DIR}${name}`)
        .then((data) => {
          response.writeHead(200, { "content-type": mime, "content-length": data.length, "cache-control": "public, max-age=86400" });
          response.end(data);
        })
        .catch(() => {
          response.writeHead(404, { "content-type": "application/json; charset=utf-8" });
          response.end(JSON.stringify({ error: "not_found" }));
        });
      return;
    }
    response.writeHead(404, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ error: "not_found" }));
  });
  await new Promise<void>((resolve, reject) => {
    server!.once("error", reject);
    server!.listen(port, "0.0.0.0", resolve);
  });
  console.log(`Health server listening on ${port}`);

  if (!process.env.PUBLIC_BASE_URL) {
    console.warn("PUBLIC_BASE_URL não configurada; os embeds serão exibidos sem imagem.");
  }

  try {
    await ensureSchema();
    databaseReady = true;
    discordClient = await startDiscord();
  } catch (error) {
    console.error("Falha ao inicializar dependências do serviço", error);
  }
}

async function shutdown(signal: string): Promise<void> {
  console.log(`${signal} recebido; encerrando com segurança.`);
  server?.close();
  discordClient?.destroy();
  await closeDatabase().catch(() => undefined);
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

main().catch((error) => {
  console.error("Falha ao iniciar o bot", error);
  process.exitCode = 1;
});
