import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChatInputCommandInteraction,
  Client,
  EmbedBuilder,
  Events,
  Guild,
  ChannelType,
  ModalBuilder,
  ModalSubmitInteraction,
  PermissionFlagsBits,
  REST,
  Routes,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
  type ButtonInteraction,
  type Channel,
  type Interaction,
  type StringSelectMenuInteraction,
  type UserSelectMenuInteraction,
} from "discord.js";
import {
  addParticipants,
  applyForContract,
  createContract,
  ensureGuildFinance,
  ensureGuildConfig,
  getContract,
  getGuildConfig,
  getGuildFinance,
  getPayment,
  listParticipants,
  listApplicants,
  listContracts,
  recordPayment,
  recordGuildExpense,
  setApplicantStatus,
  setContractAnnouncement,
  setContractStatus,
  setContractThread,
  setGuildRoles,
  setGuildStructure,
  setGuildTexts,
  type Contract,
  type ContractStatus,
  type GuildConfig,
} from "./db.js";

const COLORS = {
  midnight: 0x111827,
  steel: 0x475569,
  gold: 0xc49a4a,
  green: 0x4f8a62,
  red: 0xa34f4f,
  blue: 0x477fae,
};
const ICONS = {
  crown: "♛",
  sword: "⚔️",
  scroll: "📜",
  coin: "🪙",
  compass: "🧭",
  shield: "🛡️",
  hammer: "🔨",
  book: "📖",
  people: "👥",
  check: "✅",
  clock: "⏳",
  lock: "🔒",
};
// Override this with PANEL_BANNER_URL in Render if you replace the artwork later.
const PANEL_BANNER_URL = process.env.PANEL_BANNER_URL ?? "https://files.manuscdn.com/user_upload_by_module/session_file/310519663954740263/lSRWcVrLiNCANlcG.png";
const STATUS_LABELS: Record<ContractStatus, string> = {
  available: "🟢 Disponível",
  accepted: "🔵 Aceito",
  in_progress: "🟡 Em andamento",
  completed: "✅ Concluído",
  cancelled: "🔴 Cancelado",
  archived: "📦 Arquivado",
};

const statusOptions = Object.entries(STATUS_LABELS).map(([value, label]) => ({
  label,
  value,
  description: `Mover o contrato para: ${label.toLowerCase()}`,
}));

const categorySpecs = [
  { key: "companhia", name: "𝗖𝗢𝗠𝗣𝗔𝗡𝗛𝗜𝗔", channels: [
    { key: "painel-configuracao", name: "🔒・𝗣𝗮𝗶𝗻𝗲𝗹", type: "text" },
    { key: "contratos", name: "📜・𝗖𝗼𝗻𝘁𝗿𝗮𝘁𝗼𝘀", type: "text" },
    { key: "chat-geral", name: "💬・𝗖𝗵𝗮𝘁-𝗚𝗲𝗿𝗮𝗹", type: "text" },
    { key: "arquivo", name: "🗃️・𝗔𝗿𝗾𝘂𝗶𝘃𝗼", type: "text" },
    { key: "caixa-guilda", name: "💰・𝗖𝗮𝗶𝘅𝗮-𝗱𝗮-𝗚𝘂𝗶𝗹𝗱𝗮", type: "text" },
  ] },
] as const;

function isTextChannel(channel: Channel | null | undefined): channel is Extract<Channel, { type: ChannelType.GuildText }> {
  return Boolean(channel && channel.type === ChannelType.GuildText);
}

function hasAdministrator(interaction: Interaction): boolean {
  if (!interaction.inGuild() || !interaction.member || typeof interaction.member.permissions === "string") return false;
  return interaction.guild?.ownerId === interaction.user.id || interaction.member.permissions.has(PermissionFlagsBits.Administrator);
}

async function hasConfiguredRole(interaction: Interaction, kind: "manager" | "admin"): Promise<boolean> {
  if (!interaction.inGuild() || !interaction.member || !("roles" in interaction.member) || Array.isArray(interaction.member.roles)) return false;
  const roles = interaction.member.roles;
  const config = await getGuildConfig(interaction.guildId);
  const ids = (kind === "manager" ? config.managerRoleIds : config.adminRoleIds).filter((id) => id !== interaction.guild?.roles.everyone.id);
  return ids.some((id) => roles.cache.has(id));
}

async function canAdmin(interaction: Interaction): Promise<boolean> {
  return hasAdministrator(interaction) || (await hasConfiguredRole(interaction, "admin"));
}

async function canManage(interaction: Interaction): Promise<boolean> {
  return (await canAdmin(interaction)) || (await hasConfiguredRole(interaction, "manager"));
}

function money(value: number): string {
  return `${value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} septims`;
}

function parseMoney(value: string): number {
  const raw = value.trim().replace(/\s/g, "");
  if (!raw || !/^\d+(?:[.,]\d+)?(?:[.,]\d+)*$/.test(raw)) throw new Error("Informe um valor positivo em septims.");
  const lastComma = raw.lastIndexOf(",");
  const lastDot = raw.lastIndexOf(".");
  let normalized: string;
  if (lastComma >= 0 && lastDot >= 0) {
    normalized = lastComma > lastDot ? raw.replace(/\./g, "").replace(",", ".") : raw.replace(/,/g, "");
  } else if (lastComma >= 0) {
    normalized = raw.replace(/\./g, "").replace(",", ".");
  } else if (lastDot >= 0 && raw.slice(lastDot + 1).length <= 2) {
    normalized = raw;
  } else {
    normalized = raw.replace(/\./g, "");
  }
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error("Informe um valor positivo em septims.");
  return Math.round(parsed * 100) / 100;
}

function parseRoleIds(value: string): string[] {
  return [...new Set(value.split(/[\s,;]+/).map((part) => part.replace(/[<@&>]/g, "").trim()).filter(Boolean))];
}

function input(customId: string, label: string, style: TextInputStyle, required = true, maxLength = 1000): TextInputBuilder {
  return new TextInputBuilder().setCustomId(customId).setLabel(label).setStyle(style).setRequired(required).setMaxLength(maxLength);
}

function panelEmbed(config: GuildConfig): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(COLORS.gold)
    .setTitle(`${ICONS.crown}  ${config.texts.panelTitle}`)
    .setDescription(`> ${config.texts.panelDescription}\n\n**Livro de comando da Companhia**\nUse os controles abaixo para registrar missões, organizar a equipe e manter o caixa em ordem. Todas as ações administrativas ficam registradas no histórico.`)
    .addFields(
      { name: `${ICONS.hammer} Estrutura`, value: "Categorias, canais e permissões da guilda.", inline: true },
      { name: `${ICONS.shield} Autoridade`, value: `Admins: **${config.adminRoleIds.length || "a definir"}**\nGerentes: **${config.managerRoleIds.length || "a definir"}**`, inline: true },
      { name: `${ICONS.coin} Tesouraria`, value: `Unidade: **${config.currency}**`, inline: true },
      { name: `${ICONS.scroll} Quadro de missões`, value: "Abra contratos, forme equipes, mova estados e lance pagamentos sem sair do Discord.", inline: false },
    )
    .setImage(PANEL_BANNER_URL)
    .setFooter({ text: "COMPANHIA DE MERCENÁRIOS  •  O registro permanece" })
    .setTimestamp();
}

