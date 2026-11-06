import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder, MessageFlags, ModalBuilder,
  StringSelectMenuBuilder, TextInputBuilder, TextInputStyle, type ButtonInteraction, type ModalSubmitInteraction, type StringSelectMenuInteraction,
} from "discord.js";
import { getGuildConfig, saveGuildConfig } from "./db.js";
import { changeWarehouseItem, consumePendingWithdrawal, countWarehouseHistory, countWarehouseItems, createPendingWithdrawal, deletePendingWithdrawal, depositWarehouseBatch, listWarehouseHistory, listWarehouseItems, setPendingWithdrawalQuantity, WAREHOUSE_CAPACITY } from "./warehouse-db.js";

const GOLD = 0xc49a4a;
const date = (d: Date) => new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" }).format(d);
const encodeFilter = (value: string) => Buffer.from(value, "utf8").toString("base64url");
const decodeFilter = (value?: string) => value ? Buffer.from(value, "base64url").toString("utf8") : "";
const itemIcon = (name: string): string => {
  const n = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");
  if (/pocao|elixir|frasco|veneno|tonico/.test(n)) return "🧪";
  if (/espada|adaga|machado|arco|flecha|lanca|martelo|arma|punhal/.test(n)) return "⚔️";
  if (/armadura|capacete|elmo|escudo|bota|luva|peitoral|cota|roupa/.test(n)) return "🛡️";
  if (/pergaminho|livro|mapa|carta|diario/.test(n)) return "📜";
  if (/gema|joia|rubi|safira|esmeralda|diamante|colar|anel/.test(n)) return "💎";
  if (/minerio|mineral|lingote|ferro|aco|prata|ouro|cobre|carvao|pedra/.test(n)) return "⛏️";
  if (/erva|flor|planta|raiz|ingrediente|cogumelo|alquimia/.test(n)) return "🌿";
  if (/pao|carne|queijo|maca|comida|alimento|peixe|cozido|sopa|fruta/.test(n)) return "🍖";
  if (/pocao/.test(n)) return "🧪";
  if (/pele|couro|pena|osso|garra|dente|escama|lobo|urso/.test(n)) return "🐾";
  if (/madeira|lenha|graveto|tabua/.test(n)) return "🪵";
  if (/ferramenta|picareta|chave|alicate|serra/.test(n)) return "🛠️";
  if (/moeda|septim|dinheiro|ouro/.test(n)) return "🪙";
  if (/pano|tecido|linho|seda/.test(n)) return "🧵";
  return "📦";
};
const field = (id: string, label: string, style: TextInputStyle, required = true, maxLength = 100) => new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(style).setRequired(required).setMaxLength(maxLength);
const pageId = (kind: "view" | "history", page: number, filter: string, direction: "prev" | "next", sort: "name" | "quantity" = "name") => {
  const state = kind === "view" ? JSON.stringify({ filter, sort }) : filter;
  return `warehouse:${kind}:${page}:${state ? encodeFilter(state) : "-"}:${direction}`;
};
const canonicalItemName = (name: string) => name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR").trim().replace(/\s+/g, " ");

async function acknowledgePageClick(interaction: ButtonInteraction): Promise<void> {
  if (interaction.message.flags.has(MessageFlags.Ephemeral)) await interaction.deferUpdate();
  else await interaction.deferReply({ ephemeral: true });
}

async function showWithdrawChoices(interaction: ButtonInteraction, page: number): Promise<void> {
  const items = await listWarehouseItems(interaction.guildId!, "name");
  if (!items.length) {
    if (interaction.deferred || interaction.replied) await interaction.editReply({ content: "O baú está vazio.", embeds: [], components: [] });
    else await interaction.reply({ content: "O baú está vazio.", ephemeral: true });
    return;
  }
  const size = 25;
  const pages = Math.ceil(items.length / size);
  const current = Math.min(Math.max(page, 0), pages - 1);
  const options = items.slice(current * size, (current + 1) * size).map((item) => ({
    label: item.name.slice(0, 100), value: item.name, description: `Disponível: ${item.quantity}`.slice(0, 100), emoji: { name: itemIcon(item.name) },
  }));
  const select = new StringSelectMenuBuilder().setCustomId("warehouse:withdraw-select").setPlaceholder("Escolha o item que deseja retirar").addOptions(options);
  const nav = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`warehouse:withdraw-page:${Math.max(0, current - 1)}:prev`).setLabel("◀ Anterior").setStyle(ButtonStyle.Secondary).setDisabled(current === 0),
    new ButtonBuilder().setCustomId(`warehouse:withdraw-page:${Math.min(pages - 1, current + 1)}:next`).setLabel("Próxima ▶").setStyle(ButtonStyle.Secondary).setDisabled(current >= pages - 1),
  );
  const payload = { content: `**Escolha o item para retirar** • lista ${current + 1}/${pages}. Depois, informe a quantidade e confirme.`, components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select), nav] };
  if (interaction.deferred || interaction.replied) await interaction.editReply(payload);
  else await interaction.reply({ ...payload, ephemeral: true });
}

