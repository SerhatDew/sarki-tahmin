/**
 * src/index.ts - Discord Bot Ana Giriş Noktası (TypeScript & Bun)
 * Slash komutlarını yükler, senkronize eder ve mesaj dinleyicisini yönlendirir.
 */

import {
  Client,
  GatewayIntentBits,
  ActivityType,
  REST,
  Routes,
  ChatInputCommandInteraction,
  Events,
  VoiceChannel
} from "discord.js";
import { CONFIG } from "./config";
import { activeSessions } from "./gameSession";
import { dataManager } from "./dataManager";
import { startVoiceGame } from "./voiceGame";

import * as oyunCmd from "./commands/oyun";
import * as bitirCmd from "./commands/bitir";
import * as siralamaCmd from "./commands/siralama";
import * as profilCmd from "./commands/profil";
import * as yardimCmd from "./commands/yardim";

interface BotCommand {
  data: { name: string; toJSON: () => unknown };
  execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
}
const commands = new Map<string, BotCommand>();
commands.set(oyunCmd.data.name, oyunCmd);
commands.set(bitirCmd.data.name, bitirCmd);
commands.set(siralamaCmd.data.name, siralamaCmd);
commands.set(profilCmd.data.name, profilCmd);
commands.set(yardimCmd.data.name, yardimCmd);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates
  ]
});

client.once(Events.ClientReady, async () => {
  console.log("=".repeat(60));
  console.log(`[*] BOT AKTIF (TypeScript / Bun): ${client.user?.tag} (ID: ${client.user?.id})`);
  console.log(`[*] Sunucu Sayisi: ${client.guilds.cache.size}`);
  console.log(`[*] Yuklu Sarkilar: ${dataManager.songs.length} adet`);
  console.log(`[*] Yuklu Bayraklar: ${dataManager.flags.length} adet`);
  console.log(`[*] Yuklu Minecraft Esyalari: ${dataManager.minecraft.length} adet`);
  console.log("=".repeat(60));

  // Slash komutlarını senkronize et
  try {
    const rest = new REST({ version: "10" }).setToken(CONFIG.BOT_TOKEN);
    const commandData = Array.from(commands.values()).map(c => c.data.toJSON());
    console.log(`[*] ${commandData.length} adet Slash komutu Discord API'ye kaydediliyor...`);
    
    await rest.put(
      Routes.applicationCommands(client.user!.id),
      { body: commandData }
    );
    console.log("[+] Slash komutlari basariyla senkronize edildi!");
  } catch (error) {
    console.error("[-] Slash komut senkronizasyon hatasi:", error);
  }

  // Durum mesaji
  client.user?.setActivity("🎵 Şarkı, 🎌 Bayrak & ⛏️ Minecraft | /oyun", {
    type: ActivityType.Competing
  });
  await startConfiguredVoiceGame();
});

async function startConfiguredVoiceGame(): Promise<void> {
  if (!CONFIG.VOICE_CHANNEL_ID || activeSessions.has(CONFIG.VOICE_CHANNEL_ID)) return;
  try {
    const channel = await client.channels.fetch(CONFIG.VOICE_CHANNEL_ID);
    if (!(channel instanceof VoiceChannel)) {
      throw new Error("VOICE_CHANNEL_ID erişilebilir bir sunucu ses kanalı olmalı.");
    }
    await startVoiceGame(channel, client.user!, CONFIG.DEFAULT_ROUNDS);
    console.log(`Sesli oyun aktif: ${channel.name} (${channel.id})`);
  } catch (error) {
    console.error("Otomatik sesli oyun açılamadı:", error instanceof Error ? error.message : error);
  }
}

client.on(Events.GuildCreate, () => {
  void startConfiguredVoiceGame();
});

client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const command = commands.get(interaction.commandName);
  if (!command) return;

  try {
    await command.execute(interaction);
  } catch (error) {
    console.error(`[-] '${interaction.commandName}' komutu yurutulurken hata:`, error);
    const reply = {
      content: "⚠️ Komut calistirilirken beklenmeyen bir hata olustu!",
      ephemeral: true
    };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(reply);
    } else {
      await interaction.reply(reply);
    }
  }
});

client.on("messageCreate", async message => {
  if (message.author.bot) return;

  const channelId = message.channelId;
  const session = activeSessions.get(channelId);

  if (session && session.isRunning && !session.roundFinished) {
    try {
      await session.handleChatGuess(message);
    } catch (error) {
      console.error("Tahmin işlenemedi:", error);
      await session.endGame("Oyun hatası nedeniyle oturum kapatıldı.").catch(console.error);
    }
  }
});

function main() {
  if (!CONFIG.BOT_TOKEN || CONFIG.BOT_TOKEN === "BURAYA_BOT_TOKENI_GIRIN") {
    console.log("\n" + "!".repeat(65));
    console.log("[UYARI] Discord Bot Token'i bulunamadi!");
    console.log("Lutfen proje dizinindeki '.env' dosyasini acip tokeninizi girin:");
    console.log("DISCORD_TOKEN=Bot_Tokeniniz_Buraya");
    console.log("!".repeat(65) + "\n");
    return;
  }

  console.log("[*] TypeScript / discord.js botu baslatiliyor...");
  void client.login(CONFIG.BOT_TOKEN).catch(error => {
    console.error("Bot bağlanamadı:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}

main();
