import {
  ApplicationCommandOptionType,
  ChannelType,
  PermissionFlagsBits,
} from "discord.js";

const featureChoices = [
  { name: "Spam", value: "spam" },
  { name: "Flood", value: "flood" },
  { name: "Duplicate messages", value: "duplicates" },
  { name: "Excessive mentions", value: "mentions" },
  { name: "Discord invites", value: "invites" },
  { name: "Blocked words", value: "blockedwords" },
  { name: "Excessive characters", value: "characters" },
];

const actionChoices = [
  { name: "Warn", value: "warn" },
  { name: "Timeout", value: "timeout" },
];

const channelOption = (name: string, description: string) => ({
  type: ApplicationCommandOptionType.Channel,
  name,
  description,
  required: true,
  channel_types: [ChannelType.GuildText],
});

const userOption = (name = "user", description = "The server member.") => ({
  type: ApplicationCommandOptionType.User,
  name,
  description,
  required: true,
});

const reasonOption = {
  type: ApplicationCommandOptionType.String,
  name: "reason",
  description: "Why this action is being taken.",
  required: true,
  max_length: 1000,
};

const featureOption = (required: boolean) => ({
  type: ApplicationCommandOptionType.String,
  name: "feature",
  description: "The AutoMod feature.",
  required,
  choices: featureChoices,
});

