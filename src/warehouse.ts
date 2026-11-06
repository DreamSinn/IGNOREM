import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder, ModalBuilder,
  TextInputBuilder, TextInputStyle, type ButtonInteraction, type ModalSubmitInteraction,
} from "discord.js";
import { getGuildConfig, saveGuildConfig } from "./db.js";
import { changeWarehouseItem, countWarehouseHistory, countWarehouseItems, listWarehouseHistory, listWarehouseItems, WAREHOUSE_CAPACITY } from "./warehouse-db.js";

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
const pageId = (kind: "view" | "history", page: number, filter: string, direction: "prev" | "next") => `warehouse:${kind}:${page}:${filter ? encodeFilter(filter) : "-"}:${direction}`;

export function warehouseAdminButton(): ButtonBuilder {
  return new ButtonBuilder().setCustomId("warehouse:configure").setLabel("Configurar Wherehouse").setEmoji("📦").setStyle(ButtonStyle.Secondary);
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
      await oldMessage.edit({ embeds: [embed], components: warehousePanelComponents() });
      return;
    }
  }
  const sent = await channel.send({ embeds: [embed], components: warehousePanelComponents() });
  config.channelIds["warehouse-message"] = sent.id;
  await saveGuildConfig(config);
}

async function showItems(interaction: ButtonInteraction, page: number, filter = ""): Promise<void> {
  const items = await listWarehouseItems(interaction.guildId!);
  const matched = filter ? items.filter((item) => item.name.toLocaleLowerCase("pt-BR").includes(filter.toLocaleLowerCase("pt-BR"))) : items;
  const size = 20;
  const pages = Math.max(1, Math.ceil((filter ? matched.length : WAREHOUSE_CAPACITY) / size));
  const current = Math.min(Math.max(page, 0), pages - 1);
  const view = matched.slice(current * size, (current + 1) * size);
  const slots = Array.from({ length: size }, (_, i) => {
    const slotNo = current * size + i + 1;
    const item = view[i];
    return item ? `**${String(slotNo).padStart(3, "0")}** ${itemIcon(item.name)} **${item.name}**\n　└ Quantidade: **${item.quantity}**` : `**${String(slotNo).padStart(3, "0")}** ◻️ _Espaço vazio_`;
  });
  const embed = new EmbedBuilder().setColor(GOLD).setTitle("🧰 Inventário do Wherehouse")
    .setDescription(`${filter && !matched.length ? `Nenhum item encontrado para **${filter}**.` : slots.join("\n")}`)
    .setFooter({ text: `${matched.length}/${WAREHOUSE_CAPACITY} espaços ocupados • ${current + 1}/${pages} páginas${filter ? ` • busca: ${filter}` : " • ícones sugeridos pelo nome"}` });
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(pageId("view", Math.max(0, current - 1), filter, "prev")).setLabel("◀ Anterior").setStyle(ButtonStyle.Secondary).setDisabled(current === 0),
    new ButtonBuilder().setCustomId(pageId("view", Math.min(pages - 1, current + 1), filter, "next")).setLabel("Próxima ▶").setStyle(ButtonStyle.Secondary).setDisabled(current >= pages - 1),
    new ButtonBuilder().setCustomId("warehouse:search-items").setLabel("Buscar item").setEmoji("🔎").setStyle(ButtonStyle.Primary),
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
  if (interaction.deferred || interaction.replied) await interaction.editReply({ embeds: [embed], components: [row] });
  else await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
}

