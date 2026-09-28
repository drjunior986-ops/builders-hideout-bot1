import { randomInt, randomUUID } from "node:crypto";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type ButtonInteraction,
  type Client,
  type Guild,
  type GuildMember,
} from "discord.js";
import {
  ConfigStore,
  type GiveawayRecord,
  type GiveawayStatus,
} from "./config-store.js";
import { getTextChannel, sendModerationLog } from "./moderation.js";

const MAX_GIVEAWAY_DURATION_MS = 365 * 24 * 60 * 60 * 1000;
const MAX_DESCRIPTION_LENGTH = 3000;
const MAX_TIMER_DELAY_MS = 2_147_000_000;
const GIVEAWAY_BUTTON_PREFIX = "giveaway:enter:";

export type GiveawayStartInput = {
  guild: Guild;
  organizerId: string;
  prize: string;
  description?: string;
  color?: string;
  duration: string;
  numberOfWinners: number;
  channelId: string;
  requiredRoleId?: string;
};

export class GiveawayError extends Error {}

export function parseGiveawayDuration(value: string): number | null {
  const match = /^([1-9]\d*)(s|m|h|d|w)$/i.exec(value.trim());
  if (!match) {
    return null;
  }

  const amount = Number(match[1]);
  const multipliers: Record<string, number> = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
    w: 7 * 24 * 60 * 60 * 1000,
  };
  const duration = amount * multipliers[match[2].toLowerCase()];

  return Number.isSafeInteger(duration) && duration <= MAX_GIVEAWAY_DURATION_MS
    ? duration
    : null;
}

export function formatGiveawayDuration(durationMs: number): string {
  const seconds = Math.max(1, Math.round(durationMs / 1000));
  if (seconds % (7 * 24 * 60 * 60) === 0) {
    return `${seconds / (7 * 24 * 60 * 60)}w`;
  }
  if (seconds % (24 * 60 * 60) === 0) {
    return `${seconds / (24 * 60 * 60)}d`;
  }
  if (seconds % (60 * 60) === 0) {
    return `${seconds / (60 * 60)}h`;
  }
  if (seconds % 60 === 0) {
    return `${seconds / 60}m`;
  }
  return `${seconds}s`;
}

export function buildGiveawayEmbed(
  giveaway: GiveawayRecord,
  eligibleParticipantCount?: number,
): EmbedBuilder {
  const endingAt = giveaway.status === "ended" && giveaway.endedAt
    ? giveaway.endedAt
    : giveaway.endAt;
  const endingTimestamp = Math.floor(new Date(endingAt).getTime() / 1000);
  const description = giveaway.description
    ? `\n\n**📝 Description**\n${giveaway.description}`
    : "";
  const winnerValue = giveaway.winners.length
    ? giveaway.winners.map((userId) => `<@${userId}>`).join(", ")
    : `${giveaway.numberOfWinners} winner${giveaway.numberOfWinners === 1 ? "" : "s"} will be selected`;
  const participantValue =
    eligibleParticipantCount === undefined
      ? String(giveaway.participants.length)
      : `${giveaway.participants.length} (${eligibleParticipantCount} eligible)`;

  const embed = new EmbedBuilder()
    .setColor(getGiveawayColor(giveaway.status))
    .setTitle(
      giveaway.status === "active"
        ? "🎉 GIVEAWAY"
        : giveaway.status === "paused"
          ? "🎉 GIVEAWAY • PAUSED"
          : "🎉 GIVEAWAY • ENDED",
    )
    .setDescription(`**🎁 Prize**\n${giveaway.prize}${description}`)
    .addFields(
      { name: "🏆 Winners", value: winnerValue },
      {
        name: "⏰ Ending time",
        value:
          giveaway.status === "paused"
            ? "Paused — resume the giveaway to continue the countdown."
            : `<t:${endingTimestamp}:F> (<t:${endingTimestamp}:R>)`,
        inline: true,
      },
      { name: "👥 Participant count", value: participantValue, inline: true },
    )
    .setFooter({ text: `Builders Hideout • Giveaway ID ${giveaway.id.slice(0, 8)}` })
    .setTimestamp();

  return embed;
}

