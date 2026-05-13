# Minecraft Server Starter Bot

A Discord bot that starts, stops, and checks the status of an Aternos Minecraft server using slash commands.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server + Discord bot (port 8080)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- Discord: discord.js v14
- Aternos automation: Puppeteer (headless Chromium)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/api-server/src/bot/index.ts` — Discord client setup, command handler
- `artifacts/api-server/src/bot/commands.ts` — Slash command definitions
- `artifacts/api-server/src/bot/aternos.ts` — Puppeteer automation for Aternos login/start/stop/status
- `artifacts/api-server/src/index.ts` — Entry point, starts Express + bot

## Discord Commands

- `/start` — Starts the Aternos Minecraft server
- `/stop` — Stops the Aternos Minecraft server
- `/status` — Shows server status, IP address, and player count

## Required Secrets

| Secret | Description |
|---|---|
| `DISCORD_BOT_TOKEN` | Your Discord bot token |
| `ATERNOS_USERNAME` | Your Aternos account username |
| `ATERNOS_PASSWORD` | Your Aternos account password |

## Optional Env Vars

- `DISCORD_GUILD_ID` — Set this to your Discord server ID for instant slash command registration (instead of waiting up to 1 hour for global propagation). Great for testing.

## Architecture decisions

- The Discord bot runs inside the same process as the Express server so it stays alive on a single deployment.
- Puppeteer (headless Chromium) is used to automate Aternos since they have no official API. The browser is launched fresh per command and closed after to minimize memory usage.
- Slash commands are registered globally on bot startup. Set `DISCORD_GUILD_ID` for instant guild-scoped registration during development.

## Gotchas

- Global slash commands take up to 1 hour to appear in Discord after first startup. Use `DISCORD_GUILD_ID` for immediate testing.
- Puppeteer automation depends on Aternos' page structure — if they redesign their UI, selectors may need updating.
- Chromium is cached at `~/.cache/puppeteer` after the first `pnpm install` run.
- Each `/start`, `/stop`, or `/status` command launches a full browser session (~20–30 seconds). Discord's deferred reply handles the wait gracefully.

## User preferences

- Keep the Discord bot active in production (important).
