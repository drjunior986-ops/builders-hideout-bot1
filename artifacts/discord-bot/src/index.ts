import "dotenv/config";
import {
  ChannelType,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  PermissionFlagsBits,
  type Guild,
  type GuildMember,
  type PartialGuildMember,
  type PermissionResolvable,
  type User,
} from "discord.js";

import {
  AUTOMOD_FEATURES,
  ConfigStore,
  type AutoModAction,
  type AutoModFeature,
  type EventConfig,
} from "./config-store.js";

import { commands } from "./command-definitions.js";

import {
  AutoModerator,
  buildWarningsEmbed,
  canModerateTarget,
  formatDuration,
  getTextChannel,
  parseDuration,
  sendModerationLog,
} from "./moderation.js";

import { GiveawayError, GiveawayManager } from "./giveaways.js";
import { TicketManager } from "./tickets.js";
import { handlePaymentCommand } from "./payments.js";

type MemberEvent = GuildMember | PartialGuildMember;

const token = process.env["DISCORD_TOKEN"];
const guildId = process.env["GUILD_ID"];

if (!token) {
  throw new Error(
    "DISCORD_TOKEN is required. Add it to your Replit Secrets.",
  );
}

if (!guildId) {
  throw new Error(
    "GUILD_ID is required. Add your Builders Hideout server ID to Replit Secrets.",
  );
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const configStore = new ConfigStore();

const autoModerator = new AutoModerator(
  configStore,
  () => client.user?.id,
);

const giveawayManager = new GiveawayManager(
  configStore,
  client,
);

const ticketManager = new TicketManager(
  configStore,
  client,
);

/* ─────────────────────────────────────────────
   BOT READY
───────────────────────────────────────────── */

client.once(Events.ClientReady, async (readyClient) => {
  console.log(
    `Discord bot logged in as ${readyClient.user.tag}`,
  );

  try {
    const guild = await readyClient.guilds.fetch(guildId);

    if (!guild) {
      throw new Error(
        `Builders Hideout server was not found. Guild ID: ${guildId}`,
      );
    }

    await guild.commands.set(
  commands as any,
);

    console.log(
      `Successfully registered ${commands.length} slash commands in ${guild.name}.`,
    );

    await giveawayManager.restoreActiveGiveaways();

    console.log("Restored active giveaway timers.");

    await ticketManager.restore();

    console.log(
      "Restored active ticket inactivity timers.",
    );

    console.log("Bot is fully ready.");
  } catch (error) {
    console.error(
      "Failed to initialize Discord bot:",
      error,
    );

    process.exitCode = 1;
  }
});

/* ─────────────────────────────────────────────
   MESSAGE EVENTS
───────────────────────────────────────────── */

client.on(Events.MessageCreate, (message) => {
  void autoModerator.handleMessage(message).catch(() => {
    console.error(
      "AutoMod message handling failed.",
    );
  });

  void ticketManager.handleMessage(message).catch(() => {
    console.error(
      "Ticket activity handling failed.",
    );
  });
});

/* ─────────────────────────────────────────────
   INTERACTIONS
───────────────────────────────────────────── */

client.on(Events.InteractionCreate, (interaction) => {
  /*
   * Giveaway buttons
   */
  if (
    interaction.isButton() &&
    interaction.customId.startsWith("giveaway:enter:")
  ) {
    void giveawayManager
      .handleButton(interaction)
      .catch(async () => {
        console.error(
          "The giveaway button interaction failed.",
        );

        if (
          !interaction.replied &&
          !interaction.deferred
        ) {
          await interaction
            .reply({
              content:
                "Something went wrong while updating your giveaway entry.",
              ephemeral: true,
            })
            .catch(() => undefined);
        }
      });

    return;
  }

  /*
   * Ticket buttons, menus and modals
   */
  if (
    interaction.isButton() ||
    interaction.isStringSelectMenu() ||
    interaction.isUserSelectMenu() ||
    interaction.isModalSubmit()
  ) {
    if (
      interaction.customId.startsWith("ticket:")
    ) {
      void ticketManager
        .handleComponent(interaction)
        .catch(async () => {
          console.error(
            "The ticket interaction failed.",
          );

          if (
            !interaction.replied &&
            !interaction.deferred
          ) {
            await interaction
              .reply({
                content:
                  "Something went wrong while handling this ticket interaction.",
                ephemeral: true,
              })
              .catch(() => undefined);
          }
        });

      return;
    }
  }

  /*
   * Slash commands
   */
  if (!interaction.isChatInputCommand()) {
    return;
  }

  void routeInteraction(interaction).catch(
    async () => {
      console.error(
        `The /${interaction.commandName} command failed.`,
      );

      if (
        interaction.replied ||
        interaction.deferred
      ) {
        await interaction
          .followUp({
            content:
              "Something went wrong while handling that command.",
            ephemeral: true,
          })
          .catch(() => undefined);
      } else {
        await interaction
          .reply({
            content:
              "Something went wrong while handling that command.",
            ephemeral: true,
          })
          .catch(() => undefined);
      }
    },
  );
});

/* ─────────────────────────────────────────────
   MEMBER JOIN / LEAVE
───────────────────────────────────────────── */

client.on(Events.GuildMemberAdd, async (member) => {
  const guildConfig = configStore.get(
    member.guild.id,
  );

  if (guildConfig.welcome) {
    await sendMemberEmbed(
      member.guild,
      guildConfig.welcome,
      member,
      "welcome",
    );
  }

  await sendMemberEventLog(
    member.guild,
    guildConfig.logsChannelId,
    member,
    "join",
  );
});

client.on(Events.GuildMemberRemove, async (member) => {
  const guildConfig = configStore.get(
    member.guild.id,
  );

  if (guildConfig.leave) {
    await sendMemberEmbed(
      member.guild,
      guildConfig.leave,
      member,
      "leave",
    );
  }

  await sendMemberEventLog(
    member.guild,
    guildConfig.logsChannelId,
    member,
    "leave",
  );
});

/* ─────────────────────────────────────────────
   COMMAND ROUTER
───────────────────────────────────────────── */

async function routeInteraction(
  interaction: import("discord.js").ChatInputCommandInteraction,
): Promise<void> {
  switch (interaction.commandName) {
    case "ping":
      await interaction.reply(
        "Pong! Bot is online.",
      );
      return;

    case "config":
      await handleConfigCommand(interaction);
      return;

    case "warn":
      await handleWarnCommand(interaction);
      return;

    case "warnings":
      await handleWarningsCommand(interaction);
      return;

    case "clearwarnings":
      await handleClearWarningsCommand(interaction);
      return;

    case "clear":
      await handleClearCommand(interaction);
      return;

    case "timeout":
      await handleTimeoutCommand(interaction);
      return;

    case "kick":
      await handleKickCommand(interaction);
      return;

    case "ban":
      await handleBanCommand(interaction);
      return;

    case "unban":
      await handleUnbanCommand(interaction);
      return;

    case "automod":
      await handleAutoModCommand(interaction);
      return;

    case "giveaway":
      await handleGiveawayCommand(interaction);
      return;

    case "ticket":
      await ticketManager.handleCommand(
        interaction,
      );
      return;

    case "payment":
      await handlePaymentCommand(interaction);
      return;

    default:
      return;
  }
}

/* ─────────────────────────────────────────────
   GIVEAWAYS
───────────────────────────────────────────── */

async function handleGiveawayCommand(
  interaction: import("discord.js").ChatInputCommandInteraction,
): Promise<void> {
  const guild = await requireGuild(interaction);

  if (
    !guild ||
    !(await requireGiveawayPermission(interaction))
  ) {
    return;
  }

  const subcommand =
    interaction.options.getSubcommand();

  if (subcommand === "list") {
    const giveaways = giveawayManager
      .getForGuild(guild.id)
      .sort(
        (left, right) =>
          right.createdAt.localeCompare(
            left.createdAt,
          ),
      )
      .slice(0, 20);

    const description = giveaways.length
      ? giveaways
          .map((giveaway) => {
            const status =
              giveaway.status[0].toUpperCase() +
              giveaway.status.slice(1);

            const end =
              giveaway.status === "ended" &&
              giveaway.endedAt
                ? `ended <t:${Math.floor(
                    new Date(
                      giveaway.endedAt,
                    ).getTime() / 1000,
                  )}:R>`
                : giveaway.status === "paused"
                  ? "paused"
                  : `ends <t:${Math.floor(
                      new Date(
                        giveaway.endAt,
                      ).getTime() / 1000,
                    )}:R>`;

            return `**${status}** · \`${giveaway.id}\` · ${giveaway.prize} · <#${giveaway.channelId}> · ${end}`;
          })
          .join("\n")
          .slice(0, 4096)
      : "No giveaways have been created in this server.";

    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle(
            "Builders Hideout giveaways",
          )
          .setDescription(description)
          .setTimestamp(),
      ],
      ephemeral: true,
    });

    return;
  }

  try {
    if (subcommand === "start") {
      const channel =
        interaction.options.getChannel(
          "channel",
          true,
        );

      if (channel.type !== ChannelType.GuildText) {
        await replyError(
          interaction,
          "Please choose a standard text channel.",
        );
        return;
      }

      const role =
        interaction.options.getRole(
          "requiredrole",
        );

      const giveaway =
        await giveawayManager.start({
          guild,
          organizerId: interaction.user.id,
          prize:
            interaction.options.getString(
              "prize",
              true,
            ),
          description:
            interaction.options.getString(
              "description",
            ) ?? undefined,
          duration:
            interaction.options.getString(
              "duration",
              true,
            ),
          numberOfWinners:
            interaction.options.getInteger(
              "winners",
              true,
            ),
          channelId: channel.id,
          requiredRoleId: role?.id,
          color:
  interaction.options.getString(
    "color",
  ) ?? undefined,
        });

      await replySuccess(
        interaction,
        `Giveaway started in ${channel} for **${giveaway.prize}**. ID: \`${giveaway.id}\` · ends <t:${Math.floor(
          new Date(
            giveaway.endAt,
          ).getTime() / 1000,
        )}:R>.`,
      );

      return;
    }

    const giveawayInput =
      interaction.options.getString(
        "giveaway",
        true,
      );

    if (subcommand === "end") {
      const giveaway =
        await giveawayManager.end(
          guild,
          giveawayInput,
        );

      await replySuccess(
        interaction,
        `Giveaway \`${giveaway.id}\` ended. ${formatGiveawayWinners(
          giveaway.winners,
        )}`,
      );

      return;
    }

    if (subcommand === "pause") {
      const giveaway =
        await giveawayManager.pause(
          guild,
          giveawayInput,
        );

      await replySuccess(
        interaction,
        giveaway.status === "ended"
          ? `Giveaway \`${giveaway.id}\` had already expired and was ended. ${formatGiveawayWinners(
              giveaway.winners,
            )}`
          : `Giveaway \`${giveaway.id}\` is paused.`,
      );

      return;
    }

    if (subcommand === "resume") {
      const giveaway =
        await giveawayManager.resume(
          guild,
          giveawayInput,
        );

      await replySuccess(
        interaction,
        giveaway.status === "ended"
          ? `Giveaway \`${giveaway.id}\` had no time remaining and was ended. ${formatGiveawayWinners(
              giveaway.winners,
            )}`
          : `Giveaway \`${giveaway.id}\` resumed. It ends <t:${Math.floor(
              new Date(
                giveaway.endAt,
              ).getTime() / 1000,
            )}:R>.`,
      );

      return;
    }

    if (subcommand === "reroll") {
      const giveaway =
        await giveawayManager.reroll(
          guild,
          giveawayInput,
        );

      await replySuccess(
        interaction,
        `Giveaway \`${giveaway.id}\` rerolled. ${formatGiveawayWinners(
          giveaway.winners,
        )}`,
      );
    }
  } catch (error) {
    if (error instanceof GiveawayError) {
      await replyError(
        interaction,
        error.message,
      );
      return;
    }

    throw error;
  }
}

