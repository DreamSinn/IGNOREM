import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import mysql, { type Pool, type ResultSetHeader, type RowDataPacket } from "mysql2/promise";

export type ContractStatus =
  | "available"
  | "accepted"
  | "in_progress"
  | "completed"
  | "cancelled"
  | "archived";

const STATUS_NAMES: Record<ContractStatus, string> = {
  available: "disponível",
  accepted: "aceito",
  in_progress: "em andamento",
  completed: "concluído",
  cancelled: "cancelado",
  archived: "arquivado",
};

export interface GuildConfig {
  guildId: string;
  currency: string;
  managerRoleIds: string[];
  adminRoleIds: string[];
  channelIds: Record<string, string>;
  categoryIds: Record<string, string>;
  texts: Record<string, string>;
}

export interface Contract {
  id: number;
  guildId: string;
  code: string;
  title: string;
  client: string;
  description: string;
  location: string;
  totalValue: number;
  status: ContractStatus;
  paymentStatus: "pending" | "paid";
  creatorId: string;
  threadId: string | null;
  createdAt: Date;
  completedAt: Date | null;
}

export interface Participant {
  id: number;
  contractId: number;
  guildId: string;
  userId: string;
  displayName: string;
  shareAmount: number | null;
}

export interface PaymentItem {
  userId: string;
  displayName: string;
  amount: number;
}

export interface Payment {
  id: number;
  contractId: number;
  totalAmount: number;
  participantsCount: number;
  paidBy: string;
  note: string;
  paidAt: Date;
  guildShare: number;
  distributedAmount: number;
  items: PaymentItem[];
}

export interface ContractApplicant {
  id: number;
  contractId: number;
  guildId: string;
  userId: string;
  displayName: string;
  status: "pending" | "approved" | "rejected";
  createdAt: Date;
}

export interface GuildFinance {
  guildId: string;
  sharePercent: number;
  balance: number;
  totalIncome: number;
  totalExpenses: number;
}

type DbRow = RowDataPacket & Record<string, unknown>;

let pool: Pool | null = null;

function getPool(): Pool {
  if (pool) return pool;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL não configurada.");
  const parsed = new URL(url);
  const caPath = process.env.DATABASE_CA_PATH;
  pool = mysql.createPool({
    host: parsed.hostname,
    port: Number(parsed.port || 4000),
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: parsed.pathname.replace(/^\//, "") || "test",
    connectionLimit: 5,
    waitForConnections: true,
    queueLimit: 0,
    timezone: "Z",
    ssl: caPath
      ? { ca: readFileSync(caPath), rejectUnauthorized: true }
      : { rejectUnauthorized: false },
  });
  return pool;
}

const defaultTexts: Record<string, string> = {
  panelTitle: "Painel da Companhia",
  panelDescription: "Administração da estrutura, contratos e pagamentos em septims.",
  contractIntro: "Contratos registrados pela Companhia. Use o painel para criar e acompanhar missões.",
  paymentIntro: "Registro interno dos pagamentos efetuados pela Companhia.",
};

const defaultConfig = (guildId: string): GuildConfig => ({
  guildId,
  currency: "septims",
  managerRoleIds: [],
  adminRoleIds: [],
  channelIds: {},
  categoryIds: {},
  texts: { ...defaultTexts },
});

function parseJson<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "object") return value as T;
  try {
    return JSON.parse(String(value)) as T;
  } catch {
    return fallback;
  }
}

function toConfig(row: DbRow): GuildConfig {
  return {
    guildId: String(row.guild_id),
    currency: String(row.currency || "septims"),
    managerRoleIds: parseJson<string[]>(row.manager_role_ids, []),
    adminRoleIds: parseJson<string[]>(row.admin_role_ids, []),
    channelIds: parseJson<Record<string, string>>(row.channel_ids, {}),
    categoryIds: parseJson<Record<string, string>>(row.category_ids, {}),
    texts: { ...defaultTexts, ...parseJson<Record<string, string>>(row.texts, {}) },
  };
}

