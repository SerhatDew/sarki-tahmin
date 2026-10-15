/**
 * src/commands/yardim.ts - /yardım Slash Komutu
 */

import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from "discord.js";
import { CONFIG } from "../config";
import { dataManager } from "../dataManager";

export const data = new SlashCommandBuilder()
  .setName("yardım")
  .setDescription("Oyun kuralları, kademeli puanlama ve komut rehberi.");

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const embed = new EmbedBuilder()
    .setTitle("Tahmin Oyunu — Nasıl Oynanır?")
    .setDescription(
      "Her oyun tek bir ortak panel kullanır. Tur, ipuçları, sonuç ve skorlar aynı mesajda güncellenir.\n\n" +
      "**Tahmin:** Herkes paneldeki `Tahmin Et` butonuyla kendi formunu açabilir. " +
      "Cevap ve geri bildirim yalnızca tahmini yapan oyuncuya görünür; kanala tahmin mesajı atılmaz. " +
      "İlk doğru cevap puanı kazanır. Önceki turdan açık kalan form yeni turda geçersizdir.\n\n" +
      "**Görsel mod:** Şarkı kartları, bayraklar ve eşyalar zamanla netleşir. " +
      "Dört şıklı modda cevabı doğrudan paneldeki seçeneklerden seçin.\n\n" +
      "**Sesli mod:** `/oyun` içinde şarkı kategorisini ve sesli modu seçin. " +
      "Bot ses kanalında kesit çalar; aynı kanalın sohbetindeki panelden `Tahmin Et` butonuna basın. " +
      "Yalnızca sanatçı adı değil, şarkının adı gerekir. Son oyuncu çıkınca oyun kapanır; boş kanalda başlamaz.\n\n" +
      "**Puanlama:** Seviye 5: 50, seviye 4: 40, seviye 3: 30, seviye 2: 20, seviye 1: 10 puan. " +
      `Her tur ${CONFIG.ROUND_DURATION} saniye sürer. Süre dolunca cevap açıklanır, puan verilmez.\n\n` +
      "**Panel kontrolleri:**\n" +
      "• `İpucu` / `Netleştir`: Bir seviye açar, turun değerini 10 puan düşürür.\n" +
      "• `Turu Atla`: Cevabı gösterir, puan vermez.\n" +
      "• `Bitir`: Oyunu ve varsa sesi kapatır, skor tablosunu gösterir.\n\n" +
      "**Komutlar:** `/oyun`, `/bitir`, `/sıralama`, `/profil`, `/yardım`."
    )
    .setColor(CONFIG.COLORS.PRIMARY)
    .setFooter({
      text: `Kütüphane: ${dataManager.songs.length} Şarkı, ${dataManager.flags.length} Bayrak, ${dataManager.minecraft.length} Minecraft Eşyası hazır!`
    });
  await interaction.reply({ embeds: [embed], ephemeral: true });
}