/* ─────────────────────────────────────────────
   CONFIG
───────────────────────────────────────────── */

async function handleConfigCommand(
  interaction: import("discord.js").ChatInputCommandInteraction,
): Promise<void> {
  const guild = await requireGuild(interaction);

  if (
    !guild ||
    !(await requirePermission(
      interaction,
      PermissionFlagsBits.ManageGuild,
    ))
  ) {
    return;
  }

  const subcommand =
    interaction.options.getSubcommand();

  if (subcommand === "logs") {
    const channel =
      interaction.options.getChannel(
        "channel",
        true,
      );

    if (channel.type !== ChannelType.GuildText) {
      await replyError(
        interaction,
        "Please choose a standard text channel.",
      );
      return;
    }

    configStore.setLogsChannel(
      guild.id,
      channel.id,
    );

    await replySuccess(
      interaction,
      `Moderation and member logs will be sent to ${channel}.`,
    );

    return;
  }

  if (
    subcommand !== "welcome" &&
    subcommand !== "leave"
  ) {
    return;
  }

  const channel =
    interaction.options.getChannel(
      "channel",
      true,
    );

  if (channel.type !== ChannelType.GuildText) {
    await replyError(
      interaction,
      "Please choose a standard text channel.",
    );
    return;
  }

  const defaultConfig =
    getDefaultEventConfig(subcommand);

  const colorInput =
    interaction.options.getString("color");

  const color = colorInput
    ? parseColor(colorInput)
    : defaultConfig.color;

  if (color === null) {
    await replyError(
      interaction,
      "Color must be a hexadecimal value such as #57F287.",
    );
    return;
  }

  configStore.setEventConfig(
    guild.id,
    subcommand,
    {
      channelId: channel.id,
      title:
        interaction.options.getString(
          "title",
        ) ?? defaultConfig.title,
      message:
        interaction.options.getString(
          "message",
        ) ?? defaultConfig.message,
      color,
    },
  );

  const eventName =
    subcommand === "welcome"
      ? "Welcome"
      : "Leave";

  await replySuccess(
    interaction,
    `${eventName} messages will be sent to ${channel}.`,
  );
}