function panelComponents(): ActionRowBuilder<ButtonBuilder>[] {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("panel:new-contract").setLabel("Novo contrato").setEmoji(ICONS.scroll).setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId("panel:contracts").setLabel("Quadro de missões").setEmoji(ICONS.sword).setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("panel:payments").setLabel("Livro-caixa").setEmoji(ICONS.coin).setStyle(ButtonStyle.Secondary),
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("panel:structure").setLabel("Sincronizar estrutura").setEmoji(ICONS.hammer).setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("panel:roles").setLabel("Cargos autorizados").setEmoji(ICONS.shield).setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("panel:texts").setLabel("Identidade da guilda").setEmoji("✒️").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("panel:refresh").setLabel("Recarregar").setEmoji("🔄").setStyle(ButtonStyle.Secondary),
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("panel:clear-chat").setLabel("Limpar chat atual").setEmoji("🧹").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("panel:wipe-server").setLabel("Apagar canais do servidor").setEmoji("⚠️").setStyle(ButtonStyle.Danger),
    ),
  ];
}

async function findOrCreateCategory(guild: Guild, name: string): Promise<Extract<Channel, { type: ChannelType.GuildCategory }>> {
  const existing = guild.channels.cache.find((channel) => channel.type === ChannelType.GuildCategory && channel.name === name);
  if (existing && existing.type === ChannelType.GuildCategory) return existing;
  return guild.channels.create({ name, type: ChannelType.GuildCategory, reason: "Estrutura da Companhia" });
}

async function findOrCreateChannel(guild: Guild, name: string, type: "text" | "voice", parentId: string, topic?: string): Promise<Channel> {
  const channelType = type === "text" ? ChannelType.GuildText : ChannelType.GuildVoice;
  const existing = guild.channels.cache.find((channel) => channel.type === channelType && channel.name === name && channel.parentId === parentId);
  if (existing) {
    if (type === "text" && isTextChannel(existing) && topic && existing.topic !== topic) await existing.setTopic(topic);
    return existing;
  }
  return guild.channels.create({ name, type: channelType, parent: parentId, topic: type === "text" ? topic : undefined, reason: "Estrutura da Companhia" });
}

export async function syncPanelPermissions(guild: Guild, config: GuildConfig): Promise<void> {
  const panel = guild.channels.cache.get(config.channelIds["painel-configuracao"]);
  if (!isTextChannel(panel)) return;
  const authorizedRoleIds = [...new Set([...config.adminRoleIds, ...config.managerRoleIds])].filter((id) => id !== guild.roles.everyone.id);
  const overwrites = [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: guild.ownerId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
    { id: guild.client.user?.id ?? "", allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageThreads] },
    ...authorizedRoleIds.map((id) => ({ id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] })),
  ].filter((entry) => entry.id);
  await panel.permissionOverwrites.set(overwrites, "Aplicar cargos autorizados ao painel");
}

async function syncOperationalPermissions(guild: Guild, config: GuildConfig): Promise<void> {
  const adminIds = [...new Set([...config.adminRoleIds, ...config.managerRoleIds])].filter((id) => id !== guild.roles.everyone.id);
  const everyone = {
    id: guild.roles.everyone.id,
    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
    deny: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.SendMessagesInThreads, PermissionFlagsBits.CreatePublicThreads, PermissionFlagsBits.CreatePrivateThreads],
  };
  const bot = { id: guild.client.user?.id ?? "", allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.ManageMessages, PermissionFlagsBits.ManageThreads, PermissionFlagsBits.ReadMessageHistory] };
  const readOnly = [everyone, bot, ...adminIds.map((id) => ({ id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory], deny: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.SendMessagesInThreads, PermissionFlagsBits.CreatePublicThreads, PermissionFlagsBits.CreatePrivateThreads] }))].filter((entry) => entry.id);
  const caixa = guild.channels.cache.get(config.channelIds["caixa-guilda"]);
  const arquivo = guild.channels.cache.get(config.channelIds.arquivo);
  if (caixa && caixa.isTextBased() && "permissionOverwrites" in caixa) await caixa.permissionOverwrites.set(readOnly, "Caixa somente leitura");
  if (arquivo && arquivo.isTextBased() && "permissionOverwrites" in arquivo) await arquivo.permissionOverwrites.set(readOnly, "Arquivo somente leitura");
}

function financeEmbed(finance: Awaited<ReturnType<typeof getGuildFinance>>): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(COLORS.gold)
    .setAuthor({ name: "💰 𝗖𝗔𝗜𝗫𝗔 𝗗𝗔 𝗚𝗨𝗜𝗟𝗗𝗔" })
    .setDescription("> Fundo coletivo da Companhia. Este canal é somente leitura.")
    .addFields(
      { name: "Saldo disponível", value: `**${money(finance.balance)}**`, inline: false },
      { name: "Entradas acumuladas", value: money(finance.totalIncome), inline: true },
      { name: "Despesas acumuladas", value: money(finance.totalExpenses), inline: true },
      { name: "Participação por contrato", value: `${finance.sharePercent.toFixed(2)}%`, inline: true },
    )
    .setFooter({ text: "COMPANHIA_FINANCE_MESSAGE • Atualizado automaticamente após cada lançamento" })
    .setTimestamp();
}

async function upsertFinanceMessage(channel: Channel, guildId: string): Promise<void> {
  if (!isTextChannel(channel)) return;
  const finance = await getGuildFinance(guildId);
  const recent = await channel.messages.fetch({ limit: 100 });
  const matches = [...recent.values()]
    .filter((message) => message.author.id === channel.client.user?.id && message.embeds.some((embed) => embed.footer?.text?.startsWith("COMPANHIA_FINANCE_MESSAGE")))
    .sort((a, b) => a.createdTimestamp - b.createdTimestamp);
  // Compatibilidade com o embed anterior, cujo nome do autor usa caracteres matemáticos Unicode.
  if (!matches.length) {
    matches.push(...[...recent.values()].filter((message) => message.author.id === channel.client.user?.id && message.embeds.some((embed) => embed.author?.name === "💰 𝗖𝗔𝗜𝗫𝗔 𝗗𝗔 𝗚𝗨𝗜𝗟𝗗𝗔")));
    matches.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
  }
  if (matches[0]) {
    await matches[0].edit({ embeds: [financeEmbed(finance)] });
    for (const duplicate of matches.slice(1)) await duplicate.delete().catch(() => undefined);
  } else {
    await channel.send({ embeds: [financeEmbed(finance)] });
  }
}

