# Discord Bot Starter

A minimal TypeScript Node.js project for building a Discord bot with `discord.js`.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm --filter @workspace/discord-bot run dev` — run the Discord bot with hot reload
- `pnpm --filter @workspace/discord-bot run typecheck` — typecheck the Discord bot
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)
- Bot: `discord.js` with TypeScript and dotenv

## Where things live

- `artifacts/discord-bot/src/index.ts` — Discord client entry point
- `artifacts/discord-bot/.env.example` — required local environment variable
- `artifacts/discord-bot/README.md` — bot setup and run instructions

## Architecture decisions

- The Discord bot is an independent workspace package so it can run separately from the API server.
- The bot uses only the `Guilds` gateway intent in the starter to avoid requesting privileged intents before they are needed.
- The token is read from `DISCORD_TOKEN`; it is never committed to source control.

## Product

The project currently provides a ready-to-extend Discord bot process that connects to Discord and confirms readiness in its logs.

## User preferences

No additional preferences recorded.

## Gotchas

- Create a local `.env` from `.env.example` before starting the bot.
- Never commit `.env` or expose the Discord token.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