export function buildGiveawayComponents(
  giveaway: GiveawayRecord,
): ActionRowBuilder<ButtonBuilder>[] {
  const button = new ButtonBuilder()
    .setCustomId(`${GIVEAWAY_BUTTON_PREFIX}${giveaway.id}`)
    .setLabel(
      giveaway.status === "active"
        ? "🎉 Enter Giveaway"
        : giveaway.status === "paused"
          ? "⏸️ Giveaway Paused"
          : "🎉 Giveaway Ended",
    )
    .setStyle(ButtonStyle.Primary)
    .setDisabled(giveaway.status !== "active");

  return [new ActionRowBuilder<ButtonBuilder>().addComponents(button)];
}

export class GiveawayManager {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly finishing = new Set<string>();

  constructor(
    private readonly configStore: ConfigStore,
    private readonly client: Client,
  ) {}

  async start(input: GiveawayStartInput): Promise<GiveawayRecord> {
    const durationMs = parseGiveawayDuration(input.duration);
    if (!durationMs) {
      throw new GiveawayError(
        "Use a positive duration such as `30s`, `10m`, `1h`, `12h`, or `7d` (maximum 365d).",
      );
    }
    if (!Number.isInteger(input.numberOfWinners) || input.numberOfWinners < 1) {
      throw new GiveawayError("The number of winners must be a positive whole number.");
    }
    if (input.numberOfWinners > 100) {
      throw new GiveawayError("A giveaway can have at most 100 winners.");
    }

    const channel = await getTextChannel(input.guild, input.channelId);
    if (!channel) {
      throw new GiveawayError("Please choose a standard text channel where I can send messages.");
    }

    if (input.requiredRoleId) {
      const role = await input.guild.roles.fetch(input.requiredRoleId).catch(() => null);
      if (!role) {
        throw new GiveawayError("The required role could not be found.");
      }
    }

    const prize = input.prize.trim();
    if (!prize) {
      throw new GiveawayError("The prize cannot be empty.");
    }
    if (prize.length > 256) {
      throw new GiveawayError("The prize must be 256 characters or fewer.");
    }

    const description = input.description?.trim();
    if (description && description.length > MAX_DESCRIPTION_LENGTH) {
      throw new GiveawayError(
        `The description must be ${MAX_DESCRIPTION_LENGTH} characters or fewer so it fits cleanly in Discord embeds.`,
      );
    }

    const now = Date.now();
    const giveaway: GiveawayRecord = {
      id: randomUUID(),
      guildId: input.guild.id,
      messageId: "",
      channelId: channel.id,
      organizerId: input.organizerId,
      prize,
      ...(description ? { description } : {}),
      durationMs,
      numberOfWinners: input.numberOfWinners,
      ...(input.requiredRoleId ? { requiredRoleId: input.requiredRoleId } : {}),
      participants: [],
      winners: [],
      winnerHistory: [],
      status: "active",
      endAt: new Date(now + durationMs).toISOString(),
      createdAt: new Date(now).toISOString(),
    };

    const message = await channel.send({
      embeds: [buildGiveawayEmbed(giveaway)],
      components: buildGiveawayComponents(giveaway),
      allowedMentions: { parse: [] },
    }).catch(() => null);
    if (!message) {
      throw new GiveawayError(
        `I could not send the giveaway to ${channel}. Check that I can view the channel and send messages.`,
      );
    }

    giveaway.messageId = message.id;
    this.configStore.setGiveaway(giveaway);
    this.schedule(giveaway);
    await this.logGiveaway(input.guild, giveaway, "Giveaway created");
    return giveaway;
  }

  async end(guild: Guild, giveawayInput: string): Promise<GiveawayRecord> {
    const giveaway = this.resolveGiveaway(guild.id, giveawayInput);
    if (giveaway.status === "ended") {
      throw new GiveawayError("That giveaway has already ended.");
    }
    return this.finish(guild, giveaway, "manual");
  }

