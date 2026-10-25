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
  createContract,
  ensureGuildConfig,
  getContract,
  getGuildConfig,
  getPayment,
  listParticipants,
  listContracts,
  recordPayment,
  setContractStatus,
  setContractThread,
  setGuildRoles,
  setGuildStructure,
  setGuildTexts,
  type Contract,
  type ContractStatus,
  type GuildConfig,
} from "./db.js";

const COLORS = { steel: 0x5d6470, gold: 0xa78648, green: 0x667c57, red: 0x8a4a42 };
const STATUS_LABELS: Record<ContractStatus, string> = {
  available: "Disponível",
  accepted: "Aceito",
  in_progress: "Em andamento",
  completed: "Concluído",
  cancelled: "Cancelado",
  archived: "Arquivado",
};

const statusOptions = Object.entries(STATUS_LABELS).map(([value, label]) => ({
  label,
  value,
  description: `Mover o contrato para: ${label.toLowerCase()}`,
}));

const categorySpecs = [
  { key: "comando", name: "comando", channels: [{ key: "regras", name: "regras", type: "text" }, { key: "comunicados", name: "comunicados", type: "text" }, { key: "hierarquia", name: "hierarquia", type: "text" }, { key: "registro-membros", name: "registro-de-membros", type: "text" }] },
  { key: "contratos", name: "contratos", channels: [{ key: "contratos-disponiveis", name: "contratos-disponiveis", type: "text" }, { key: "contratos-aceitos", name: "contratos-aceitos", type: "text" }, { key: "contratos-em-andamento", name: "contratos-em-andamento", type: "text" }, { key: "contratos-concluidos", name: "contratos-concluidos", type: "text" }, { key: "arquivo-contratos", name: "arquivo-de-contratos", type: "text" }] },
  { key: "financas", name: "finanças", channels: [{ key: "pagamentos", name: "pagamentos", type: "text" }, { key: "historico-financeiro", name: "historico-financeiro", type: "text" }] },
  { key: "operacoes", name: "operações", channels: [{ key: "planejamento", name: "planejamento", type: "text" }, { key: "relatorios-missao", name: "relatorios-de-missao", type: "text" }, { key: "provas-registros", name: "provas-e-registros", type: "text" }, { key: "briefing", name: "briefing", type: "voice" }, { key: "operacoes-voz", name: "operações", type: "voice" }, { key: "reuniao", name: "reunião", type: "voice" }, { key: "espera", name: "espera", type: "voice" }] },
  { key: "configuracao", name: "configuração", channels: [{ key: "painel-configuracao", name: "painel-de-configuração", type: "text" }] },
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
  const ids = kind === "manager" ? config.managerRoleIds : config.adminRoleIds;
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
    .setTitle(config.texts.panelTitle)
    .setDescription(`${config.texts.panelDescription}\n\nAções administrativas ficam registradas no banco da Companhia.`)
    .addFields(
      { name: "Estrutura", value: "Criar ou atualizar categorias, salas e a sala privada do painel.", inline: false },
      { name: "Autoridade", value: `Administradores: ${config.adminRoleIds.length || "a definir"}\nGerentes: ${config.managerRoleIds.length || "a definir"}`, inline: true },
      { name: "Moeda", value: config.currency, inline: true },
      { name: "Contratos", value: "Criação, equipe, estados, tópicos e pagamento.", inline: false },
    )
    .setFooter({ text: "Companhia de Mercenários" });
}

