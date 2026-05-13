import { SlashCommandBuilder } from "discord.js";

export const commands = [
  new SlashCommandBuilder()
    .setName("start")
    .setDescription("Start your Aternos Minecraft server"),

  new SlashCommandBuilder()
    .setName("stop")
    .setDescription("Stop your Aternos Minecraft server"),

  new SlashCommandBuilder()
    .setName("status")
    .setDescription("Check the status of your Aternos Minecraft server"),
].map((cmd) => cmd.toJSON());