export async function handleWarehouseButton(interaction: ButtonInteraction): Promise<boolean> {
  if (!interaction.guildId) return false;
  const id = interaction.customId;
  if (id === "warehouse:configure") {
    const modal = new ModalBuilder().setCustomId("warehouse:configure").setTitle("Configurar painel do Wherehouse");
    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(field("channel_id", "ID do canal de publicação", TextInputStyle.Short, true, 30).setPlaceholder("Cole o ID do canal de texto")));
    await interaction.showModal(modal); return true;
  }
  if (id === "warehouse:deposit" || id === "warehouse:withdraw") {
    const deposit = id.endsWith("deposit");
    const modal = new ModalBuilder().setCustomId(`warehouse:${deposit ? "deposit" : "withdraw"}`).setTitle(deposit ? "Guardar item no baú" : "Retirar item do baú");
    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(field("item_name", "Nome do item", TextInputStyle.Short, true, 100)),
      new ActionRowBuilder<TextInputBuilder>().addComponents(field("quantity", "Quantidade (número inteiro)", TextInputStyle.Short, true, 10).setPlaceholder("Ex.: 3")),
    );
    await interaction.showModal(modal); return true;
  }
  if (id === "warehouse:filter" || id === "warehouse:search-items") {
    const history = id === "warehouse:filter";
    const modal = new ModalBuilder().setCustomId(history ? "warehouse:filter-history" : "warehouse:filter-items").setTitle(history ? "Filtrar movimentações" : "Buscar itens");
    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(field("query", history ? "Item, nome ou ID do usuário" : "Nome do item", TextInputStyle.Short, false, 100).setPlaceholder("Deixe vazio para ver tudo")));
    await interaction.showModal(modal); return true;
  }
  if (id.startsWith("warehouse:view:")) {
    const [, , rawPage, rawFilter] = id.split(":");
    await interaction.deferReply({ ephemeral: true });
    await showItems(interaction, Number(rawPage), rawFilter === "-" ? "" : decodeFilter(rawFilter)); return true;
  }
  if (id.startsWith("warehouse:history:")) {
    const [, , rawPage, rawFilter] = id.split(":");
    await interaction.deferReply({ ephemeral: true });
    await showHistory(interaction, Number(rawPage), rawFilter === "-" ? "" : decodeFilter(rawFilter)); return true;
  }
  return false;
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
  if (interaction.customId === "warehouse:deposit" || interaction.customId === "warehouse:withdraw") {
    const action = interaction.customId.endsWith("deposit") ? "deposit" : "withdraw";
    const raw = interaction.fields.getTextInputValue("quantity").trim();
    if (!/^\d+$/.test(raw)) { await interaction.reply({ content: "A quantidade precisa ser um número inteiro positivo.", ephemeral: true }); return true; }
    await interaction.deferReply({ ephemeral: true });
    try {
      const result = await changeWarehouseItem({ guildId: interaction.guildId, action, name: interaction.fields.getTextInputValue("item_name"), quantity: Number(raw), userId: interaction.user.id, displayName: interaction.user.globalName ?? interaction.user.username });
      await refreshPublicPanel(interaction.guild, interaction.guildId);
      await interaction.editReply(`${action === "deposit" ? "Item guardado" : "Item retirado"}. **${interaction.fields.getTextInputValue("item_name").trim()}** — quantidade: **${raw}**. Espaços ocupados: **${result.slotsUsed}/${WAREHOUSE_CAPACITY}**.`);
    } catch (error) { await interaction.editReply(error instanceof Error ? error.message : "Não foi possível atualizar o baú."); }
    return true;
  }
  if (interaction.customId === "warehouse:filter-items" || interaction.customId === "warehouse:filter-history") {
    const filter = interaction.fields.getTextInputValue("query").trim();
    if (Buffer.byteLength(filter, "utf8") > 45) { await interaction.reply({ content: "Use um filtro com até 45 bytes (aproximadamente 15 caracteres com acentos) para a navegação funcionar.", ephemeral: true }); return true; }
    await interaction.deferReply({ ephemeral: true });
    const proxy = interaction as unknown as ButtonInteraction;
    if (interaction.customId.endsWith("items")) await showItems(proxy, 0, filter);
    else await showHistory(proxy, 0, filter);
    return true;
  }
  return false;
}