function panelComponents(): ActionRowBuilder<ButtonBuilder>[] {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("panel:structure").setLabel("Criar estrutura").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("panel:roles").setLabel("Definir cargos").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("panel:texts").setLabel("Textos").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("panel:refresh").setLabel("Atualizar painel").setStyle(ButtonStyle.Secondary),
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("panel:new-contract").setLabel("Novo contrato").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId("panel:contracts").setLabel("Consultar contratos").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("panel:payments").setLabel("Pagamentos").setStyle(ButtonStyle.Secondary),
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
  const overwrites = [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: guild.ownerId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
    { id: guild.client.user?.id ?? "", allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageThreads] },
    ...[...config.adminRoleIds, ...config.managerRoleIds].map((id) => ({ id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] })),
  ].filter((entry) => entry.id);
  await panel.permissionOverwrites.set(overwrites, "Aplicar cargos autorizados ao painel");
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
        : channelSpec.key === "contratos-em-andamento"
          ? "Tópicos individuais acompanham as missões aceitas pela Companhia."
          : undefined;
      const channel = await findOrCreateChannel(guild, channelSpec.name, channelSpec.type, category.id, topic);
      channelIds[channelSpec.key] = channel.id;
    }
  }
  config = await setGuildStructure(guild.id, categoryIds, channelIds);
  await syncPanelPermissions(guild, config);
  const panel = guild.channels.cache.get(channelIds["painel-configuracao"]);
  if (isTextChannel(panel)) await upsertPanelMessage(panel, config);
  return config;
}

async function upsertPanelMessage(channel: Extract<Channel, { type: ChannelType.GuildText }>, config: GuildConfig): Promise<void> {
  const recent = await channel.messages.fetch({ limit: 30 });
  const own = recent.find((message) => message.author.id === channel.client.user?.id && message.embeds.some((embed) => embed.title === config.texts.panelTitle));
  if (own) {
    await own.edit({ embeds: [panelEmbed(config)], components: panelComponents() });
  } else {
    await channel.send({ embeds: [panelEmbed(config)], components: panelComponents() });
  }
}

function contractEmbed(contract: Contract, participantText = "Nenhum participante registrado."): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(contract.status === "completed" ? COLORS.green : contract.status === "cancelled" ? COLORS.red : COLORS.steel)
    .setTitle(`${contract.code} — ${contract.title}`)
    .setDescription(contract.description)
    .addFields(
      { name: "Contratante", value: contract.client, inline: true },
      { name: "Local", value: contract.location || "Não informado", inline: true },
      { name: "Valor", value: money(contract.totalValue), inline: true },
      { name: "Estado", value: STATUS_LABELS[contract.status], inline: true },
      { name: "Pagamento", value: contract.paymentStatus === "paid" ? "Lançado" : "Pendente", inline: true },
      { name: "Participantes", value: participantText, inline: false },
    )
    .setFooter({ text: "Registro da Companhia" });
}

const statusChannelKeys: Record<ContractStatus, string> = {
  available: "contratos-disponiveis",
  accepted: "contratos-aceitos",
  in_progress: "contratos-em-andamento",
  completed: "contratos-concluidos",
  cancelled: "arquivo-contratos",
  archived: "arquivo-contratos",
};

async function announceContractState(guild: Guild, config: GuildConfig, contract: Contract): Promise<void> {
  const channel = guild.channels.cache.get(config.channelIds[statusChannelKeys[contract.status]]);
  if (!isTextChannel(channel)) return;
  await channel.send({ embeds: [contractEmbed(contract)] });
}

async function contractDetail(interaction: ButtonInteraction, id: number): Promise<unknown> {
  const contract = await getContract(interaction.guildId!, id);
  if (!contract) return interaction.reply({ content: "Contrato não encontrado.", ephemeral: true });
  const participants = await listParticipants(interaction.guildId!, id);
  const participantText = participants.length
    ? participants.map((participant) => `<@${participant.userId}> — ${participant.displayName}${participant.shareAmount !== null ? ` — ${money(participant.shareAmount)}` : ""}`).join("\n")
    : "Nenhum participante registrado.";
  const rows: ActionRowBuilder<ButtonBuilder | UserSelectMenuBuilder | StringSelectMenuBuilder>[] = [
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder().setCustomId(`contract:status:${id}`).setPlaceholder("Alterar estado").addOptions(statusOptions),
    ),
    new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
      new UserSelectMenuBuilder().setCustomId(`contract:participants:${id}`).setPlaceholder("Adicionar participantes").setMinValues(1).setMaxValues(10),
    ),
  ];
  const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
    ...(contract.status === "completed" && contract.paymentStatus === "pending"
      ? [new ButtonBuilder().setCustomId(`contract:pay:${id}`).setLabel("Registrar pagamento").setStyle(ButtonStyle.Success)]
      : []),
    new ButtonBuilder().setCustomId(`contract:archive:${id}`).setLabel("Arquivar").setStyle(ButtonStyle.Secondary),
  );
  rows.push(buttons);
  await interaction.reply({ embeds: [contractEmbed(contract, participantText)], components: rows, ephemeral: true });
}

