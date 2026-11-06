import { randomBytes } from "node:crypto";
import type { RowDataPacket } from "mysql2/promise";
import { getDatabasePool } from "./db.js";

export const WAREHOUSE_CAPACITY = 240;
export interface WarehouseItem { id: number; name: string; quantity: number; updatedAt: Date }
export interface WarehouseLog { id: number; action: "deposit" | "withdraw"; itemName: string; quantity: number; userId: string; displayName: string; createdAt: Date }
type Row = RowDataPacket & Record<string, unknown>;

export async function ensureWarehouseSchema(): Promise<void> {
  const pool = getDatabasePool();
  await pool.query(`CREATE TABLE IF NOT EXISTS warehouse_locks (
    guild_id VARCHAR(32) NOT NULL PRIMARY KEY
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  await pool.query(`CREATE TABLE IF NOT EXISTS warehouse_items (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    guild_id VARCHAR(32) NOT NULL,
    item_name VARCHAR(100) NOT NULL,
    quantity BIGINT UNSIGNED NOT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id), UNIQUE KEY uq_warehouse_item (guild_id, item_name),
    KEY idx_warehouse_item_name (guild_id, item_name)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  await pool.query(`CREATE TABLE IF NOT EXISTS warehouse_history (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    guild_id VARCHAR(32) NOT NULL,
    action VARCHAR(16) NOT NULL,
    item_name VARCHAR(100) NOT NULL,
    quantity BIGINT UNSIGNED NOT NULL,
    user_id VARCHAR(32) NOT NULL,
    display_name VARCHAR(150) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id), KEY idx_warehouse_history (guild_id, created_at),
    KEY idx_warehouse_history_item (guild_id, item_name), KEY idx_warehouse_history_user (guild_id, user_id),
    CONSTRAINT chk_warehouse_action CHECK (action IN ('deposit', 'withdraw'))
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  await pool.query(`CREATE TABLE IF NOT EXISTS warehouse_operations (
    interaction_id VARCHAR(32) NOT NULL PRIMARY KEY,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  await pool.query(`CREATE TABLE IF NOT EXISTS warehouse_pending_withdrawals (
    token CHAR(16) NOT NULL PRIMARY KEY,
    guild_id VARCHAR(32) NOT NULL,
    user_id VARCHAR(32) NOT NULL,
    item_name VARCHAR(100) NOT NULL,
    quantity BIGINT UNSIGNED NOT NULL,
    expires_at DATETIME NOT NULL,
    KEY idx_warehouse_pending_expires (expires_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
}

export async function listWarehouseItems(guildId: string, sort: "name" | "quantity" = "name"): Promise<WarehouseItem[]> {
  const order = sort === "quantity" ? "quantity DESC, item_name ASC" : "item_name ASC";
  const [rows] = await getDatabasePool().execute<Row[]>(`SELECT id, item_name, quantity, updated_at FROM warehouse_items WHERE guild_id = ? ORDER BY ${order}`, [guildId]);
  return rows.map((r) => ({ id: Number(r.id), name: String(r.item_name), quantity: Number(r.quantity), updatedAt: new Date(String(r.updated_at)) }));
}

export async function countWarehouseItems(guildId: string): Promise<number> {
  const [rows] = await getDatabasePool().execute<Row[]>("SELECT COUNT(*) AS total FROM warehouse_items WHERE guild_id = ?", [guildId]);
  return Number(rows[0]?.total ?? 0);
}

export async function changeWarehouseItem(input: { guildId: string; action: "deposit" | "withdraw"; name: string; quantity: number; userId: string; displayName: string; operationId: string }): Promise<{ slotsUsed: number; quantity: number }> {
  const name = input.name.trim().replace(/\s+/g, " ");
  if (!name || name.length > 100) throw new Error("O nome do item deve ter entre 1 e 100 caracteres.");
  if (!Number.isSafeInteger(input.quantity) || input.quantity < 1 || input.quantity > 1000000) throw new Error("A quantidade deve ser um número inteiro entre 1 e 1.000.000.");
  const pool = getDatabasePool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute("INSERT INTO warehouse_operations (interaction_id) VALUES (?)", [input.operationId]);
    await conn.execute("INSERT INTO warehouse_locks (guild_id) VALUES (?) ON DUPLICATE KEY UPDATE guild_id = VALUES(guild_id)", [input.guildId]);
    await conn.execute("SELECT guild_id FROM warehouse_locks WHERE guild_id = ? FOR UPDATE", [input.guildId]);
    const [rows] = await conn.execute<Row[]>("SELECT id, item_name, quantity FROM warehouse_items WHERE guild_id = ? AND item_name = ? FOR UPDATE", [input.guildId, name]);
    const item = rows[0];
    if (input.action === "deposit") {
      if (!item) {
        const [cnt] = await conn.execute<Row[]>("SELECT COUNT(*) AS total FROM warehouse_items WHERE guild_id = ?", [input.guildId]);
        const slotsUsed = Number(cnt[0]?.total ?? 0);
        if (slotsUsed >= WAREHOUSE_CAPACITY) throw new Error(`O baú está cheio (${WAREHOUSE_CAPACITY}/${WAREHOUSE_CAPACITY} espaços).`);
        await conn.execute("INSERT INTO warehouse_items (guild_id, item_name, quantity) VALUES (?, ?, ?)", [input.guildId, name, input.quantity]);
      } else {
        const updated = Number(item.quantity) + input.quantity;
        if (!Number.isSafeInteger(updated)) throw new Error("Quantidade total excede o limite permitido.");
        await conn.execute("UPDATE warehouse_items SET quantity = ? WHERE id = ?", [updated, item.id]);
      }
    } else {
      if (!item) throw new Error(`**${name}** não existe no baú.`);
      const available = Number(item.quantity);
      if (input.quantity > available) throw new Error(`Quantidade insuficiente. Há **${available}** unidade(s) de **${String(item.item_name)}**.`);
      if (input.quantity === available) await conn.execute("DELETE FROM warehouse_items WHERE id = ?", [item.id]);
      else await conn.execute("UPDATE warehouse_items SET quantity = quantity - ? WHERE id = ?", [input.quantity, item.id]);
    }
    await conn.execute("INSERT INTO warehouse_history (guild_id, action, item_name, quantity, user_id, display_name) VALUES (?, ?, ?, ?, ?, ?)", [input.guildId, input.action, item ? String(item.item_name) : name, input.quantity, input.userId, input.displayName.slice(0, 150)]);
    const [cnt] = await conn.execute<Row[]>("SELECT COUNT(*) AS total FROM warehouse_items WHERE guild_id = ?", [input.guildId]);
    const [qty] = await conn.execute<Row[]>("SELECT quantity FROM warehouse_items WHERE guild_id = ? AND item_name = ?", [input.guildId, item ? String(item.item_name) : name]);
    await conn.commit();
    return { slotsUsed: Number(cnt[0]?.total ?? 0), quantity: Number(qty[0]?.quantity ?? 0) };
  } catch (error) {
    await conn.rollback();
    if ((error as { code?: string }).code === "ER_DUP_ENTRY") throw new Error("Esta interação já foi processada; nenhuma movimentação duplicada foi registrada.");
    throw error;
  } finally { conn.release(); }
}

function historyFilter(filter: string): { query: string; action: string; userId: string } {
  const value = filter.trim();
  if (value.startsWith("action:")) return { query: "", action: value.slice(7), userId: "" };
  if (value.startsWith("user:")) return { query: "", action: "", userId: value.slice(5) };
  return { query: value, action: "", userId: "" };
}

export async function countWarehouseHistory(guildId: string, filter = ""): Promise<number> {
  const parsed = historyFilter(filter);
  const search = `%${parsed.query}%`;
  const [rows] = await getDatabasePool().execute<Row[]>(`SELECT COUNT(*) AS total FROM warehouse_history
    WHERE guild_id = ? AND (? = '' OR item_name LIKE ? OR display_name LIKE ? OR user_id LIKE ?)
    AND (? = '' OR action = ?) AND (? = '' OR user_id = ?)`, [guildId, parsed.query, search, search, search, parsed.action, parsed.action, parsed.userId, parsed.userId]);
  return Number(rows[0]?.total ?? 0);
}

export async function listWarehouseHistory(guildId: string, filter = "", limit = 10, offset = 0): Promise<WarehouseLog[]> {
  const parsed = historyFilter(filter);
  const search = `%${parsed.query}%`;
  const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 100);
  const safeOffset = Math.max(Math.trunc(offset), 0);
  const [rows] = await getDatabasePool().execute<Row[]>(`SELECT id, action, item_name, quantity, user_id, display_name, created_at
    FROM warehouse_history WHERE guild_id = ? AND (? = '' OR item_name LIKE ? OR display_name LIKE ? OR user_id LIKE ?)
    AND (? = '' OR action = ?) AND (? = '' OR user_id = ?)
    ORDER BY created_at DESC, id DESC LIMIT ${safeLimit} OFFSET ${safeOffset}`, [guildId, parsed.query, search, search, search, parsed.action, parsed.action, parsed.userId, parsed.userId]);
  return rows.map((r) => ({ id: Number(r.id), action: String(r.action) as WarehouseLog["action"], itemName: String(r.item_name), quantity: Number(r.quantity), userId: String(r.user_id), displayName: String(r.display_name), createdAt: new Date(String(r.created_at)) }));
}

export async function createPendingWithdrawal(input: { guildId: string; userId: string; itemName: string; quantity: number }): Promise<string> {
  if (!Number.isSafeInteger(input.quantity) || input.quantity < 0 || input.quantity > 1000000) throw new Error("A quantidade deve ser um número inteiro entre 0 e 1.000.000.");
  const token = randomBytes(8).toString("hex");
  await getDatabasePool().execute("DELETE FROM warehouse_pending_withdrawals WHERE expires_at < UTC_TIMESTAMP()");
  await getDatabasePool().execute("INSERT INTO warehouse_pending_withdrawals (token, guild_id, user_id, item_name, quantity, expires_at) VALUES (?, ?, ?, ?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 5 MINUTE))", [token, input.guildId, input.userId, input.itemName, input.quantity]);
  return token;
}

export async function setPendingWithdrawalQuantity(token: string, guildId: string, userId: string, quantity: number): Promise<string | null> {
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 1000000) throw new Error("A quantidade deve ser um número inteiro entre 1 e 1.000.000.");
  const [rows] = await getDatabasePool().execute<Row[]>("SELECT item_name FROM warehouse_pending_withdrawals WHERE token = ? AND guild_id = ? AND user_id = ? AND expires_at > UTC_TIMESTAMP()", [token, guildId, userId]);
  if (!rows[0]) return null;
  const [result] = await getDatabasePool().execute("UPDATE warehouse_pending_withdrawals SET quantity = ? WHERE token = ? AND guild_id = ? AND user_id = ? AND expires_at > UTC_TIMESTAMP()", [quantity, token, guildId, userId]);
  return (result as { affectedRows: number }).affectedRows === 1 ? String(rows[0].item_name) : null;
}

export async function deletePendingWithdrawal(token: string, guildId: string, userId: string): Promise<void> {
  await getDatabasePool().execute("DELETE FROM warehouse_pending_withdrawals WHERE token = ? AND guild_id = ? AND user_id = ?", [token, guildId, userId]);
}

export async function consumePendingWithdrawal(token: string, guildId: string, userId: string): Promise<{ itemName: string; quantity: number } | null> {
  const conn = await getDatabasePool().getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.execute<Row[]>("SELECT item_name, quantity FROM warehouse_pending_withdrawals WHERE token = ? AND guild_id = ? AND user_id = ? AND expires_at > UTC_TIMESTAMP() FOR UPDATE", [token, guildId, userId]);
    if (!rows[0]) { await conn.rollback(); return null; }
    await conn.execute("DELETE FROM warehouse_pending_withdrawals WHERE token = ?", [token]);
    await conn.commit();
    return { itemName: String(rows[0].item_name), quantity: Number(rows[0].quantity) };
  } catch (error) { await conn.rollback(); throw error; }
  finally { conn.release(); }
}

export async function depositWarehouseBatch(input: { guildId: string; items: Array<{ name: string; quantity: number }>; userId: string; displayName: string; operationId: string }): Promise<{ slotsUsed: number; itemCount: number }> {
  if (!input.items.length || input.items.length > 40) throw new Error("A lista deve conter de 1 a 40 itens diferentes.");
  const normalized = new Map<string, { name: string; quantity: number }>();
  for (const entry of input.items) {
    const name = entry.name.trim().replace(/\s+/g, " ");
    if (!name || name.length > 100) throw new Error("Cada nome de item deve ter entre 1 e 100 caracteres.");
    if (!Number.isSafeInteger(entry.quantity) || entry.quantity < 1 || entry.quantity > 1000000) throw new Error(`Quantidade inválida para **${name}**.`);
    const key = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");
    const prior = normalized.get(key);
    if (prior) {
      prior.quantity += entry.quantity;
      if (!Number.isSafeInteger(prior.quantity) || prior.quantity > 1000000) throw new Error(`Quantidade total inválida para **${name}**.`);
    } else normalized.set(key, { name, quantity: entry.quantity });
  }

  const conn = await getDatabasePool().getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute("INSERT INTO warehouse_operations (interaction_id) VALUES (?)", [input.operationId]);
    await conn.execute("INSERT INTO warehouse_locks (guild_id) VALUES (?) ON DUPLICATE KEY UPDATE guild_id = VALUES(guild_id)", [input.guildId]);
    await conn.execute("SELECT guild_id FROM warehouse_locks WHERE guild_id = ? FOR UPDATE", [input.guildId]);
    const [existingRows] = await conn.execute<Row[]>("SELECT item_name, quantity FROM warehouse_items WHERE guild_id = ? FOR UPDATE", [input.guildId]);
    const existing = new Map(existingRows.map((row) => [String(row.item_name).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR"), Number(row.quantity)]));
    const newSlots = [...normalized.keys()].filter((key) => !existing.has(key)).length;
    if (existingRows.length + newSlots > WAREHOUSE_CAPACITY) throw new Error(`A lista ultrapassa o limite do baú. Há ${WAREHOUSE_CAPACITY - existingRows.length} espaço(s) livre(s), mas são necessários ${newSlots}.`);
    for (const [key, entry] of normalized) {
      const old = existing.get(key);
      const total = (old ?? 0) + entry.quantity;
      if (!Number.isSafeInteger(total)) throw new Error(`Quantidade total excede o limite para **${entry.name}**.`);
      if (old === undefined) await conn.execute("INSERT INTO warehouse_items (guild_id, item_name, quantity) VALUES (?, ?, ?)", [input.guildId, entry.name, entry.quantity]);
      else await conn.execute("UPDATE warehouse_items SET quantity = ? WHERE guild_id = ? AND item_name = ?", [total, input.guildId, entry.name]);
      await conn.execute("INSERT INTO warehouse_history (guild_id, action, item_name, quantity, user_id, display_name) VALUES (?, 'deposit', ?, ?, ?, ?)", [input.guildId, entry.name, entry.quantity, input.userId, input.displayName.slice(0, 150)]);
    }
    const [countRows] = await conn.execute<Row[]>("SELECT COUNT(*) AS total FROM warehouse_items WHERE guild_id = ?", [input.guildId]);
    await conn.commit();
    return { slotsUsed: Number(countRows[0]?.total ?? 0), itemCount: normalized.size };
  } catch (error) {
    await conn.rollback();
    if ((error as { code?: string }).code === "ER_DUP_ENTRY") throw new Error("Esta interação já foi processada; nenhum item duplicado foi guardado.");
    throw error;
  } finally { conn.release(); }
}
