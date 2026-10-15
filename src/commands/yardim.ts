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
    .setTitle("📖 Şarkı & Görsel Tahmin Sistemi — Nasıl Oynanır?")
    .setDescription(
      "Bu botta albüm kapakları, bayraklar ve eşyalar kademeli olarak blurlu (bulanık) şekilde ekrana gelir.\n" +
      "Şarkı modunda her turda müzik türü, çıkış yılı, sanatçı ve şarkı sözü ipuçları açılır!\n" +
      "Süre geçtikçe veya oyuncular tahmin yaptıkça görsel yavaş yavaş netleşir!\n\n" +
      "**Sesli mod:** `/oyun` içinde şarkı kategorisini ve sesli modu seçin. " +
      "Bot ses kanalında kesit çalar; şarkı adını aynı kanalın sohbetine yazın. " +
      "Kanalda `/bitir` ile sesi ve oturumu kapatabilirsiniz.\n\n" +
      "**🎯 Kademeli Puan Cetveli:**\n" +
      "• 🟥 **Seviye 5 (En Bulanık):** ⭐ **50 Puan** (Görsel neredeyse görünmezken)\n" +
      "• 🟧 **Seviye 4:** ⭐ **40 Puan**\n" +
      "• 🟨 **Seviye 3:** ⭐ **30 Puan**\n" +
      "• 🟦 **Seviye 2:** ⭐ **20 Puan**\n" +
      "• 🟩 **Seviye 1 (En Net):** ⭐ **10 Puan**\n" +
      "• ⬛ **Süre Bittiğinde (Seviye 0):** Orijinal görsel ifşa olur, puan verilmez.\n\n" +
      "**⚡ Oyun İçi Butonlar:**\n" +
      "• `🔍 Netleştir`: Görseli hemen 1 seviye açar (puan değeri 10 düşer).\n" +
      "• `⏩ Turu Atla`: Mevcut soruyu pas geçer.\n" +
      "• `⏹️ Bitir`: Oyunu sonlandırıp podyum grafiğini gösterir.\n\n" +
      "**🎮 Komutlar:**\n" +
      "• `/oyun` — Kategori ve mod seçerek oyunu başlatır.\n" +
      "• `/bitir` — Aktif oyunu kapatır.\n" +
      "• `/sıralama` — Sunucunun en yüksek puanlı oyuncuları.\n" +
      "• `/profil` — Kişisel istatistik kartınız."
    )
    .setColor(CONFIG.COLORS.PRIMARY)
    .setFooter({
      text: `Kütüphane: ${dataManager.songs.length} Şarkı, ${dataManager.flags.length} Bayrak, ${dataManager.minecraft.length} Minecraft Eşyası hazır!`
    });
  await interaction.reply({ embeds: [embed] });
}
