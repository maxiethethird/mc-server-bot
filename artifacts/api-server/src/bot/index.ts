import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  Events,
  type Interaction,
} from "discord.js";
import { logger } from "../lib/logger.js";
import { commands } from "./commands.js";
import { startServer, getStatus } from "./aternos.js";

const TOKEN = process.env["DISCORD_BOT_TOKEN"];

export function startBot() {
  if (!TOKEN) {
    logger.warn("DISCORD_BOT_TOKEN is not set — bot will not start.");
    return;
  }

  const client = new Client({ intents: [GatewayIntentBits.Guilds] });

  client.once(Events.ClientReady, async (readyClient) => {
    logger.info({ tag: readyClient.user.tag }, "Discord bot is ready");

    // Register slash commands globally (takes up to 1 hour to propagate)
    // If DISCORD_GUILD_ID is set, register to that guild instantly instead
    try {
      const rest = new REST().setToken(TOKEN!);
      const guildId = process.env["DISCORD_GUILD_ID"];
      const appId = readyClient.user.id;

      if (guildId) {
        await rest.put(Routes.applicationGuildCommands(appId, guildId), {
          body: commands,
        });
        logger.info({ guildId }, "Slash commands registered to guild (instant)");
      } else {
        await rest.put(Routes.applicationCommands(appId), { body: commands });
        logger.info("Slash commands registered globally (may take up to 1 hour)");
      }
    } catch (err) {
      logger.error({ err }, "Failed to register slash commands");
    }
  });

  client.on(Events.InteractionCreate, async (interaction: Interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const { commandName } = interaction;

    if (!["start", "status"].includes(commandName)) return;

    // Defer so we have time for the puppeteer automation (can take ~30s)
    await interaction.deferReply();

    logger.info({ commandName, user: interaction.user.tag }, "Command received");

    try {
      let result: string;

      if (commandName === "start") {
        result = await startServer();
      } else {
        result = await getStatus();
      }

      await interaction.editReply(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ err, commandName }, "Command failed");
      await interaction.editReply(
        `❌ **Error:** ${message}\n\nCheck that your Aternos credentials are correct.`
      );
    }
  });

  client.on(Events.Error, (err) => {
    logger.error({ err }, "Discord client error");
  });

  client.login(TOKEN).catch((err) => {
    logger.error({ err }, "Failed to login to Discord");
  });

  return client;
}