/* ─────────────────────────────────────────────
   MODERATION
───────────────────────────────────────────── */

async function handleWarnCommand(
  interaction: import("discord.js").ChatInputCommandInteraction,
): Promise<void> {
  const guild = await requireGuild(interaction);

  if (
    !guild ||
    !(await requirePermission(
      interaction,
      PermissionFlagsBits.ModerateMembers,
    ))
  ) {
    return;
  }

  const target =
    await getTargetMember(
      interaction,
      guild,
    );

  if (!target) return;

  const hierarchy =
    await checkTargetHierarchy(
      interaction,
      guild,
      target,
    );

  if (!hierarchy.allowed) {
    await replyError(
      interaction,
      hierarchy.reason ??
        "That member cannot be moderated.",
    );
    return;
  }

  const reason =
    interaction.options.getString(
      "reason",
      true,
    );

  configStore.addWarning(
    guild.id,
    target.id,
    {
      moderatorId: interaction.user.id,
      reason,
    },
  );

  await replySuccess(
    interaction,
    `Warning added to ${target.user.username}. They now have ${
      configStore.getWarnings(
        guild.id,
        target.id,
      ).length
    } warning(s).`,
  );

  await logModeration(
    guild,
    interaction.user,
    target.user,
    "Warn",
    reason,
  );
}