export function warehouseAdminButton(): ButtonBuilder {
  return new ButtonBuilder().setCustomId("warehouse:configure").setLabel("Configurar Wherehouse").setEmoji("📦").setStyle(ButtonStyle.Secondary);
}

export function warehouseIconAdminButton(): ButtonBuilder {
  return new ButtonBuilder().setCustomId("warehouse:icons").setLabel("Ícones dos itens").setEmoji("🎨").setStyle(ButtonStyle.Secondary);
}

export function warehousePanelComponents(): ActionRowBuilder<ButtonBuilder>[] {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("warehouse:view:0").setLabel("Ver itens").setEmoji("📦").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("warehouse:deposit").setLabel("Guardar item").setEmoji("➕").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId("warehouse:withdraw").setLabel("Retirar item").setEmoji("➖").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("warehouse:history:0").setLabel("Registro").setEmoji("📖").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("warehouse:filter").setLabel("Filtrar registro").setEmoji("🔎").setStyle(ButtonStyle.Secondary),
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("warehouse:deposit-batch").setLabel("Guardar vários itens").setEmoji("📦").setStyle(ButtonStyle.Success),
    ),
  ];
}

async function refreshPublicPanel(guild: ButtonInteraction["guild"] | ModalSubmitInteraction["guild"], guildId: string): Promise<void> {
  if (!guild) return;
  const config = await getGuildConfig(guildId);
  const channelId = config.channelIds["warehouse-panel"];
  if (!channelId) return;
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel || channel.type !== ChannelType.GuildText) return;
  const count = await countWarehouseItems(guildId);
  const embed = new EmbedBuilder().setColor(GOLD).setTitle("📦 Wherehouse da Guilda")
    .setDescription(`Baú compartilhado da Companhia. Consulte, guarde ou retire itens usando os controles abaixo.\n\n**Espaços ocupados:** ${count}/${WAREHOUSE_CAPACITY}\nCada tipo de item ocupa um espaço; itens iguais se acumulam na mesma pilha.`)
    .setFooter({ text: "Movimentações registradas • O histórico permanece" }).setTimestamp();
  const messageId = config.channelIds["warehouse-message"];
  if (messageId) {
    const oldMessage = await channel.messages.fetch(messageId).catch(() => null);
    if (oldMessage) {
      try {
        await oldMessage.edit({ embeds: [embed], components: warehousePanelComponents() });
        return;
      } catch (error) {
        if ((error as { code?: number }).code !== 10008) throw error;
        // O ID estava salvo, mas a mensagem foi apagada; publica um painel novo abaixo.
      }
    }
  }
  const sent = await channel.send({ embeds: [embed], components: warehousePanelComponents() });
  config.channelIds["warehouse-message"] = sent.id;
  await saveGuildConfig(config);
}

