import "dotenv/config";
import { Client, Events, GatewayIntentBits } from "discord.js";

const token = process.env["DISCORD_TOKEN"];

if (!token) {
  throw new Error(
    "DISCORD_TOKEN is required. Add it to your environment or a local .env file.",
  );
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Discord bot logged in as ${readyClient.user.tag}`);
});

const shutdown = async (signal: string) => {
  console.log(`Received ${signal}; shutting down Discord bot.`);
  client.destroy();
};

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

await client.login(token);