async function handleWarningsCommand(
  interaction: import("discord.js").ChatInputCommandInteraction,
): Promise<void> {
  const guild = await requireGuild(interaction);

  if (
    !guild ||
    !(await requirePermission(
      interaction,
      PermissionFlagsBits.ModerateMembers,
    ))
  ) {
    return;
  }

  const user =
    interaction.options.getUser(
      "user",
      true,
    );

  const warnings =
    configStore.getWarnings(
      guild.id,
      user.id,
    );

  await interaction.reply({
    embeds: [
      buildWarningsEmbed(
        user,
        warnings,
      ),
    ],
    ephemeral: true,
  });
}

async function handleClearWarningsCommand(
  interaction: import("discord.js").ChatInputCommandInteraction,
): Promise<void> {
  const guild = await requireGuild(interaction);

  if (
    !guild ||
    !(await requirePermission(
      interaction,
      PermissionFlagsBits.ModerateMembers,
    ))
  ) {
    return;
  }

  const target =
    await getTargetMember(
      interaction,
      guild,
    );

  if (!target) return;

  const hierarchy =
    await checkTargetHierarchy(
      interaction,
      guild,
      target,
    );

  if (!hierarchy.allowed) {
    await replyError(
      interaction,
      hierarchy.reason ??
        "That member cannot be moderated.",
    );
    return;
  }

  const warnings =
    configStore.clearWarnings(
      guild.id,
      target.id,
    );

  await replySuccess(
    interaction,
    `Cleared ${warnings.length} warning(s) from ${target.user.username}.`,
  );

  await logModeration(
    guild,
    interaction.user,
    target.user,
    "Clear warnings",
    `Removed ${warnings.length} warning(s).`,
  );
}

async function handleClearCommand(
  interaction: import("discord.js").ChatInputCommandInteraction,
): Promise<void> {
  const guild = await requireGuild(interaction);

  if (
    !guild ||
    !(await requirePermission(
      interaction,
      PermissionFlagsBits.ManageMessages,
    ))
  ) {
    return;
  }

  if (
    !interaction.channel ||
    interaction.channel.type !==
      ChannelType.GuildText
  ) {
    await replyError(
      interaction,
      "The /clear command can only be used in a standard text channel.",
    );
    return;
  }

  const amount =
    interaction.options.getInteger(
      "amount",
      true,
    );

  let deletedCount = 0;

  if (amount === 1) {
    const messages =
      await interaction.channel.messages.fetch({
        limit: 1,
      });

    const message = messages.first();

    if (message) {
      await message.delete();
      deletedCount = 1;
    }
  } else {
    deletedCount = (
      await interaction.channel.bulkDelete(
        amount,
        true,
      )
    ).size;
  }

  await replySuccess(
    interaction,
    `Deleted ${deletedCount} recent message(s).`,
  );

  await logModeration(
    guild,
    interaction.user,
    undefined,
    "Clear messages",
    `Deleted ${deletedCount} recent message(s).`,
    interaction.channel.name,
  );
}

async function handleTimeoutCommand(
  interaction: import("discord.js").ChatInputCommandInteraction,
): Promise<void> {
  const guild = await requireGuild(interaction);

  if (
    !guild ||
    !(await requirePermission(
      interaction,
      PermissionFlagsBits.ModerateMembers,
    ))
  ) {
    return;
  }

  const durationInput =
    interaction.options.getString(
      "duration",
      true,
    );

  const duration =
    parseDuration(durationInput);

  if (!duration) {
    await replyError(
      interaction,
      "Use a duration such as 10m, 1h, or 1d. The maximum is 28d.",
    );
    return;
  }

  const target =
    await getTargetMember(
      interaction,
      guild,
    );

  if (!target) return;

  const hierarchy =
    await checkTargetHierarchy(
      interaction,
      guild,
      target,
    );

  if (!hierarchy.allowed) {
    await replyError(
      interaction,
      hierarchy.reason ??
        "That member cannot be moderated.",
    );
    return;
  }

  const reason =
    interaction.options.getString(
      "reason",
      true,
    );

  await target.timeout(
    duration,
    reason,
  );

  await replySuccess(
    interaction,
    `${target.user.username} was timed out for ${formatDuration(
      duration,
    )}.`,
  );

  await logModeration(
    guild,
    interaction.user,
    target.user,
    "Timeout",
    reason,
  );
}