export async function provisionGuildStructure(guild: Guild): Promise<GuildConfig> {
  let config = await ensureGuildConfig(guild.id);
  const categoryIds = { ...config.categoryIds };
  const channelIds = { ...config.channelIds };
  for (const spec of categorySpecs) {
    const category = await findOrCreateCategory(guild, spec.name);
    categoryIds[spec.key] = category.id;
    for (const channelSpec of spec.channels) {
      const topic = channelSpec.key === "painel-configuracao"
        ? "Sala privada para configurar a Companhia por botões e menus."
          : channelSpec.key === "contratos"
          ? "Tópicos individuais acompanham as missões aceitas pela Companhia."
          : undefined;
      const channel = await findOrCreateChannel(guild, channelSpec.name, channelSpec.type, category.id, topic);
      channelIds[channelSpec.key] = channel.id;
    }
  }
  config = await setGuildStructure(guild.id, categoryIds, channelIds);
  await syncPanelPermissions(guild, config);
  await syncOperationalPermissions(guild, config);
  await ensureGuildFinance(guild.id);
  const panel = guild.channels.cache.get(channelIds["painel-configuracao"]);
  if (isTextChannel(panel)) await upsertPanelMessage(panel, config);
  const treasury = guild.channels.cache.get(channelIds["caixa-guilda"]);
  if (treasury) await upsertFinanceMessage(treasury, guild.id);
  return config;
}

async function upsertPanelMessage(channel: Extract<Channel, { type: ChannelType.GuildText }>, config: GuildConfig): Promise<void> {
  const recent = await channel.messages.fetch({ limit: 100 });
  const matches = [...recent.values()]
    .filter((message) => message.author.id === channel.client.user?.id && message.embeds.some((embed) => embed.footer?.text === "COMPANHIA DE MERCENÁRIOS  •  O registro permanece" || embed.title === `${ICONS.crown}  ${config.texts.panelTitle}`))
    .sort((a, b) => a.createdTimestamp - b.createdTimestamp);
  if (matches[0]) {
    await matches[0].edit({ embeds: [panelEmbed(config)], components: panelComponents() });
    for (const duplicate of matches.slice(1)) await duplicate.delete().catch(() => undefined);
  } else {
    await channel.send({ embeds: [panelEmbed(config)], components: panelComponents() });
  }
}

function contractEmbed(contract: Contract, participantText = "Nenhum participante registrado."): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(contract.status === "completed" ? COLORS.green : contract.status === "cancelled" ? COLORS.red : contract.status === "in_progress" ? COLORS.gold : COLORS.steel)
    .setAuthor({ name: `${ICONS.sword}  CONTRATO DA COMPANHIA` })
    .setTitle(`${contract.code}  •  ${contract.title}`)
    .setDescription(`> ${contract.description}`)
    .addFields(
      { name: "👤 Contratante", value: contract.client, inline: true },
      { name: `${ICONS.compass} Local`, value: contract.location || "Não informado", inline: true },
      { name: `${ICONS.coin} Recompensa`, value: `**${money(contract.totalValue)}**`, inline: true },
      { name: "📌 Situação", value: STATUS_LABELS[contract.status], inline: true },
      { name: "💰 Pagamento", value: contract.paymentStatus === "paid" ? `${ICONS.check} Lançado` : `${ICONS.clock} Pendente`, inline: true },
      { name: `${ICONS.people} Equipe`, value: participantText, inline: false },
    )
    .setThumbnail(PANEL_BANNER_URL)
    .setFooter({ text: `Registro da Companhia  •  ${contract.code}` })
    .setTimestamp(contract.createdAt);
}

const statusChannelKeys: Record<ContractStatus, string> = {
  available: "contratos",
  accepted: "contratos",
  in_progress: "contratos",
  completed: "arquivo",
  cancelled: "arquivo",
  archived: "arquivo",
};

function participantSummary(participants: Awaited<ReturnType<typeof listParticipants>>): string {
  if (!participants.length) return "Nenhum participante registrado.";
  const lines: string[] = [];
  let length = 0;
  for (const participant of participants) {
    const line = `<@${participant.userId}> — ${participant.displayName}${participant.shareAmount !== null ? ` — ${money(participant.shareAmount)}` : ""}`;
    if (length + line.length + (lines.length ? 1 : 0) > 900) break;
    lines.push(line);
    length += line.length + (lines.length > 1 ? 1 : 0);
  }
  const omitted = participants.length - lines.length;
  if (omitted > 0) lines.push(`… e mais ${omitted} participante(s).`);
  return lines.join("\n");
}

function isContractMessage(message: { author: { id: string }; embeds: readonly { footer?: { text?: string | null } | null }[] }, code: string, botId: string): boolean {
  return message.author.id === botId && message.embeds.some((embed) => embed.footer?.text === `Registro da Companhia  •  ${code}`);
}

async function upsertContractThread(guild: Guild, contract: Contract, embed: EmbedBuilder): Promise<void> {
  if (!contract.threadId) return;
  try {
    const thread = await guild.channels.fetch(contract.threadId);
    if (!thread?.isThread()) return;
    const recent = await thread.messages.fetch({ limit: 100 });
    const matches = [...recent.values()]
      .filter((message) => isContractMessage(message, contract.code, guild.client.user!.id))
      .sort((a, b) => a.createdTimestamp - b.createdTimestamp);
    if (matches[0]) {
      await matches[0].edit({ embeds: [embed] });
      for (const duplicate of matches.slice(1)) await duplicate.delete().catch(() => undefined);
    } else {
      await thread.send({ embeds: [embed] });
    }
  } catch (error) {
    console.warn(`Não foi possível atualizar o tópico de ${contract.code}`, error);
  }
}