  async pause(guild: Guild, giveawayInput: string): Promise<GiveawayRecord> {
    const giveaway = this.resolveGiveaway(guild.id, giveawayInput);
    if (giveaway.status !== "active") {
      throw new GiveawayError(
        giveaway.status === "paused"
          ? "That giveaway is already paused."
          : "That giveaway has already ended.",
      );
    }

    const remainingMs = new Date(giveaway.endAt).getTime() - Date.now();
    if (remainingMs <= 0) {
      return this.finish(guild, giveaway, "automatic");
    }

    this.clearTimer(giveaway);
    const paused = this.configStore.updateGiveaway(guild.id, giveaway.id, (current) => {
      current.status = "paused";
      current.pausedAt = new Date().toISOString();
      current.remainingMs = remainingMs;
    });
    if (!paused) {
      throw new GiveawayError("That giveaway no longer exists.");
    }

    await this.updateGiveawayMessage(guild, paused);
    await this.logGiveaway(guild, paused, "Giveaway paused");
    return paused;
  }

  async resume(guild: Guild, giveawayInput: string): Promise<GiveawayRecord> {
    const giveaway = this.resolveGiveaway(guild.id, giveawayInput);
    if (giveaway.status !== "paused") {
      throw new GiveawayError(
        giveaway.status === "active"
          ? "That giveaway is already active."
          : "That giveaway has already ended.",
      );
    }
    if (!giveaway.remainingMs || giveaway.remainingMs <= 0) {
      return this.finish(guild, giveaway, "automatic");
    }

    const resumed = this.configStore.updateGiveaway(guild.id, giveaway.id, (current) => {
      current.status = "active";
      current.endAt = new Date(Date.now() + (current.remainingMs ?? 0)).toISOString();
      current.pausedAt = undefined;
      current.remainingMs = undefined;
    });
    if (!resumed) {
      throw new GiveawayError("That giveaway no longer exists.");
    }

    this.schedule(resumed);
    await this.updateGiveawayMessage(guild, resumed);
    await this.logGiveaway(guild, resumed, "Giveaway resumed");
    return resumed;
  }

  async reroll(guild: Guild, giveawayInput: string): Promise<GiveawayRecord> {
    const giveaway = this.resolveGiveaway(guild.id, giveawayInput);
    if (giveaway.status !== "ended") {
      throw new GiveawayError("A giveaway must be ended before it can be rerolled.");
    }

    const eligibleMembers = await this.getEligibleMembers(guild, giveaway);
    const eligibleIds = eligibleMembers.map((member) => member.id);
    if (eligibleIds.length === 0) {
      throw new GiveawayError("There are no eligible participants available for a reroll.");
    }

    const history = new Set(giveaway.winnerHistory);
    const currentWinners = new Set(giveaway.winners);
    const unseen = eligibleIds.filter((id) => !history.has(id));
    const notCurrent = eligibleIds.filter((id) => !currentWinners.has(id));
    const candidates = unseen.length ? unseen : notCurrent.length ? notCurrent : eligibleIds;
    const newWinner = candidates[randomInt(candidates.length)];

    const rerolled = this.configStore.updateGiveaway(guild.id, giveaway.id, (current) => {
      if (current.winners.length >= current.numberOfWinners && current.winners.length > 0) {
        current.winners[current.winners.length - 1] = newWinner;
      } else if (!current.winners.includes(newWinner)) {
        current.winners.push(newWinner);
      }
      current.winnerHistory = Array.from(new Set([...current.winnerHistory, newWinner]));
    });
    if (!rerolled) {
      throw new GiveawayError("That giveaway no longer exists.");
    }

    await this.updateGiveawayMessage(guild, rerolled, eligibleIds.length);
    const channel = await getTextChannel(guild, rerolled.channelId);
    if (channel) {
      await channel.send({
        content: `🎉 Giveaway reroll: congratulations <@${newWinner}>!`,
        allowedMentions: { users: [newWinner], roles: [], parse: [] },
      }).catch(() => undefined);
    }
    await this.logGiveaway(
      guild,
      rerolled,
      "Giveaway rerolled",
      `New winner: <@${newWinner}>.`,
    );
    return rerolled;
  }