async function handleKickCommand(
  interaction: import("discord.js").ChatInputCommandInteraction,
): Promise<void> {
  const guild = await requireGuild(interaction);

  if (
    !guild ||
    !(await requirePermission(
      interaction,
      PermissionFlagsBits.KickMembers,
    ))
  ) {
    return;
  }

  const target =
    await getTargetMember(
      interaction,
      guild,
    );

  if (!target) return;

  const hierarchy =
    await checkTargetHierarchy(
      interaction,
      guild,
      target,
    );

  if (!hierarchy.allowed) {
    await replyError(
      interaction,
      hierarchy.reason ??
        "That member cannot be moderated.",
    );
    return;
  }

  const reason =
    interaction.options.getString(
      "reason",
      true,
    );

  await target.kick(reason);

  await replySuccess(
    interaction,
    `${target.user.username} was kicked.`,
  );

  await logModeration(
    guild,
    interaction.user,
    target.user,
    "Kick",
    reason,
  );
}

async function handleBanCommand(
  interaction: import("discord.js").ChatInputCommandInteraction,
): Promise<void> {
  const guild = await requireGuild(interaction);

  if (
    !guild ||
    !(await requirePermission(
      interaction,
      PermissionFlagsBits.BanMembers,
    ))
  ) {
    return;
  }

  const target =
    await getTargetMember(
      interaction,
      guild,
    );

  if (!target) return;

  const hierarchy =
    await checkTargetHierarchy(
      interaction,
      guild,
      target,
    );

  if (!hierarchy.allowed) {
    await replyError(
      interaction,
      hierarchy.reason ??
        "That member cannot be moderated.",
    );
    return;
  }

  const reason =
    interaction.options.getString(
      "reason",
      true,
    );

  await target.ban({ reason });

  await replySuccess(
    interaction,
    `${target.user.username} was banned.`,
  );

  await logModeration(
    guild,
    interaction.user,
    target.user,
    "Ban",
    reason,
  );
}

async function handleUnbanCommand(
  interaction: import("discord.js").ChatInputCommandInteraction,
): Promise<void> {
  const guild = await requireGuild(interaction);

  if (
    !guild ||
    !(await requirePermission(
      interaction,
      PermissionFlagsBits.BanMembers,
    ))
  ) {
    return;
  }

  const user =
    interaction.options.getUser(
      "user",
      true,
    );

  const ban =
    await guild.bans
      .fetch(user.id)
      .catch(() => null);

  if (!ban) {
    await replyError(
      interaction,
      `${user.username} is not currently banned.`,
    );
    return;
  }

  const reason =
    interaction.options.getString(
      "reason",
    ) ?? "Manual unban";

  await guild.members.unban(
    user.id,
    reason,
  );

  await replySuccess(
    interaction,
    `${user.username} was unbanned.`,
  );

  await logModeration(
    guild,
    interaction.user,
    user,
    "Unban",
    reason,
  );
}

/* ─────────────────────────────────────────────
   AUTOMOD
───────────────────────────────────────────── */

async function handleAutoModCommand(
  interaction: import("discord.js").ChatInputCommandInteraction,
): Promise<void> {
  const guild = await requireGuild(interaction);

  if (
    !guild ||
    !(await requirePermission(
      interaction,
      PermissionFlagsBits.ManageGuild,
    ))
  ) {
    return;
  }

  const group =
    interaction.options.getSubcommandGroup(
      false,
    );

  if (group === "invitechannel") {
    await handleInviteChannelCommand(
      interaction,
      guild,
    );
    return;
  }

  if (group === "blockedword") {
    await handleBlockedWordCommand(
      interaction,
      guild,
    );
    return;
  }

  const subcommand =
    interaction.options.getSubcommand();

  if (subcommand === "setup") {
    configStore.updateAutoModConfig(
      guild.id,
      (config) => {
        for (const feature of AUTOMOD_FEATURES) {
          config.enabled[feature] = true;
        }
      },
    );

    await replySuccess(
      interaction,
      "AutoMod is enabled with safe default thresholds.",
    );

    return;
  }

  if (subcommand === "status") {
    await interaction.reply({
      embeds: [
        buildAutoModStatusEmbed(
          guild.id,
        ),
      ],
    });

    return;
  }

  if (
    subcommand === "enable" ||
    subcommand === "disable"
  ) {
    const feature =
      getAutoModFeature(
        interaction.options.getString(
          "feature",
          true,
        ),
      );

    if (!feature) {
      await replyError(
        interaction,
        "That AutoMod feature is not recognized.",
      );
      return;
    }

    configStore.updateAutoModConfig(
      guild.id,
      (config) => {
        config.enabled[feature] =
          subcommand === "enable";
      },
    );

    await replySuccess(
      interaction,
      `${featureLabel(feature)} is now ${
        subcommand === "enable"
          ? "enabled"
          : "disabled"
      }.`,
    );

    return;
  }

  if (subcommand === "config") {
    await handleAutoModConfigCommand(
      interaction,
      guild,
    );
  }
}