async function announceContractState(guild: Guild, config: GuildConfig, contract: Contract): Promise<void> {
  const botId = guild.client.user?.id;
  if (!botId) return;
  const participants = await listParticipants(guild.id, contract.id);
  const embed = contractEmbed(contract, participantSummary(participants));
  const components = contract.status === "available"
    ? [new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(`contract:apply:${contract.id}`).setLabel("Tenho interesse").setEmoji("🪶").setStyle(ButtonStyle.Success), new ButtonBuilder().setCustomId(`contract:view:${contract.id}`).setLabel("Ver detalhes").setEmoji("📜").setStyle(ButtonStyle.Secondary))]
    : [];
  const target = guild.channels.cache.get(config.channelIds[statusChannelKeys[contract.status]]);
  const targetChannel = isTextChannel(target) ? target : undefined;

  let announcement;
  let announcementPersisted = false;
  let announcementChannel: Extract<Channel, { type: ChannelType.GuildText }> | undefined;
  if (contract.announcementChannelId && contract.announcementMessageId) {
    const savedChannel = guild.channels.cache.get(contract.announcementChannelId);
    if (isTextChannel(savedChannel)) {
      announcementChannel = savedChannel;
      try {
        announcement = await savedChannel.messages.fetch(contract.announcementMessageId);
        announcementPersisted = true;
      } catch {
        announcement = undefined;
      }
    }
  }

  // Contratos publicados antes desta correção não possuem os IDs salvos; localizar e reaproveitar o cartão original.
  if (!announcement) {
    const legacyChannels = [...new Set([config.channelIds.contratos, config.channelIds.arquivo])]
      .map((id) => guild.channels.cache.get(id))
      .filter(isTextChannel);
    const legacyMatches = [];
    for (const channel of legacyChannels) {
      const recent = await channel.messages.fetch({ limit: 100 }).catch(() => null);
      if (!recent) continue;
      legacyMatches.push(...[...recent.values()].filter((message) => isContractMessage(message, contract.code, botId)));
    }
    legacyMatches.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
    if (legacyMatches[0]) {
      announcement = legacyMatches[0];
      const foundChannel = guild.channels.cache.get(announcement.channelId);
      if (isTextChannel(foundChannel)) announcementChannel = foundChannel;
      for (const duplicate of legacyMatches.slice(1)) await duplicate.delete().catch(() => undefined);
    }
  }

  // Mesmo com um ID persistido, limpar cartões deixados em outro canal por uma falha ao mover.
  if (announcement) {
    const channels = [...new Set([config.channelIds.contratos, config.channelIds.arquivo])]
      .map((id) => guild.channels.cache.get(id))
      .filter(isTextChannel);
    for (const channel of channels) {
      const recent = await channel.messages.fetch({ limit: 100 }).catch(() => null);
      if (!recent) continue;
      for (const duplicate of recent.values()) {
        if (duplicate.id !== announcement.id && isContractMessage(duplicate, contract.code, botId)) {
          await duplicate.delete().catch(() => undefined);
        }
      }
    }
  }

  if (announcement && announcementChannel && targetChannel && announcementChannel.id !== targetChannel.id) {
    try {
      const moved = await targetChannel.send({ embeds: [embed], components });
      try {
        await setContractAnnouncement(guild.id, contract.id, targetChannel.id, moved.id);
      } catch (error) {
        await moved.delete().catch(() => undefined);
        throw error;
      }
      announcementPersisted = true;
      await announcement.delete().catch(() => undefined);
      announcement = moved;
      announcementChannel = targetChannel;
    } catch {
      // Se não for possível publicar no canal de destino, conserva e atualiza o cartão original.
      try {
        await announcement.edit({ embeds: [embed], components });
        if (!announcementPersisted) {
          await setContractAnnouncement(guild.id, contract.id, announcementChannel.id, announcement.id);
          announcementPersisted = true;
        }
      } catch {
        announcement = undefined;
      }
    }
  } else if (announcement && announcementChannel) {
    try {
      await announcement.edit({ embeds: [embed], components });
      if (!announcementPersisted) {
        await setContractAnnouncement(guild.id, contract.id, announcementChannel.id, announcement.id);
        announcementPersisted = true;
      }
    } catch {
      announcement = undefined;
    }
  }
  if (!announcement) {
    if (!targetChannel) return;
    const sent = await targetChannel.send({ embeds: [embed], components });
    try {
      await setContractAnnouncement(guild.id, contract.id, targetChannel.id, sent.id);
      announcementPersisted = true;
    } catch (error) {
      await sent.delete().catch(() => undefined);
      throw error;
    }
  }

  await upsertContractThread(guild, contract, embed);
}

async function contractDetail(interaction: ButtonInteraction, id: number): Promise<unknown> {
  await interaction.deferReply({ ephemeral: true });
  const contract = await getContract(interaction.guildId!, id);
  if (!contract) return interaction.editReply({ content: "Contrato não encontrado." });
  const participants = await listParticipants(interaction.guildId!, id);
  const applicants = await listApplicants(interaction.guildId!, id);
  const participantText = participantSummary(participants);
  const transitions: Record<ContractStatus, ContractStatus[]> = {
    available: ["accepted", "cancelled"],
    accepted: ["in_progress", "cancelled"],
    in_progress: ["completed", "cancelled"],
    completed: ["archived"],
    cancelled: ["archived"],
    archived: [],
  };
  const rows: ActionRowBuilder<ButtonBuilder | UserSelectMenuBuilder | StringSelectMenuBuilder>[] = [];
  if (transitions[contract.status].length) {
    rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`contract:status:${id}`)
        .setPlaceholder("📌 Alterar situação da missão")
        .addOptions(statusOptions.filter((option) => transitions[contract.status].includes(option.value as ContractStatus))),
    ));
  }
  if (contract.paymentStatus === "pending") {
    rows.push(new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
      new UserSelectMenuBuilder().setCustomId(`contract:participants:${id}`).setPlaceholder("👥 Montar equipe da missão").setMinValues(1).setMaxValues(10),
    ));
  }
  const pending = applicants.filter((applicant) => applicant.status === "pending").slice(0, 5);
  if (pending.length && contract.status === "available" && await canManage(interaction)) {
    rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(...pending.map((applicant) => new ButtonBuilder().setCustomId(`contract:appapprove:${id}:${applicant.id}`).setLabel(`Aprovar ${applicant.displayName.slice(0, 12)}`).setEmoji("✅").setStyle(ButtonStyle.Success))));
  }
  const buttons = new ActionRowBuilder<ButtonBuilder>();
  if (contract.status === "completed" && contract.paymentStatus === "pending") {
    buttons.addComponents(new ButtonBuilder().setCustomId(`contract:pay:${id}`).setLabel("Lançar pagamento").setEmoji(ICONS.coin).setStyle(ButtonStyle.Success));
  }
  if (transitions[contract.status].includes("archived")) {
    buttons.addComponents(new ButtonBuilder().setCustomId(`contract:archive:${id}`).setLabel("Arquivar registro").setEmoji("📦").setStyle(ButtonStyle.Secondary));
  }
  if (buttons.components.length) rows.push(buttons);
  await interaction.editReply({ embeds: [contractEmbed(contract, participantText)], components: rows });
}

async function contractsMenu(interaction: ButtonInteraction | ChatInputCommandInteraction): Promise<void> {
  const menu = new StringSelectMenuBuilder().setCustomId("contracts:status").setPlaceholder("Filtrar contratos por estado").addOptions([
    { label: "📚 Todos os contratos", value: "all", description: "Mostrar o histórico completo" },
    ...statusOptions,
  ]);
  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
  await interaction.reply({ content: `${ICONS.book} **Quadro de missões**\nEscolha uma situação para consultar os contratos registrados.`, components: [row], ephemeral: true });
}

