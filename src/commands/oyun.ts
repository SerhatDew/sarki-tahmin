/**
 * src/commands/oyun.ts - /oyun Slash Komutu
 */

import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  TextChannel,
  VoiceChannel,
  ChannelType
} from "discord.js";
import { GameSession, activeSessions } from "../gameSession";
import { CONFIG } from "../config";
import { startVoiceGame } from "../voiceGame";

export const data = new SlashCommandBuilder()
  .setName("oyun")
  .setDescription("Şarkı, bayrak veya Minecraft tahmin oyunu başlatır.")
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
        { name: "Sohbetten tahmin", value: "chat" },
        { name: "Dört şıklı tahmin", value: "buttons" },
        { name: "Sesli şarkı tahmini", value: "voice" }
      )
  )
  .addIntegerOption(option =>
    option
      .setName("tur_sayisi")
      .setDescription("Toplam tur sayısı (Varsayılan: 10)")
      .setRequired(false)
      .setMinValue(3)
      .setMaxValue(30)
  )
  .addChannelOption(option =>
    option
      .setName("ses_kanali")
      .setDescription("Sesli oyun kanalı; seçilmezse bulunduğunuz ses kanalı kullanılır")
      .addChannelTypes(ChannelType.GuildVoice)
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const category = interaction.options.getString("kategori", true);
  const mode = interaction.options.getString("mod") || "chat";
  const rounds = interaction.options.getInteger("tur_sayisi") || CONFIG.DEFAULT_ROUNDS;
  if (mode === "voice") {
    if (category !== "songs") {
      await interaction.reply({ content: "Sesli mod yalnızca şarkı kategorisinde kullanılabilir.", ephemeral: true });
      return;
    }
    const selected = interaction.options.getChannel("ses_kanali");
    const target = selected ?? (interaction.inCachedGuild() ? interaction.member.voice.channel : null);
    if (!(target instanceof VoiceChannel)) {
      await interaction.reply({ content: "Bir ses kanalına katılın veya ses_kanali seçeneğini kullanın.", ephemeral: true });
      return;
    }
    await interaction.deferReply();
    try {
      await startVoiceGame(target, interaction.user, rounds);
      await interaction.editReply(`Sesli oyun <#${target.id}> kanalında başladı. Tahminleri o kanalın sohbetine yazın.`);
    } catch (error) {
      await interaction.editReply(error instanceof Error ? error.message : "Sesli oyun başlatılamadı.");
    }
    return;
  }
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


  await interaction.reply({
    content: `✅ **${interaction.user.displayName}** tarafından oyun oturumu başlatıldı!`,
    ephemeral: false
  });

  const session = new GameSession(channel, interaction.user, category, mode, rounds);
  activeSessions.set(channel.id, session);
  await session.start();
}