  getForGuild(guildId: string): GiveawayRecord[] {
    return this.configStore.getGiveaways(guildId);
  }

  async handleButton(interaction: ButtonInteraction): Promise<void> {
    const giveawayId = interaction.customId.slice(GIVEAWAY_BUTTON_PREFIX.length);
    if (!giveawayId || !interaction.guild) {
      await interaction.reply({ content: "This giveaway is not available here.", ephemeral: true });
      return;
    }

    const giveaway = this.configStore.getGiveaway(interaction.guild.id, giveawayId);
    if (!giveaway) {
      await interaction.reply({ content: "That giveaway no longer exists.", ephemeral: true });
      return;
    }
    if (giveaway.status !== "active") {
      await interaction.reply({
        content: giveaway.status === "paused"
          ? "This giveaway is currently paused."
          : "This giveaway has ended.",
        ephemeral: true,
      });
      return;
    }
    if (interaction.user.bot) {
      await interaction.reply({ content: "Bots cannot enter giveaways.", ephemeral: true });
      return;
    }

    const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    if (!member) {
      await interaction.reply({ content: "I could not verify your server membership.", ephemeral: true });
      return;
    }

    const alreadyParticipating = giveaway.participants.includes(interaction.user.id);
    if (!alreadyParticipating && giveaway.requiredRoleId) {
      const role = interaction.guild.roles.cache.get(giveaway.requiredRoleId)
        ?? await interaction.guild.roles.fetch(giveaway.requiredRoleId).catch(() => null);
      if (!role) {
        await interaction.reply({
          content: "This giveaway's required role no longer exists, so entries are temporarily unavailable.",
          ephemeral: true,
        });
        return;
      }
      if (!member.roles.cache.has(role.id)) {
        await interaction.reply({
          content: `You need the ${role} role to enter this giveaway.`,
          ephemeral: true,
        });
        return;
      }
    }

    const updated = this.configStore.updateGiveaway(interaction.guild.id, giveaway.id, (current) => {
      if (current.status !== "active") {
        return;
      }
      current.participants = alreadyParticipating
        ? current.participants.filter((id) => id !== interaction.user.id)
        : [...current.participants, interaction.user.id];
    });
    if (!updated) {
      await interaction.reply({ content: "That giveaway is no longer available.", ephemeral: true });
      return;
    }

    await interaction.reply({
      content: alreadyParticipating
        ? "You left the giveaway."
        : "You entered the giveaway. Good luck!",
      ephemeral: true,
    });
    await this.updateGiveawayMessage(interaction.guild, updated);
  }

  async restoreActiveGiveaways(): Promise<void> {
    for (const giveaway of this.configStore.getAllGiveaways()) {
      if (giveaway.status === "active") {
        this.schedule(giveaway);
      }
    }
  }

  private resolveGiveaway(guildId: string, input: string): GiveawayRecord {
    const normalized = input.trim().toLowerCase();
    const matches = this.configStore
      .getGiveaways(guildId)
      .filter((giveaway) =>
        giveaway.id.toLowerCase() === normalized ||
        giveaway.id.toLowerCase().startsWith(normalized),
      );
    if (matches.length === 0) {
      throw new GiveawayError("I could not find that giveaway. Use `/giveaway list` to see its ID.");
    }
    if (matches.length > 1) {
      throw new GiveawayError("That giveaway ID is ambiguous. Please use the full giveaway ID.");
    }
    return matches[0];
  }

  private schedule(giveaway: GiveawayRecord): void {
    this.clearTimer(giveaway);
    if (giveaway.status !== "active") {
      return;
    }

    const remainingMs = new Date(giveaway.endAt).getTime() - Date.now();
    const key = this.timerKey(giveaway);
    if (remainingMs <= 0) {
      void this.finishById(giveaway.guildId, giveaway.id, "automatic");
      return;
    }

    const delay = Math.min(remainingMs, MAX_TIMER_DELAY_MS);
    this.timers.set(
      key,
      setTimeout(() => {
        this.timers.delete(key);
        if (delay < remainingMs) {
          const current = this.configStore.getGiveaway(giveaway.guildId, giveaway.id);
          if (current) {
            this.schedule(current);
          }
        } else {
          void this.finishById(giveaway.guildId, giveaway.id, "automatic");
        }
      }, delay),
    );
  }