async function showContractList(interaction: StringSelectMenuInteraction, value: string): Promise<unknown> {
  await interaction.deferUpdate();
  const status = value === "all" ? undefined : value as ContractStatus;
  const contracts = await listContracts(interaction.guildId!, status);
  if (!contracts.length) return interaction.editReply({ content: "Nenhum contrato encontrado para esse filtro.", components: [], embeds: [] });
  const candidates = contracts.slice(0, 15).map((contract) => `${STATUS_LABELS[contract.status]}  **${contract.code}** — ${contract.title}\n> ${money(contract.totalValue)}  •  pagamento: ${contract.paymentStatus === "paid" ? "lançado" : "pendente"}`);
  const lines: string[] = [];
  let contentLength = 100;
  for (const line of candidates) {
    if (contentLength + line.length + 2 > 1850) break;
    lines.push(line);
    contentLength += line.length + 2;
  }
  const buttons = new ActionRowBuilder<ButtonBuilder>();
  for (const contract of contracts.slice(0, 5)) buttons.addComponents(new ButtonBuilder().setCustomId(`contract:view:${contract.id}`).setLabel(contract.code).setStyle(ButtonStyle.Secondary));
  const hidden = contracts.length - lines.length;
  await interaction.editReply({ content: `${ICONS.book} **Contratos registrados${status ? ` — ${STATUS_LABELS[status]}` : ""}**\n\n${lines.join("\n\n")}${hidden > 0 ? `\n\n_Exibindo ${lines.length} de ${contracts.length} contratos; refine o filtro para ver outros._` : ""}`, components: buttons.components.length ? [buttons] : [] });
}

async function paymentLedger(interaction: ButtonInteraction | ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });
  const contracts = (await listContracts(interaction.guildId!)).filter((contract) => contract.paymentStatus === "paid");
  if (!contracts.length) {
    await interaction.editReply(`${ICONS.coin} **Livro-caixa vazio**\nAinda não há pagamentos registrados para esta guilda.`);
    return;
  }
  const lines: string[] = [];
  for (const contract of contracts.slice(0, 15)) {
    const payment = await getPayment(interaction.guildId!, contract.id);
    lines.push(`**${contract.code}**  ${contract.title}\n> ${ICONS.coin} ${money(payment?.totalAmount ?? contract.totalValue)}  •  ${payment?.items.length ?? 0} participante(s)`);
  }
  const paymentFields = [];
  for (let index = 0; index < lines.length; index += 4) {
    paymentFields.push({ name: index === 0 ? "Lançamentos recentes" : "Continuação", value: lines.slice(index, index + 4).join("\n\n"), inline: false });
  }
  const embed = new EmbedBuilder()
    .setColor(COLORS.gold)
    .setAuthor({ name: `${ICONS.coin}  LIVRO-CAIXA DA COMPANHIA` })
    .setDescription("Pagamentos lançados e registrados no histórico financeiro.")
    .addFields(paymentFields)
    .setFooter({ text: contracts.length > 15 ? "Exibindo os 15 lançamentos mais recentes" : "Histórico financeiro auditável" })
    .setTimestamp();
  await interaction.editReply({ embeds: [embed] });
}

async function newContractModal(interaction: ButtonInteraction | ChatInputCommandInteraction): Promise<void> {
  const modal = new ModalBuilder().setCustomId("contract:create").setTitle("⚔️ Novo contrato");
  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(input("title", "Nome da missão", TextInputStyle.Short, true, 150).setPlaceholder("Ex.: Escolta até Dawnstar")),
    new ActionRowBuilder<TextInputBuilder>().addComponents(input("client", "Nome do contratante", TextInputStyle.Short, true, 150).setPlaceholder("Ex.: Jarl de Whiterun")),
    new ActionRowBuilder<TextInputBuilder>().addComponents(input("value", "Recompensa em septims", TextInputStyle.Short, true, 30).setPlaceholder("Ex.: 1.500,00")),
    new ActionRowBuilder<TextInputBuilder>().addComponents(input("location", "Local da missão", TextInputStyle.Short, true, 150).setPlaceholder("Ex.: Estrada de Helgen")),
    new ActionRowBuilder<TextInputBuilder>().addComponents(input("description", "Briefing da missão", TextInputStyle.Paragraph, true, 1000).setPlaceholder("Objetivo, riscos e condições do contrato...")),
  );
  await interaction.showModal(modal);
}

async function rolesModal(interaction: ButtonInteraction): Promise<void> {
  const config = await getGuildConfig(interaction.guildId!);
  const modal = new ModalBuilder().setCustomId("config:roles").setTitle("Cargos autorizados");
  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(input("manager_roles", "IDs dos cargos de gerente", TextInputStyle.Paragraph, false, 500).setPlaceholder("IDs separados por vírgula ou espaço").setValue(config.managerRoleIds.join(", "))),
    new ActionRowBuilder<TextInputBuilder>().addComponents(input("admin_roles", "IDs dos cargos de administrador", TextInputStyle.Paragraph, false, 500).setPlaceholder("IDs separados por vírgula ou espaço").setValue(config.adminRoleIds.join(", "))),
  );
  await interaction.showModal(modal);
}

async function textsModal(interaction: ButtonInteraction): Promise<void> {
  const config = await getGuildConfig(interaction.guildId!);
  const modal = new ModalBuilder().setCustomId("config:texts").setTitle("Textos da Companhia");
  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(input("panel_title", "Título do painel", TextInputStyle.Short, true, 100).setValue(config.texts.panelTitle)),
    new ActionRowBuilder<TextInputBuilder>().addComponents(input("panel_description", "Descrição do painel", TextInputStyle.Paragraph, true, 500).setValue(config.texts.panelDescription)),
    new ActionRowBuilder<TextInputBuilder>().addComponents(input("contract_intro", "Texto de contratos", TextInputStyle.Paragraph, true, 500).setValue(config.texts.contractIntro)),
    new ActionRowBuilder<TextInputBuilder>().addComponents(input("payment_intro", "Texto de pagamentos", TextInputStyle.Paragraph, true, 500).setValue(config.texts.paymentIntro)),
  );
  await interaction.showModal(modal);
}

async function paymentModal(interaction: ButtonInteraction, id: number): Promise<unknown> {
  const contract = await getContract(interaction.guildId!, id);
  if (!contract) return interaction.reply({ content: "Contrato não encontrado.", ephemeral: true });
  const modal = new ModalBuilder().setCustomId(`contract:payment:${id}`).setTitle(`Pagamento ${contract.code}`);
  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(input("value", "Valor total pago em septims", TextInputStyle.Short, true, 30).setValue(contract.totalValue.toFixed(2).replace(".", ","))),
    new ActionRowBuilder<TextInputBuilder>().addComponents(input("note", "Observação do pagamento", TextInputStyle.Paragraph, false, 500).setPlaceholder("Ex.: pagamento recebido do contratante")),
  );
  await interaction.showModal(modal);
}