async function contractsMenu(interaction: ButtonInteraction | ChatInputCommandInteraction): Promise<void> {
  const menu = new StringSelectMenuBuilder().setCustomId("contracts:status").setPlaceholder("Filtrar contratos por estado").addOptions([
    { label: "Todos", value: "all", description: "Mostrar o histórico completo" },
    ...statusOptions,
  ]);
  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
  await interaction.reply({ content: "Escolha o quadro que deseja consultar.", components: [row], ephemeral: true });
}

async function showContractList(interaction: StringSelectMenuInteraction, value: string): Promise<unknown> {
  const status = value === "all" ? undefined : value as ContractStatus;
  const contracts = await listContracts(interaction.guildId!, status);
  if (!contracts.length) return interaction.update({ content: "Nenhum contrato encontrado para esse filtro.", components: [], embeds: [] });
  const lines = contracts.slice(0, 15).map((contract) => `${contract.code} — **${contract.title}** — ${STATUS_LABELS[contract.status]} — ${money(contract.totalValue)}`);
  const buttons = new ActionRowBuilder<ButtonBuilder>();
  for (const contract of contracts.slice(0, 5)) buttons.addComponents(new ButtonBuilder().setCustomId(`contract:view:${contract.id}`).setLabel(contract.code).setStyle(ButtonStyle.Secondary));
  await interaction.update({ content: `Contratos registrados${status ? ` — ${STATUS_LABELS[status]}` : ""}:\n\n${lines.join("\n")}${contracts.length > 15 ? "\n\nExibindo os 15 mais recentes." : ""}`, components: buttons.components.length ? [buttons] : [] });
}

