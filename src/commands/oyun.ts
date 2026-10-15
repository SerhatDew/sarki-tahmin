/**
 * src/commands/oyun.ts - /oyun Slash Komutu
 */

import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  TextChannel
} from "discord.js";
import { GameSession, activeSessions } from "../gameSession";
import { CONFIG } from "../config";

export const data = new SlashCommandBuilder()
  .setName("oyun")
  .setDescription("Yeni bir kademeli görsel tahmin oyunu başlatır.")
  .addStringOption(option =>
    option
      .setName("kategori")
      .setDescription("Oyun kategorisini seçin")
      .setRequired(true)
      .addChoices(
        { name: "🎵 Şarkı ve Müzik", value: "songs" },
        { name: "⛏️ Minecraft Eşyaları", value: "minecraft" },
        { name: "🎌 Ülke Bayrakları", value: "flags" },
        { name: "🎲 Karışık (Şarkı, Bayrak & Minecraft)", value: "mixed" }
      )
  )
  .addStringOption(option =>
    option
      .setName("mod")
      .setDescription("Tahmin yöntemini seçin")
      .setRequired(false)
      .addChoices(
        { name: "💬 Sohbet Modu (Mesajla Hızlı Tahmin)", value: "chat" },
        { name: "🔘 Buton Modu (4 Şıklı Çoktan Seçmeli)", value: "buttons" }
      )
  )
  .addIntegerOption(option =>
    option
      .setName("tur_sayisi")
      .setDescription("Toplam tur sayısı (Varsayılan: 10)")
      .setRequired(false)
      .setMinValue(3)
      .setMaxValue(30)
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const channel = interaction.channel;
  if (!channel || !(channel instanceof TextChannel)) {
    await interaction.reply({
      content: "⚠️ Bu komut yalnızca sunucu metin kanallarında kullanılabilir!",
      ephemeral: true
    });
    return;
  }

  if (activeSessions.has(channel.id) && activeSessions.get(channel.id)!.isRunning) {
    await interaction.reply({
      content: "⚠️ Bu kanalda zaten devam eden bir oyun var! Önce `/bitir` ile kapatabilirsiniz.",
      ephemeral: true
    });
    return;
  }

  const category = interaction.options.getString("kategori", true);
  const mode = interaction.options.getString("mod") || "chat";
  const rounds = interaction.options.getInteger("tur_sayisi") || CONFIG.DEFAULT_ROUNDS;

  await interaction.reply({
    content: `✅ **${interaction.user.displayName}** tarafından oyun oturumu başlatıldı!`,
    ephemeral: false
  });

  const session = new GameSession(channel, interaction.user, category, mode, rounds);
  activeSessions.set(channel.id, session);
  await session.start();
}
