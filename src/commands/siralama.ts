/**
 * src/commands/siralama.ts - /sıralama Slash Komutu
 */

import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from "discord.js";
import { db } from "../database";
import { CONFIG } from "../config";

export const data = new SlashCommandBuilder()
  .setName("sıralama")
  .setDescription("Sunucunun en iyi tahmincilerini listeler.");

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const guildId = interaction.guildId || "0";
  const leaders = db.getLeaderboard(guildId, 10);

  const embed = new EmbedBuilder()
    .setTitle("🏆 SUNUCU LİDERLİK TABLOSU (TOP 10)")
    .setDescription("Sunucunun en hızlı ve en çok puan toplayan oyuncuları:\n")
    .setColor(CONFIG.COLORS.GOLD)
    .setFooter({ text: "Kendi profilinizi görüntülemek için: /profil" });

  if (leaders.length === 0) {
    embed.setDescription(
      embed.data.description +
        "\n*Henüz bu sunucuda kayıtlı bir oyun puanı yok! `/oyun` yazarak ilk oyunu başlatabilirsiniz.*"
    );
  } else {
    const medals = ["🥇", "🥈", "🥉", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"];
    const firstLeader = leaders[0];
    const maxScore = firstLeader ? Math.max(1, firstLeader.total_score) : 1;
    let desc = "";

    leaders.forEach((p, idx) => {
      const medal = medals[idx] ?? "▫️";
      const ratio = p.total_score / maxScore;
      const barLen = Math.max(1, Math.floor(ratio * 8));
      const progBar = "█".repeat(barLen) + "░".repeat(8 - barLen);

      desc +=
        `${medal} **${p.username}** — **${p.total_score} Puan**\n` +
        `     \`[${progBar}]\` • ✅ **${p.correct_guesses}** Doğru • 🏆 **${p.games_won}** Birincilik\n`;
    });

    embed.setDescription(embed.data.description + desc);
  }

  await interaction.reply({ embeds: [embed] });
}
