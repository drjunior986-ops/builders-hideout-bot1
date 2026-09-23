# Discord Bot

A blank Node.js Discord bot starter using TypeScript and `discord.js`.

## Setup

1. Create a bot in the [Discord Developer Portal](https://discord.com/developers/applications).
2. Copy `.env.example` to `.env`.
3. Set `DISCORD_TOKEN` to the bot token from the Developer Portal.
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

The starter connects with the `Guilds` intent and logs in when the bot is ready. Add commands and event handlers in `src/index.ts` as the bot grows.