async function maintenanceModal(interaction: ButtonInteraction, mode: "clear" | "wipe"): Promise<void> {
  const modal = new ModalBuilder().setCustomId(`maintenance:${mode}`).setTitle(mode === "clear" ? "🧹 Limpar mensagens" : "⚠️ Apagar canais");
  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(input("confirmation", mode === "clear" ? "Digite LIMPAR para confirmar" : "Digite APAGAR TUDO para confirmar", TextInputStyle.Short, true, 20)),
  );
  await interaction.showModal(modal);
}

async function clearCurrentChannel(interaction: ModalSubmitInteraction): Promise<unknown> {
  const channel = interaction.channel;
  if (!channel || !channel.isTextBased() || !("bulkDelete" in channel)) throw new Error("Esta ação precisa ser executada em um canal de texto.");
  await interaction.deferReply({ ephemeral: true });
  const confirmation = interaction.fields.getTextInputValue("confirmation").trim().toUpperCase();
  if (confirmation !== "LIMPAR") return interaction.editReply("Confirmação inválida. Nenhuma mensagem foi apagada.");
  let deleted = 0;
  while (true) {
    const messages = await channel.messages.fetch({ limit: 100 });
    if (!messages.size) break;
    const result = await channel.bulkDelete(messages, true);
    deleted += result.size;
    if (messages.size < 100 || result.size === 0) break;
  }
  await interaction.editReply(`🧹 Limpeza concluída. **${deleted}** mensagem(ns) removida(s).`);
}

async function wipeServer(interaction: ModalSubmitInteraction): Promise<unknown> {
  const confirmation = interaction.fields.getTextInputValue("confirmation").trim().toUpperCase();
  if (confirmation !== "APAGAR TUDO") return interaction.reply({ content: "Confirmação inválida. Nenhum canal foi apagado.", ephemeral: true });
  await interaction.reply({ content: "⚠️ Exclusão iniciada. Os canais serão removidos agora.", ephemeral: true });
  const channels = [...interaction.guild!.channels.cache.values()];
  for (const channel of channels) {
    try { await channel.delete("Limpeza total solicitada por administrador"); } catch (error) { console.error(`Não foi possível apagar o canal ${channel.id}`, error); }
  }
}

async function handleModal(interaction: ModalSubmitInteraction): Promise<unknown> {
  if (!interaction.guild) return interaction.reply({ content: "Esta ação só pode ser usada dentro de um servidor.", ephemeral: true });
  if (interaction.customId === "maintenance:clear") {
    if (!(await canAdmin(interaction))) return interaction.reply({ content: "Apenas administradores autorizados podem limpar mensagens.", ephemeral: true });
    return clearCurrentChannel(interaction);
  }
  if (interaction.customId === "maintenance:wipe") {
    if (!hasAdministrator(interaction)) return interaction.reply({ content: "Apenas o proprietário ou Administrator pode apagar todos os canais.", ephemeral: true });
    return wipeServer(interaction);
  }
  if (interaction.customId === "config:roles") {
    if (!(await canAdmin(interaction))) return interaction.reply({ content: "Apenas administradores autorizados podem alterar cargos.", ephemeral: true });
    await interaction.deferReply({ ephemeral: true });
    const managerRoleIds = parseRoleIds(interaction.fields.getTextInputValue("manager_roles"));
    const adminRoleIds = parseRoleIds(interaction.fields.getTextInputValue("admin_roles"));
    const invalid = [...managerRoleIds, ...adminRoleIds].filter((id) => !interaction.guild!.roles.cache.has(id) || id === interaction.guild!.roles.everyone.id);
    if (invalid.length) return interaction.editReply(`IDs de cargo inválidos: ${invalid.join(", ")}. O cargo @everyone não pode ser autorizado.`);
    const config = await setGuildRoles(interaction.guildId!, managerRoleIds, adminRoleIds);
    await syncPanelPermissions(interaction.guild, config);
    await syncOperationalPermissions(interaction.guild, config);
    await interaction.editReply("Cargos autorizados atualizados. O painel e os canais operacionais respeitam essa lista.");
    return;
  }
  if (interaction.customId === "config:texts") {
    if (!(await canAdmin(interaction))) return interaction.reply({ content: "Apenas administradores autorizados podem alterar textos.", ephemeral: true });
    await interaction.deferReply({ ephemeral: true });
    const config = await setGuildTexts(interaction.guildId!, {
      panelTitle: interaction.fields.getTextInputValue("panel_title"),
      panelDescription: interaction.fields.getTextInputValue("panel_description"),
      contractIntro: interaction.fields.getTextInputValue("contract_intro"),
      paymentIntro: interaction.fields.getTextInputValue("payment_intro"),
    });
    await provisionGuildStructure(interaction.guild);
    await interaction.editReply("Textos atualizados no painel e na configuração da guilda.");
    return;
  }
  if (interaction.customId === "contract:create") {
    if (!(await canManage(interaction))) return interaction.reply({ content: "Apenas gerentes e administradores podem criar contratos.", ephemeral: true });
    await interaction.deferReply({ ephemeral: true });
    let createdContract: Contract | null = null;
    try {
      const config = await getGuildConfig(interaction.guildId!);
      const contractChannel = interaction.guild.channels.cache.get(config.channelIds.contratos);
      if (!isTextChannel(contractChannel)) throw new Error("Crie a estrutura da guilda pelo painel antes de registrar contratos.");
      const contract = await createContract({
        guildId: interaction.guildId!,
        title: interaction.fields.getTextInputValue("title"),
        client: interaction.fields.getTextInputValue("client"),
        totalValue: parseMoney(interaction.fields.getTextInputValue("value")),
        location: interaction.fields.getTextInputValue("location"),
        description: interaction.fields.getTextInputValue("description"),
        creatorId: interaction.user.id,
      });
      createdContract = contract;
      const thread = await contractChannel.threads.create({ name: `${contract.code} — ${contract.title}`.slice(0, 100), autoArchiveDuration: 10080, reason: "Tópico de contrato" });
      await setContractThread(interaction.guildId!, contract.id, thread.id);
      await thread.send({ embeds: [contractEmbed(contract)] });
      await announceContractState(interaction.guild, config, contract);
      await interaction.editReply(`Contrato ${contract.code} criado. Tópico: ${thread}`);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "falha não identificada";
      await interaction.editReply(createdContract
        ? `O contrato ${createdContract.code} foi salvo, mas houve uma falha ao publicar todas as mensagens: ${detail}. Não crie outro com os mesmos dados; informe um administrador para reparar a publicação.`
        : `Não foi possível criar o contrato: ${detail}`);
    }
    return;
  }
  if (interaction.customId.startsWith("contract:payment:")) {
    if (!(await canManage(interaction))) return interaction.reply({ content: "Apenas gerentes e administradores podem registrar pagamentos.", ephemeral: true });
    await interaction.deferReply({ ephemeral: true });
    const id = Number(interaction.customId.split(":")[2]);
    try {
      const payment = await recordPayment({
        guildId: interaction.guildId!,
        contractId: id,
        paidBy: interaction.user.id,
        totalAmount: parseMoney(interaction.fields.getTextInputValue("value")),
        note: interaction.fields.getTextInputValue("note") || "Sem observação.",
      });
      const contract = await getContract(interaction.guildId!, id);
      if (contract) {
        await announceContractState(interaction.guild, await getGuildConfig(interaction.guildId!), contract);
      }
      const financeChannel = interaction.guild.channels.cache.get((await getGuildConfig(interaction.guildId!)).channelIds["caixa-guilda"]);
      if (financeChannel) await upsertFinanceMessage(financeChannel, interaction.guildId!);
      await interaction.editReply(`Pagamento lançado. ${money(payment.totalAmount)} distribuídos entre ${payment.participantsCount} participante(s).`);
    } catch (error) {
      await interaction.editReply(error instanceof Error ? error.message : "Não foi possível lançar o pagamento.");
    }
  }
}