  private async finishById(
    guildId: string,
    giveawayId: string,
    mode: "automatic" | "manual",
  ): Promise<GiveawayRecord> {
    const giveaway = this.configStore.getGiveaway(guildId, giveawayId);
    if (!giveaway) {
      throw new GiveawayError("That giveaway no longer exists.");
    }
    return this.finishForGuild(guildId, giveaway, mode);
  }

  private async finish(
    guild: Guild,
    giveaway: GiveawayRecord,
    mode: "automatic" | "manual",
  ): Promise<GiveawayRecord> {
    return this.finishForGuild(guild.id, giveaway, mode, guild);
  }

  private async finishForGuild(
    guildId: string,
    giveaway: GiveawayRecord,
    mode: "automatic" | "manual",
    knownGuild?: Guild,
  ): Promise<GiveawayRecord> {
    const key = this.timerKey(giveaway);
    if (this.finishing.has(key)) {
      return giveaway;
    }
    this.finishing.add(key);
    this.clearTimer(giveaway);

    try {
      const guild = knownGuild ?? await this.getGuild(guildId);
      if (!guild) {
        if (mode === "manual") {
          throw new GiveawayError("I could not access the server to end that giveaway.");
        }
        this.scheduleRetry(giveaway);
        return giveaway;
      }

      const eligibleMembers = await this.getEligibleMembers(guild, giveaway);
      const eligibleIds = eligibleMembers.map((member) => member.id);
      const winners = pickUniqueRandom(eligibleIds, giveaway.numberOfWinners);
      const ended = this.configStore.updateGiveaway(guildId, giveaway.id, (current) => {
        current.status = "ended";
        current.winners = winners;
        current.winnerHistory = Array.from(new Set([...current.winnerHistory, ...winners]));
        current.endedAt = new Date().toISOString();
        current.remainingMs = undefined;
      });
      if (!ended) {
        throw new GiveawayError("That giveaway no longer exists.");
      }

      await this.updateGiveawayMessage(guild, ended, eligibleIds.length);
      await this.announceEnd(guild, ended, eligibleIds.length);
      await this.logGiveaway(
        guild,
        ended,
        mode === "manual" ? "Giveaway ended manually" : "Giveaway ended",
        winners.length
          ? `Winners: ${winners.map((userId) => `<@${userId}>`).join(", ")}. Eligible participants: ${eligibleIds.length}.`
          : `Not enough eligible participants. Requested ${giveaway.numberOfWinners}, eligible ${eligibleIds.length}.`,
        mode === "automatic" ? undefined : giveaway.organizerId,
      );
      return ended;
    } finally {
      this.finishing.delete(key);
    }
  }

  private async announceEnd(
    guild: Guild,
    giveaway: GiveawayRecord,
    eligibleCount: number,
  ): Promise<void> {
    const channel = await getTextChannel(guild, giveaway.channelId);
    if (!channel) {
      return;
    }

    const hasEnoughWinners = giveaway.winners.length >= giveaway.numberOfWinners;
    const content = giveaway.winners.length
      ? `🎉 Congratulations ${giveaway.winners.map((userId) => `<@${userId}>`).join(", ")}!`
      : "There were not enough eligible participants to select a winner.";
    const detail = hasEnoughWinners
      ? `Requested winners: ${giveaway.numberOfWinners}.`
      : `Not enough eligible participants: ${eligibleCount} eligible for ${giveaway.numberOfWinners} requested winner${giveaway.numberOfWinners === 1 ? "" : "s"}.`;

    await channel.send({
      content,
      embeds: [
        new EmbedBuilder()
          .setColor(0x57f287)
          .setTitle("🎉 Giveaway ended")
          .setDescription(`**${giveaway.prize}**\n${detail}`)
          .setTimestamp(),
      ],
      allowedMentions: {
        users: giveaway.winners,
        roles: [],
        parse: [],
      },
    }).catch(() => undefined);
  }