async function showItems(interaction: ButtonInteraction, page: number, filter = "", sort: "name" | "quantity" = "name"): Promise<void> {
  const [items, config] = await Promise.all([listWarehouseItems(interaction.guildId!, sort), getGuildConfig(interaction.guildId!)]);
  const matched = filter ? items.filter((item) => canonicalItemName(item.name).includes(canonicalItemName(filter))) : items;
  let overrides: Record<string, string> = {};
  try { overrides = JSON.parse(config.texts.warehouseIconOverrides || "{}"); } catch { overrides = {}; }
  const size = 20;
  const pages = Math.max(1, Math.ceil((filter ? matched.length : WAREHOUSE_CAPACITY) / size));
  const current = Math.min(Math.max(page, 0), pages - 1);
  const view = matched.slice(current * size, (current + 1) * size);
  const slots = Array.from({ length: size }, (_, i) => {
    const slotNo = current * size + i + 1;
    const item = view[i];
    const icon = item ? overrides[canonicalItemName(item.name)] || itemIcon(item.name) : "◻️";
    return item ? `**${String(slotNo).padStart(3, "0")}** ${icon} **${item.name}**\n　└ Quantidade: **${item.quantity}**` : `**${String(slotNo).padStart(3, "0")}** ◻️ _Espaço vazio_`;
  });
  const embed = new EmbedBuilder().setColor(GOLD).setTitle("🧰 Inventário do Wherehouse")
    .setDescription(`${filter && !matched.length ? `Nenhum item encontrado para **${filter}**.` : slots.join("\n")}`)
    .setFooter({ text: `${matched.length}/${WAREHOUSE_CAPACITY} espaços ocupados • ${current + 1}/${pages} páginas${filter ? ` • busca: ${filter}` : ""} • ordem: ${sort === "name" ? "A–Z" : "quantidade"}` });
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(pageId("view", Math.max(0, current - 1), filter, "prev", sort)).setLabel("◀ Anterior").setStyle(ButtonStyle.Secondary).setDisabled(current === 0),
    new ButtonBuilder().setCustomId(pageId("view", Math.min(pages - 1, current + 1), filter, "next", sort)).setLabel("Próxima ▶").setStyle(ButtonStyle.Secondary).setDisabled(current >= pages - 1),
    new ButtonBuilder().setCustomId("warehouse:search-items").setLabel("Buscar item").setEmoji("🔎").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`warehouse:sort:${encodeFilter(JSON.stringify({ filter, sort: sort === "name" ? "quantity" : "name" }))}`).setLabel(sort === "name" ? "Maior quantidade" : "Ordem A–Z").setEmoji("↕️").setStyle(ButtonStyle.Secondary),
  );
  if (interaction.deferred || interaction.replied) await interaction.editReply({ embeds: [embed], components: [row] });
  else await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
}

async function showHistory(interaction: ButtonInteraction, page: number, filter = ""): Promise<void> {
  const size = 10;
  const total = await countWarehouseHistory(interaction.guildId!, filter);
  const pages = Math.max(1, Math.ceil(total / size));
  const current = Math.min(Math.max(page, 0), pages - 1);
  const view = await listWarehouseHistory(interaction.guildId!, filter, size, current * size);
  const embed = new EmbedBuilder().setColor(GOLD).setTitle("📖 Registro do Wherehouse")
    .setDescription(view.length ? view.map((log) => `${log.action === "deposit" ? "➕ Guardou" : "➖ Retirou"} **${log.quantity}× ${log.itemName}**\n> ${log.displayName} • ${date(log.createdAt)}`).join("\n\n") : "Nenhuma movimentação encontrada.")
    .setFooter({ text: `${total} movimentação(ões) • ${current + 1}/${pages} páginas${filter ? ` • filtro: ${filter}` : ""}` });
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(pageId("history", Math.max(0, current - 1), filter, "prev")).setLabel("◀ Anterior").setStyle(ButtonStyle.Secondary).setDisabled(current === 0),
    new ButtonBuilder().setCustomId(pageId("history", Math.min(pages - 1, current + 1), filter, "next")).setLabel("Próxima ▶").setStyle(ButtonStyle.Secondary).setDisabled(current >= pages - 1),
    new ButtonBuilder().setCustomId("warehouse:filter").setLabel("Filtrar").setEmoji("🔎").setStyle(ButtonStyle.Primary),
  );
  const quickFilters = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`warehouse:history-filter:${encodeFilter(`user:${interaction.user.id}`)}`).setLabel("Minhas movimentações").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`warehouse:history-filter:${encodeFilter("action:deposit")}`).setLabel("Guardados").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`warehouse:history-filter:${encodeFilter("action:withdraw")}`).setLabel("Retirados").setStyle(ButtonStyle.Danger),
  );
  if (interaction.deferred || interaction.replied) await interaction.editReply({ embeds: [embed], components: [row, quickFilters] });
  else await interaction.reply({ embeds: [embed], components: [row, quickFilters], ephemeral: true });
}