async function handleAutoModConfigCommand(
  interaction: import("discord.js").ChatInputCommandInteraction,
  guild: Guild,
): Promise<void> {
  const featureValue =
    interaction.options.getString(
      "feature",
    );

  const feature = featureValue
    ? getAutoModFeature(featureValue)
    : null;

  const actionValue =
    interaction.options.getString(
      "action",
    ) as AutoModAction | null;

  const limit =
    interaction.options.getInteger(
      "limit",
    );

  const window =
    interaction.options.getInteger(
      "window",
    );

  const mentions =
    interaction.options.getInteger(
      "mentions",
    );

  const characters =
    interaction.options.getInteger(
      "characters",
    );

  const timeout =
    interaction.options.getInteger(
      "timeout",
    );

  if (featureValue && !feature) {
    await replyError(
      interaction,
      "That AutoMod feature is not recognized.",
    );
    return;
  }

  if (
    (actionValue && !feature) ||
    (limit !== null && !feature)
  ) {
    await replyError(
      interaction,
      "Choose a feature when changing its action or limit.",
    );
    return;
  }

  const hasUpdate =
    actionValue ||
    limit !== null ||
    window !== null ||
    mentions !== null ||
    characters !== null ||
    timeout !== null;

  if (!hasUpdate) {
    await interaction.reply({
      embeds: [
        buildAutoModStatusEmbed(
          guild.id,
        ),
      ],
    });
    return;
  }

  configStore.updateAutoModConfig(
    guild.id,
    (config) => {
      if (
        feature &&
        actionValue &&
        (
          actionValue === "warn" ||
          actionValue === "timeout"
        )
      ) {
        config.actions[feature] =
          actionValue;
      }

      if (
        feature &&
        limit !== null
      ) {
        if (feature === "spam")
          config.spamLimit = limit;

        if (feature === "flood")
          config.floodLimit = limit;

        if (feature === "duplicates")
          config.duplicateLimit = limit;
      }

      if (
        feature &&
        window !== null
      ) {
        if (feature === "spam")
          config.spamWindowSeconds =
            window;

        if (feature === "flood")
          config.floodWindowSeconds =
            window;

        if (feature === "duplicates")
          config.duplicateWindowSeconds =
            window;
      }

      if (mentions !== null)
        config.mentionLimit = mentions;

      if (characters !== null)
        config.repeatedCharacterThreshold =
          characters;

      if (timeout !== null)
        config.timeoutMinutes = timeout;
    },
  );

  await replySuccess(
    interaction,
    "AutoMod configuration updated.",
  );
}

async function handleInviteChannelCommand(
  interaction: import("discord.js").ChatInputCommandInteraction,
  guild: Guild,
): Promise<void> {
  const subcommand =
    interaction.options.getSubcommand();

  if (subcommand === "list") {
    const config =
      configStore.getAutoModConfig(
        guild.id,
      );

    const channels =
      config.inviteChannelIds.length
        ? config.inviteChannelIds
            .map((id) => `<#${id}>`)
            .join(", ")
        : "No channels are allowlisted.";

    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle(
            "Invite channel allowlist",
          )
          .setDescription(channels),
      ],
      ephemeral: true,
    });

    return;
  }

  const channel =
    interaction.options.getChannel(
      "channel",
      true,
    );

  if (channel.type !== ChannelType.GuildText) {
    await replyError(
      interaction,
      "Please choose a standard text channel.",
    );
    return;
  }

  const changed =
    subcommand === "add"
      ? configStore.addInviteChannel(
          guild.id,
          channel.id,
        )
      : configStore.removeInviteChannel(
          guild.id,
          channel.id,
        );

  await replySuccess(
    interaction,
    changed
      ? subcommand === "add"
        ? `Discord invites are allowed in ${channel}.`
        : `Discord invites are blocked again in ${channel}.`
      : subcommand === "add"
        ? `${channel} is already allowlisted.`
        : `${channel} was not on the allowlist.`,
  );
}

async function handleBlockedWordCommand(
  interaction: import("discord.js").ChatInputCommandInteraction,
  guild: Guild,
): Promise<void> {
  const subcommand =
    interaction.options.getSubcommand();

  if (subcommand === "list") {
    const words =
      configStore.getAutoModConfig(
        guild.id,
      ).blockedWords;

    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle("Blocked words")
          .setDescription(
            words.length
              ? words
                  .map(
                    (word) => `\`${word}\``,
                  )
                  .join(", ")
              : "No blocked words configured.",
          ),
      ],
      ephemeral: true,
    });

    return;
  }

  const word =
    interaction.options
      .getString("word", true)
      .trim()
      .toLowerCase();

  if (!word) {
    await replyError(
      interaction,
      "The blocked word cannot be empty.",
    );
    return;
  }

  const changed =
    subcommand === "add"
      ? configStore.addBlockedWord(
          guild.id,
          word,
        )
      : configStore.removeBlockedWord(
          guild.id,
          word,
        );

  await replySuccess(
    interaction,
    changed
      ? subcommand === "add"
        ? `Added \`${word}\` to the blocked-word list.`
        : `Removed \`${word}\` from the blocked-word list.`
      : subcommand === "add"
        ? `\`${word}\` is already blocked.`
        : `\`${word}\` was not in the blocked-word list.`,
  );
}

