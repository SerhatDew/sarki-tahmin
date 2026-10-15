/**
 * src/commands/profil.ts - /profil Slash Komutu
 */

import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from "discord.js";
import { db } from "../database";
import { dataManager } from "../dataManager";
import { CONFIG } from "../config";

export const data = new SlashCommandBuilder()
  .setName("profil")
  .setDescription("Kişisel tahmin istatistiklerinizi görüntüler.")
  .addUserOption(option =>
    option
      .setName("kullanici")
      .setDescription("İstatistiklerini görmek istediğiniz kullanıcı (İsteğe bağlı)")
      .setRequired(false)
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const target = interaction.options.getUser("kullanici") || interaction.user;
  const guildId = interaction.guildId || "0";
  const userStats = db.getUserProfile(target.id, guildId);

  const embed = new EmbedBuilder()
    .setTitle(`👤 ${target.displayName} — Oyuncu Kartı`)
    .setThumbnail(target.displayAvatarURL())
    .setColor(CONFIG.COLORS.PRIMARY)
    .setFooter({ text: "Şarkı/Görsel Tahmin Sistemi • /sıralama" });

  if (!userStats) {
    embed.setDescription(
      `**${target.displayName}** henüz bu sunucuda hiç tahmin oyununa katılmadı.\nHemen \`/oyun\` yazarak oynamaya başlayabilirsiniz!`
    );
  } else {
    const score = userStats.total_score;
    let rankBadge = "🥉 Çırak Tahminci";
    if (score >= 1000) rankBadge = "👑 Efsanevi Tahminci";
    else if (score >= 600) rankBadge = "💎 Elmas Tahminci";
    else if (score >= 300) rankBadge = "🥇 Usta Tahminci";
    else if (score >= 100) rankBadge = "🥈 Deneyimli Tahminci";

    const totalGuesses = userStats.correct_guesses + userStats.wrong_guesses;
    const accuracy = totalGuesses > 0 ? Math.floor((userStats.correct_guesses / totalGuesses) * 100) : 0;
    const accBars = "🟩".repeat(Math.floor(accuracy / 10)) + "⬛".repeat(10 - Math.floor(accuracy / 10));

    embed.setDescription(
      `**Unvan:** \`${rankBadge}\`\n**Sunucu Derecesi:** 🎖️ **#${userStats.rank}**\n\n`
    );

    embed.addFields(
      { name: "⭐ Toplam Skor", value: `**${userStats.total_score} Puan**`, inline: true },
      { name: "🏆 Birincilikler", value: `**${userStats.games_won} Oyun**`, inline: true },
      { name: "🎯 En Zor Başarı", value: `**Seviye ${userStats.best_level}** *(50 Puan)*`, inline: true },
      {
        name: "📊 Doğruluk Oranı",
        value: `\`[${accBars}]\` %${accuracy}\n(✅ ${userStats.correct_guesses} Doğru / ❌ ${userStats.wrong_guesses} Yanlış)`,
        inline: false
      },
      {
        name: "🎵 Şarkı Havuzu",
        value: `**${userStats.songs_guessed}** / ${dataManager.songs.length} Keşfedildi`,
        inline: true
      },
      {
        name: "🎌 Bayrak Havuzu",
        value: `**${userStats.flags_guessed}** / ${dataManager.flags.length} Keşfedildi`,
        inline: true
      },
      {
        name: "⛏️ Minecraft Havuzu",
        value: `**${userStats.minecraft_guessed}** / ${dataManager.minecraft.length} Keşfedildi`,
        inline: true
      },
      {
        name: "🎮 Toplam Oturum",
        value: `**${userStats.games_played}** Oyun Oynandı`,
        inline: true
      }
    );
  }

  await interaction.reply({ embeds: [embed] });
}
