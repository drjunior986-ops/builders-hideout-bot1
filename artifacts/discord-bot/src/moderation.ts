import {
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
  type Guild,
  type GuildMember,
  type Message,
  type TextChannel,
  type User,
} from "discord.js";
import {
  type AutoModFeature,
  ConfigStore,
  type AutoModAction,
  type WarningRecord,
} from "./config-store.js";

export type ModerationLogDetails = {
  moderator: string;
  target: string;
  action: string;
  reason: string;
  channel?: string;
  rule?: string;
  color?: number;
};

export type ModerationCheck = {
  allowed: boolean;
  reason?: string;
};

type MessageRecord = {
  content: string;
  timestamp: number;
};

type Violation = {
  feature: AutoModFeature;
  rule: string;
  reason: string;
};

const invitePattern =
  /(?:https?:\/\/)?(?:www\.)?(?:discord\.gg|discord(?:app)?\.com\/invite)\/[A-Za-z0-9-]+/i;

export function parseDuration(value: string): number | null {
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

  return duration > 28 * 24 * 60 * 60 * 1000 ? null : duration;
}

export function formatDuration(durationMs: number): string {
  const minutes = Math.round(durationMs / 60_000);
  if (minutes >= 60 * 24) {
    return `${Math.round(minutes / (60 * 24))}d`;
  }
  if (minutes >= 60) {
    return `${Math.round(minutes / 60)}h`;
  }
  return `${Math.max(1, minutes)}m`;
}

export function canModerateTarget(
  moderator: GuildMember,
  target: GuildMember,
  botMember: GuildMember,
): ModerationCheck {
  if (moderator.id === target.id) {
    return { allowed: false, reason: "You cannot moderate yourself." };
  }
  if (target.id === moderator.guild.ownerId) {
    return { allowed: false, reason: "The server owner cannot be moderated." };
  }
  if (target.roles.highest.position >= moderator.roles.highest.position) {
    return {
      allowed: false,
      reason: "You cannot moderate a member with an equal or higher role.",
    };
  }
  if (target.roles.highest.position >= botMember.roles.highest.position) {
    return {
      allowed: false,
      reason: "I cannot moderate that member because their highest role is equal to or higher than mine.",
    };
  }
  if (!target.moderatable) {
    return {
      allowed: false,
      reason: "I cannot moderate that member with my current role permissions.",
    };
  }

  return { allowed: true };
}

export function isProtectedFromAutoMod(
  member: GuildMember,
  botMember: GuildMember,
): boolean {
  if (member.id === botMember.id || member.user.bot) {
    return true;
  }
  if (!member.moderatable) {
    return true;
  }
  if (
    member.permissions.has(PermissionFlagsBits.Administrator) ||
    member.permissions.has(PermissionFlagsBits.ManageGuild) ||
    member.permissions.has(PermissionFlagsBits.ManageMessages) ||
    member.permissions.has(PermissionFlagsBits.ModerateMembers)
  ) {
    return true;
  }

  return member.roles.highest.position >= botMember.roles.highest.position;
}

export async function getTextChannel(
  guild: Guild,
  channelId: string,
): Promise<TextChannel | null> {
  const channel =
    guild.channels.cache.get(channelId) ??
    (await guild.channels.fetch(channelId).catch(() => null));

  return channel?.type === ChannelType.GuildText ? channel : null;
}