function toContract(row: DbRow): Contract {
  return {
    id: Number(row.id),
    guildId: String(row.guild_id),
    code: String(row.code),
    title: String(row.title),
    client: String(row.client),
    description: String(row.description),
    location: String(row.location),
    totalValue: Number(row.total_value),
    status: String(row.status) as ContractStatus,
    paymentStatus: String(row.payment_status) as "pending" | "paid",
    creatorId: String(row.creator_id),
    threadId: row.thread_id ? String(row.thread_id) : null,
    createdAt: new Date(String(row.created_at)),
    completedAt: row.completed_at ? new Date(String(row.completed_at)) : null,
  };
}

function toParticipant(row: DbRow): Participant {
  return {
    id: Number(row.id),
    contractId: Number(row.contract_id),
    guildId: String(row.guild_id),
    userId: String(row.user_id),
    displayName: String(row.display_name),
    shareAmount: row.share_amount === null ? null : Number(row.share_amount),
  };
}

export async function ensureSchema(): Promise<void> {
  const sqlPath = fileURLToPath(new URL("../sql/001_init.sql", import.meta.url));
  const sql = readFileSync(sqlPath, "utf8");
  const statements = sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((statement) => statement.trim())
    .filter(Boolean);
  for (const statement of statements) await getPool().query(statement);
}