  private async getEligibleMembers(
    guild: Guild,
    giveaway: GiveawayRecord,
  ): Promise<GuildMember[]> {
    const requiredRole = giveaway.requiredRoleId
      ? guild.roles.cache.get(giveaway.requiredRoleId)
        ?? await guild.roles.fetch(giveaway.requiredRoleId).catch(() => null)
      : null;
    if (giveaway.requiredRoleId && !requiredRole) {
      return [];
    }

    const members: GuildMember[] = [];
    for (const participantId of giveaway.participants) {
      const member = await guild.members.fetch(participantId).catch(() => null);
      if (member && !member.user.bot && (!requiredRole || member.roles.cache.has(requiredRole.id))) {
        members.push(member);
      }
    }
    return members;
  }

  private async updateGiveawayMessage(
    guild: Guild,
    giveaway: GiveawayRecord,
    eligibleParticipantCount?: number,
  ): Promise<void> {
    const channel = await getTextChannel(guild, giveaway.channelId);
    if (!channel || !giveaway.messageId) {
      return;
    }
    const message = await channel.messages.fetch(giveaway.messageId).catch(() => null);
    if (!message) {
      console.error(`Could not fetch giveaway message ${giveaway.messageId}.`);
      return;
    }
    await message.edit({
      embeds: [buildGiveawayEmbed(giveaway, eligibleParticipantCount)],
      components: buildGiveawayComponents(giveaway),
    }).catch(() => {
      console.error(`Could not update giveaway message ${giveaway.messageId}.`);
    });
  }

  private async getGuild(guildId: string): Promise<Guild | null> {
    return this.client.guilds.cache.get(guildId)
      ?? await this.client.guilds.fetch(guildId).catch(() => null);
  }

  private async logGiveaway(
    guild: Guild,
    giveaway: GiveawayRecord,
    action: string,
    additionalReason?: string,
    actorId?: string,
  ): Promise<void> {
    const channelName = guild.channels.cache.get(giveaway.channelId)?.name ?? giveaway.channelId;
    const reason = [
      `Prize: ${giveaway.prize}`,
      `Channel: <#${giveaway.channelId}>`,
      `Giveaway ID: ${giveaway.id}`,
      `Participants: ${giveaway.participants.length}`,
      additionalReason,
    ].filter(Boolean).join("\n");

    await sendModerationLog(
      guild,
      this.configStore.get(guild.id).logsChannelId,
      {
        moderator: actorId ? `<@${actorId}>` : "System",
        target: `<#${giveaway.channelId}>`,
        action,
        reason,
        channel: channelName,
        color: 0x5865f2,
      },
    ).catch(() => undefined);
  }

  private scheduleRetry(giveaway: GiveawayRecord): void {
    const key = this.timerKey(giveaway);
    this.timers.set(
      key,
      setTimeout(() => {
        this.timers.delete(key);
        void this.finishById(giveaway.guildId, giveaway.id, "automatic");
      }, 60_000),
    );
  }

  private clearTimer(giveaway: GiveawayRecord): void {
    const timer = this.timers.get(this.timerKey(giveaway));
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(this.timerKey(giveaway));
    }
  }

  private timerKey(giveaway: Pick<GiveawayRecord, "guildId" | "id">): string {
    return `${giveaway.guildId}:${giveaway.id}`;
  }
}

function pickUniqueRandom(values: string[], count: number): string[] {
  const available = [...values];
  const selected: string[] = [];
  const targetCount = Math.min(count, available.length);

  while (selected.length < targetCount) {
    selected.push(available.splice(randomInt(available.length), 1)[0]);
  }
  return selected;
}

function getGiveawayColor(status: GiveawayStatus): number {
  if (status === "ended") {
    return 0x57f287;
  }
  if (status === "paused") {
    return 0xfaa61a;
  }
  return 0x5865f2;
}