export async function handleWarehouseButton(interaction: ButtonInteraction): Promise<boolean> {
  if (!interaction.guildId) return false;
  const id = interaction.customId;
  if (id === "warehouse:configure") {
    const modal = new ModalBuilder().setCustomId("warehouse:configure").setTitle("Configurar painel do Wherehouse");
    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(field("channel_id", "ID do canal de publicação", TextInputStyle.Short, true, 30).setPlaceholder("Cole o ID do canal de texto")));
    await interaction.showModal(modal); return true;
  }
  if (id === "warehouse:icons") {
    const modal = new ModalBuilder().setCustomId("warehouse:icons").setTitle("Ícone personalizado do item");
    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(field("item_name", "Nome exato do item", TextInputStyle.Short, true, 100)),
      new ActionRowBuilder<TextInputBuilder>().addComponents(field("emoji", "Emoji novo (vazio remove ajuste)", TextInputStyle.Short, false, 40).setPlaceholder("Ex.: 🐉 ou <:nome:id>")),
    );
    await interaction.showModal(modal); return true;
  }
  if (id === "warehouse:deposit") {
    const modal = new ModalBuilder().setCustomId("warehouse:deposit").setTitle("Guardar item no baú");
    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(field("item_name", "Nome do item", TextInputStyle.Short, true, 100)),
      new ActionRowBuilder<TextInputBuilder>().addComponents(field("quantity", "Quantidade (número inteiro)", TextInputStyle.Short, true, 10).setPlaceholder("Ex.: 3")),
    );
    await interaction.showModal(modal); return true;
  }
  if (id === "warehouse:deposit-batch") {
    const modal = new ModalBuilder().setCustomId("warehouse:deposit-batch").setTitle("Guardar vários itens");
    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(
      field("items", "Um item por linha: nome | quantidade", TextInputStyle.Paragraph, true, 4000)
        .setPlaceholder("Poção de vida | 10\nPoção de mana | 5\nArco | 1\nFlecha | 100"),
    ));
    await interaction.showModal(modal); return true;
  }
  if (id === "warehouse:withdraw") { await showWithdrawChoices(interaction, 0); return true; }
  if (id.startsWith("warehouse:withdraw-page:")) {
    const page = Number(id.split(":")[2]);
    await acknowledgePageClick(interaction);
    await showWithdrawChoices(interaction, page); return true;
  }
  if (id.startsWith("warehouse:confirm-withdraw:")) {
    const token = id.split(":")[2];
    if (interaction.message.flags.has(MessageFlags.Ephemeral)) await interaction.deferUpdate();
    else await interaction.deferReply({ ephemeral: true });
    try {
      const pending = await consumePendingWithdrawal(token, interaction.guildId, interaction.user.id);
      if (!pending) { await interaction.editReply({ content: "Esta confirmação expirou ou já foi utilizada. Reabra a retirada.", components: [] }); return true; }
      const result = await changeWarehouseItem({ guildId: interaction.guildId, action: "withdraw", name: pending.itemName, quantity: pending.quantity, userId: interaction.user.id, displayName: interaction.user.globalName ?? interaction.user.username, operationId: interaction.id });
      await refreshPublicPanel(interaction.guild, interaction.guildId);
      await interaction.editReply({ content: `Retirada confirmada: **${pending.quantity}× ${pending.itemName}**. Restante no baú: **${result.quantity}**. Espaços ocupados: **${result.slotsUsed}/${WAREHOUSE_CAPACITY}**.`, components: [] });
    } catch (error) { await interaction.editReply({ content: error instanceof Error ? error.message : "Não foi possível concluir a retirada.", components: [] }); }
    return true;
  }
  if (id.startsWith("warehouse:cancel-withdraw:")) {
    const token = id.split(":")[2];
    await interaction.deferUpdate();
    await deletePendingWithdrawal(token, interaction.guildId, interaction.user.id);
    await interaction.editReply({ content: "Retirada cancelada. Nenhum item foi removido.", components: [] }); return true;
  }
  if (id.startsWith("warehouse:history-filter:")) {
    const filter = decodeFilter(id.split(":")[2]);
    await acknowledgePageClick(interaction);
    await showHistory(interaction, 0, filter); return true;
  }
  if (id.startsWith("warehouse:sort:")) {
    const state = JSON.parse(decodeFilter(id.slice("warehouse:sort:".length))) as { filter?: string; sort?: "name" | "quantity" };
    await acknowledgePageClick(interaction);
    await showItems(interaction, 0, state.filter ?? "", state.sort === "quantity" ? "quantity" : "name"); return true;
  }
  if (id === "warehouse:filter" || id === "warehouse:search-items") {
    const history = id === "warehouse:filter";
    const modal = new ModalBuilder().setCustomId(history ? "warehouse:filter-history" : "warehouse:filter-items").setTitle(history ? "Filtrar movimentações" : "Buscar itens");
    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(field("query", history ? "Item, nome ou ID do usuário" : "Nome do item", TextInputStyle.Short, false, 100).setPlaceholder("Deixe vazio para ver tudo")));
    await interaction.showModal(modal); return true;
  }
  if (id.startsWith("warehouse:view:")) {
    const [, , rawPage, rawFilter] = id.split(":");
    await acknowledgePageClick(interaction);
    const state = rawFilter && rawFilter !== "-" ? JSON.parse(decodeFilter(rawFilter)) as { filter?: string; sort?: "name" | "quantity" } : {};
    await showItems(interaction, Number(rawPage), state.filter ?? "", state.sort === "quantity" ? "quantity" : "name"); return true;
  }
  if (id.startsWith("warehouse:history:")) {
    const [, , rawPage, rawFilter] = id.split(":");
    await acknowledgePageClick(interaction);
    await showHistory(interaction, Number(rawPage), rawFilter === "-" ? "" : decodeFilter(rawFilter)); return true;
  }
  return false;
}