export async function closeDatabase(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

export async function ensureGuildConfig(guildId: string): Promise<GuildConfig> {
  const initial = defaultConfig(guildId);
  await getPool().execute(
    `INSERT INTO guild_configs
      (guild_id, currency, manager_role_ids, admin_role_ids, channel_ids, category_ids, texts)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE guild_id = VALUES(guild_id)`,
    [
      guildId,
      initial.currency,
      JSON.stringify(initial.managerRoleIds),
      JSON.stringify(initial.adminRoleIds),
      JSON.stringify(initial.channelIds),
      JSON.stringify(initial.categoryIds),
      JSON.stringify(initial.texts),
    ],
  );
  return getGuildConfig(guildId);
}

export async function getGuildConfig(guildId: string): Promise<GuildConfig> {
  const [rows] = await getPool().execute<DbRow[]>("SELECT * FROM guild_configs WHERE guild_id = ? LIMIT 1", [guildId]);
  if (!rows[0]) return ensureGuildConfig(guildId);
  return toConfig(rows[0]);
}

export async function saveGuildConfig(config: GuildConfig): Promise<GuildConfig> {
  await getPool().execute(
    `UPDATE guild_configs
     SET currency = ?, manager_role_ids = ?, admin_role_ids = ?, channel_ids = ?, category_ids = ?, texts = ?
     WHERE guild_id = ?`,
    [
      config.currency,
      JSON.stringify(config.managerRoleIds),
      JSON.stringify(config.adminRoleIds),
      JSON.stringify(config.channelIds),
      JSON.stringify(config.categoryIds),
      JSON.stringify(config.texts),
      config.guildId,
    ],
  );
  return getGuildConfig(config.guildId);
}

export async function setGuildRoles(guildId: string, managerRoleIds: string[], adminRoleIds: string[]): Promise<GuildConfig> {
  const config = await getGuildConfig(guildId);
  config.managerRoleIds = [...new Set(managerRoleIds.filter(Boolean))];
  config.adminRoleIds = [...new Set(adminRoleIds.filter(Boolean))];
  return saveGuildConfig(config);
}

export async function setGuildStructure(
  guildId: string,
  categoryIds: Record<string, string>,
  channelIds: Record<string, string>,
): Promise<GuildConfig> {
  const config = await getGuildConfig(guildId);
  config.categoryIds = categoryIds;
  config.channelIds = channelIds;
  return saveGuildConfig(config);
}

export async function setGuildTexts(guildId: string, texts: Record<string, string>): Promise<GuildConfig> {
  const config = await getGuildConfig(guildId);
  config.texts = { ...config.texts, ...texts };
  return saveGuildConfig(config);
}

export async function ensureGuildFinance(guildId: string): Promise<void> {
  await getPool().execute(
    `INSERT INTO guild_finance (guild_id, share_percent, balance)
     VALUES (?, 10.00, 0.00)
     ON DUPLICATE KEY UPDATE guild_id = VALUES(guild_id)`,
    [guildId],
  );
}

export async function getGuildFinance(guildId: string): Promise<GuildFinance> {
  await ensureGuildFinance(guildId);
  const [rows] = await getPool().execute<DbRow[]>("SELECT * FROM guild_finance WHERE guild_id = ? LIMIT 1", [guildId]);
  const [incomeRows] = await getPool().execute<DbRow[]>("SELECT COALESCE(SUM(amount), 0) AS total FROM guild_ledger WHERE guild_id = ? AND kind = 'income'", [guildId]);
  const [expenseRows] = await getPool().execute<DbRow[]>("SELECT COALESCE(SUM(amount), 0) AS total FROM guild_ledger WHERE guild_id = ? AND kind = 'expense'", [guildId]);
  const row = rows[0];
  return { guildId, sharePercent: Number(row.share_percent), balance: Number(row.balance), totalIncome: Number(incomeRows[0]?.total ?? 0), totalExpenses: Number(expenseRows[0]?.total ?? 0) };
}

export async function recordGuildExpense(input: { guildId: string; amount: number; description: string; createdBy: string }): Promise<GuildFinance> {
  if (!Number.isFinite(input.amount) || input.amount <= 0) throw new Error("A despesa precisa ser maior que zero.");
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const [financeRows] = await connection.execute<DbRow[]>("SELECT * FROM guild_finance WHERE guild_id = ? FOR UPDATE", [input.guildId]);
    if (!financeRows[0]) throw new Error("Caixa da guilda ainda não foi inicializado.");
    if (Number(financeRows[0].balance) < input.amount) throw new Error(`Saldo insuficiente. Disponível: ${Number(financeRows[0].balance).toFixed(2)} septims.`);
    await connection.execute("UPDATE guild_finance SET balance = balance - ? WHERE guild_id = ?", [input.amount.toFixed(2), input.guildId]);
    await connection.execute("INSERT INTO guild_ledger (guild_id, kind, amount, description, created_by) VALUES (?, 'expense', ?, ?, ?)", [input.guildId, input.amount.toFixed(2), input.description, input.createdBy]);
    await connection.commit();
    return getGuildFinance(input.guildId);
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function applyForContract(input: { guildId: string; contractId: number; userId: string; displayName: string }): Promise<ContractApplicant> {
  const contract = await getContract(input.guildId, input.contractId);
  if (!contract) throw new Error("Contrato não encontrado.");
  if (contract.status !== "available") throw new Error("As inscrições para este contrato estão encerradas.");
  await getPool().execute(`INSERT INTO contract_applicants (contract_id, guild_id, user_id, display_name, status) VALUES (?, ?, ?, ?, 'pending') ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), status = 'pending'`, [input.contractId, input.guildId, input.userId, input.displayName]);
  const [rows] = await getPool().execute<DbRow[]>("SELECT * FROM contract_applicants WHERE guild_id = ? AND contract_id = ? AND user_id = ? LIMIT 1", [input.guildId, input.contractId, input.userId]);
  return toApplicant(rows[0]);
}

function toApplicant(row: DbRow): ContractApplicant {
  return { id: Number(row.id), contractId: Number(row.contract_id), guildId: String(row.guild_id), userId: String(row.user_id), displayName: String(row.display_name), status: String(row.status) as ContractApplicant["status"], createdAt: new Date(String(row.created_at)) };
}

export async function listApplicants(guildId: string, contractId: number): Promise<ContractApplicant[]> {
  const [rows] = await getPool().execute<DbRow[]>("SELECT * FROM contract_applicants WHERE guild_id = ? AND contract_id = ? ORDER BY created_at ASC", [guildId, contractId]);
  return rows.map(toApplicant);
}

export async function setApplicantStatus(guildId: string, applicantId: number, status: "approved" | "rejected"): Promise<ContractApplicant | null> {
  await getPool().execute("UPDATE contract_applicants SET status = ? WHERE guild_id = ? AND id = ?", [status, guildId, applicantId]);
  const [rows] = await getPool().execute<DbRow[]>("SELECT * FROM contract_applicants WHERE guild_id = ? AND id = ? LIMIT 1", [guildId, applicantId]);
  return rows[0] ? toApplicant(rows[0]) : null;
}

export async function createContract(input: {
  guildId: string;
  title: string;
  client: string;
  description: string;
  location: string;
  totalValue: number;
  creatorId: string;
}): Promise<Contract> {
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const [result] = await connection.execute<ResultSetHeader>(
      `INSERT INTO contracts
       (guild_id, code, title, client, description, location, total_value, status, payment_status, creator_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'available', 'pending', ?)`,
      [input.guildId, "PENDING", input.title, input.client, input.description, input.location, input.totalValue, input.creatorId],
    );
    const id = Number(result.insertId);
    const code = `CT-${String(id).padStart(4, "0")}`;
    await connection.execute("UPDATE contracts SET code = ? WHERE id = ?", [code, id]);
    await connection.commit();
    const contract = await getContract(input.guildId, id);
    if (!contract) throw new Error("Contrato criado, mas não localizado.");
    return contract;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function setContractThread(guildId: string, id: number, threadId: string): Promise<void> {
  await getPool().execute("UPDATE contracts SET thread_id = ? WHERE guild_id = ? AND id = ?", [threadId, guildId, id]);
}

export async function getContract(guildId: string, id: number): Promise<Contract | null> {
  const [rows] = await getPool().execute<DbRow[]>("SELECT * FROM contracts WHERE guild_id = ? AND id = ? LIMIT 1", [guildId, id]);
  return rows[0] ? toContract(rows[0]) : null;
}

export async function listContracts(guildId: string, status?: ContractStatus): Promise<Contract[]> {
  const query = status
    ? "SELECT * FROM contracts WHERE guild_id = ? AND status = ? ORDER BY created_at DESC"
    : "SELECT * FROM contracts WHERE guild_id = ? ORDER BY created_at DESC";
  const params = status ? [guildId, status] : [guildId];
  const [rows] = await getPool().execute<DbRow[]>(query, params);
  return rows.map(toContract);
}

export async function setContractStatus(guildId: string, id: number, status: ContractStatus): Promise<Contract | null> {
  const current = await getContract(guildId, id);
  if (!current) return null;
  const allowed: Record<ContractStatus, ContractStatus[]> = {
    available: ["accepted", "cancelled"],
    accepted: ["in_progress", "cancelled"],
    in_progress: ["completed", "cancelled"],
    completed: ["archived"],
    cancelled: ["archived"],
    archived: [],
  };
  if (current.status !== status && !allowed[current.status].includes(status)) {
    throw new Error(`Transição inválida: ${STATUS_NAMES[current.status]} → ${STATUS_NAMES[status]}.`);
  }
  await getPool().execute(
    "UPDATE contracts SET status = ?, completed_at = CASE WHEN ? = 'completed' THEN CURRENT_TIMESTAMP ELSE completed_at END WHERE guild_id = ? AND id = ?",
    [status, status, guildId, id],
  );
  return getContract(guildId, id);
}

export async function addParticipants(
  guildId: string,
  contractId: number,
  participants: Array<{ userId: string; displayName: string }>,
): Promise<Participant[]> {
  const contract = await getContract(guildId, contractId);
  if (!contract) throw new Error("Contrato não encontrado.");
  for (const participant of participants) {
    await getPool().execute(
      `INSERT INTO contract_participants (contract_id, guild_id, user_id, display_name)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE display_name = VALUES(display_name)`,
      [contractId, guildId, participant.userId, participant.displayName],
    );
  }
  return listParticipants(guildId, contractId);
}

export async function listParticipants(guildId: string, contractId: number): Promise<Participant[]> {
  const [rows] = await getPool().execute<DbRow[]>(
    "SELECT * FROM contract_participants WHERE guild_id = ? AND contract_id = ? ORDER BY created_at ASC",
    [guildId, contractId],
  );
  return rows.map(toParticipant);
}

export async function recordPayment(input: {
  guildId: string;
  contractId: number;
  paidBy: string;
  totalAmount?: number;
  note: string;
}): Promise<Payment> {
  await ensureGuildFinance(input.guildId);
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const [contractRows] = await connection.execute<DbRow[]>(
      "SELECT * FROM contracts WHERE guild_id = ? AND id = ? FOR UPDATE",
      [input.guildId, input.contractId],
    );
    if (!contractRows[0]) throw new Error("Contrato não encontrado.");
    const contract = toContract(contractRows[0]);
    if (contract.paymentStatus === "paid") throw new Error("Este contrato já possui pagamento registrado.");
    if (contract.status !== "completed") throw new Error("O contrato precisa estar concluído antes do pagamento.");

    const [participantRows] = await connection.execute<DbRow[]>(
      "SELECT * FROM contract_participants WHERE guild_id = ? AND contract_id = ? ORDER BY created_at ASC",
      [input.guildId, input.contractId],
    );
    if (!participantRows.length) throw new Error("Adicione pelo menos um participante antes de pagar o contrato.");

    const total = Number(input.totalAmount ?? contract.totalValue);
    if (!Number.isFinite(total) || total <= 0) throw new Error("O valor do pagamento precisa ser maior que zero.");
    const [financeRows] = await connection.execute<DbRow[]>("SELECT * FROM guild_finance WHERE guild_id = ? FOR UPDATE", [input.guildId]);
    const sharePercent = Number(financeRows[0]?.share_percent ?? 10);
    const guildShare = Math.round(total * sharePercent) / 100;
    const distributedAmount = Math.round((total - guildShare) * 100) / 100;
    const cents = Math.round(distributedAmount * 100);
    const base = Math.floor(cents / participantRows.length);
    const remainder = cents - base * participantRows.length;

    const [paymentResult] = await connection.execute<ResultSetHeader>(
      `INSERT INTO payments (contract_id, guild_id, total_amount, participants_count, paid_by, note)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [input.contractId, input.guildId, total.toFixed(2), participantRows.length, input.paidBy, input.note],
    );
    const paymentId = Number(paymentResult.insertId);
    const items: PaymentItem[] = [];
    for (let index = 0; index < participantRows.length; index += 1) {
      const row = participantRows[index];
      const amount = (base + (index < remainder ? 1 : 0)) / 100;
      const displayName = String(row.display_name);
      const userId = String(row.user_id);
      items.push({ userId, displayName, amount });
      await connection.execute("UPDATE contract_participants SET share_amount = ? WHERE id = ?", [amount.toFixed(2), row.id]);
      await connection.execute(
        `INSERT INTO payment_items (payment_id, contract_id, guild_id, user_id, display_name, amount)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [paymentId, input.contractId, input.guildId, userId, displayName, amount.toFixed(2)],
      );
    }
    await connection.execute("UPDATE contracts SET payment_status = 'paid' WHERE guild_id = ? AND id = ?", [input.guildId, input.contractId]);
    await connection.execute("UPDATE guild_finance SET balance = balance + ? WHERE guild_id = ?", [guildShare.toFixed(2), input.guildId]);
    await connection.execute("INSERT INTO guild_ledger (guild_id, contract_id, kind, amount, description, created_by) VALUES (?, ?, 'income', ?, ?, ?)", [input.guildId, input.contractId, guildShare.toFixed(2), `Participação de ${contract.code}`, input.paidBy]);
    await connection.commit();
    return {
      id: paymentId,
      contractId: input.contractId,
      totalAmount: total,
      participantsCount: participantRows.length,
      paidBy: input.paidBy,
      note: input.note,
      paidAt: new Date(),
      guildShare,
      distributedAmount,
      items,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function getPayment(guildId: string, contractId: number): Promise<Payment | null> {
  const [paymentRows] = await getPool().execute<DbRow[]>(
    "SELECT * FROM payments WHERE guild_id = ? AND contract_id = ? LIMIT 1",
    [guildId, contractId],
  );
  if (!paymentRows[0]) return null;
  const row = paymentRows[0];
  const [itemRows] = await getPool().execute<DbRow[]>(
    "SELECT * FROM payment_items WHERE guild_id = ? AND contract_id = ? ORDER BY id ASC",
    [guildId, contractId],
  );
  return {
    id: Number(row.id),
    contractId: Number(row.contract_id),
    totalAmount: Number(row.total_amount),
    participantsCount: Number(row.participants_count),
    paidBy: String(row.paid_by),
    note: String(row.note),
    paidAt: new Date(String(row.paid_at)),
    guildShare: Number(row.total_amount) - itemRows.reduce((sum, item) => sum + Number(item.amount), 0),
    distributedAmount: itemRows.reduce((sum, item) => sum + Number(item.amount), 0),
    items: itemRows.map((item) => ({
      userId: String(item.user_id),
      displayName: String(item.display_name),
      amount: Number(item.amount),
    })),
  };
}
