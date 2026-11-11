import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { ASSET_DIR, assetMimeType } from "./assets.js";
import { closeDatabase, ensureSchema } from "./db.js";
import { ensureWarehouseSchema } from "./warehouse-db.js";
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

  // Banco e Discord iniciam de forma independente: um problema no MySQL não impede mais o bot de conectar.
  void initDatabase();
  try {
    discordClient = await startDiscord();
  } catch (error) {
    console.error("Falha ao conectar no Discord", error);
  }
}

async function initDatabase(): Promise<void> {
  for (let attempt = 1; !databaseReady; attempt++) {
    try {
      console.log(`[db] Conectando ao MySQL (tentativa ${attempt})...`);
      await ensureSchema();
      await ensureWarehouseSchema();
      databaseReady = true;
      console.log("[db] Banco pronto.");
    } catch (error) {
      const e = error as { code?: string; message?: string };
      console.error(`[db] Falha ao preparar o banco (${e.code ?? "sem código"}): ${e.message ?? error}`);
      if (/certificate|SSL|TLS/i.test(`${e.code} ${e.message}`)) {
        console.error("[db] Dica: o certificado do MySQL não foi aceito. Defina DATABASE_SSL=insecure (ou DATABASE_CA_PATH com a CA do banco).");
      }
      await new Promise((resolve) => setTimeout(resolve, Math.min(60000, attempt * 10000)));
    }
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

process.on("unhandledRejection", (reason) => console.error("unhandledRejection:", reason));
process.on("uncaughtException", (error) => console.error("uncaughtException:", error));

main().catch((error) => {
  console.error("Falha ao iniciar o bot", error);
  process.exitCode = 1;
});