async function newContractModal(interaction: ButtonInteraction): Promise<void> {
  const modal = new ModalBuilder().setCustomId("contract:create").setTitle("Registrar contrato");
  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(input("title", "Título do contrato", TextInputStyle.Short, true, 150)),
    new ActionRowBuilder<TextInputBuilder>().addComponents(input("client", "Contratante", TextInputStyle.Short, true, 150)),
    new ActionRowBuilder<TextInputBuilder>().addComponents(input("value", "Valor em septims", TextInputStyle.Short, true, 30)),
    new ActionRowBuilder<TextInputBuilder>().addComponents(input("location", "Local", TextInputStyle.Short, true, 150)),
    new ActionRowBuilder<TextInputBuilder>().addComponents(input("description", "Descrição da missão", TextInputStyle.Paragraph, true, 1000)),
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

async function sendThreadUpdate(guild: Guild, contract: Contract, content: string): Promise<void> {
  if (!contract.threadId) return;
  const thread = guild.channels.cache.get(contract.threadId);
  if (thread && thread.isThread()) await thread.send({ content });
}

async function handleModal(interaction: ModalSubmitInteraction): Promise<unknown> {
  if (!interaction.guild) return;
  if (interaction.customId === "config:roles") {
    if (!(await canAdmin(interaction))) return interaction.reply({ content: "Apenas administradores autorizados podem alterar cargos.", ephemeral: true });
    const managerRoleIds = parseRoleIds(interaction.fields.getTextInputValue("manager_roles"));
    const adminRoleIds = parseRoleIds(interaction.fields.getTextInputValue("admin_roles"));
    const invalid = [...managerRoleIds, ...adminRoleIds].filter((id) => !interaction.guild!.roles.cache.has(id));
    if (invalid.length) return interaction.reply({ content: `IDs de cargo não encontrados: ${invalid.join(", ")}`, ephemeral: true });
    const config = await setGuildRoles(interaction.guildId!, managerRoleIds, adminRoleIds);
    await syncPanelPermissions(interaction.guild, config);
    await interaction.reply({ content: "Cargos autorizados atualizados. O painel agora respeita essa lista.", ephemeral: true });
    return;
  }
  if (interaction.customId === "config:texts") {
    if (!(await canAdmin(interaction))) return interaction.reply({ content: "Apenas administradores autorizados podem alterar textos.", ephemeral: true });
    const config = await setGuildTexts(interaction.guildId!, {
      panelTitle: interaction.fields.getTextInputValue("panel_title"),
      panelDescription: interaction.fields.getTextInputValue("panel_description"),
      contractIntro: interaction.fields.getTextInputValue("contract_intro"),
      paymentIntro: interaction.fields.getTextInputValue("payment_intro"),
    });
    await provisionGuildStructure(interaction.guild);
    await interaction.reply({ content: "Textos atualizados no painel e na configuração da guilda.", ephemeral: true });
    return;
  }
  if (interaction.customId === "contract:create") {
    if (!(await canManage(interaction))) return interaction.reply({ content: "Apenas gerentes e administradores podem criar contratos.", ephemeral: true });
    try {
      const config = await getGuildConfig(interaction.guildId!);
      const contractChannel = interaction.guild.channels.cache.get(config.channelIds["contratos-em-andamento"]);
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
      const thread = await contractChannel.threads.create({ name: `${contract.code} — ${contract.title}`.slice(0, 100), autoArchiveDuration: 10080, reason: "Tópico de contrato" });
      await setContractThread(interaction.guildId!, contract.id, thread.id);
      await thread.send({ embeds: [contractEmbed(contract)] });
      await announceContractState(interaction.guild, config, contract);
      await interaction.reply({ content: `Contrato ${contract.code} criado. Tópico: ${thread}`, ephemeral: true });
    } catch (error) {
      await interaction.reply({ content: error instanceof Error ? error.message : "Não foi possível criar o contrato.", ephemeral: true });
    }
    return;
  }
  if (interaction.customId.startsWith("contract:payment:")) {
    if (!(await canManage(interaction))) return interaction.reply({ content: "Apenas gerentes e administradores podem registrar pagamentos.", ephemeral: true });
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
        await sendThreadUpdate(interaction.guild, contract, `Pagamento lançado: ${money(payment.totalAmount)}. A divisão foi registrada no histórico.`);
        await announceContractState(interaction.guild, await getGuildConfig(interaction.guildId!), contract);
      }
      await interaction.reply({ content: `Pagamento lançado. ${money(payment.totalAmount)} distribuídos entre ${payment.participantsCount} participante(s).`, ephemeral: true });
    } catch (error) {
      await interaction.reply({ content: error instanceof Error ? error.message : "Não foi possível lançar o pagamento.", ephemeral: true });
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
    const config = await provisionGuildStructure(interaction.guild!);
    return interaction.update({ embeds: [panelEmbed(config)], components: panelComponents(), content: "" });
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
    const paid = (await listContracts(interaction.guildId!)).filter((contract) => contract.paymentStatus === "paid");
    if (!paid.length) return interaction.reply({ content: "Ainda não há pagamentos registrados.", ephemeral: true });
    const lines = [];
    for (const contract of paid.slice(0, 15)) {
      const payment = await getPayment(interaction.guildId!, contract.id);
      lines.push(`${contract.code} — ${contract.title} — ${money(payment?.totalAmount ?? contract.totalValue)} — ${payment?.items.length ?? 0} participante(s)`);
    }
    return interaction.reply({ content: `Histórico de pagamentos:\n\n${lines.join("\n")}`, ephemeral: true });
  }
  if (interaction.customId.startsWith("contract:view:")) return contractDetail(interaction, Number(interaction.customId.split(":")[2]));
  if (interaction.customId.startsWith("contract:pay:")) {
    if (!(await canManage(interaction))) return interaction.reply({ content: "Apenas gerentes e administradores podem registrar pagamentos.", ephemeral: true });
    return paymentModal(interaction, Number(interaction.customId.split(":")[2]));
  }
  if (interaction.customId.startsWith("contract:archive:")) {
    if (!(await canManage(interaction))) return interaction.reply({ content: "Apenas gerentes e administradores podem arquivar contratos.", ephemeral: true });
    const id = Number(interaction.customId.split(":")[2]);
    const contract = await setContractStatus(interaction.guildId!, id, "archived");
    if (contract) await announceContractState(interaction.guild!, await getGuildConfig(interaction.guildId!), contract);
    return interaction.update({ content: contract ? `${contract.code} arquivado.` : "Contrato não encontrado.", embeds: [], components: [] });
  }
}

