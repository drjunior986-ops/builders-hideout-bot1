import { randomUUID } from "node:crypto";
import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  ModalBuilder,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Client,
  type Guild,
  type GuildMember,
  type Message,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
  type TextChannel,
  type UserSelectMenuInteraction,
} from "discord.js";
import {
  ConfigStore,
  type TicketCloseRecord,
  type TicketConfig,
  type TicketEvent,
  type TicketPanelConfig,
  type TicketPriority,
  type TicketQuestion,
  type TicketRecord,
  type TicketTypeConfig,
} from "./config-store.js";
import { getTextChannel, sendModerationLog } from "./moderation.js";

const TICKET_ID_PREFIX = "ticket:";
const MAX_TIMER_DELAY = 2_147_000_000;
const PRIORITIES: Record<TicketPriority, { label: string; color: number }> = {
  low: { label: "🟢 Low", color: 0x57f287 },
  normal: { label: "🔵 Normal", color: 0x5865f2 },
  high: { label: "🟠 High", color: 0xfaa61a },
  urgent: { label: "🔴 Urgent", color: 0xed4245 },
};

type Interaction =
  | ButtonInteraction
  | StringSelectMenuInteraction
  | UserSelectMenuInteraction
  | ModalSubmitInteraction;

type QuestionnaireSession = {
  guildId: string;
  userId: string;
  panelId: string;
  typeKey: string;
  answers: Record<string, string>;
  expiresAt: number;
};

export class TicketError extends Error {}

export class TicketManager {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly questionnaireSessions = new Map<string, QuestionnaireSession>();

  constructor(
    private readonly configStore: ConfigStore,
    private readonly client: Client,
  ) {}

  async handleCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    const guild = interaction.guild;
    if (!guild) {
      await this.replyError(interaction, "Ticket commands can only be used inside a server.");
      return;
    }

    const subcommand = interaction.options.getSubcommand();
    const group = interaction.options.getSubcommandGroup(false);
    if (subcommand === "priority") {
      await this.updatePriorityFromCommand(interaction, guild);
      return;
    }
    if (subcommand === "adduser" || subcommand === "removeuser") {
      await this.updateUserFromCommand(interaction, guild, subcommand === "adduser");
      return;
    }
    if (subcommand === "rename") {
      await this.renameFromCommand(interaction, guild);
      return;
    }
    if (subcommand === "close") {
      const ticket = this.getTicketForChannel(guild.id, interaction.channelId);
      if (!ticket) {
        await this.replyError(interaction, "This command must be used in a ticket channel.");
        return;
      }
      if (!(await this.requireTicketAccess(interaction, guild, ticket))) {
        return;
      }
      const reason = interaction.options.getString("reason", true).trim();
      if (!reason) {
        await this.replyError(interaction, "A close reason is required.");
        return;
      }
      await this.closeTicket(guild, ticket, reason, interaction.user.id, false);
      await this.replySuccess(interaction, "Ticket closed and transcript created.");
      return;
    }

    if (!(await this.requireStaff(interaction))) {
      return;
    }