async function handleButton(interaction: ButtonInteraction): Promise<unknown> {
  if (interaction.customId === "panel:structure") {
    if (!(await canAdmin(interaction))) return interaction.reply({ content: "Apenas administradores autorizados podem criar a estrutura.", ephemeral: true });
    await interaction.deferReply({ ephemeral: true });
    try {
      const config = await provisionGuildStructure(interaction.guild!);
      await interaction.editReply(`Estrutura pronta. Painel privado: <#${config.channelIds["painel-configuracao"]}>`);
    } catch (error) {
      await interaction.editReply(error instanceof Error ? error.message : "Não foi possível criar a estrutura.");
    }
    return;
  }
  if (interaction.customId === "panel:roles") {
    if (!(await canAdmin(interaction))) return interaction.reply({ content: "Apenas administradores autorizados podem definir cargos.", ephemeral: true });
    return rolesModal(interaction);
  }
  if (interaction.customId === "panel:texts") {
    if (!(await canAdmin(interaction))) return interaction.reply({ content: "Apenas administradores autorizados podem alterar textos.", ephemeral: true });
    return textsModal(interaction);
  }
  if (interaction.customId === "panel:refresh") {
    if (!(await canAdmin(interaction))) return interaction.reply({ content: "Apenas administradores autorizados podem atualizar o painel.", ephemeral: true });
    await interaction.deferReply({ ephemeral: true });
    const config = await provisionGuildStructure(interaction.guild!);
    return interaction.editReply(`Painel e estrutura sincronizados. Sala privada: <#${config.channelIds["painel-configuracao"]}>`);
  }
  if (interaction.customId === "panel:clear-chat") {
    if (!(await canAdmin(interaction))) return interaction.reply({ content: "Apenas administradores autorizados podem limpar mensagens.", ephemeral: true });
    return maintenanceModal(interaction, "clear");
  }
  if (interaction.customId === "panel:wipe-server") {
    if (!hasAdministrator(interaction)) return interaction.reply({ content: "Apenas o proprietário ou Administrator pode apagar todos os canais.", ephemeral: true });
    return maintenanceModal(interaction, "wipe");
  }
  if (interaction.customId === "panel:new-contract") {
    if (!(await canManage(interaction))) return interaction.reply({ content: "Apenas gerentes e administradores podem criar contratos.", ephemeral: true });
    return newContractModal(interaction);
  }
  if (interaction.customId === "panel:contracts") {
    if (!(await canManage(interaction))) return interaction.reply({ content: "Apenas gerentes e administradores podem consultar contratos.", ephemeral: true });
    return contractsMenu(interaction);
  }
  if (interaction.customId === "panel:payments") {
    if (!(await canManage(interaction))) return interaction.reply({ content: "Apenas gerentes e administradores podem consultar pagamentos.", ephemeral: true });
    return paymentLedger(interaction);
  }
  if (interaction.customId.startsWith("contract:apply:")) {
    const id = Number(interaction.customId.split(":")[2]);
    await interaction.deferReply({ ephemeral: true });
    try {
      const applicant = await applyForContract({ guildId: interaction.guildId!, contractId: id, userId: interaction.user.id, displayName: interaction.user.globalName ?? interaction.user.username });
      return interaction.editReply(`🪶 Interesse registrado para **${applicant.displayName}**. Aguarde a aprovação de um administrador; sua entrada ainda não foi confirmada na equipe.`);
    } catch (error) {
      return interaction.editReply(error instanceof Error ? error.message : "Não foi possível registrar seu interesse.");
    }
  }
  if (interaction.customId.startsWith("contract:appapprove:")) {
    if (!(await canManage(interaction))) return interaction.reply({ content: "Apenas gerentes e administradores podem aprovar equipes.", ephemeral: true });
    await interaction.deferReply({ ephemeral: true });
    const [, , contractId, applicantId] = interaction.customId.split(":");
    try {
      const applicant = await setApplicantStatus(interaction.guildId!, Number(contractId), Number(applicantId), "approved");
      if (applicant) {
        const updatedContract = await getContract(interaction.guildId!, Number(contractId));
        if (updatedContract) await announceContractState(interaction.guild!, await getGuildConfig(interaction.guildId!), updatedContract);
      }
      return interaction.editReply(applicant ? `✅ ${applicant.displayName} foi aprovado na equipe.` : "Interessado não encontrado.");
    } catch (error) {
      return interaction.editReply(error instanceof Error ? error.message : "Não foi possível aprovar o interessado.");
    }
  }
  if (interaction.customId.startsWith("contract:view:")) return contractDetail(interaction, Number(interaction.customId.split(":")[2]));
  if (interaction.customId.startsWith("contract:pay:")) {
    if (!(await canManage(interaction))) return interaction.reply({ content: "Apenas gerentes e administradores podem registrar pagamentos.", ephemeral: true });
    return paymentModal(interaction, Number(interaction.customId.split(":")[2]));
  }
  if (interaction.customId.startsWith("contract:archive:")) {
    if (!(await canManage(interaction))) return interaction.reply({ content: "Apenas gerentes e administradores podem arquivar contratos.", ephemeral: true });
    await interaction.deferUpdate();
    const id = Number(interaction.customId.split(":")[2]);
    const contract = await setContractStatus(interaction.guildId!, id, "archived");
    if (contract) await announceContractState(interaction.guild!, await getGuildConfig(interaction.guildId!), contract);
    return interaction.editReply({ content: contract ? `${contract.code} arquivado.` : "Contrato não encontrado.", embeds: [], components: [] });
  }
}

