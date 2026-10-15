/**
 * src/commands/bitir.ts - /bitir Slash Komutu
 */

import { SlashCommandBuilder, ChatInputCommandInteraction } from "discord.js";
import { activeSessions } from "../gameSession";

export const data = new SlashCommandBuilder()
  .setName("bitir")
  .setDescription("Bu kanalda devam eden aktif tahmin oyununu sonlandırır.");

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const channelId = interaction.channelId;
  const session = activeSessions.get(channelId);

  if (!session || !session.isRunning) {
    await interaction.reply({
      content: "Bu kanalda aktif bir oyun bulunmuyor.",
      ephemeral: true
    });
    return;
  }

  await Promise.all([
    interaction.reply({ content: "Oyun sonlandırıldı.", ephemeral: true }),
    session.endGame("Kullanıcı tarafından bitirildi.")
  ]);
}
