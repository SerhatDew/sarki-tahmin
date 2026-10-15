/**
 * src/dataManager.ts - Veri Seti Yöneticisi ve Akıllı Tahmin Eşleştirici
 * Türkçe karakter normalizasyonu, Levenshtein benzerlik toleransı ve seçenek üretimi.
 */

import path from "path";
import fs from "fs";

export interface GameItem {
  id: string;
  name: string;
  aliases: string[];
  artist?: string;
  album?: string;
  year?: number;
  genre?: string;
  lyrics?: string;
}

export class DataManager {
  public flags: GameItem[] = [];
  public minecraft: GameItem[] = [];
  public songs: GameItem[] = [];

  constructor() {
    this.loadData();
  }

  private loadData(): void {
    const flagsPath = path.join(process.cwd(), "data", "flags.json");
    const mcPath = path.join(process.cwd(), "data", "minecraft.json");

    if (fs.existsSync(flagsPath)) {
      this.flags = JSON.parse(fs.readFileSync(flagsPath, "utf-8"));
    }
    if (fs.existsSync(mcPath)) {
      this.minecraft = JSON.parse(fs.readFileSync(mcPath, "utf-8"));
    }

    const songsPath = path.join(process.cwd(), "data", "songs.json");
    if (fs.existsSync(songsPath)) {
      this.songs = JSON.parse(fs.readFileSync(songsPath, "utf-8"));
    }
  }

  /**
   * Türkçe karakterleri ve özel işaretleri temizleyerek metni normalize eder.
   */
  public normalizeText(text: string): string {
    if (!text) return "";
    const map: Record<string, string> = {
      "I": "i", "ı": "i",
      "İ": "i", "i": "i",
      "Ş": "s", "ş": "s",
      "Ğ": "g", "ğ": "g",
      "Ü": "u", "ü": "u",
      "Ö": "o", "ö": "o",
      "Ç": "c", "ç": "c"
    };
    let normalized = "";
    for (const char of text) {
      normalized += map[char] ?? char.toLowerCase();
    }
    return normalized
      .replace(/[^\w\s]/g, " ")
      .replace(/(.)\1{2,}/g, "$1")
      .replace(/\s+/g, " ")
      .trim();
  }

  /**
   * Levenshtein benzerlik oranını hesaplar (0.0 - 1.0).
   */
  private calculateSimilarity(s1: string, s2: string): number {
    const longer = s1.length >= s2.length ? s1 : s2;
    const shorter = s1.length < s2.length ? s1 : s2;
    const longerLength = longer.length;
    if (longerLength === 0) return 1.0;

    const costs: number[] = [];
    for (let i = 0; i <= s1.length; i++) {
      let lastValue = i;
      for (let j = 0; j <= s2.length; j++) {
        if (i === 0) {
          costs[j] = j;
        } else if (j > 0) {
          const prev = costs[j - 1] ?? 0;
          const current = costs[j] ?? 0;
          let newValue = prev;
          if (s1.charAt(i - 1) !== s2.charAt(j - 1)) {
            newValue = Math.min(Math.min(newValue, lastValue), current) + 1;
          }
          costs[j - 1] = lastValue;
          lastValue = newValue;
        }
      }
      if (i > 0) costs[s2.length] = lastValue;
    }

    const endCost = costs[s2.length] ?? 0;
    return (longerLength - endCost) / longerLength;
  }

  /**
   * Belirtilen kategoriden rastgele bir eşya seçer.
   */
  public getRandomItem(category: string, excludedIds: string[] = []): GameItem {
    let pool: GameItem[];
    if (category === "flags") {
      pool = this.flags;
    } else if (category === "songs") {
      pool = this.songs;
    } else {
      pool = this.minecraft;
    }
    if (pool.length === 0) {
      throw new Error(`'${category}' kategorisinde veri bulunamadı!`);
    }

    if (excludedIds.length > 0) {
      const excludedSet = new Set(excludedIds);
      const available = pool.filter(item => !excludedSet.has(item.id));
      if (available.length > 0) {
        return available[Math.floor(Math.random() * available.length)]!;
      }
    }

    return pool[Math.floor(Math.random() * pool.length)]!;
  }

  /**
   * Kullanıcının yazdığı metnin doğru cevap veya geçerli bir alias olup olmadığını doğrular.
   */
  public checkGuess(item: GameItem, userGuess: string): boolean {
    const cleanGuess = this.normalizeText(userGuess);
    if (!cleanGuess || cleanGuess.length < 2) return false;

    const candidates = [item.name, ...(item.aliases || [])];
    const normCandidates = candidates.map(c => this.normalizeText(c)).filter(Boolean);

    // 1. Tam eşleşme
    if (normCandidates.includes(cleanGuess)) {
      return true;
    }

    // 2. Cümle içinde kelime öbeği olarak geçme (Regex word boundary)
    for (const cand of normCandidates) {
      if (cand.length >= 3) {
        const regex = new RegExp(`(?:^|\\s)${cand}(?:$|\\s)`);
        if (regex.test(cleanGuess)) {
          return true;
        }
      }
    }

    // 3. Yazım hatası toleransı (Fuzzy Levenshtein)
    for (const cand of normCandidates) {
      const sim = this.calculateSimilarity(cleanGuess, cand);
      const threshold = cand.length <= 4 ? 0.88 : 0.78;
      if (sim >= threshold) {
        return true;
      }
    }

    return false;
  }

  /**
   * Çoktan seçmeli mod için 1 doğru ve N-1 yanlış seçenek üretir.
   */
  public getMultipleChoiceOptions(category: string, correctItem: GameItem, count: number = 4): GameItem[] {
    let pool: GameItem[];
    if (category === "flags") {
      pool = this.flags;
    } else if (category === "songs") {
      pool = this.songs;
    } else {
      pool = this.minecraft;
    }
    const others = pool.filter(i => i.id !== correctItem.id);

    // Rastgele karıştır
    const shuffled = [...others].sort(() => 0.5 - Math.random());
    const distractors = shuffled.slice(0, count - 1);

    const options = [correctItem, ...distractors];
    return options.sort(() => 0.5 - Math.random());
  }
}

export const dataManager = new DataManager();