export async function sendModerationLog(
  guild: Guild,
  logsChannelId: string | undefined,
  details: ModerationLogDetails,
): Promise<void> {
  if (!logsChannelId) {
    return;
  }

  const channel = await getTextChannel(guild, logsChannelId);
  if (!channel) {
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(details.color ?? 0xed4245)
    .setTitle(details.rule ? `AutoMod: ${details.action}` : `Moderation: ${details.action}`)
    .addFields(
      { name: "Moderator", value: details.moderator, inline: true },
      { name: "Target", value: details.target, inline: true },
      { name: "Action", value: details.action, inline: true },
      { name: "Reason", value: details.reason.slice(0, 1024) },
      ...(details.rule
        ? [{ name: "Rule", value: details.rule, inline: true }]
        : []),
      ...(details.channel
        ? [{ name: "Channel", value: details.channel, inline: true }]
        : []),
    )
    .setTimestamp();

  await channel.send({ embeds: [embed] });
}

export function buildWarningsEmbed(
  user: User,
  warnings: WarningRecord[],
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(0xfaa61a)
    .setTitle(`Warnings for ${user.username}`)
    .setThumbnail(user.displayAvatarURL())
    .setTimestamp();

  if (warnings.length === 0) {
    return embed.setDescription("This user has no warnings.");
  }

  return embed.setDescription(
    warnings
      .map(
        (warning, index) =>
          `**${index + 1}.** ${warning.reason}\nModerator: <@${warning.moderatorId}> • <t:${Math.floor(new Date(warning.timestamp).getTime() / 1000)}:R>`,
      )
      .join("\n\n")
      .slice(0, 4096),
  );
}

export class AutoModerator {
  private readonly messageHistory = new Map<string, MessageRecord[]>();
  private readonly cooldowns = new Map<string, number>();

  constructor(
    private readonly configStore: ConfigStore,
    private readonly botUserId: () => string | undefined,
  ) {}

  async handleMessage(message: Message): Promise<void> {
    if (!message.guild || message.author.bot || !message.member) {
      return;
    }

    const config = this.configStore.getAutoModConfig(message.guild.id);
    const botMember = message.guild.members.me;
    if (!botMember || isProtectedFromAutoMod(message.member, botMember)) {
      return;
    }

    const now = Date.now();
    const historyKey = `${message.guild.id}:${message.author.id}`;
    const history = this.messageHistory.get(historyKey) ?? [];
    const maxWindowSeconds = Math.max(
      config.spamWindowSeconds,
      config.floodWindowSeconds,
      config.duplicateWindowSeconds,
    );
    const currentHistory = history.filter(
      (record) => now - record.timestamp <= maxWindowSeconds * 1000,
    );
    currentHistory.push({ content: message.content, timestamp: now });
    this.messageHistory.set(historyKey, currentHistory);

    const violation = this.detectViolation(message, currentHistory, config);
    if (!violation || !config.enabled[violation.feature]) {
      return;
    }
    if (
      violation.feature === "invites" &&
      config.inviteChannelIds.includes(message.channel.id)
    ) {
      return;
    }

    await message.delete().catch(() => undefined);

    const cooldownKey = `${message.guild.id}:${message.author.id}:${violation.feature}`;
    const lastAction = this.cooldowns.get(cooldownKey) ?? 0;
    if (now - lastAction < config.cooldownSeconds * 1000) {
      return;
    }
    this.cooldowns.set(cooldownKey, now);

    const warning = this.configStore.addWarning(message.guild.id, message.author.id, {
      moderatorId: this.botUserId() ?? "automod",
      reason: `[AutoMod] ${violation.reason}`,
    });
    const recentAutoModWarnings = this.configStore
      .getWarnings(message.guild.id, message.author.id)
      .filter(
        (item) =>
          item.reason.startsWith("[AutoMod]") &&
          Date.now() - new Date(item.timestamp).getTime() <= 60 * 60 * 1000,
      ).length;

    const shouldTimeout =
      config.actions[violation.feature] === "timeout" || recentAutoModWarnings >= 3;
    let action = "Warning";
    if (shouldTimeout && message.member.moderatable) {
      const timeoutMs = config.timeoutMinutes * 60 * 1000;
      const timedOut = await message.member
        .timeout(timeoutMs, `AutoMod: ${violation.rule}`)
        .then(() => true)
        .catch(() => false);
      if (timedOut) {
        action = "Timeout";
      }
    }

    await this.sendNotice(message, action, warning);
    await sendModerationLog(
      message.guild,
      this.configStore.get(message.guild.id).logsChannelId,
      {
      moderator: this.botUserId() ? `<@${this.botUserId()}>` : "AutoMod",
      target: `<@${message.author.id}>`,
      action,
      reason: violation.reason,
      rule: violation.rule,
      channel: `${message.channel}`,
      },
    );
  }

  private detectViolation(
    message: Message,
    history: MessageRecord[],
    config: ReturnType<ConfigStore["getAutoModConfig"]>,
  ): Violation | null {
    const now = Date.now();
    const within = (seconds: number) =>
      history.filter((record) => now - record.timestamp <= seconds * 1000);

    if (
      within(config.spamWindowSeconds).length >= config.spamLimit
    ) {
      return {
        feature: "spam",
        rule: "Anti-spam",
        reason: `Sent ${config.spamLimit} messages within ${config.spamWindowSeconds} seconds.`,
      };
    }

    if (
      within(config.floodWindowSeconds).length >= config.floodLimit
    ) {
      return {
        feature: "flood",
        rule: "Anti-flood",
        reason: `Sent ${config.floodLimit} messages within ${config.floodWindowSeconds} seconds.`,
      };
    }

    const normalizedContent = message.content.trim().toLowerCase();
    if (
      normalizedContent &&
      within(config.duplicateWindowSeconds).filter(
        (record) => record.content.trim().toLowerCase() === normalizedContent,
      ).length >= config.duplicateLimit
    ) {
      return {
        feature: "duplicates",
        rule: "Duplicate messages",
        reason: `Repeated the same message ${config.duplicateLimit} times.`,
      };
    }

    const mentionCount =
      message.mentions.users.size +
      message.mentions.roles.size +
      (message.mentions.everyone ? 1 : 0);
    if (mentionCount > config.mentionLimit) {
      return {
        feature: "mentions",
        rule: "Excessive mentions",
        reason: `Used ${mentionCount} mentions; the limit is ${config.mentionLimit}.`,
      };
    }

    if (invitePattern.test(message.content)) {
      return {
        feature: "invites",
        rule: "Discord invite links",
        reason: "Posted a Discord invite link outside an allowed channel.",
      };
    }

    const blockedWord = config.blockedWords.find((word) =>
      message.content.toLowerCase().includes(word),
    );
    if (blockedWord) {
      return {
        feature: "blockedwords",
        rule: "Blocked words",
        reason: `Message contained the blocked word "${blockedWord}".`,
      };
    }

    if (hasRepeatedCharacters(message.content, config.repeatedCharacterThreshold)) {
      return {
        feature: "characters",
        rule: "Excessive repeated characters",
        reason: `Contained a repeated character sequence of at least ${config.repeatedCharacterThreshold}.`,
      };
    }

    return null;
  }

  private async sendNotice(
    message: Message,
    action: string,
    warning: WarningRecord,
  ): Promise<void> {
    const notice = await (message.channel as TextChannel)
      .send({
        content:
          action === "Timeout"
            ? `<@${message.author.id}> your message was removed and you were timed out for an AutoMod violation.`
            : `<@${message.author.id}> your message was removed and a warning was added.`,
        allowedMentions: { users: [message.author.id] },
      })
      .catch(() => null);

    if (notice) {
      setTimeout(() => {
        void notice.delete().catch(() => undefined);
      }, 5000);
    }

    void warning;
  }
}

function hasRepeatedCharacters(value: string, threshold: number): boolean {
  let previous = "";
  let count = 0;

  for (const character of value) {
    if (character === previous) {
      count += 1;
      if (count >= threshold) {
        return true;
      }
    } else {
      previous = character;
      count = 1;
    }
  }

  return false;
}