import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { ContractStatus } from "./db.js";

// Imagens padrão, servidas pelo próprio bot em /assets/<arquivo> (pasta public/assets).
export const ASSET_DIR = fileURLToPath(new URL("../public/assets/", import.meta.url));

export interface ImageSlot {
  key: string; // chave guardada em guild_configs.texts
  label: string; // rótulo mostrado no formulário (máx. 45 caracteres)
  file: string; // arquivo padrão em public/assets
}

export const IMAGE_SLOTS: ImageSlot[] = [
  { key: "img:base", label: "Banner padrão (painel e disponível)", file: "embed-base.jpg" },
  { key: "img:aceito", label: "Banner: contrato aceito", file: "embed-aceito.jpg" },
  { key: "img:andamento", label: "Banner: em andamento", file: "embed-andamento.jpg" },
  { key: "img:concluido", label: "Banner: concluído", file: "embed-concluido.jpg" },
  { key: "img:cancelado", label: "Banner: cancelado", file: "embed-cancelado.jpg" },
  { key: "img:arquivado", label: "Banner: arquivado", file: "embed-arquivado.jpg" },
  { key: "img:avatar", label: "Avatar do bot", file: "avatar-bot.jpg" },
  { key: "img:banner-bot", label: "Banner do bot", file: "banner-bot.jpg" },
  { key: "img:foto", label: "Foto do servidor (e miniatura)", file: "foto-servidor.jpg" },
  { key: "img:banner-servidor", label: "Banner do servidor", file: "banner-servidor.jpg" },
];

// Formulário "Imagens dos cartões" (5 campos) e "Imagens de perfil" (5 campos).
export const EMBED_IMAGE_SLOTS = IMAGE_SLOTS.slice(0, 5);
export const PROFILE_IMAGE_SLOTS = IMAGE_SLOTS.slice(5);

const STATUS_KEYS: Record<ContractStatus, string> = {
  available: "img:base",
  accepted: "img:aceito",
  in_progress: "img:andamento",
  completed: "img:concluido",
  cancelled: "img:cancelado",
  archived: "img:arquivado",
};

export function imageKeyForStatus(status: ContractStatus): string {
  return STATUS_KEYS[status];
}

export function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function slotFor(key: string): ImageSlot {
  const slot = IMAGE_SLOTS.find((item) => item.key === key);
  if (!slot) throw new Error(`Imagem desconhecida: ${key}`);
  return slot;
}

function overrideFor(texts: Record<string, string>, key: string): string | undefined {
  const value = texts[key]?.trim();
  return value && isHttpsUrl(value) ? value : undefined;
}

// Endereço usado nos embeds: o link do formulário, ou a imagem padrão servida pelo bot.
export function imageUrl(texts: Record<string, string>, key: string): string | undefined {
  const override = overrideFor(texts, key);
  if (override) return override;
  const base = process.env.PUBLIC_BASE_URL?.replace(/\/+$/, "");
  return base ? `${base}/assets/${slotFor(key).file}` : undefined;
}

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

// Baixa uma imagem e confirma que o link realmente entrega um arquivo de imagem.
export async function fetchImage(url: string, timeoutMs = 15000): Promise<Buffer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: "follow" });
    if (!response.ok) throw new Error(`o link respondeu com status ${response.status}`);
    const type = response.headers.get("content-type") ?? "";
    if (!type.startsWith("image/")) throw new Error("o link não entrega uma imagem");
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > MAX_IMAGE_BYTES) throw new Error("a imagem passa de 10 MB");
    return buffer;
  } catch (error) {
    if ((error as { name?: string }).name === "AbortError") throw new Error("o link demorou demais para responder");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

// Verifica um link do formulário; devolve a mensagem de erro ou null se estiver tudo certo.
export async function checkImageUrl(url: string): Promise<string | null> {
  try {
    await fetchImage(url);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : "link inválido";
  }
}

// Bytes da imagem para os perfis (/identidade): link do formulário ou arquivo padrão.
export async function imageBytes(texts: Record<string, string>, key: string): Promise<Buffer> {
  const override = overrideFor(texts, key);
  if (override) return fetchImage(override);
  return readFileSync(`${ASSET_DIR}${slotFor(key).file}`);
}

// Tipo MIME dos arquivos padrão servidos em /assets (null para qualquer outro nome).
export function assetMimeType(name: string): string | null {
  return IMAGE_SLOTS.some((slot) => slot.file === name) ? "image/jpeg" : null;
}