export async function handleWarehouseSelect(interaction: StringSelectMenuInteraction): Promise<boolean> {
  if (interaction.customId !== "warehouse:withdraw-select" || !interaction.guildId) return false;
  const itemName = interaction.values[0];
  const token = await createPendingWithdrawal({ guildId: interaction.guildId, userId: interaction.user.id, itemName, quantity: 0 });
  const modal = new ModalBuilder().setCustomId(`warehouse:withdraw-quantity:${token}`).setTitle("Quantidade para retirar");
  modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(field("quantity", "Quantidade (número inteiro)", TextInputStyle.Short, true, 10).setPlaceholder("Ex.: 2")));
  await interaction.showModal(modal);
  return true;
}

export async function handleWarehouseModal(interaction: ModalSubmitInteraction): Promise<boolean> {
  if (!interaction.guildId || !interaction.guild) return false;
  if (interaction.customId === "warehouse:configure") {
    const config = await getGuildConfig(interaction.guildId);
    const channelId = interaction.fields.getTextInputValue("channel_id").trim().replace(/[<#>]/g, "");
    if (!/^\d{17,20}$/.test(channelId)) { await interaction.reply({ content: "ID inválido. Informe o ID numérico de um canal de texto do Discord.", ephemeral: true }); return true; }
    const channel = await interaction.guild.channels.fetch(channelId).catch(() => null);
    if (!channel || channel.type !== ChannelType.GuildText) { await interaction.reply({ content: "Não encontrei um canal de texto acessível com esse ID.", ephemeral: true }); return true; }
    config.channelIds["warehouse-panel"] = channelId;
    await saveGuildConfig(config);
    await refreshPublicPanel(interaction.guild, interaction.guildId);
    await interaction.reply({ content: `Painel do Wherehouse publicado ou atualizado em <#${channelId}>.`, ephemeral: true }); return true;
  }
  if (interaction.customId === "warehouse:icons") {
    const itemName = interaction.fields.getTextInputValue("item_name").trim();
    const emoji = interaction.fields.getTextInputValue("emoji").trim();
    if (!itemName || itemName.length > 100 || emoji.length > 40) { await interaction.reply({ content: "Informe um nome de item válido e um emoji com no máximo 40 caracteres.", ephemeral: true }); return true; }
    const config = await getGuildConfig(interaction.guildId);
    let overrides: Record<string, string> = {};
    try { overrides = JSON.parse(config.texts.warehouseIconOverrides || "{}"); } catch { overrides = {}; }
    const key = canonicalItemName(itemName);
    if (emoji) overrides[key] = emoji;
    else delete overrides[key];
    config.texts.warehouseIconOverrides = JSON.stringify(overrides);
    await saveGuildConfig(config);
    await interaction.reply({ content: emoji ? `Ícone de **${itemName}** definido como ${emoji}.` : `Ícone personalizado de **${itemName}** removido; o bot voltará a sugerir automaticamente.`, ephemeral: true }); return true;
  }
  if (interaction.customId === "warehouse:deposit-batch") {
    const lines = interaction.fields.getTextInputValue("items").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (!lines.length) { await interaction.reply({ content: "Digite pelo menos um item no formato **Nome do item | quantidade**.", ephemeral: true }); return true; }
    if (lines.length > 40) { await interaction.reply({ content: "O limite é de 40 linhas de itens por envio.", ephemeral: true }); return true; }
    const entries: Array<{ name: string; quantity: number }> = [];
    for (const [index, line] of lines.entries()) {
      const match = line.match(/^(.+?)\s*\|\s*(\d+)$/);
      if (!match) { await interaction.reply({ content: `Linha ${index + 1} inválida: **${line}**. Use o formato **Nome do item | quantidade** (ex.: Poção de vida | 10).`, ephemeral: true }); return true; }
      const name = match[1].trim();
      const quantity = Number(match[2]);
      if (!name || name.length > 100 || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 1000000) {
        await interaction.reply({ content: `Confira o nome e a quantidade da linha ${index + 1}; use quantidade de 1 a 1.000.000.`, ephemeral: true }); return true;
      }
      entries.push({ name, quantity });
    }
    await interaction.deferReply({ ephemeral: true });
    try {
      const result = await depositWarehouseBatch({ guildId: interaction.guildId, items: entries, userId: interaction.user.id, displayName: interaction.user.globalName ?? interaction.user.username, operationId: interaction.id });
      await refreshPublicPanel(interaction.guild, interaction.guildId);
      const summary = entries.map((entry) => `• ${entry.name} — **${entry.quantity}**`).join("\n");
      await interaction.editReply(`**${result.itemCount} tipo(s) de item guardado(s) com sucesso.**\n${summary}\n\nEspaços ocupados: **${result.slotsUsed}/${WAREHOUSE_CAPACITY}**.`);
    } catch (error) { await interaction.editReply(error instanceof Error ? error.message : "Não foi possível guardar a lista."); }
    return true;
  }
  if (interaction.customId === "warehouse:deposit") {
    const raw = interaction.fields.getTextInputValue("quantity").trim();
    if (!/^\d+$/.test(raw)) { await interaction.reply({ content: "A quantidade precisa ser um número inteiro positivo.", ephemeral: true }); return true; }
    await interaction.deferReply({ ephemeral: true });
    try {
      const name = interaction.fields.getTextInputValue("item_name");
      const result = await changeWarehouseItem({ guildId: interaction.guildId, action: "deposit", name, quantity: Number(raw), userId: interaction.user.id, displayName: interaction.user.globalName ?? interaction.user.username, operationId: interaction.id });
      await refreshPublicPanel(interaction.guild, interaction.guildId);
      await interaction.editReply(`Item guardado. **${name.trim()}** — quantidade: **${raw}**. Espaços ocupados: **${result.slotsUsed}/${WAREHOUSE_CAPACITY}**.`);
    } catch (error) { await interaction.editReply(error instanceof Error ? error.message : "Não foi possível atualizar o baú."); }
    return true;
  }
  if (interaction.customId.startsWith("warehouse:withdraw-quantity:")) {
    const token = interaction.customId.split(":")[2];
    const raw = interaction.fields.getTextInputValue("quantity").trim();
    if (!/^\d+$/.test(raw)) { await interaction.reply({ content: "A quantidade precisa ser um número inteiro positivo.", ephemeral: true }); return true; }
    try {
      const itemName = await setPendingWithdrawalQuantity(token, interaction.guildId, interaction.user.id, Number(raw));
      if (!itemName) { await interaction.reply({ content: "A seleção expirou. Escolha o item novamente.", ephemeral: true }); return true; }
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`warehouse:confirm-withdraw:${token}`).setLabel("Confirmar retirada").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`warehouse:cancel-withdraw:${token}`).setLabel("Cancelar").setStyle(ButtonStyle.Secondary),
      );
      await interaction.reply({ content: `**Confirme a retirada**\nItem: ${itemIcon(itemName)} **${itemName}**\nQuantidade: **${raw}**\nO saldo será validado antes da operação.`, components: [row], ephemeral: true });
    } catch (error) { await interaction.reply({ content: error instanceof Error ? error.message : "Não foi possível preparar a retirada.", ephemeral: true }); }
    return true;
  }
  if (interaction.customId === "warehouse:filter-items" || interaction.customId === "warehouse:filter-history") {
    const filter = interaction.fields.getTextInputValue("query").trim();
    const maxBytes = interaction.customId.endsWith("items") ? 30 : 45;
    if (Buffer.byteLength(filter, "utf8") > maxBytes) { await interaction.reply({ content: `Use um filtro com até ${maxBytes} bytes para a navegação funcionar.`, ephemeral: true }); return true; }
    await interaction.deferReply({ ephemeral: true });
    const proxy = interaction as unknown as ButtonInteraction;
    if (interaction.customId.endsWith("items")) await showItems(proxy, 0, filter);
    else await showHistory(proxy, 0, filter);
    return true;
  }
  return false;
}