/* ─────────────────────────────────────────────
   AUTOMOD HELPERS
───────────────────────────────────────────── */

function buildAutoModStatusEmbed(
  guildId: string,
): EmbedBuilder {
  const config =
    configStore.getAutoModConfig(
      guildId,
    );

  const lines = AUTOMOD_FEATURES.map(
    (feature) =>
      `**${featureLabel(feature)}:** ${
        config.enabled[feature]
          ? "Enabled"
          : "Disabled"
      } · ${config.actions[feature]}`,
  );

  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("AutoMod status")
    .setDescription(lines.join("\n"))
    .addFields(
      {
        name: "Thresholds",
        value: [
          `Spam: ${config.spamLimit} in ${config.spamWindowSeconds}s`,
          `Flood: ${config.floodLimit} in ${config.floodWindowSeconds}s`,
          `Duplicates: ${config.duplicateLimit} in ${config.duplicateWindowSeconds}s`,
          `Mentions: ${config.mentionLimit}`,
          `Repeated characters: ${config.repeatedCharacterThreshold}`,
          `Timeout: ${config.timeoutMinutes}m`,
        ].join("\n"),
      },
      {
        name: "Lists",
        value: `Invite channels: ${config.inviteChannelIds.length}\nBlocked words: ${config.blockedWords.length}`,
      },
    );
}

function getAutoModFeature(
  value: string,
): AutoModFeature | null {
  return (
    AUTOMOD_FEATURES as readonly string[]
  ).includes(value)
    ? (value as AutoModFeature)
    : null;
}

function featureLabel(
  feature: AutoModFeature,
): string {
  const labels: Record<
    AutoModFeature,
    string
  > = {
    spam: "Anti-spam",
    flood: "Anti-flood",
    duplicates: "Duplicate messages",
    mentions: "Excessive mentions",
    invites: "Discord invites",
    blockedwords: "Blocked words",
    characters: "Excessive characters",
  };

  return labels[feature];
}

/* ─────────────────────────────────────────────
   GENERAL HELPERS
───────────────────────────────────────────── */

async function requireGuild(
  interaction: import("discord.js").ChatInputCommandInteraction,
): Promise<Guild | null> {
  if (
    interaction.inGuild() &&
    interaction.guild
  ) {
    return interaction.guild;
  }

  await replyError(
    interaction,
    "This command can only be used inside a server.",
  );

  return null;
}

async function requirePermission(
  interaction: import("discord.js").ChatInputCommandInteraction,
  permission: PermissionResolvable,
): Promise<boolean> {
  if (
    interaction.memberPermissions?.has(
      permission,
    )
  ) {
    return true;
  }

  await replyError(
    interaction,
    "You do not have permission to use this moderation command.",
  );

  return false;
}

async function requireGiveawayPermission(
  interaction: import("discord.js").ChatInputCommandInteraction,
): Promise<boolean> {
  const permissions =
    interaction.memberPermissions;

  if (
    permissions?.has(
      PermissionFlagsBits.ManageGuild,
    ) ||
    permissions?.has(
      PermissionFlagsBits.ManageMessages,
    ) ||
    permissions?.has(
      PermissionFlagsBits.ModerateMembers,
    )
  ) {
    return true;
  }

  await replyError(
    interaction,
    "You need Manage Server, Manage Messages, or Moderate Members to manage giveaways.",
  );

  return false;
}

function formatGiveawayWinners(
  winners: string[],
): string {
  return winners.length
    ? `Winner${
        winners.length === 1 ? "" : "s"
      }: ${winners
        .map(
          (userId) => `<@${userId}>`,
        )
        .join(", ")}.`
    : "There were not enough eligible participants to select a winner.";
}

async function getTargetMember(
  interaction: import("discord.js").ChatInputCommandInteraction,
  guild: Guild,
): Promise<GuildMember | null> {
  const user =
    interaction.options.getUser(
      "user",
      true,
    );

  const target =
    await guild.members
      .fetch(user.id)
      .catch(() => null);

  if (target) return target;

  await replyError(
    interaction,
    "That user is not a current member of this server.",
  );

  return null;
}

