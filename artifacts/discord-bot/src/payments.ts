import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  PermissionFlagsBits,
} from "discord.js";
import { randomUUID } from "crypto";
import {
  ConfigStore,
  PaymentRecord,
  PaymentStatus,
} from "./config-store.js";

const store = new ConfigStore();

function paymentId(): string {
  return randomUUID().split("-")[0].toUpperCase();
}

function paymentStatusLabel(status: PaymentStatus): string {
  switch (status) {
    case "verified":
      return "🟢 Verified";
    case "manual_verified":
      return "🟢 Manually Verified";
    case "rejected":
      return "🔴 Rejected";
    case "cancelled":
      return "⚫ Cancelled";
    case "unavailable":
      return "🟡 Verification Unavailable";
    default:
      return "🟠 Waiting for Verification";
  }
}

export async function handlePaymentCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const guild = interaction.guild;

  if (!guild) {
    await interaction.reply({
      content: "❌ This command can only be used inside a server.",
      ephemeral: true,
    });
    return;
  }

  const subcommand = interaction.options.getSubcommand();

  // /payment setup
  if (subcommand === "setup") {
    if (
      !interaction.memberPermissions?.has(
        PermissionFlagsBits.ManageGuild,
      )
    ) {
      await interaction.reply({
        content: "❌ You need Manage Server permission.",
        ephemeral: true,
      });
      return;
    }

    const channel = interaction.options.getChannel("logs", true);

    const config = store.getPaymentConfig(guild.id);
    config.logChannelId = channel.id;
    store.setPaymentConfig(guild.id, config);

    await interaction.reply({
      content: `✅ Payment logs will now be sent to <#${channel.id}>.`,
      ephemeral: true,
    });

    return;
  }

  // /payment profile
  if (subcommand === "profile") {
    const username = interaction.options.getString("username", true).trim();

    store.setMinecraftProfile(
      guild.id,
      interaction.user.id,
      username,
    );

    await interaction.reply({
      content: `✅ Your Minecraft profile has been saved as **${username}**.`,
      ephemeral: true,
    });

    return;
  }

  // /payment start
  if (subcommand === "start") {
    const buyer = interaction.options.getUser("buyer", true);
    const amount = interaction.options.getString("amount", true);
    const service = interaction.options.getString("service", true);
    const paymentType = interaction.options.getString(
      "paymenttype",
      true,
    );

    if (buyer.bot) {
      await interaction.reply({
        content: "❌ A bot cannot be the buyer.",
        ephemeral: true,
      });
      return;
    }

    if (buyer.id === interaction.user.id) {
      await interaction.reply({
        content: "❌ The buyer cannot be yourself.",
        ephemeral: true,
      });
      return;
    }

    const sellerMinecraft =
      store.getMinecraftProfile(guild.id, interaction.user.id);

    const buyerMinecraft =
      store.getMinecraftProfile(guild.id, buyer.id);

    const id = paymentId();

    const payment: PaymentRecord = {
      id,
      guildId: guild.id,
      sellerId: interaction.user.id,
      buyerId: buyer.id,
      sellerMinecraft: sellerMinecraft ?? undefined,
      buyerMinecraft: buyerMinecraft ?? undefined,
      amount,
      service,
      paymentType,
      status: "waiting",
      createdAt: new Date().toISOString(),
    };

    store.setPayment(payment);

    const embed = new EmbedBuilder()
      .setTitle("💰 Payment Verification")
      .setDescription(
        `Payment request **#${id}** has been created.`,
      )
      .addFields(
        {
          name: "👤 Seller",
          value: `<@${interaction.user.id}>${
            sellerMinecraft
              ? `\nMinecraft: **${sellerMinecraft}**`
              : "\nMinecraft: **Not linked**"
          }`,
          inline: true,
        },
        {
          name: "👤 Buyer",
          value: `<@${buyer.id}>${
            buyerMinecraft
              ? `\nMinecraft: **${buyerMinecraft}**`
              : "\nMinecraft: **Not linked**"
          }`,
          inline: true,
        },
        {
          name: "💵 Amount",
          value: `**${amount}**`,
          inline: true,
        },
        {
          name: "🔨 Service",
          value: service,
          inline: true,
        },
        {
          name: "💳 Payment Type",
          value: paymentType,
          inline: true,
        },
        {
          name: "📊 Status",
          value: paymentStatusLabel(payment.status),
          inline: true,
        },
      )
      .setFooter({
        text: `Payment ID: ${id}`,
      })
      .setTimestamp();

    const paymentConfig = store.getPaymentConfig(guild.id);

if (paymentConfig.logChannelId) {
  const logChannel = await guild.channels.fetch(
    paymentConfig.logChannelId,
  );

  if (logChannel?.isTextBased()) {
    await logChannel.send({
      embeds: [embed],
    });
  }
}

await interaction.reply({
  content: `✅ Payment **#${id}** has been created and logged.`,
  ephemeral: true,
});

    return;
  }

  // /payment status
  if (subcommand === "status") {
    const id = interaction.options
      .getString("payment", true)
      .trim()
      .toUpperCase();

    const payment = store.getPayment(guild.id, id);

    if (!payment) {
      await interaction.reply({
        content: `❌ Payment **#${id}** was not found.`,
        ephemeral: true,
      });
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle("💰 Payment Status")
      .addFields(
        {
          name: "Payment ID",
          value: `\`${payment.id}\``,
          inline: true,
        },
        {
          name: "Status",
          value: paymentStatusLabel(payment.status),
          inline: true,
        },
        {
          name: "Amount",
          value: payment.amount,
          inline: true,
        },
        {
          name: "Service",
          value: payment.service,
          inline: true,
        },
        {
          name: "Seller",
          value: `<@${payment.sellerId}>`,
          inline: true,
        },
        {
          name: "Buyer",
          value: `<@${payment.buyerId}>`,
          inline: true,
        },
      )
      .setTimestamp();

    await interaction.reply({
      embeds: [embed],
      ephemeral: true,
    });

    return;
  }

  // /payment cancel
  if (subcommand === "cancel") {
    const id = interaction.options
      .getString("payment", true)
      .trim()
      .toUpperCase();

    const payment = store.getPayment(guild.id, id);

    if (!payment) {
      await interaction.reply({
        content: `❌ Payment **#${id}** was not found.`,
        ephemeral: true,
      });
      return;
    }

    if (
      payment.sellerId !== interaction.user.id &&
      payment.buyerId !== interaction.user.id &&
      !interaction.memberPermissions?.has(
        PermissionFlagsBits.ManageGuild,
      )
    ) {
      await interaction.reply({
        content: "❌ You are not allowed to cancel this payment.",
        ephemeral: true,
      });
      return;
    }

    if (
      payment.status === "verified" ||
      payment.status === "manual_verified"
    ) {
      await interaction.reply({
        content: "❌ A verified payment cannot be cancelled.",
        ephemeral: true,
      });
      return;
    }

    store.updatePayment(guild.id, id, (record: PaymentRecord) => {
    record.status = "cancelled";
      record.cancelledAt = new Date().toISOString();
      record.cancelledBy = interaction.user.id;
    });

    await interaction.reply({
      content: `⚫ Payment **#${id}** has been cancelled.`,
    });

    return;
  }

  // /payment verify
  if (subcommand === "verify") {
    if (
      !interaction.memberPermissions?.has(
        PermissionFlagsBits.ManageGuild,
      )
    ) {
      await interaction.reply({
        content: "❌ You need Manage Server permission.",
        ephemeral: true,
      });
      return;
    }

    const id = interaction.options
      .getString("payment", true)
      .trim()
      .toUpperCase();

    const reason = interaction.options.getString("reason", true);

    const payment = store.getPayment(guild.id, id);

    if (!payment) {
      await interaction.reply({
        content: `❌ Payment **#${id}** was not found.`,
        ephemeral: true,
      });
      return;
    }

    store.updatePayment(guild.id, id, (record: PaymentRecord) => {
      record.status = "manual_verified";
      record.verifiedAt = new Date().toISOString();
      record.verificationSource = "Manual staff verification";
      record.reviewBy = interaction.user.id;
      record.reviewReason = reason;
    });

    await interaction.reply({
      content:
        `🟢 Payment **#${id}** has been manually verified.\n` +
        `**Reason:** ${reason}`,
    });

    return;
  }

  // /payment reject
  if (subcommand === "reject") {
    if (
      !interaction.memberPermissions?.has(
        PermissionFlagsBits.ManageGuild,
      )
    ) {
      await interaction.reply({
        content: "❌ You need Manage Server permission.",
        ephemeral: true,
      });
      return;
    }

    const id = interaction.options
      .getString("payment", true)
      .trim()
      .toUpperCase();

    const reason = interaction.options.getString("reason", true);

    const payment = store.getPayment(guild.id, id);

    if (!payment) {
      await interaction.reply({
        content: `❌ Payment **#${id}** was not found.`,
        ephemeral: true,
      });
      return;
    }

    store.updatePayment(guild.id, id, (record: PaymentRecord) => {
    record.status = "rejected";
      record.reviewBy = interaction.user.id;
      record.reviewReason = reason;
      record.verificationSource = "Staff review";
    });

    await interaction.reply({
      content:
        `🔴 Payment **#${id}** has been rejected.\n` +
        `**Reason:** ${reason}`,
    });

    return;
  }
}