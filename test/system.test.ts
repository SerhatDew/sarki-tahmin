/**
 * test/system.test.ts - TypeScript / Bun Entegrasyon Testi
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { dataManager } from "../src/dataManager";
import { imageProcessor } from "../src/imageProcessor";
import { AppDatabase } from "../src/database";

describe("TypeScript Şarkı/Görsel Tahmin Sistemi", () => {
  let db: AppDatabase;

  beforeEach(() => {
    db = new AppDatabase(":memory:");
  });

  afterEach(() => {
    db.close();
  });

  it("1. Veri setleri eksiksiz yüklenmeli", () => {
    expect(dataManager.flags.length).toBeGreaterThanOrEqual(50);
    expect(dataManager.minecraft.length).toBeGreaterThanOrEqual(50);
    expect(dataManager.songs.length).toBeGreaterThanOrEqual(40);
  });

  it("2. Akıllı tahmin, Türkçe karakter ve tolerans testi", () => {
    const itemFlag = dataManager.flags.find(f => f.id === "tr")!;
    const itemMc = dataManager.minecraft.find(m => m.id === "diamond_sword")!;
    const itemSong = dataManager.songs.find(s => s.id === "baris_manco_donence")!;

    // Bayrak
    expect(dataManager.checkGuess(itemFlag, "Türkiye")).toBe(true);
    expect(dataManager.checkGuess(itemFlag, "turkiye")).toBe(true);
    expect(dataManager.checkGuess(itemFlag, "turkey")).toBe(true);
    expect(dataManager.checkGuess(itemFlag, "bence türkiye bu")).toBe(true);
    expect(dataManager.checkGuess(itemFlag, "türkiyee")).toBe(true);
    expect(dataManager.checkGuess(itemFlag, "Almanya")).toBe(false);

    // Minecraft
    expect(dataManager.checkGuess(itemMc, "Elmas Kılıç")).toBe(true);
    expect(dataManager.checkGuess(itemMc, "diamond sword")).toBe(true);
    expect(dataManager.checkGuess(itemMc, "elmas kilic")).toBe(true);
    expect(dataManager.checkGuess(itemMc, "elmas klıç")).toBe(true);
    expect(dataManager.checkGuess(itemMc, "altın kılıç")).toBe(false);
    expect(dataManager.checkGuess(itemMc, "kılıç")).toBe(false);

    // Şarkı
    expect(dataManager.checkGuess(itemSong, "Dönence")).toBe(true);
    expect(dataManager.checkGuess(itemSong, "donence")).toBe(true);
    expect(dataManager.checkGuess(itemSong, "Barış Manço Dönence")).toBe(true);
    expect(dataManager.checkGuess(itemSong, "baris manco - donence")).toBe(true);
    expect(dataManager.checkGuess(itemSong, "dönenceee")).toBe(true);
    expect(dataManager.checkGuess(itemSong, "Gülpembe")).toBe(false);
  });

  it("3. Çoktan seçmeli seçenek üretimi", () => {
    const item = dataManager.minecraft[0]!;
    const options = dataManager.getMultipleChoiceOptions("minecraft", item, 4);

    expect(options.length).toBe(4);
    expect(options.some(o => o.id === item.id)).toBe(true);

    const uniqueIds = new Set(options.map(o => o.id));
    expect(uniqueIds.size).toBe(4);

    const songItem = dataManager.songs[0]!;
    const songOptions = dataManager.getMultipleChoiceOptions("songs", songItem, 4);
    expect(songOptions.length).toBe(4);
    expect(songOptions.some(o => o.id === songItem.id)).toBe(true);
  });

  it("4. Kademeli blur ve kart üretimi (0 - 5)", async () => {
    for (let lvl = 0; lvl <= 5; lvl++) {
      const flagBuf = await imageProcessor.getBlurredImageBuffer("flags", "tr", lvl);
      expect(flagBuf).toBeInstanceOf(Buffer);
      expect(flagBuf.length).toBeGreaterThan(1000);

      const mcBuf = await imageProcessor.getBlurredImageBuffer("minecraft", "diamond_sword", lvl, "Elmas Kılıç");
      expect(mcBuf).toBeInstanceOf(Buffer);
      expect(mcBuf.length).toBeGreaterThan(1000);

      const songBuf = await imageProcessor.getBlurredImageBuffer("songs", "baris_manco_donence", lvl, "Dönence");
      expect(songBuf).toBeInstanceOf(Buffer);
      expect(songBuf.length).toBeGreaterThan(1000);
    }
  });

  it("5. Podyum görseli üretimi", () => {
    const scores = new Map<string, { username: string; score: number }>();
    scores.set("1", { username: "Oyuncu1", score: 180 });
    scores.set("2", { username: "Oyuncu2", score: 120 });
    scores.set("3", { username: "Oyuncu3", score: 80 });

    const podiumBuffer = imageProcessor.generateScoreboardImage(scores, "🎵 Şarkı ve Müzik", 10);
    expect(podiumBuffer).toBeInstanceOf(Buffer);
    expect(podiumBuffer.length).toBeGreaterThan(5000);
  });

  it("6. SQLite Veritabanı ve Puanlama", () => {
    db.recordGuess("user1", "guild1", "Ali", "songs", 5, 50, true);
    db.recordGuess("user1", "guild1", "Ali", "songs", 4, 40, true);
    db.recordGuess("user2", "guild1", "Veli", "songs", 3, 0, false);

    const p1 = db.getUserProfile("user1", "guild1");
    expect(p1).not.toBeNull();
    expect(p1!.total_score).toBe(90);
    expect(p1!.correct_guesses).toBe(2);
    expect(p1!.wrong_guesses).toBe(0);
    expect(p1!.songs_guessed).toBe(2);

    const p2 = db.getUserProfile("user2", "guild1");
    expect(p2).not.toBeNull();
    expect(p2!.total_score).toBe(0);
    expect(p2!.wrong_guesses).toBe(1);

    const scores = new Map<string, { username: string; score: number }>();
    scores.set("user1", { username: "Ali", score: 90 });
    db.recordGameFinish("guild1", "chan1", "songs", scores, 5);

    const lb = db.getLeaderboard("guild1");
    expect(lb.length).toBeGreaterThanOrEqual(1);
    expect(lb[0]!.user_id).toBe("user1");
    expect(lb[0]!.total_score).toBe(90);
  });
});
