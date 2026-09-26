# Discord Bot

A blank Node.js Discord bot starter using TypeScript and `discord.js`.

## Setup

1. Create a bot in the [Discord Developer Portal](https://discord.com/developers/applications).
2. Enable the **Server Members Intent** and **Message Content Intent** under the bot's Privileged Gateway Intents.
3. Add `DISCORD_TOKEN` through Replit Secrets, or set it in a local `.env` file from `.env.example`.
4. Install dependencies from the workspace root:

   ```bash
   pnpm install
   ```

## Run

Start the bot with hot reload:

```bash
pnpm --filter @workspace/discord-bot dev
```

Run the typecheck:

```bash
pnpm --filter @workspace/discord-bot typecheck
```

The bot connects with the `Guilds`, `GuildMembers`, `GuildMessages`, and `MessageContent` intents and logs in when ready.

## Server configuration

Members with the **Manage Server** permission can configure the bot with slash commands:

```text
/config welcome channel:#welcome
/config leave channel:#goodbye
/config logs channel:#mod-log
```

The welcome and leave commands also accept optional `title`, `message`, and `color` values. Messages support these placeholders:

- `{user}` — member mention
- `{username}` — member username
- `{count}` — current server member count
- `{server}` — server name

Configuration is stored in `data/config.json` and is loaded again when the bot restarts.

## Moderation

Members need the corresponding Discord permission to use each manual command:

```text
/warn user:@member reason:...
/warnings user:@member
/clearwarnings user:@member
/clear amount:25
/timeout user:@member duration:10m reason:...
/kick user:@member reason:...
/ban user:@member reason:...
/unban user:@user
```

Moderators cannot act on themselves or on members with equal or higher roles. Every manual action is sent to the configured logs channel.

## AutoMod

Use `/automod setup` to enable all protections with safe defaults. Use `/automod status` to view the current configuration, `/automod enable` and `/automod disable` to toggle features, and `/automod config` to update thresholds and whether a violation warns or times out.

Invite allowlists and blocked words are managed with:

```text
/automod invitechannel add channel:#partners
/automod invitechannel remove channel:#partners
/automod invitechannel list
/automod blockedword add word:...
/automod blockedword remove word:...
/automod blockedword list
```

AutoMod ignores bots and staff members, respects role hierarchy, deletes violating messages, starts with warnings, and escalates repeated violations to timeouts. AutoMod settings, warning history, invite channels, and blocked words are all stored in `data/config.json`.

## Giveaways

Members with **Manage Server**, **Manage Messages**, or **Moderate Members** can manage giveaways. Create one with:

```text
/giveaway start prize:... duration:1h winners:1 channel:#giveaways
/giveaway start prize:... duration:7d winners:3 channel:#giveaways description:... requiredrole:@Builders
```

Durations support `30s`, `10m`, `1h`, `12h`, `1d`, and `7d` (up to 365 days). The announcement uses a Builders Hideout themed embed with a live Discord timestamp, participant count, optional Markdown description, required-role eligibility, and an **Enter Giveaway** button. Clicking the button again leaves the giveaway.

Management commands:

```text
/giveaway list
/giveaway pause giveaway:<id>
/giveaway resume giveaway:<id>
/giveaway end giveaway:<id>
/giveaway reroll giveaway:<id>
```

Giveaway records, participant IDs, message and channel IDs, descriptions, winners, statuses, and timers are persisted in `data/config.json`. Active timers are restored automatically when the bot restarts. Automatic endings and manual actions are recorded in the configured logs channel.

## Tickets

The ticket system is configured with slash commands and stores its data alongside the existing configuration in `data/config.json`. Staff configuration uses server-side checks for Manage Server, Manage Channels, Manage Messages, Moderate Members, or a configured ticket staff role; Administrator is not required.

Configure ticket types and questions first:

```text
/ticket type add key:billing name:Billing description:Payment and account help
/ticket role add type:billing role:@Support
/ticket question add type:billing label:What do you need help with? required:True paragraph:True
/ticket panel create channel:#support title:Builders Hideout Support description:Choose a ticket type below.
/ticket config logs:#ticket-logs
```

Ticket panels support multiple configurable types, private channels, staff roles, categories, custom questions, duplicate prevention, and questionnaire answers in the ticket embed and transcript.

Ticket members can use:

```text
/ticket priority priority:high
/ticket adduser user:@member
/ticket removeuser user:@member
/ticket rename name:billing-help
/ticket close reason:Resolved
```

Ticket controls provide the same actions through buttons, including modal-based close reasons and rename, User Select menus for access changes, and a priority selector. Closed tickets retain close history, transcript data, and can be reopened or deleted by staff.

Open tickets track meaningful user activity. After the configured inactivity period (48 hours by default), the bot sends a warning and then auto-closes after the configured warning period (24 hours by default). Open ticket timers are restored after restart. Transcripts are sent privately to the configured ticket logs channel.