export const commands = [
  {
    name: "ping",
    description: "Check whether the bot is online.",
  },
  {
    name: "config",
    description: "Configure welcome, leave, and moderation log channels.",
    defaultMemberPermissions: PermissionFlagsBits.ManageGuild.toString(),
    options: [
      {
        type: ApplicationCommandOptionType.Subcommand,
        name: "welcome",
        description: "Configure the welcome channel and message.",
        options: [
          channelOption("channel", "Channel where welcome messages are sent."),
          {
            type: ApplicationCommandOptionType.String,
            name: "title",
            description: "Title shown in the welcome embed.",
            required: false,
            max_length: 256,
          },
          {
            type: ApplicationCommandOptionType.String,
            name: "message",
            description: "Message shown in the welcome embed.",
            required: false,
            max_length: 1000,
          },
          {
            type: ApplicationCommandOptionType.String,
            name: "color",
            description: "Color in hexadecimal format, such as #57F287.",
            required: false,
            max_length: 7,
          },
        ],
      },
      {
        type: ApplicationCommandOptionType.Subcommand,
        name: "leave",
        description: "Configure the leave channel and message.",
        options: [
          channelOption("channel", "Channel where leave messages are sent."),
          {
            type: ApplicationCommandOptionType.String,
            name: "title",
            description: "Title shown in the leave embed.",
            required: false,
            max_length: 256,
          },
          {
            type: ApplicationCommandOptionType.String,
            name: "message",
            description: "Message shown in the leave embed.",
            required: false,
            max_length: 1000,
          },
          {
            type: ApplicationCommandOptionType.String,
            name: "color",
            description: "Color in hexadecimal format, such as #ED4245.",
            required: false,
            max_length: 7,
          },
        ],
      },
      {
        type: ApplicationCommandOptionType.Subcommand,
        name: "logs",
        description: "Configure the moderation and member event log channel.",
        options: [channelOption("channel", "Channel where events are logged.")],
      },
    ],
  },
  {
    name: "warn",
    description: "Warn a server member.",
    defaultMemberPermissions: PermissionFlagsBits.ModerateMembers.toString(),
    options: [userOption(), reasonOption],
  },
  {
    name: "warnings",
    description: "View a server member's warnings.",
    defaultMemberPermissions: PermissionFlagsBits.ModerateMembers.toString(),
    options: [userOption()],
  },
  {
    name: "clearwarnings",
    description: "Remove all warnings from a server member.",
    defaultMemberPermissions: PermissionFlagsBits.ModerateMembers.toString(),
    options: [userOption()],
  },
  {
    name: "clear",
    description: "Delete recent messages from this channel.",
    defaultMemberPermissions: PermissionFlagsBits.ManageMessages.toString(),
    options: [
      {
        type: ApplicationCommandOptionType.Integer,
        name: "amount",
        description: "Number of messages to delete.",
        required: true,
        min_value: 1,
        max_value: 100,
      },
    ],
  },
  {
    name: "timeout",
    description: "Timeout a server member.",
    defaultMemberPermissions: PermissionFlagsBits.ModerateMembers.toString(),
    options: [
      userOption(),
      {
        type: ApplicationCommandOptionType.String,
        name: "duration",
        description: "Duration such as 10m, 1h, or 1d (maximum 28d).",
        required: true,
      },
      reasonOption,
    ],
  },
  {
    name: "kick",
    description: "Kick a server member.",
    defaultMemberPermissions: PermissionFlagsBits.KickMembers.toString(),
    options: [userOption(), reasonOption],
  },
  {
    name: "ban",
    description: "Ban a server member.",
    defaultMemberPermissions: PermissionFlagsBits.BanMembers.toString(),
    options: [userOption(), reasonOption],
  },
  {
    name: "unban",
    description: "Unban a user from the server.",
    defaultMemberPermissions: PermissionFlagsBits.BanMembers.toString(),
    options: [userOption("user", "The user to unban.")],
  },
  {
    name: "automod",
    description: "Configure and manage automatic moderation.",
    defaultMemberPermissions: PermissionFlagsBits.ManageGuild.toString(),
    options: [
      {
        type: ApplicationCommandOptionType.Subcommand,
        name: "setup",
        description: "Enable all AutoMod features with safe defaults.",
      },
      {
        type: ApplicationCommandOptionType.Subcommand,
        name: "status",
        description: "Show the current AutoMod configuration.",
      },
      {
        type: ApplicationCommandOptionType.Subcommand,
        name: "enable",
        description: "Enable one AutoMod feature.",
        options: [featureOption(true)],
      },
      {
        type: ApplicationCommandOptionType.Subcommand,
        name: "disable",
        description: "Disable one AutoMod feature.",
        options: [featureOption(true)],
      },
      {
        type: ApplicationCommandOptionType.Subcommand,
        name: "config",
        description: "View or update AutoMod thresholds and actions.",
        options: [
          featureOption(false),
          {
            type: ApplicationCommandOptionType.String,
            name: "action",
            description: "Action after a message is deleted.",
            required: false,
            choices: actionChoices,
          },
          {
            type: ApplicationCommandOptionType.Integer,
            name: "limit",
            description: "Message limit for spam, flood, or duplicate rules.",
            required: false,
            min_value: 2,
            max_value: 100,
          },
          {
            type: ApplicationCommandOptionType.Integer,
            name: "window",
            description: "Time window in seconds for rate rules.",
            required: false,
            min_value: 1,
            max_value: 300,
          },
          {
            type: ApplicationCommandOptionType.Integer,
            name: "mentions",
            description: "Maximum mentions allowed in one message.",
            required: false,
            min_value: 1,
            max_value: 50,
          },
          {
            type: ApplicationCommandOptionType.Integer,
            name: "characters",
            description: "Repeated-character threshold.",
            required: false,
            min_value: 3,
            max_value: 100,
          },
          {
            type: ApplicationCommandOptionType.Integer,
            name: "timeout",
            description: "AutoMod timeout duration in minutes.",
            required: false,
            min_value: 1,
            max_value: 40320,
          },
        ],
      },
      {
        type: ApplicationCommandOptionType.SubcommandGroup,
        name: "invitechannel",
        description: "Manage channels where invites are allowed.",
        options: [
          {
            type: ApplicationCommandOptionType.Subcommand,
            name: "add",
            description: "Allow invites in a channel.",
            options: [channelOption("channel", "Channel where invites are allowed.")],
          },
          {
            type: ApplicationCommandOptionType.Subcommand,
            name: "remove",
            description: "Block invites in a channel again.",
            options: [channelOption("channel", "Channel to remove from the allowlist.")],
          },
          {
            type: ApplicationCommandOptionType.Subcommand,
            name: "list",
            description: "List channels where invites are allowed.",
          },
        ],
      },
      {
        type: ApplicationCommandOptionType.SubcommandGroup,
        name: "blockedword",
        description: "Manage blocked words.",
        options: [
          {
            type: ApplicationCommandOptionType.Subcommand,
            name: "add",
            description: "Add a blocked word.",
            options: [
              {
                type: ApplicationCommandOptionType.String,
                name: "word",
                description: "Word to block.",
                required: true,
                max_length: 100,
              },
            ],
          },
          {
            type: ApplicationCommandOptionType.Subcommand,
            name: "remove",
            description: "Remove a blocked word.",
            options: [
              {
                type: ApplicationCommandOptionType.String,
                name: "word",
                description: "Word to remove.",
                required: true,
                max_length: 100,
              },
            ],
          },
          {
            type: ApplicationCommandOptionType.Subcommand,
            name: "list",
            description: "List blocked words.",
          },
        ],
      },
    ],
  },
  {
    name: "giveaway",
    description: "Create and manage Builders Hideout giveaways.",
    defaultMemberPermissions: PermissionFlagsBits.ManageGuild.toString(),
    options: [
      {
        type: ApplicationCommandOptionType.Subcommand,
        name: "start",
        description: "Start a new giveaway.",
        options: [
          {
            type: ApplicationCommandOptionType.String,
            name: "prize",
            description: "What the winner will receive.",
            required: true,
            max_length: 256,
          },
          {
            type: ApplicationCommandOptionType.String,
            name: "duration",
            description: "Duration such as 30s, 10m, 1h, or 7d.",
            required: true,
            max_length: 20,
          },
          {
            type: ApplicationCommandOptionType.Integer,
            name: "winners",
            description: "Number of winners to select.",
            required: true,
            min_value: 1,
            max_value: 100,
          },
          channelOption("channel", "Channel where the giveaway announcement is sent."),
          {
            type: ApplicationCommandOptionType.String,
            name: "description",
            description: "Optional announcement description. Markdown and line breaks are supported.",
            required: false,
            max_length: 3000,
          },
          {
            type: ApplicationCommandOptionType.Role,
            name: "requiredrole",
            description: "Optional role required to enter.",
            required: false,
          },
        ],
      },
      {
        type: ApplicationCommandOptionType.Subcommand,
        name: "end",
        description: "End an active or paused giveaway immediately.",
        options: [
          {
            type: ApplicationCommandOptionType.String,
            name: "giveaway",
            description: "Giveaway ID or the unique beginning of its ID.",
            required: true,
            max_length: 40,
          },
        ],
      },
      {
        type: ApplicationCommandOptionType.Subcommand,
        name: "reroll",
        description: "Select a new winner for an ended giveaway.",
        options: [
          {
            type: ApplicationCommandOptionType.String,
            name: "giveaway",
            description: "Giveaway ID or the unique beginning of its ID.",
            required: true,
            max_length: 40,
          },
        ],
      },
      {
        type: ApplicationCommandOptionType.Subcommand,
        name: "pause",
        description: "Pause an active giveaway countdown.",
        options: [
          {
            type: ApplicationCommandOptionType.String,
            name: "giveaway",
            description: "Giveaway ID or the unique beginning of its ID.",
            required: true,
            max_length: 40,
          },
        ],
      },
      {
        type: ApplicationCommandOptionType.Subcommand,
        name: "resume",
        description: "Resume a paused giveaway countdown.",
        options: [
          {
            type: ApplicationCommandOptionType.String,
            name: "giveaway",
            description: "Giveaway ID or the unique beginning of its ID.",
            required: true,
            max_length: 40,
          },
        ],
      },
      {
        type: ApplicationCommandOptionType.Subcommand,
        name: "list",
        description: "List active, paused, and recently ended giveaways.",
      },
    ],
  },
  
    {
      name: "payment",
      description: "Track and verify payments.",
      options: [
        {
          type: ApplicationCommandOptionType.Subcommand,
          name: "setup",
          description: "Configure payment logs.",
          options: [
            channelOption("logs", "Payment log channel.")
          ]
        },
        {
          type: ApplicationCommandOptionType.Subcommand,
          name: "profile",
          description: "Save Minecraft profile.",
          options: [
            {
              type: ApplicationCommandOptionType.String,
              name: "username",
              description: "Minecraft username.",
              required: true
            }
          ]
        },
        {
          type: ApplicationCommandOptionType.Subcommand,
          name: "start",
          description: "Start a payment.",
          options: [
            {
              type: ApplicationCommandOptionType.User,
              name: "buyer",
              description: "Buyer.",
              required: true
            },
            {
              type: ApplicationCommandOptionType.String,
              name: "amount",
              description: "Payment amount.",
              required: true
            },
            {
              type: ApplicationCommandOptionType.String,
              name: "service",
              description: "Service or item.",
              required: true
            },
            {
              type: ApplicationCommandOptionType.String,
              name: "paymenttype",
              description: "Payment type.",
              required: true
            }
          ]
        },
        {
          type: ApplicationCommandOptionType.Subcommand,
          name: "status",
          description: "Check a payment.",
          options: [
            {
              type: ApplicationCommandOptionType.String,
              name: "payment",
              description: "Payment ID.",
              required: true
            }
          ]
        },
        {
          type: ApplicationCommandOptionType.Subcommand,
          name: "cancel",
          description: "Cancel a payment.",
          options: [
            {
              type: ApplicationCommandOptionType.String,
              name: "payment",
              description: "Payment ID.",
              required: true
            }
          ]
        },
        {
          type: ApplicationCommandOptionType.Subcommand,
          name: "verify",
          description: "Verify a payment.",
          options: [
            {
              type: ApplicationCommandOptionType.String,
              name: "payment",
              description: "Payment ID.",
              required: true
            },
            {
              type: ApplicationCommandOptionType.String,
              name: "reason",
              description: "Verification reason.",
              required: true
            }
          ]
        },
        {
          type: ApplicationCommandOptionType.Subcommand,
          name: "reject",
          description: "Reject a payment.",
          options: [
            {
              type: ApplicationCommandOptionType.String,
              name: "payment",
              description: "Payment ID.",
              required: true
            },
            {
              type: ApplicationCommandOptionType.String,
              name: "reason",
              description: "Rejection reason.",
              required: true
            }
          ]
        }
      ]
    },
    {
    name: "ticket",
    description: "Create and manage private Builders Hideout support tickets.",
    options: [
      {
        type: ApplicationCommandOptionType.SubcommandGroup,
        name: "panel",
        description: "Manage ticket panels.",
        options: [
          {
            type: ApplicationCommandOptionType.Subcommand,
            name: "create",
            description: "Create a ticket panel.",
            options: [
              channelOption("channel", "Channel where the panel is sent."),
              {
                type: ApplicationCommandOptionType.String,
                name: "title",
                description: "Panel title.",
                required: true,
                max_length: 256,
              },
              {
                type: ApplicationCommandOptionType.String,
                name: "description",
                description: "Panel description.",
                required: true,
                max_length: 4000,
              },
            ],
          },
          {
            type: ApplicationCommandOptionType.Subcommand,
            name: "edit",
            description: "Edit an existing ticket panel.",
            options: [
              {
                type: ApplicationCommandOptionType.String,
                name: "panel",
                description: "Panel ID.",
                required: true,
                max_length: 40,
              },
              {
                type: ApplicationCommandOptionType.String,
                name: "title",
                description: "New panel title.",
                required: false,
                max_length: 256,
              },
              {
                type: ApplicationCommandOptionType.String,
                name: "description",
                description: "New panel description.",
                required: false,
                max_length: 4000,
              },
            ],
          },
          {
            type: ApplicationCommandOptionType.Subcommand,
            name: "delete",
            description: "Delete a ticket panel without changing existing tickets.",
            options: [
              {
                type: ApplicationCommandOptionType.String,
                name: "panel",
                description: "Panel ID.",
                required: true,
                max_length: 40,
              },
            ],
          },
          {
            type: ApplicationCommandOptionType.Subcommand,
            name: "list",
            description: "List configured ticket panels.",
          },
        ],
      },
      {
        type: ApplicationCommandOptionType.SubcommandGroup,
        name: "type",
        description: "Manage configurable ticket types.",
        options: [
          {
            type: ApplicationCommandOptionType.Subcommand,
            name: "add",
            description: "Add a ticket type.",
            options: [
              {
                type: ApplicationCommandOptionType.String,
                name: "key",
                description: "Stable key, such as billing or bug.",
                required: true,
                max_length: 32,
              },
              {
                type: ApplicationCommandOptionType.String,
                name: "name",
                description: "Displayed type name.",
                required: true,
                max_length: 100,
              },
              {
                type: ApplicationCommandOptionType.String,
                name: "description",
                description: "Displayed type description.",
                required: true,
                max_length: 100,
              },
              {
                type: ApplicationCommandOptionType.String,
                name: "emoji",
                description: "Optional emoji.",
                required: false,
                max_length: 10,
              },
              {
                type: ApplicationCommandOptionType.Channel,
                name: "category",
                description: "Optional category for created tickets.",
                required: false,
                channel_types: [ChannelType.GuildCategory],
              },
              {
                type: ApplicationCommandOptionType.String,
                name: "channelname",
                description: "Optional name template using {id}, {type}, or {user}.",
                required: false,
                max_length: 80,
              },
              {
                type: ApplicationCommandOptionType.Boolean,
                name: "preventduplicate",
                description: "Prevent multiple active tickets of this type per user.",
                required: false,
              },
            ],
          },
          {
            type: ApplicationCommandOptionType.Subcommand,
            name: "edit",
            description: "Edit a ticket type.",
            options: [
              {
                type: ApplicationCommandOptionType.String,
                name: "key",
                description: "Ticket type key.",
                required: true,
                max_length: 32,
              },
              {
                type: ApplicationCommandOptionType.String,
                name: "name",
                description: "New displayed name.",
                required: false,
                max_length: 100,
              },
              {
                type: ApplicationCommandOptionType.String,
                name: "description",
                description: "New displayed description.",
                required: false,
                max_length: 100,
              },
              {
                type: ApplicationCommandOptionType.String,
                name: "emoji",
                description: "New emoji.",
                required: false,
                max_length: 10,
              },
              {
                type: ApplicationCommandOptionType.Channel,
                name: "category",
                description: "New ticket category.",
                required: false,
                channel_types: [ChannelType.GuildCategory],
              },
              {
                type: ApplicationCommandOptionType.String,
                name: "channelname",
                description: "New name template.",
                required: false,
                max_length: 80,
              },
              {
                type: ApplicationCommandOptionType.Boolean,
                name: "preventduplicate",
                description: "Prevent duplicate active tickets.",
                required: false,
              },
            ],
          },
          {
            type: ApplicationCommandOptionType.Subcommand,
            name: "remove",
            description: "Remove a ticket type.",
            options: [
              {
                type: ApplicationCommandOptionType.String,
                name: "key",
                description: "Ticket type key.",
                required: true,
                max_length: 32,
              },
            ],
          },
          {
            type: ApplicationCommandOptionType.Subcommand,
            name: "list",
            description: "List ticket types.",
            options: [
              {
                type: ApplicationCommandOptionType.String,
                name: "key",
                description: "Ignored; kept for shared command parsing.",
                required: false,
                max_length: 32,
              },
            ],
          },
        ],
      },
      {
        type: ApplicationCommandOptionType.SubcommandGroup,
        name: "question",
        description: "Manage ticket questionnaire questions.",
        options: [
          {
            type: ApplicationCommandOptionType.Subcommand,
            name: "add",
            description: "Add a questionnaire question.",
            options: [
              {
                type: ApplicationCommandOptionType.String,
                name: "type",
                description: "Ticket type key.",
                required: true,
                max_length: 32,
              },
              {
                type: ApplicationCommandOptionType.String,
                name: "label",
                description: "Question label.",
                required: true,
                max_length: 45,
              },
              {
                type: ApplicationCommandOptionType.Boolean,
                name: "required",
                description: "Whether an answer is required.",
                required: false,
              },
              {
                type: ApplicationCommandOptionType.Integer,
                name: "maxlength",
                description: "Maximum answer length.",
                required: false,
                min_value: 1,
                max_value: 4000,
              },
              {
                type: ApplicationCommandOptionType.Integer,
                name: "order",
                description: "Question order.",
                required: false,
                min_value: 1,
                max_value: 100,
              },
              {
                type: ApplicationCommandOptionType.Boolean,
                name: "paragraph",
                description: "Use a multi-line answer field.",
                required: false,
              },
            ],
          },
          {
            type: ApplicationCommandOptionType.Subcommand,
            name: "edit",
            description: "Edit a questionnaire question.",
            options: [
              {
                type: ApplicationCommandOptionType.String,
                name: "type",
                description: "Ticket type key.",
                required: true,
                max_length: 32,
              },
              {
                type: ApplicationCommandOptionType.String,
                name: "question",
                description: "Question ID.",
                required: true,
                max_length: 40,
              },
              {
                type: ApplicationCommandOptionType.String,
                name: "label",
                description: "New question label.",
                required: false,
                max_length: 45,
              },
              {
                type: ApplicationCommandOptionType.Boolean,
                name: "required",
                description: "Whether an answer is required.",
                required: false,
              },
              {
                type: ApplicationCommandOptionType.Integer,
                name: "maxlength",
                description: "Maximum answer length.",
                required: false,
                min_value: 1,
                max_value: 4000,
              },
              {
                type: ApplicationCommandOptionType.Integer,
                name: "order",
                description: "Question order.",
                required: false,
                min_value: 1,
                max_value: 100,
              },
              {
                type: ApplicationCommandOptionType.Boolean,
                name: "paragraph",
                description: "Use a multi-line answer field.",
                required: false,
              },
            ],
          },
          {
            type: ApplicationCommandOptionType.Subcommand,
            name: "remove",
            description: "Remove a questionnaire question.",
            options: [
              {
                type: ApplicationCommandOptionType.String,
                name: "type",
                description: "Ticket type key.",
                required: true,
                max_length: 32,
              },
              {
                type: ApplicationCommandOptionType.String,
                name: "question",
                description: "Question ID.",
                required: true,
                max_length: 40,
              },
            ],
          },
          {
            type: ApplicationCommandOptionType.Subcommand,
            name: "list",
            description: "List questionnaire questions.",
            options: [
              {
                type: ApplicationCommandOptionType.String,
                name: "type",
                description: "Ticket type key.",
                required: true,
                max_length: 32,
              },
            ],
          },
        ],
      },
      {
        type: ApplicationCommandOptionType.SubcommandGroup,
        name: "role",
        description: "Manage staff roles for ticket types.",
        options: [
          {
            type: ApplicationCommandOptionType.Subcommand,
            name: "add",
            description: "Add a staff role.",
            options: [
              {
                type: ApplicationCommandOptionType.String,
                name: "type",
                description: "Ticket type key.",
                required: true,
                max_length: 32,
              },
              {
                type: ApplicationCommandOptionType.Role,
                name: "role",
                description: "Role that can access tickets of this type.",
                required: true,
              },
            ],
          },
          {
            type: ApplicationCommandOptionType.Subcommand,
            name: "remove",
            description: "Remove a staff role.",
            options: [
              {
                type: ApplicationCommandOptionType.String,
                name: "type",
                description: "Ticket type key.",
                required: true,
                max_length: 32,
              },
              {
                type: ApplicationCommandOptionType.Role,
                name: "role",
                description: "Role to remove.",
                required: true,
              },
            ],
          },
          {
            type: ApplicationCommandOptionType.Subcommand,
            name: "list",
            description: "List staff roles for a ticket type.",
            options: [
              {
                type: ApplicationCommandOptionType.String,
                name: "type",
                description: "Ticket type key.",
                required: true,
                max_length: 32,
              },
            ],
          },
        ],
      },
      {
        type: ApplicationCommandOptionType.Subcommand,
        name: "config",
        description: "Configure ticket logs and inactivity timers.",
        options: [
          {
            type: ApplicationCommandOptionType.Channel,
            name: "logs",
            description: "Private channel for ticket logs and transcripts.",
            required: false,
            channel_types: [ChannelType.GuildText],
          },
          {
            type: ApplicationCommandOptionType.Integer,
            name: "inactivityhours",
            description: "Hours before an inactivity warning.",
            required: false,
            min_value: 1,
            max_value: 720,
          },
          {
            type: ApplicationCommandOptionType.Integer,
            name: "warninghours",
            description: "Hours after the warning before auto-close.",
            required: false,
            min_value: 1,
            max_value: 168,
          },
        ],
      },
      {
        type: ApplicationCommandOptionType.Subcommand,
        name: "priority",
        description: "Set the priority of the current ticket.",
        options: [
          {
            type: ApplicationCommandOptionType.String,
            name: "priority",
            description: "Ticket priority.",
            required: true,
            choices: [
              { name: "🟢 Low", value: "low" },
              { name: "🔵 Normal", value: "normal" },
              { name: "🟠 High", value: "high" },
              { name: "🔴 Urgent", value: "urgent" },
            ],
          },
        ],
      },
      {
        type: ApplicationCommandOptionType.Subcommand,
        name: "adduser",
        description: "Give a user access to the current ticket.",
        options: [userOption("user", "User to add to this ticket.")],
      },
      {
        type: ApplicationCommandOptionType.Subcommand,
        name: "removeuser",
        description: "Remove a user from the current ticket.",
        options: [userOption("user", "User to remove from this ticket.")],
      },
      {
        type: ApplicationCommandOptionType.Subcommand,
        name: "rename",
        description: "Rename the current ticket channel.",
        options: [
          {
            type: ApplicationCommandOptionType.String,
            name: "name",
            description: "New channel name.",
            required: true,
            max_length: 90,
          },
        ],
      },
      {
        type: ApplicationCommandOptionType.Subcommand,
        name: "close",
        description: "Close the current ticket with a required reason.",
        options: [reasonOption],
      },
    ],
  },
];