async function checkTargetHierarchy(
  interaction: import("discord.js").ChatInputCommandInteraction,
  guild: Guild,
  target: GuildMember,
): Promise<{
  allowed: boolean;
  reason?: string;
}> {
  const moderator =
    await guild.members
      .fetch(interaction.user.id)
      .catch(() => null);

  const botMember =
    guild.members.me ??
    (await guild.members
      .fetchMe()
      .catch(() => null));

  if (!moderator || !botMember) {
    return {
      allowed: false,
      reason:
        "I could not verify the server role hierarchy. Please try again.",
    };
  }

  return canModerateTarget(
    moderator,
    target,
    botMember,
  );
}

async function logModeration(
  guild: Guild,
  moderator: User,
  target: User | undefined,
  action: string,
  reason: string,
  channel?: string,
): Promise<void> {
  await sendModerationLog(
    guild,
    configStore.get(guild.id)
      .logsChannelId,
    {
      moderator: `<@${moderator.id}>`,
      target: target
        ? `<@${target.id}>`
        : "Channel messages",
      action,
      reason,
      channel,
    },
  ).catch(() => undefined);
}

async function replySuccess(
  interaction: import("discord.js").ChatInputCommandInteraction,
  message: string,
): Promise<void> {
  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(0x57f287)
        .setDescription(message),
    ],
    ephemeral: true,
  });
}

async function replyError(
  interaction: import("discord.js").ChatInputCommandInteraction,
  message: string,
): Promise<void> {
  const payload = {
    embeds: [
      new EmbedBuilder()
        .setColor(0xed4245)
        .setDescription(message),
    ],
    ephemeral: true,
  };

  if (
    interaction.replied ||
    interaction.deferred
  ) {
    await interaction.followUp(payload);
  } else {
    await interaction.reply(payload);
  }
}

/* ─────────────────────────────────────────────
   WELCOME / LEAVE
───────────────────────────────────────────── */

async function sendMemberEmbed(
  guild: Guild,
  eventConfig: EventConfig,
  member: MemberEvent,
  event: "welcome" | "leave",
): Promise<void> {
  const channel =
    await getTextChannel(
      guild,
      eventConfig.channelId,
    );

  if (!channel) {
    console.error(
      `Configured ${event} channel could not be found.`,
    );
    return;
  }

  const username =
    member.user.username;

  const placeholders = {
    user: `<@${member.id}>`,
    username,
    count: String(
      guild.memberCount,
    ),
    server: guild.name,
  };

  const embed =
    new EmbedBuilder()
      .setColor(eventConfig.color)
      .setTitle(
        replacePlaceholders(
          eventConfig.title,
          placeholders,
        ),
      )
      .setDescription(
        replacePlaceholders(
          eventConfig.message,
          placeholders,
        ),
      )
      .addFields(
        {
          name: "Username",
          value: username,
          inline: true,
        },
        {
          name: "Member count",
          value: String(
            guild.memberCount,
          ),
          inline: true,
        },
      )
      .setThumbnail(
        member.user.displayAvatarURL(),
      )
      .setTimestamp();

  await channel.send({
    embeds: [embed],
  });
}

async function sendMemberEventLog(
  guild: Guild,
  logsChannelId: string | undefined,
  member: MemberEvent,
  event: "join" | "leave",
): Promise<void> {
  await sendModerationLog(
    guild,
    logsChannelId,
    {
      moderator: "System",
      target: `<@${member.id}>`,
      action:
        event === "join"
          ? "Member joined"
          : "Member left",
      reason:
        event === "join"
          ? "Member joined the server."
          : "Member left the server.",
      channel: "Member events",
      color:
        event === "join"
          ? 0x57f287
          : 0xed4245,
    },
  ).catch(() => undefined);
}

function getDefaultEventConfig(
  event: "welcome" | "leave",
): EventConfig {
  if (event === "welcome") {
    return {
      channelId: "",
      title: "Welcome to {server}!",
      message:
        "Welcome {user} to the server!",
      color: 0x57f287,
    };
  }

  return {
    channelId: "",
    title:
      "{username} has left the server",
    message:
      "{username} has left the server.",
    color: 0xed4245,
  };
}

function parseColor(
  value: string,
): number | null {
  const normalized =
    value.startsWith("#")
      ? value.slice(1)
      : value;

  return /^[0-9a-fA-F]{6}$/.test(
    normalized,
  )
    ? Number.parseInt(
        normalized,
        16,
      )
    : null;
}

function replacePlaceholders(
  value: string,
  placeholders: Record<
    string,
    string
  >,
): string {
  return value.replace(
    /\{(user|username|count|server)\}/g,
    (_, key: string) =>
      placeholders[key] ??
      `{${key}}`,
  );
}

/* ─────────────────────────────────────────────
   SHUTDOWN
───────────────────────────────────────────── */

const shutdown = async (
  signal: string,
) => {
  console.log(
    `Received ${signal}; shutting down Discord bot.`,
  );

  client.destroy();
};

process.once("SIGINT", () =>
  void shutdown("SIGINT"),
);

process.once("SIGTERM", () =>
  void shutdown("SIGTERM"),
);

await client.login(token);