async function handleSelect(interaction: StringSelectMenuInteraction | UserSelectMenuInteraction): Promise<unknown> {
  if (interaction.isStringSelectMenu() && interaction.customId === "contracts:status") {
    if (!(await canManage(interaction))) return interaction.reply({ content: "Apenas gerentes e administradores podem consultar contratos.", ephemeral: true });
    return showContractList(interaction, interaction.values[0]);
  }
  if (interaction.isStringSelectMenu() && interaction.customId.startsWith("contract:status:")) {
    if (!(await canManage(interaction))) return interaction.reply({ content: "Apenas gerentes e administradores podem alterar contratos.", ephemeral: true });
    const id = Number(interaction.customId.split(":")[2]);
    const status = interaction.values[0] as ContractStatus;
    const contract = await setContractStatus(interaction.guildId!, id, status);
    if (contract) {
      await sendThreadUpdate(interaction.guild!, contract, `Estado atualizado: ${STATUS_LABELS[status]}.`);
      await announceContractState(interaction.guild!, await getGuildConfig(interaction.guildId!), contract);
    }
    return interaction.reply({ content: contract ? `${contract.code} agora está ${STATUS_LABELS[status].toLowerCase()}.` : "Contrato não encontrado.", ephemeral: true });
  }
  if (interaction.isUserSelectMenu() && interaction.customId.startsWith("contract:participants:")) {
    if (!(await canManage(interaction))) return interaction.reply({ content: "Apenas gerentes e administradores podem definir participantes.", ephemeral: true });
    const id = Number(interaction.customId.split(":")[2]);
    const selected = [...interaction.users.values()].map((user) => ({ userId: user.id, displayName: user.globalName ?? user.username }));
    const participants = await addParticipants(interaction.guildId!, id, selected);
    const contract = await getContract(interaction.guildId!, id);
    if (contract) await sendThreadUpdate(interaction.guild!, contract, `Equipe atualizada: ${participants.map((participant) => participant.displayName).join(", ")}.`);
    return interaction.reply({ content: `${selected.length} participante(s) adicionado(s) a ${contract?.code ?? "o contrato"}.`, ephemeral: true });
  }
}

async function handleCommand(interaction: ChatInputCommandInteraction): Promise<unknown> {
  if (interaction.commandName !== "painel") return;
  if (!hasAdministrator(interaction) && !(await canAdmin(interaction))) return interaction.reply({ content: "Apenas o proprietário, Administrator ou administradores configurados podem abrir o painel.", ephemeral: true });
  await interaction.deferReply({ ephemeral: true });
  try {
    const config = await provisionGuildStructure(interaction.guild!);
    await interaction.editReply(`Painel pronto em <#${config.channelIds["painel-configuracao"]}>. Acesse a sala privada para operar a Companhia.`);
  } catch (error) {
    await interaction.editReply(error instanceof Error ? error.message : "Não foi possível inicializar o painel.");
  }
}

export async function registerDiscord(client: Client): Promise<void> {
  const command = { name: "painel", description: "Abrir o painel da Companhia de Mercenários" };
  const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN ?? "");
  if (process.env.DISCORD_GUILD_ID) {
    await rest.put(Routes.applicationGuildCommands(client.user!.id, process.env.DISCORD_GUILD_ID), { body: [command] });
  } else {
    await rest.put(Routes.applicationCommands(client.user!.id), { body: [command] });
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
        if (interaction.deferred) await interaction.editReply({ content, embeds: [], components: [] });
        else if (!interaction.replied) await interaction.reply({ content, ephemeral: true });
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