async function handleSelect(interaction: StringSelectMenuInteraction | UserSelectMenuInteraction): Promise<unknown> {
  if (interaction.isStringSelectMenu() && interaction.customId === "contracts:status") {
    if (!(await canManage(interaction))) return interaction.reply({ content: "Apenas gerentes e administradores podem consultar contratos.", ephemeral: true });
    return showContractList(interaction, interaction.values[0]);
  }
  if (interaction.isStringSelectMenu() && interaction.customId.startsWith("contract:status:")) {
    if (!(await canManage(interaction))) return interaction.reply({ content: "Apenas gerentes e administradores podem alterar contratos.", ephemeral: true });
    await interaction.deferUpdate();
    const id = Number(interaction.customId.split(":")[2]);
    const status = interaction.values[0] as ContractStatus;
    const contract = await setContractStatus(interaction.guildId!, id, status);
    if (contract) {
      await announceContractState(interaction.guild!, await getGuildConfig(interaction.guildId!), contract);
    }
    return interaction.editReply({
      content: contract ? `${contract.code} agora está ${STATUS_LABELS[status].toLowerCase()}.` : "Contrato não encontrado.",
      embeds: [],
      components: [],
    });
  }
  if (interaction.isUserSelectMenu() && interaction.customId.startsWith("contract:participants:")) {
    if (!(await canManage(interaction))) return interaction.reply({ content: "Apenas gerentes e administradores podem definir participantes.", ephemeral: true });
    await interaction.deferUpdate();
    const id = Number(interaction.customId.split(":")[2]);
    const selected = [...interaction.users.values()].map((user) => ({ userId: user.id, displayName: user.globalName ?? user.username }));
    await addParticipants(interaction.guildId!, id, selected);
    const contract = await getContract(interaction.guildId!, id);
    if (!contract) return interaction.editReply({ content: "Contrato não encontrado.", embeds: [], components: [] });
    const participants = await listParticipants(interaction.guildId!, id);
    await announceContractState(interaction.guild!, await getGuildConfig(interaction.guildId!), contract);
    return interaction.editReply({
      embeds: [contractEmbed(contract, participantSummary(participants))],
      components: interaction.message.components,
    });
  }
}

async function handleCommand(interaction: ChatInputCommandInteraction): Promise<unknown> {
  if (interaction.commandName === "painel") {
    if (!hasAdministrator(interaction) && !(await canAdmin(interaction))) return interaction.reply({ content: `${ICONS.lock} Apenas o proprietário, Administrator ou administradores configurados podem abrir o painel.`, ephemeral: true });
    await interaction.deferReply({ ephemeral: true });
    try {
      const config = await provisionGuildStructure(interaction.guild!);
      await interaction.editReply({ content: `${ICONS.check} **Painel da Companhia pronto.**\nSala privada: <#${config.channelIds["painel-configuracao"]}>\n\nUse os botões para comandar a operação.` });
    } catch (error) {
      await interaction.editReply(error instanceof Error ? error.message : "Não foi possível inicializar o painel.");
    }
    return;
  }
  if (interaction.commandName === "contratos") {
    if (!(await canManage(interaction))) return interaction.reply({ content: `${ICONS.lock} Apenas gerentes e administradores podem consultar contratos.`, ephemeral: true });
    return contractsMenu(interaction);
  }
  if (interaction.commandName === "novo-contrato") {
    if (!(await canManage(interaction))) return interaction.reply({ content: `${ICONS.lock} Apenas gerentes e administradores podem criar contratos.`, ephemeral: true });
    return newContractModal(interaction);
  }
  if (interaction.commandName === "pagamentos") {
    if (!(await canManage(interaction))) return interaction.reply({ content: `${ICONS.lock} Apenas gerentes e administradores podem consultar pagamentos.`, ephemeral: true });
    return paymentLedger(interaction);
  }
  if (interaction.commandName === "estrutura") {
    if (!(await canAdmin(interaction))) return interaction.reply({ content: `${ICONS.lock} Apenas administradores autorizados podem sincronizar a estrutura.`, ephemeral: true });
    await interaction.deferReply({ ephemeral: true });
    const config = await provisionGuildStructure(interaction.guild!);
    return interaction.editReply(`${ICONS.check} Estrutura sincronizada. Painel privado: <#${config.channelIds["painel-configuracao"]}>`);
  }
}

export async function registerDiscord(client: Client): Promise<void> {
  const commands = [
    { name: "painel", description: "Abrir o painel da Companhia de Mercenários" },
    { name: "contratos", description: "Consultar o quadro de missões e contratos" },
    { name: "novo-contrato", description: "Registrar uma nova missão no livro da Companhia" },
    { name: "pagamentos", description: "Consultar o livro-caixa e pagamentos lançados" },
    { name: "estrutura", description: "Sincronizar categorias, canais e painel privado" },
  ];
  const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN ?? "");
  if (process.env.DISCORD_GUILD_ID) {
    await rest.put(Routes.applicationGuildCommands(client.user!.id, process.env.DISCORD_GUILD_ID), { body: commands });
  } else {
    await rest.put(Routes.applicationCommands(client.user!.id), { body: commands });
  }
}

export function attachDiscordHandlers(client: Client): void {
  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      if (interaction.isChatInputCommand()) await handleCommand(interaction);
      else if (interaction.isButton()) await handleButton(interaction);
      else if (interaction.isStringSelectMenu() || interaction.isUserSelectMenu()) await handleSelect(interaction);
      else if (interaction.isModalSubmit()) await handleModal(interaction);
    } catch (error) {
      console.error("Falha ao processar interação Discord", error);
      if (interaction.isRepliable()) {
        const content = "A ação não pôde ser concluída. Consulte os logs do bot.";
        try {
          if (interaction.deferred) await interaction.editReply({ content, embeds: [], components: [] });
          else if (!interaction.replied) await interaction.reply({ content, ephemeral: true });
        } catch (replyError) {
          console.error("Não foi possível responder à interação Discord; ela pode ter expirado", replyError);
        }
      }
    }
  });
}

export async function startDiscord(): Promise<Client | null> {
  const token = process.env.DISCORD_TOKEN;
  if (!token) {
    console.warn("DISCORD_TOKEN não configurado; o servidor de saúde continuará ativo, mas o bot não conectará.");
    return null;
  }
  const client = new Client({ intents: ["Guilds"] });
  attachDiscordHandlers(client);
  client.once(Events.ClientReady, async (readyClient) => {
    console.log(`Discord conectado como ${readyClient.user.tag}`);
    try {
      await registerDiscord(readyClient);
      console.log("Comando /painel registrado.");
    } catch (error) {
      console.error("Não foi possível registrar comandos Discord", error);
    }
  });
  await client.login(token);
  return client;
}