    if (group === "panel") {
      await this.handlePanelCommand(interaction, guild);
      return;
    }
    if (group === "type") {
      await this.handleTypeCommand(interaction, guild);
      return;
    }
    if (group === "question") {
      await this.handleQuestionCommand(interaction, guild);
      return;
    }
    if (group === "role") {
      await this.handleRoleCommand(interaction, guild);
      return;
    }
    if (subcommand === "config") {
      await this.handleConfigCommand(interaction, guild);
    }
  }

  async handleComponent(interaction: Interaction): Promise<void> {
    if (interaction.isStringSelectMenu()) {
      if (interaction.customId.startsWith(`${TICKET_ID_PREFIX}panel:`)) {
        await this.handlePanelSelection(interaction);
        return;
      }
      if (interaction.customId.startsWith(`${TICKET_ID_PREFIX}priority:`)) {
        await this.handlePrioritySelection(interaction);
        return;
      }
    }

    if (interaction.isUserSelectMenu()) {
      if (interaction.customId.startsWith(`${TICKET_ID_PREFIX}useradd:`)) {
        await this.handleUserSelection(interaction, true);
        return;
      }
      if (interaction.customId.startsWith(`${TICKET_ID_PREFIX}userremove:`)) {
        await this.handleUserSelection(interaction, false);
        return;
      }
    }

    if (interaction.isModalSubmit()) {
      if (interaction.customId.startsWith(`${TICKET_ID_PREFIX}q:`)) {
        await this.handleQuestionnaireModal(interaction);
        return;
      }
      if (interaction.customId.startsWith(`${TICKET_ID_PREFIX}close:`)) {
        await this.handleCloseModal(interaction);
        return;
      }
      if (interaction.customId.startsWith(`${TICKET_ID_PREFIX}rename:`)) {
        await this.handleRenameModal(interaction);
      }
      return;
    }

    if (!interaction.isButton()) {
      return;
    }

    const [prefix, action, ticketId] = interaction.customId.split(":");
    if (prefix !== "ticket" || !action || !ticketId) {
      return;
    }
    const guild = interaction.guild;
    if (!guild) {
      await this.replyError(interaction, "This ticket is not attached to a server.");
      return;
    }
    if (action === "nextq") {
      await this.handleNextQuestionButton(interaction);
      return;
    }
    const ticket = this.getTicket(guild.id, ticketId);
    if (!ticket) {
      await this.replyError(interaction, "That ticket no longer exists.");
      return;
    }

    if (action === "close") {
      if (!(await this.requireTicketAccess(interaction, guild, ticket))) {
        return;
      }
      await interaction.showModal(this.buildCloseModal(ticket.id));
      return;
    }
    if (action === "claim" || action === "unclaim") {
      await this.claimTicket(interaction, guild, ticket, action === "claim");
      return;
    }
    if (action === "rename") {
      if (!(await this.requireTicketAccess(interaction, guild, ticket))) {
        return;
      }
      await interaction.showModal(this.buildRenameModal(ticket.id));
      return;
    }
    if (action === "adduser" || action === "removeuser") {
      if (!(await this.requireTicketAccess(interaction, guild, ticket))) {
        return;
      }
      await interaction.reply({
        content: action === "adduser"
          ? "Choose the user to add to this ticket."
          : "Choose the user to remove from this ticket.",
        components: [this.buildUserSelect(ticket.id, action === "adduser")],
        ephemeral: true,
      });
      return;
    }
    if (action === "priority") {
      if (!(await this.requireTicketAccess(interaction, guild, ticket))) {
        return;
      }
      await interaction.reply({
        content: "Choose the new ticket priority.",
        components: [this.buildPrioritySelect(ticket.id)],
        ephemeral: true,
      });
      return;
    }
    if (action === "reopen") {
      await this.reopenTicket(interaction, guild, ticket);
      return;
    }
    if (action === "delete") {
      await this.deleteTicket(interaction, guild, ticket);
    }
  }

  async handleMessage(message: Message): Promise<void> {
    if (!message.guild || message.author.bot || message.system) {
      return;
    }
    const ticket = this.getTicketForChannel(message.guild.id, message.channelId);
    if (!ticket || ticket.status !== "open") {
      return;
    }

    const updated = this.configStore.updateTicketConfig(message.guild.id, (config) => {
      const current = config.tickets[ticket.id];
      if (!current || current.status !== "open") {
        return;
      }
      current.lastActivityAt = new Date().toISOString();
      current.warningSentAt = undefined;
      current.inactivityWarningAt = undefined;
    }).tickets[ticket.id];
    if (updated) {
      this.scheduleInactivity(updated);
    }
  }

  async restore(): Promise<void> {
    for (const ticket of Object.values(this.getAllTickets())) {
      if (ticket.status === "open") {
        this.scheduleInactivity(ticket);
      }
    }
  }

  private async handlePanelSelection(
    interaction: StringSelectMenuInteraction,
  ): Promise<void> {
    const panelId = interaction.customId.slice(`${TICKET_ID_PREFIX}panel:`.length);
    const guild = interaction.guild;
    const typeKey = interaction.values[0];
    if (!guild || !typeKey) {
      await this.replyError(interaction, "That ticket panel is no longer available.");
      return;
    }

    const config = this.configStore.getTicketConfig(guild.id);
    const panel = config.panels[panelId];
    const type = config.types[typeKey];
    if (!panel || !type) {
      await this.replyError(interaction, "That ticket type is no longer configured.");
      return;
    }
    const existing = this.findOpenTicket(guild.id, interaction.user.id, type.key);
    if (type.preventDuplicate && existing) {
      await this.replyError(interaction, `You already have an open ${type.name} ticket: <#${existing.channelId}>.`);
      return;
    }

    const questions = [...type.questions].sort((left, right) => left.order - right.order);
    if (questions.length === 0) {
      const ticket = await this.createTicket(guild, panel, type, interaction.user.id, {});
      await this.replySuccess(interaction, `Your ticket has been created: <#${ticket.channelId}>.`);
      return;
    }

    const sessionId = randomUUID();
    this.questionnaireSessions.set(sessionId, {
      guildId: guild.id,
      userId: interaction.user.id,
      panelId,
      typeKey: type.key,
      answers: {},
      expiresAt: Date.now() + 15 * 60 * 1000,
    });
    await interaction.showModal(this.buildQuestionModal(sessionId, 0, questions));
  }

  private async handleQuestionnaireModal(
    interaction: ModalSubmitInteraction,
  ): Promise<void> {
    const [, , sessionId, stepValue] = interaction.customId.split(":");
    const session = this.questionnaireSessions.get(sessionId);
    if (!session || session.expiresAt < Date.now() || session.userId !== interaction.user.id) {
      await this.replyError(interaction, "That questionnaire expired. Please select the ticket type again.");
      return;
    }

    const guild = interaction.guild;
    if (!guild) {
      await this.replyError(interaction, "This questionnaire is no longer attached to a server.");
      return;
    }
    const config = this.configStore.getTicketConfig(guild.id);
    const type = config.types[session.typeKey];
    const panel = config.panels[session.panelId];
    if (!type || !panel) {
      await this.replyError(interaction, "That ticket type is no longer configured.");
      this.questionnaireSessions.delete(sessionId);
      return;
    }

    const questions = [...type.questions].sort((left, right) => left.order - right.order);
    const step = Number(stepValue);
    for (const question of questions.slice(step * 5, step * 5 + 5)) {
      session.answers[question.id] = interaction.fields.getTextInputValue(question.id).trim();
    }

    const nextStep = step + 1;
    if (nextStep * 5 < questions.length) {
      await interaction.reply({
        content: "Continue to the next set of ticket questions.",
        components: [
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
              .setCustomId(`${TICKET_ID_PREFIX}nextq:${sessionId}:${nextStep}`)
              .setLabel("Continue")
              .setStyle(ButtonStyle.Primary),
          ),
        ],
        ephemeral: true,
      });
      return;
    }

    this.questionnaireSessions.delete(sessionId);
    const ticket = await this.createTicket(guild, panel, type, interaction.user.id, session.answers);
    await this.replySuccess(interaction, `Your ticket has been created: <#${ticket.channelId}>.`);
  }

  private async handleNextQuestionButton(interaction: ButtonInteraction): Promise<void> {
    const [, , sessionId, stepValue] = interaction.customId.split(":");
    const session = this.questionnaireSessions.get(sessionId);
    if (!session || session.expiresAt < Date.now() || session.userId !== interaction.user.id) {
      await this.replyError(interaction, "That questionnaire expired. Please select the ticket type again.");
      return;
    }
    const guild = interaction.guild;
    if (!guild) {
      await this.replyError(interaction, "This questionnaire is no longer attached to a server.");
      return;
    }
    const type = this.configStore.getTicketConfig(guild.id).types[session.typeKey];
    if (!type) {
      await this.replyError(interaction, "That ticket type is no longer configured.");
      return;
    }
    await interaction.showModal(
      this.buildQuestionModal(
        sessionId,
        Number(stepValue),
        [...type.questions].sort((left, right) => left.order - right.order),
      ),
    );
  }

  private async createTicket(
    guild: Guild,
    panel: TicketPanelConfig,
    type: TicketTypeConfig,
    creatorId: string,
    answers: Record<string, string>,
  ): Promise<TicketRecord> {
    const existing = this.findOpenTicket(guild.id, creatorId, type.key);
    if (type.preventDuplicate && existing) {
      throw new TicketError(`You already have an open ticket of this type: <#${existing.channelId}>.`);
    }

    const id = randomUUID();
    const now = new Date().toISOString();
    const name = this.buildChannelName(type, id, creatorId);
    const validStaffRoleIds = [];
    for (const roleId of type.staffRoleIds) {
      if (await guild.roles.fetch(roleId).catch(() => null)) {
        validStaffRoleIds.push(roleId);
      }
    }
    const permissionOverwrites = [
      {
        id: guild.roles.everyone.id,
        deny: [PermissionFlagsBits.ViewChannel],
      },
      {
        id: this.client.user?.id ?? guild.client.user.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.EmbedLinks,
          PermissionFlagsBits.AttachFiles,
        ],
      },
      {
        id: creatorId,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.AttachFiles,
        ],
      },
      ...validStaffRoleIds.map((roleId) => ({
        id: roleId,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
        ],
      })),
    ];

    const categoryId = type.categoryId
      ? (await guild.channels.fetch(type.categoryId).catch(() => null))?.type === ChannelType.GuildCategory
        ? type.categoryId
        : undefined
      : undefined;
    const channel = await guild.channels.create({
      name,
      type: ChannelType.GuildText,
      ...(categoryId ? { parent: categoryId } : {}),
      permissionOverwrites,
      reason: `Ticket ${id} created`,
    }).catch(() => null);
    if (!channel || channel.type !== ChannelType.GuildText) {
      throw new TicketError("I could not create the private ticket channel. Check my channel and category permissions.");
    }

    const ticket: TicketRecord = {
      id,
      guildId: guild.id,
      channelId: channel.id,
      panelId: panel.id,
      typeKey: type.key,
      typeName: type.name,
      creatorId,
      staffRoleIds: type.staffRoleIds,
      questionAnswers: answers,
      addedUserIds: [],
      priority: "normal",
      status: "open",
      createdAt: now,
      lastActivityAt: now,
      closeHistory: [],
      events: [
        {
          type: "created",
          actorId: creatorId,
          details: `Created as ${type.name}.`,
          timestamp: now,
        },
      ],
    };
    this.configStore.updateTicketConfig(guild.id, (config) => {
      config.tickets[id] = ticket;
    });
    await channel.send({
      content: `<@${creatorId}>`,
      embeds: [this.buildTicketEmbed(ticket, type)],
      components: this.buildTicketComponents(ticket),
      allowedMentions: { users: [creatorId], parse: [] },
    }).catch(() => undefined);
    this.scheduleInactivity(ticket);
    await this.logTicket(guild, ticket, "Ticket created", `Type: ${type.name}.`, creatorId);
    return ticket;
  }

  private async handleCloseModal(interaction: ModalSubmitInteraction): Promise<void> {
    const ticketId = interaction.customId.slice(`${TICKET_ID_PREFIX}close:`.length);
    const guild = interaction.guild;
    const ticket = guild ? this.getTicket(guild.id, ticketId) : null;
    if (!guild || !ticket) {
      await this.replyError(interaction, "That ticket no longer exists.");
      return;
    }
    if (!(await this.requireTicketAccess(interaction, guild, ticket))) {
      return;
    }
    const reason = interaction.fields.getTextInputValue("reason").trim();
    if (!reason) {
      await this.replyError(interaction, "A close reason is required.");
      return;
    }
    await this.closeTicket(guild, ticket, reason, interaction.user.id, false);
    await this.replySuccess(interaction, "Ticket closed and transcript created.");
  }

  private async closeTicket(
    guild: Guild,
    ticket: TicketRecord,
    reason: string,
    closerId: string,
    automatic: boolean,
  ): Promise<TicketRecord> {
    if (ticket.status !== "open") {
      throw new TicketError("That ticket is already closed.");
    }
    this.clearTimers(ticket.id);
    const closedAt = new Date().toISOString();
    const closeRecord: TicketCloseRecord = {
      reason,
      closedBy: closerId,
      closedAt,
      automatic,
    };
    const updated = this.configStore.updateTicketConfig(guild.id, (config) => {
      const current = config.tickets[ticket.id];
      if (!current) return;
      current.status = "closed";
      current.closeReason = reason;
      current.closedBy = closerId;
      current.closedAt = closedAt;
      current.closeHistory.push(closeRecord);
      current.events.push({
        type: automatic ? "automatic-close" : "closed",
        actorId: closerId,
        details: reason,
        timestamp: closedAt,
      });
    }).tickets[ticket.id];
    if (!updated) {
      throw new TicketError("That ticket no longer exists.");
    }

    const channel = await this.getTicketChannel(guild, updated);
    if (channel) {
      for (const userId of [updated.creatorId, ...updated.addedUserIds]) {
        await channel.permissionOverwrites.edit(userId, {
          SendMessages: false,
        }).catch(() => undefined);
      }
      await this.updateTicketMessage(channel, updated);
    }
    await this.createTranscript(guild, updated, channel);
    await this.logTicket(
      guild,
      updated,
      automatic ? "Ticket auto-closed" : "Ticket closed",
      `Close reason: ${reason}`,
      closerId,
    );
    return updated;
  }

  private async reopenTicket(
    interaction: ButtonInteraction,
    guild: Guild,
    ticket: TicketRecord,
  ): Promise<void> {
    if (!(await this.requireStaff(interaction))) {
      return;
    }
    if (ticket.status !== "closed") {
      await this.replyError(interaction, "Only closed tickets can be reopened.");
      return;
    }
    const now = new Date().toISOString();
    const updated = this.configStore.updateTicketConfig(guild.id, (config) => {
      const current = config.tickets[ticket.id];
      if (!current) return;
      current.status = "open";
      current.lastActivityAt = now;
      current.warningSentAt = undefined;
      current.inactivityWarningAt = undefined;
      current.events.push({ type: "reopened", actorId: interaction.user.id, timestamp: now });
    }).tickets[ticket.id];
    if (!updated) {
      await this.replyError(interaction, "That ticket no longer exists.");
      return;
    }
    const channel = await this.getTicketChannel(guild, updated);
    if (channel) {
      for (const userId of [updated.creatorId, ...updated.addedUserIds]) {
        await channel.permissionOverwrites.edit(userId, {
          ViewChannel: true,
          SendMessages: true,
          ReadMessageHistory: true,
        }).catch(() => undefined);
      }
      await this.updateTicketMessage(channel, updated);
    }
    this.scheduleInactivity(updated);
    await this.logTicket(guild, updated, "Ticket reopened", "Ticket reopened by staff.", interaction.user.id);
    await this.replySuccess(interaction, "Ticket reopened.");
  }

  private async deleteTicket(
    interaction: ButtonInteraction,
    guild: Guild,
    ticket: TicketRecord,
  ): Promise<void> {
    if (!(await this.requireStaff(interaction))) {
      return;
    }
    if (ticket.status !== "closed") {
      await this.replyError(interaction, "Close the ticket before deleting it.");
      return;
    }
    const channel = await this.getTicketChannel(guild, ticket);
    await this.createTranscript(guild, ticket, channel);
    const updated = this.configStore.updateTicketConfig(guild.id, (config) => {
      const current = config.tickets[ticket.id];
      if (!current) return;
      current.status = "deleted";
      current.deletedAt = new Date().toISOString();
      current.events.push({
        type: "deleted",
        actorId: interaction.user.id,
        timestamp: current.deletedAt,
      });
    }).tickets[ticket.id];
    if (updated) {
      await this.logTicket(guild, updated, "Ticket deleted", "Closed ticket deleted.", interaction.user.id);
    }
    await interaction.reply({ content: "Deleting the ticket channel.", ephemeral: true });
    await channel?.delete(`Ticket ${ticket.id} deleted by ${interaction.user.tag}`).catch(() => undefined);
  }

  private async claimTicket(
    interaction: ButtonInteraction,
    guild: Guild,
    ticket: TicketRecord,
    claim: boolean,
  ): Promise<void> {
    if (!(await this.requireStaff(interaction))) {
      return;
    }
    if (ticket.status !== "open") {
      await this.replyError(interaction, "Only open tickets can be claimed.");
      return;
    }
    if (claim && ticket.claimantId && ticket.claimantId !== interaction.user.id) {
      await this.replyError(interaction, `This ticket is already claimed by <@${ticket.claimantId}>.`);
      return;
    }
    const claimantId = claim ? interaction.user.id : undefined;
    const updated = this.configStore.updateTicketConfig(guild.id, (config) => {
      const current = config.tickets[ticket.id];
      if (!current) return;
      current.claimantId = claimantId;
      current.events.push({
        type: claim ? "claimed" : "unclaimed",
        actorId: interaction.user.id,
        timestamp: new Date().toISOString(),
      });
    }).tickets[ticket.id];
    if (!updated) {
      await this.replyError(interaction, "That ticket no longer exists.");
      return;
    }
    const channel = await this.getTicketChannel(guild, updated);
    if (channel) await this.updateTicketMessage(channel, updated);
    await this.logTicket(guild, updated, claim ? "Ticket claimed" : "Ticket unclaimed", "", interaction.user.id);
    await this.replySuccess(interaction, claim ? "Ticket claimed." : "Ticket unclaimed.");
  }

  private async handlePrioritySelection(interaction: StringSelectMenuInteraction): Promise<void> {
    const ticketId = interaction.customId.slice(`${TICKET_ID_PREFIX}priority:`.length);
    const guild = interaction.guild;
    const ticket = guild ? this.getTicket(guild.id, ticketId) : null;
    if (!guild || !ticket || !interaction.values[0]) {
      await this.replyError(interaction, "That ticket no longer exists.");
      return;
    }
    await this.changePriority(interaction, guild, ticket, interaction.values[0]);
  }

  private async updatePriorityFromCommand(
    interaction: ChatInputCommandInteraction,
    guild: Guild,
  ): Promise<void> {
    const ticket = this.getTicketForChannel(guild.id, interaction.channelId);
    const priority = interaction.options.getString("priority", true);
    if (!ticket) {
      await this.replyError(interaction, "This command must be used in a ticket channel.");
      return;
    }
    await this.changePriority(interaction, guild, ticket, priority);
  }

  private async changePriority(
    interaction: ChatInputCommandInteraction | StringSelectMenuInteraction,
    guild: Guild,
    ticket: TicketRecord,
    value: string,
  ): Promise<void> {
    if (!(await this.requireTicketAccess(interaction, guild, ticket))) return;
    if (!(value in PRIORITIES)) {
      await this.replyError(interaction, "Choose Low, Normal, High, or Urgent.");
      return;
    }
    const priority = value as TicketPriority;
    const updated = this.configStore.updateTicketConfig(guild.id, (config) => {
      const current = config.tickets[ticket.id];
      if (!current) return;
      current.priority = priority;
      current.events.push({
        type: "priority-changed",
        actorId: interaction.user.id,
        details: PRIORITIES[priority].label,
        timestamp: new Date().toISOString(),
      });
    }).tickets[ticket.id];
    if (!updated) {
      await this.replyError(interaction, "That ticket no longer exists.");
      return;
    }
    const channel = await this.getTicketChannel(guild, updated);
    if (channel) await this.updateTicketMessage(channel, updated);
    await this.logTicket(guild, updated, "Ticket priority changed", `Priority: ${PRIORITIES[priority].label}`, interaction.user.id);
    await this.replySuccess(interaction, `Ticket priority changed to ${PRIORITIES[priority].label}.`);
  }

  private async updateUserFromCommand(
    interaction: ChatInputCommandInteraction,
    guild: Guild,
    add: boolean,
  ): Promise<void> {
    const ticket = this.getTicketForChannel(guild.id, interaction.channelId);
    const user = interaction.options.getUser("user", true);
    if (!ticket) {
      await this.replyError(interaction, "This command must be used in a ticket channel.");
      return;
    }
    await this.changeUser(interaction, guild, ticket, user.id, add);
  }

  private async handleUserSelection(
    interaction: UserSelectMenuInteraction,
    add: boolean,
  ): Promise<void> {
    const ticketId = interaction.customId.slice(`${TICKET_ID_PREFIX}${add ? "useradd" : "userremove"}:`.length);
    const guild = interaction.guild;
    const ticket = guild ? this.getTicket(guild.id, ticketId) : null;
    const userId = interaction.values[0];
    if (!guild || !ticket || !userId) {
      await this.replyError(interaction, "That ticket no longer exists.");
      return;
    }
    await this.changeUser(interaction, guild, ticket, userId, add);
  }

  private async changeUser(
    interaction: ChatInputCommandInteraction | UserSelectMenuInteraction,
    guild: Guild,
    ticket: TicketRecord,
    userId: string,
    add: boolean,
  ): Promise<void> {
    if (!(await this.requireTicketAccess(interaction, guild, ticket))) return;
    if (ticket.status !== "open") {
      await this.replyError(interaction, "Users can only be changed on open tickets.");
      return;
    }
    if (userId === guild.ownerId || userId === this.client.user?.id) {
      await this.replyError(interaction, "That user cannot be changed through ticket access.");
      return;
    }
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) {
      await this.replyError(interaction, "That user is not a member of this server.");
      return;
    }
    if (add && (ticket.creatorId === userId || ticket.addedUserIds.includes(userId))) {
      await this.replyError(interaction, "That user already has access to this ticket.");
      return;
    }
    if (!add && !ticket.addedUserIds.includes(userId)) {
      await this.replyError(interaction, "That user was not added to this ticket.");
      return;
    }
    const updated = this.configStore.updateTicketConfig(guild.id, (config) => {
      const current = config.tickets[ticket.id];
      if (!current) return;
      current.addedUserIds = add
        ? [...current.addedUserIds, userId]
        : current.addedUserIds.filter((id) => id !== userId);
      current.events.push({
        type: add ? "user-added" : "user-removed",
        actorId: interaction.user.id,
        details: `<@${userId}>`,
        timestamp: new Date().toISOString(),
      });
    }).tickets[ticket.id];
    if (!updated) {
      await this.replyError(interaction, "That ticket no longer exists.");
      return;
    }

    const channel = await this.getTicketChannel(guild, updated);
    if (channel) {
      await channel.permissionOverwrites.edit(userId, add
        ? {
            ViewChannel: true,
            SendMessages: true,
            ReadMessageHistory: true,
          }
        : {
            ViewChannel: false,
            SendMessages: false,
            ReadMessageHistory: false,
          }).catch(() => undefined);
      await this.updateTicketMessage(channel, updated);
    }
    await this.logTicket(
      guild,
      updated,
      add ? "Ticket user added" : "Ticket user removed",
      `User: <@${userId}>`,
      interaction.user.id,
    );
    await this.replySuccess(interaction, add ? `<@${userId}> was added to this ticket.` : `<@${userId}> was removed from this ticket.`);
  }

  private async renameFromCommand(
    interaction: ChatInputCommandInteraction,
    guild: Guild,
  ): Promise<void> {
    const ticket = this.getTicketForChannel(guild.id, interaction.channelId);
    if (!ticket) {
      await this.replyError(interaction, "This command must be used in a ticket channel.");
      return;
    }
    if (!(await this.requireTicketAccess(interaction, guild, ticket))) return;
    await this.renameTicket(interaction, guild, ticket, interaction.options.getString("name", true));
  }

  private async handleRenameModal(interaction: ModalSubmitInteraction): Promise<void> {
    const ticketId = interaction.customId.slice(`${TICKET_ID_PREFIX}rename:`.length);
    const guild = interaction.guild;
    const ticket = guild ? this.getTicket(guild.id, ticketId) : null;
    if (!guild || !ticket) {
      await this.replyError(interaction, "That ticket no longer exists.");
      return;
    }
    if (!(await this.requireTicketAccess(interaction, guild, ticket))) return;
    await this.renameTicket(interaction, guild, ticket, interaction.fields.getTextInputValue("name"));
  }

  private async renameTicket(
    interaction: ChatInputCommandInteraction | ModalSubmitInteraction,
    guild: Guild,
    ticket: TicketRecord,
    requestedName: string,
  ): Promise<void> {
    const channel = await this.getTicketChannel(guild, ticket);
    if (!channel) {
      await this.replyError(interaction, "The ticket channel could not be found.");
      return;
    }
    const name = sanitizeChannelName(requestedName, ticket.id);
    if (!name) {
      await this.replyError(interaction, "Use a channel name with at least one letter or number.");
      return;
    }
    const oldName = channel.name;
    await channel.setName(name, `Ticket ${ticket.id} renamed by ${interaction.user.tag}`);
    const updated = this.configStore.updateTicketConfig(guild.id, (config) => {
      const current = config.tickets[ticket.id];
      if (!current) return;
      current.events.push({
        type: "renamed",
        actorId: interaction.user.id,
        details: `${oldName} → ${name}`,
        timestamp: new Date().toISOString(),
      });
    }).tickets[ticket.id];
    if (updated) {
      await this.logTicket(guild, updated, "Ticket renamed", `${oldName} → ${name}`, interaction.user.id);
    }
    await this.replySuccess(interaction, `Ticket renamed to \`${name}\`.`);
  }

  private async handlePanelCommand(
    interaction: ChatInputCommandInteraction,
    guild: Guild,
  ): Promise<void> {
    const action = interaction.options.getSubcommand();
    if (action === "create") {
      const selectedChannel = interaction.options.getChannel("channel", true);
      if (selectedChannel.type !== ChannelType.GuildText) {
        await this.replyError(interaction, "Choose a standard text channel.");
        return;
      }
      const channel = await getTextChannel(guild, selectedChannel.id);
      if (!channel) {
        await this.replyError(interaction, "I could not access that text channel.");
        return;
      }
      const title = interaction.options.getString("title", true).trim();
      const description = interaction.options.getString("description", true).trim();
      const config = this.configStore.getTicketConfig(guild.id);
      if (!Object.keys(config.types).length) {
        await this.replyError(interaction, "Add at least one ticket type before creating a panel.");
        return;
      }
      const panelId = randomUUID();
      const panel: TicketPanelConfig = {
        id: panelId,
        channelId: channel.id,
        messageId: "",
        title,
        description,
        createdAt: new Date().toISOString(),
      };
      const message = await channel.send({
        embeds: [this.buildPanelEmbed(panel)],
        components: [this.buildPanelSelect(panel, config)],
      }).catch(() => null);
      if (!message) {
        await this.replyError(interaction, "I could not send the ticket panel to that channel.");
        return;
      }
      panel.messageId = message.id;
      this.configStore.updateTicketConfig(guild.id, (current) => {
        current.panels[panelId] = panel;
      });
      await this.logTicket(guild, undefined, "Ticket panel created", `Panel ID: ${panelId}.`, interaction.user.id);
      await this.replySuccess(interaction, `Ticket panel created in ${channel}. ID: \`${panelId}\`.`);
      return;
    }

    if (action === "list") {
      const config = this.configStore.getTicketConfig(guild.id);
      const panels = Object.values(config.panels);
      await this.replyEmbed(
        interaction,
        "Ticket panels",
        panels.length
          ? panels.map((item) => `\`${item.id}\` · ${item.title} · <#${item.channelId}>`).join("\n")
          : "No ticket panels configured.",
      );
      return;
    }

    const panelId = interaction.options.getString("panel", true);
    const config = this.configStore.getTicketConfig(guild.id);
    const panel = config.panels[panelId];
    if (!panel) {
      await this.replyError(interaction, "That panel was not found.");
      return;
    }
    const channel = await getTextChannel(guild, panel.channelId);
    const message = channel ? await channel.messages.fetch(panel.messageId).catch(() => null) : null;
    if (action === "delete") {
      await message?.delete().catch(() => undefined);
      this.configStore.updateTicketConfig(guild.id, (current) => {
        delete current.panels[panelId];
      });
      await this.logTicket(guild, undefined, "Ticket panel deleted", `Panel ID: ${panelId}.`, interaction.user.id);
      await this.replySuccess(interaction, "Ticket panel deleted. Existing tickets were not changed.");
      return;
    }
    if (action === "edit") {
      const title = interaction.options.getString("title")?.trim() ?? panel.title;
      const description = interaction.options.getString("description")?.trim() ?? panel.description;
      const edited = this.configStore.updateTicketConfig(guild.id, (current) => {
        current.panels[panelId].title = title;
        current.panels[panelId].description = description;
      }).panels[panelId];
      if (message && channel) {
        await message.edit({
          embeds: [this.buildPanelEmbed(edited)],
          components: [this.buildPanelSelect(edited, config)],
        });
      }
      await this.replySuccess(interaction, "Ticket panel updated.");
      return;
    }
  }

  private async handleTypeCommand(
    interaction: ChatInputCommandInteraction,
    guild: Guild,
  ): Promise<void> {
    const action = interaction.options.getSubcommand();
    const config = this.configStore.getTicketConfig(guild.id);
    if (action === "list") {
      await this.replyEmbed(
        interaction,
        "Ticket types",
        Object.values(config.types).length
          ? Object.values(config.types).map((type) => `${type.emoji ?? "🎫"} **${type.name}** · \`${type.key}\` · ${type.questions.length} question(s) · ${type.staffRoleIds.length} staff role(s)`).join("\n")
          : "No ticket types configured.",
      );
      return;
    }
    const key = interaction.options.getString("key", true).trim().toLowerCase();
    if (action === "remove") {
      if (!config.types[key]) {
        await this.replyError(interaction, "That ticket type was not found.");
        return;
      }
      this.configStore.updateTicketConfig(guild.id, (current) => {
        delete current.types[key];
      });
      await this.replySuccess(interaction, `Ticket type \`${key}\` removed. Existing tickets were not changed.`);
      return;
    }
    const name = interaction.options.getString("name", action === "add")?.trim() ?? "";
    const description = interaction.options.getString("description", action === "add")?.trim() ?? "";
    if (action === "add" && (!name || !description)) {
      await this.replyError(interaction, "Type name and description are required.");
      return;
    }
    if (name.length > 100 || description.length > 100) {
      await this.replyError(interaction, "Type name and description must be 100 characters or fewer.");
      return;
    }
    const existing = config.types[key];
    if (action === "edit" && !existing) {
      await this.replyError(interaction, "That ticket type was not found.");
      return;
    }
    const type = this.configStore.updateTicketConfig(guild.id, (current) => {
      const old = current.types[key];
      current.types[key] = {
        key,
        name: name || old?.name || key,
        description: description || old?.description || "Contact the Builders Hideout team.",
        emoji: interaction.options.getString("emoji")?.trim() || old?.emoji,
        categoryId: interaction.options.getChannel("category")?.id || old?.categoryId,
        staffRoleIds: old?.staffRoleIds ?? [],
        questions: old?.questions ?? [],
        preventDuplicate: interaction.options.getBoolean("preventduplicate") ?? old?.preventDuplicate ?? true,
        channelNameTemplate: interaction.options.getString("channelname")?.trim() || old?.channelNameTemplate,
      };
    }).types[key];
    await this.replySuccess(interaction, `Ticket type **${type.name}** is configured as \`${type.key}\`.`);
  }

  private async handleQuestionCommand(
    interaction: ChatInputCommandInteraction,
    guild: Guild,
  ): Promise<void> {
    const action = interaction.options.getSubcommand();
    const typeKey = interaction.options.getString("type", true).trim().toLowerCase();
    const config = this.configStore.getTicketConfig(guild.id);
    const type = config.types[typeKey];
    if (!type) {
      await this.replyError(interaction, "That ticket type was not found.");
      return;
    }
    if (action === "list") {
      const questions = [...type.questions].sort((left, right) => left.order - right.order);
      await this.replyEmbed(
        interaction,
        `Questions for ${type.name}`,
        questions.length
          ? questions.map((question) => `\`${question.id}\` · ${question.required ? "Required" : "Optional"} · ${question.label}`).join("\n")
          : "No questions configured.",
      );
      return;
    }
    const questionId = interaction.options.getString("question")?.trim();
    if (action === "remove") {
      if (!questionId || !type.questions.some((question) => question.id === questionId)) {
        await this.replyError(interaction, "That question was not found.");
        return;
      }
      this.configStore.updateTicketConfig(guild.id, (current) => {
        current.types[typeKey].questions = current.types[typeKey].questions.filter((question) => question.id !== questionId);
      });
      await this.replySuccess(interaction, "Question removed.");
      return;
    }
    const label = interaction.options.getString("label", action === "add")?.trim() ?? "";
    const required = interaction.options.getBoolean("required") ?? true;
    const maxLength = interaction.options.getInteger("maxlength") ?? 1000;
    const order = interaction.options.getInteger("order") ?? type.questions.length + 1;
    const paragraph = interaction.options.getBoolean("paragraph") ?? false;
    if (action === "add" && !label) {
      await this.replyError(interaction, "A question label is required.");
      return;
    }
    if (maxLength < 1 || maxLength > 4000 || order < 1) {
      await this.replyError(interaction, "Maximum length must be 1-4000 and order must be positive.");
      return;
    }
    if (action === "edit" && !questionId) {
      await this.replyError(interaction, "Provide the question ID to edit.");
      return;
    }
    const id = questionId || randomUUID().slice(0, 8);
    if (action === "edit" && !type.questions.some((question) => question.id === id)) {
      await this.replyError(interaction, "That question was not found.");
      return;
    }
    this.configStore.updateTicketConfig(guild.id, (current) => {
      const questions = current.types[typeKey].questions.filter((question) => question.id !== id);
      const old = current.types[typeKey].questions.find((question) => question.id === id);
      questions.push({
        id,
        label: label || old?.label || id,
        required,
        maxLength,
        order,
        paragraph,
      });
      current.types[typeKey].questions = questions;
    });
    await this.replySuccess(interaction, `Question saved with ID \`${id}\`.`);
  }

  private async handleRoleCommand(
    interaction: ChatInputCommandInteraction,
    guild: Guild,
  ): Promise<void> {
    const action = interaction.options.getSubcommand();
    const typeKey = interaction.options.getString("type", true).trim().toLowerCase();
    const config = this.configStore.getTicketConfig(guild.id);
    const type = config.types[typeKey];
    if (!type) {
      await this.replyError(interaction, "That ticket type was not found.");
      return;
    }
    if (action === "list") {
      await this.replyEmbed(interaction, `Staff roles for ${type.name}`, type.staffRoleIds.length ? type.staffRoleIds.map((id) => `<@&${id}>`).join(", ") : "No staff roles configured.");
      return;
    }
    const role = interaction.options.getRole("role", true);
    const hasRole = type.staffRoleIds.includes(role.id);
    if (action === "add" && hasRole) {
      await this.replyError(interaction, "That role is already configured.");
      return;
    }
    if (action === "remove" && !hasRole) {
      await this.replyError(interaction, "That role is not configured.");
      return;
    }
    this.configStore.updateTicketConfig(guild.id, (current) => {
      current.types[typeKey].staffRoleIds = action === "add"
        ? [...current.types[typeKey].staffRoleIds, role.id]
        : current.types[typeKey].staffRoleIds.filter((id) => id !== role.id);
    });
    await this.replySuccess(interaction, action === "add" ? `${role} can now access new ${type.name} tickets.` : `${role} was removed from new ${type.name} tickets.`);
  }

  private async handleConfigCommand(
    interaction: ChatInputCommandInteraction,
    guild: Guild,
  ): Promise<void> {
    const logs = interaction.options.getChannel("logs");
    const inactivity = interaction.options.getInteger("inactivityhours");
    const warning = interaction.options.getInteger("warninghours");
    if (!logs && inactivity === null && warning === null) {
      const config = this.configStore.getTicketConfig(guild.id);
      await this.replyEmbed(
        interaction,
        "Ticket configuration",
        `Logs: ${config.logsChannelId ? `<#${config.logsChannelId}>` : "Not configured"}\nInactivity: ${config.inactivityHours}h\nWarning period: ${config.warningHours}h`,
      );
      return;
    }
    if (logs && logs.type !== ChannelType.GuildText) {
      await this.replyError(interaction, "Choose a standard text channel for ticket logs.");
      return;
    }
    if (inactivity !== null && (inactivity < 1 || inactivity > 720)) {
      await this.replyError(interaction, "Inactivity hours must be between 1 and 720.");
      return;
    }
    if (warning !== null && (warning < 1 || warning > 168)) {
      await this.replyError(interaction, "Warning hours must be between 1 and 168.");
      return;
    }
    const config = this.configStore.updateTicketConfig(guild.id, (current) => {
      if (logs) current.logsChannelId = logs.id;
      if (inactivity !== null) current.inactivityHours = inactivity;
      if (warning !== null) current.warningHours = warning;
    });
    await this.replySuccess(interaction, `Ticket configuration saved. Logs: ${config.logsChannelId ? `<#${config.logsChannelId}>` : "not configured"}, inactivity: ${config.inactivityHours}h, warning: ${config.warningHours}h.`);
  }

  private buildQuestionModal(
    sessionId: string,
    step: number,
    questions: TicketQuestion[],
  ): ModalBuilder {
    const modal = new ModalBuilder()
      .setCustomId(`${TICKET_ID_PREFIX}q:${sessionId}:${step}`)
      .setTitle(`Ticket questions ${step + 1}`);
    for (const question of questions.slice(step * 5, step * 5 + 5)) {
      modal.addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId(question.id)
            .setLabel(question.label.slice(0, 45))
            .setStyle(question.paragraph ? TextInputStyle.Paragraph : TextInputStyle.Short)
            .setRequired(question.required)
            .setMaxLength(Math.min(question.maxLength, 4000)),
        ),
      );
    }
    return modal;
  }

  private buildCloseModal(ticketId: string): ModalBuilder {
    return new ModalBuilder()
      .setCustomId(`${TICKET_ID_PREFIX}close:${ticketId}`)
      .setTitle("Close ticket")
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId("reason")
            .setLabel("Close reason")
            .setPlaceholder("Explain why this ticket is being closed.")
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setMaxLength(1000),
        ),
      );
  }

  private buildRenameModal(ticketId: string): ModalBuilder {
    return new ModalBuilder()
      .setCustomId(`${TICKET_ID_PREFIX}rename:${ticketId}`)
      .setTitle("Rename ticket")
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId("name")
            .setLabel("New channel name")
            .setPlaceholder("billing-help")
            .setRequired(true)
            .setMaxLength(90),
        ),
      );
  }

  private buildUserSelect(ticketId: string, add: boolean): ActionRowBuilder<UserSelectMenuBuilder> {
    return new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
      new UserSelectMenuBuilder()
        .setCustomId(`${TICKET_ID_PREFIX}${add ? "useradd" : "userremove"}:${ticketId}`)
        .setPlaceholder(add ? "Select a user to add" : "Select a user to remove")
        .setMinValues(1)
        .setMaxValues(1),
    );
  }

  private buildPrioritySelect(ticketId: string): ActionRowBuilder<StringSelectMenuBuilder> {
    return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`${TICKET_ID_PREFIX}priority:${ticketId}`)
        .setPlaceholder("Select priority")
        .addOptions(
          Object.entries(PRIORITIES).map(([value, priority]) => ({
            label: priority.label,
            value,
          })),
        ),
    );
  }

  private buildPanelEmbed(panel: TicketPanelConfig): EmbedBuilder {
    return new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle(panel.title.slice(0, 256))
      .setDescription(panel.description.slice(0, 4096))
      .setFooter({ text: "Builders Hideout • Select a ticket type below" })
      .setTimestamp();
  }

  private buildPanelSelect(
    panel: TicketPanelConfig,
    config: TicketConfig,
  ): ActionRowBuilder<StringSelectMenuBuilder> {
    const options = Object.values(config.types).slice(0, 25).map((type) => ({
      label: type.name.slice(0, 100),
      description: type.description.slice(0, 100),
      value: type.key,
      ...(type.emoji ? { emoji: type.emoji } : {}),
    }));
    const menu = new StringSelectMenuBuilder()
      .setCustomId(`${TICKET_ID_PREFIX}panel:${panel.id}`)
      .setPlaceholder("Choose a ticket type")
      .addOptions(options);
    return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
  }

  private buildTicketEmbed(ticket: TicketRecord, type?: TicketTypeConfig): EmbedBuilder {
    const priority = PRIORITIES[ticket.priority] ?? PRIORITIES.normal;
    const embed = new EmbedBuilder()
      .setColor(priority.color)
      .setTitle(`${type?.emoji ?? "🎫"} ${ticket.typeName} • Ticket ${ticket.id.slice(0, 8)}`)
      .setDescription("Welcome to your private Builders Hideout support ticket. A staff member will be with you shortly.")
      .addFields(
        { name: "Priority", value: priority.label, inline: true },
        { name: "Creator", value: `<@${ticket.creatorId}>`, inline: true },
        { name: "Claimant", value: ticket.claimantId ? `<@${ticket.claimantId}>` : "Unclaimed", inline: true },
        { name: "Status", value: ticket.status === "open" ? "🟢 Open" : "🔒 Closed", inline: true },
      )
      .setFooter({ text: `Builders Hideout • Ticket ID ${ticket.id}` })
      .setTimestamp(new Date(ticket.closedAt ?? ticket.createdAt));

    const answers = type?.questions
      .sort((left, right) => left.order - right.order)
      .map((question) => {
        const answer = ticket.questionAnswers[question.id];
        return answer ? `**${question.label}**\n${answer}` : null;
      })
      .filter((value): value is string => Boolean(value))
      .join("\n\n");
    if (answers) {
      embed.addFields({ name: "Questionnaire answers", value: answers.slice(0, 1024) });
    }
    if (ticket.addedUserIds.length) {
      embed.addFields({ name: "Added users", value: ticket.addedUserIds.map((id) => `<@${id}>`).join(", ").slice(0, 1024) });
    }
    if (ticket.status === "closed") {
      embed.addFields({
        name: "Close reason",
        value: `${ticket.closeReason ?? "No reason recorded"}\nClosed by: <@${ticket.closedBy ?? "unknown"}>\nClosed: ${ticket.closedAt ? `<t:${Math.floor(new Date(ticket.closedAt).getTime() / 1000)}:F>` : "Unknown"}`.slice(0, 1024),
      });
    }
    return embed;
  }

  private buildTicketComponents(ticket: TicketRecord): ActionRowBuilder<ButtonBuilder>[] {
    if (ticket.status === "closed") {
      return [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId(`ticket:reopen:${ticket.id}`).setLabel("Reopen").setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`ticket:delete:${ticket.id}`).setLabel("Delete").setStyle(ButtonStyle.Danger),
        ),
      ];
    }
    return [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`ticket:close:${ticket.id}`).setLabel("🔒 Close").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`ticket:claim:${ticket.id}`).setLabel("🙋 Claim").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`ticket:unclaim:${ticket.id}`).setLabel("Unclaim").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`ticket:rename:${ticket.id}`).setLabel("✏️ Rename").setStyle(ButtonStyle.Secondary),
      ),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`ticket:adduser:${ticket.id}`).setLabel("➕ Add User").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`ticket:removeuser:${ticket.id}`).setLabel("➖ Remove User").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`ticket:priority:${ticket.id}`).setLabel("🎯 Priority").setStyle(ButtonStyle.Secondary),
      ),
    ];
  }

  private async updateTicketMessage(channel: TextChannel, ticket: TicketRecord): Promise<void> {
    const messages = await channel.messages.fetch({ limit: 50 }).catch(() => null);
    const message = messages?.find((item) =>
      item.author.id === this.client.user?.id &&
      item.embeds.some((embed) => embed.footer?.text?.includes(ticket.id)),
    );
    if (!message) return;
    const type = this.configStore.getTicketConfig(ticket.guildId).types[ticket.typeKey];
    await message.edit({
      embeds: [this.buildTicketEmbed(ticket, type)],
      components: this.buildTicketComponents(ticket),
    }).catch(() => undefined);
  }

  private async createTranscript(
    guild: Guild,
    ticket: TicketRecord,
    channel: TextChannel | null,
  ): Promise<void> {
    const messages = channel ? await channel.messages.fetch({ limit: 100 }).catch(() => null) : null;
    const type = this.configStore.getTicketConfig(guild.id).types[ticket.typeKey];
    const lines = [
      `Builders Hideout Ticket Transcript`,
      `Ticket ID: ${ticket.id}`,
      `Type: ${ticket.typeName}`,
      `Creator: ${ticket.creatorId}`,
      `Claimant: ${ticket.claimantId ?? "Unclaimed"}`,
      `Priority: ${PRIORITIES[ticket.priority]?.label ?? "🔵 Normal"}`,
      `Created: ${ticket.createdAt}`,
      `Closed: ${ticket.closedAt ?? "Open"}`,
      `Close reason: ${ticket.closeReason ?? "Not closed"}`,
      `Added users: ${ticket.addedUserIds.join(", ") || "None"}`,
      "",
      "Questionnaire answers:",
      ...(type?.questions ?? []).map((question) => `${question.label}: ${ticket.questionAnswers[question.id] ?? "(not answered)"}`),
      "",
      "Events:",
      ...ticket.events.map((event) => `${event.timestamp} [${event.type}] ${event.actorId ?? "system"} ${event.details ?? ""}`),
      "",
      "Messages:",
      ...(messages ? [...messages.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp).map((message) =>
        `${message.createdAt} ${message.author.tag}: ${message.content}${message.attachments.size ? ` [attachments: ${[...message.attachments.values()].map((file) => file.url).join(", ")}]` : ""}`,
      ) : ["(Messages could not be fetched.)"]),
    ];
    const logChannelId = this.getLogsChannelId(guild.id);
    const logChannel = logChannelId ? await getTextChannel(guild, logChannelId) : null;
    if (logChannel) {
      await logChannel.send({
        content: `Private transcript created for ticket \`${ticket.id}\`.`,
        files: [new AttachmentBuilder(Buffer.from(lines.join("\n"), "utf8"), { name: `ticket-${ticket.id}.txt` })],
      }).catch(() => undefined);
    }
    await this.logTicket(guild, ticket, "Ticket transcript created", `Transcript sent to ${logChannel ? `<#${logChannel.id}>` : "configured ticket logs"}.`);
  }

  private scheduleInactivity(ticket: TicketRecord): void {
    if (ticket.status !== "open") return;
    const config = this.configStore.getTicketConfig(ticket.guildId);
    const base = new Date(ticket.lastActivityAt).getTime();
    const dueAt = ticket.warningSentAt
      ? new Date(ticket.warningSentAt).getTime() + config.warningHours * 60 * 60 * 1000
      : base + config.inactivityHours * 60 * 60 * 1000;
    const key = `${ticket.id}:${ticket.warningSentAt ? "close" : "warn"}`;
    this.clearTimers(ticket.id);
    this.scheduleAt(key, dueAt, () => {
      if (ticket.warningSentAt) {
        void this.autoCloseIfStillInactive(ticket.id);
      } else {
        void this.issueInactivityWarning(ticket.id);
      }
    });
  }

  private async issueInactivityWarning(ticketId: string): Promise<void> {
    const ticket = this.findTicketById(ticketId);
    if (!ticket || ticket.status !== "open") return;
    const dueAt = new Date(ticket.lastActivityAt).getTime() + this.configStore.getTicketConfig(ticket.guildId).inactivityHours * 60 * 60 * 1000;
    if (Date.now() < dueAt) {
      this.scheduleInactivity(ticket);
      return;
    }
    const guild = await this.getGuild(ticket.guildId);
    const channel = guild ? await this.getTicketChannel(guild, ticket) : null;
    const warningAt = new Date().toISOString();
    const updated = this.configStore.updateTicketConfig(ticket.guildId, (config) => {
      const current = config.tickets[ticket.id];
      if (!current || current.status !== "open") return;
      current.warningSentAt = warningAt;
      current.inactivityWarningAt = new Date(Date.now() + config.warningHours * 60 * 60 * 1000).toISOString();
      current.events.push({ type: "inactivity-warning", timestamp: warningAt, details: `${config.warningHours}h warning period.` });
    }).tickets[ticket.id];
    if (!updated) return;
    await channel?.send(`⚠️ This ticket has been inactive for ${this.configStore.getTicketConfig(ticket.guildId).inactivityHours} hours. Please reply within the warning period or it will be closed automatically.`).catch(() => undefined);
    if (guild) await this.logTicket(guild, updated, "Ticket inactivity warning", "Warning sent after inactivity.");
    this.scheduleInactivity(updated);
  }

  private async autoCloseIfStillInactive(ticketId: string): Promise<void> {
    const ticket = this.findTicketById(ticketId);
    if (!ticket || ticket.status !== "open" || !ticket.warningSentAt) return;
    const config = this.configStore.getTicketConfig(ticket.guildId);
    const closeAt = new Date(ticket.warningSentAt).getTime() + config.warningHours * 60 * 60 * 1000;
    if (Date.now() < closeAt) {
      this.scheduleInactivity(ticket);
      return;
    }
    const guild = await this.getGuild(ticket.guildId);
    if (!guild) return;
    await this.closeTicket(
      guild,
      ticket,
      "Automatically closed due to inactivity after the warning period.",
      this.client.user?.id ?? "system",
      true,
    ).catch(() => undefined);
  }

  private scheduleAt(key: string, dueAt: number, callback: () => void): void {
    const delay = Math.max(1, dueAt - Date.now());
    const actualDelay = Math.min(delay, MAX_TIMER_DELAY);
    this.timers.set(key, setTimeout(() => {
      this.timers.delete(key);
      if (actualDelay < delay) {
        this.scheduleAt(key, dueAt, callback);
      } else {
        callback();
      }
    }, actualDelay));
  }

  private clearTimers(ticketId: string): void {
    this.clearTimerKey(`${ticketId}:warn`);
    this.clearTimerKey(`${ticketId}:close`);
  }

  private clearTimerKey(key: string): void {
    const timer = this.timers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(key);
    }
  }

  private async requireTicketAccess(
    interaction: ChatInputCommandInteraction | Interaction,
    guild: Guild,
    ticket: TicketRecord,
  ): Promise<boolean> {
    const member = await guild.members.fetch(interaction.user.id).catch(() => null);
    if (!member || (!this.isStaff(member, ticket) && member.id !== ticket.creatorId && !ticket.addedUserIds.includes(member.id))) {
      await this.replyError(interaction, "You are not authorized to manage this ticket.");
      return false;
    }
    return true;
  }

  private async requireStaff(interaction: ChatInputCommandInteraction | Interaction): Promise<boolean> {
    if (!interaction.guild) {
      await this.replyError(interaction, "This can only be used inside a server.");
      return false;
    }
    const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    if (!member || !this.isStaff(member)) {
      await this.replyError(interaction, "You need a configured ticket staff role or a staff moderation permission.");
      return false;
    }
    return true;
  }

  private isStaff(member: GuildMember, ticket?: TicketRecord): boolean {
    return member.permissions.has(PermissionFlagsBits.ManageGuild) ||
      member.permissions.has(PermissionFlagsBits.ManageChannels) ||
      member.permissions.has(PermissionFlagsBits.ManageMessages) ||
      member.permissions.has(PermissionFlagsBits.ModerateMembers) ||
      Boolean(ticket?.staffRoleIds.some((roleId) => member.roles.cache.has(roleId)));
  }

  private getTicketForChannel(guildId: string, channelId: string): TicketRecord | null {
    return Object.values(this.getAllTickets()).find((ticket) =>
      ticket.guildId === guildId && ticket.channelId === channelId && ticket.status !== "deleted",
    ) ?? null;
  }

  private getTicket(guildId: string, ticketId: string): TicketRecord | null {
    return this.configStore.getTicketConfig(guildId).tickets[ticketId] ?? null;
  }

  private findTicketById(ticketId: string): TicketRecord | null {
    return Object.values(this.getAllTickets()).find((ticket) => ticket.id === ticketId) ?? null;
  }

  private findOpenTicket(guildId: string, creatorId: string, typeKey: string): TicketRecord | null {
    return Object.values(this.getAllTickets()).find((ticket) =>
      ticket.guildId === guildId && ticket.creatorId === creatorId && ticket.typeKey === typeKey && ticket.status === "open",
    ) ?? null;
  }

  private getAllTickets(): Record<string, TicketRecord> {
    return Object.fromEntries(
      this.configStore.getAllTicketRecords().map((ticket) => [ticket.id, ticket]),
    );
  }

  private async getTicketChannel(guild: Guild, ticket: TicketRecord): Promise<TextChannel | null> {
    return getTextChannel(guild, ticket.channelId);
  }

  private async getGuild(guildId: string): Promise<Guild | null> {
    return this.client.guilds.cache.get(guildId) ?? await this.client.guilds.fetch(guildId).catch(() => null);
  }

  private buildChannelName(type: TicketTypeConfig, id: string, userId: string): string {
    const template = type.channelNameTemplate || "ticket-{id}";
    const value = template.replace(/\{id\}/g, id.slice(0, 8)).replace(/\{type\}/g, type.key).replace(/\{user\}/g, userId);
    return sanitizeChannelName(value, id);
  }

  private getLogsChannelId(guildId: string): string | undefined {
    return this.configStore.getTicketConfig(guildId).logsChannelId ?? this.configStore.get(guildId).logsChannelId;
  }

  private async logTicket(
    guild: Guild,
    ticket: TicketRecord | undefined,
    action: string,
    reason: string,
    actorId?: string,
  ): Promise<void> {
    const details = [
      ticket ? `Ticket ID: ${ticket.id}` : undefined,
      ticket ? `Type: ${ticket.typeName}` : undefined,
      ticket ? `Channel: <#${ticket.channelId}>` : undefined,
      reason,
    ].filter(Boolean).join("\n");
    await sendModerationLog(guild, this.getLogsChannelId(guild.id), {
      moderator: actorId ? `<@${actorId}>` : "System",
      target: ticket ? `<#${ticket.channelId}>` : "Ticket configuration",
      action,
      reason: details || action,
      channel: ticket ? ticket.channelId : "Ticket configuration",
      color: 0x5865f2,
    }).catch(() => undefined);
  }

  private async replySuccess(
    interaction: ChatInputCommandInteraction | Interaction,
    message: string,
  ): Promise<void> {
    const payload = {
      embeds: [new EmbedBuilder().setColor(0x57f287).setDescription(message)],
      ephemeral: true,
    };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(payload);
    } else {
      await interaction.reply(payload);
    }
  }

  private async replyError(
    interaction: ChatInputCommandInteraction | Interaction,
    message: string,
  ): Promise<void> {
    const payload = {
      embeds: [new EmbedBuilder().setColor(0xed4245).setDescription(message)],
      ephemeral: true,
    };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(payload);
    } else {
      await interaction.reply(payload);
    }
  }

  private async replyEmbed(
    interaction: ChatInputCommandInteraction,
    title: string,
    description: string,
  ): Promise<void> {
    await interaction.reply({
      embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle(title).setDescription(description.slice(0, 4096))],
      ephemeral: true,
    });
  }
}

function sanitizeChannelName(value: string, ticketId: string): string {
  const cleaned = value
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
  if (!cleaned) return "";
  const suffix = ticketId.slice(0, 8);
  return cleaned.includes(suffix) ? cleaned : `${cleaned}-${suffix}`.slice(0, 90);
}