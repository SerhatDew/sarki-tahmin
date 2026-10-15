/**
 * src/config.ts - Bot ve Oyun Yapılandırma Sabitleri
 */

import dotenv from "dotenv";
dotenv.config({ override: true });

export const CONFIG = {
  // Discord Bot Token
  BOT_TOKEN: process.env.DISCORD_TOKEN || process.env.BOT_TOKEN || "",
  VOICE_CHANNEL_ID: process.env.VOICE_CHANNEL_ID || "",
  
  // Komut Prefix
  COMMAND_PREFIX: process.env.COMMAND_PREFIX || "!",

  // Oyun Ayarları
  DEFAULT_ROUNDS: 10,
  ROUND_DURATION: 25,       // Tur süresi (saniye)
  BLUR_STEP_SECONDS: 5,     // Netleşme aralığı (saniye)

  // Blur Seviyeleri ve Piksel Yarıçapları
  BLUR_RADII: {
    5: 32, // En bulanık
    4: 22,
    3: 14,
    2: 7,
    1: 3,
    0: 0   // Kristal netlik (Açıldı)
  } as Record<number, number>,

  // Puan Tablosu
  POINTS_MAP: {
    5: 50,
    4: 40,
    3: 30,
    2: 20,
    1: 10,
    0: 0
  } as Record<number, number>,

  // Discord Renk Sabitleri
  COLORS: {
    PRIMARY: 0x5865F2,   // Blurple
    SUCCESS: 0x57F287,   // Yeşil
    WARNING: 0xFEE75C,   // Sarı
    DANGER: 0xED4245,    // Kırmızı
    GOLD: 0xF1C40F       // Altın
  }
};
