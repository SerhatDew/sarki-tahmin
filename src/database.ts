/**
 * src/database.ts - SQLite Veritabanı Yönetimi (Bun Native SQLite)
 * Kullanıcı profilleri, sunucu liderlik tablosu ve oyun geçmişini depolar.
 */

import { Database as BunDatabase } from "bun:sqlite";
import path from "path";
import fs from "fs";

export interface UserStats {
  user_id: string;
  guild_id: string;
  username: string;
  total_score: number;
  correct_guesses: number;
  wrong_guesses: number;
  flags_guessed: number;
  minecraft_guessed: number;
  songs_guessed: number;
  games_played: number;
  games_won: number;
  best_level: number;
  rank?: number;
}

export class AppDatabase {
  private db: BunDatabase;

  constructor(dbPath: string = path.join(process.cwd(), "data", "stats.db")) {
    const dir = path.dirname(dbPath);
    if (dir && !fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    this.db = new BunDatabase(dbPath);
    this.initTables();
  }

  private initTables(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS user_stats (
        user_id TEXT NOT NULL,
        guild_id TEXT NOT NULL,
        username TEXT NOT NULL,
        total_score INTEGER DEFAULT 0,
        correct_guesses INTEGER DEFAULT 0,
        wrong_guesses INTEGER DEFAULT 0,
        flags_guessed INTEGER DEFAULT 0,
        minecraft_guessed INTEGER DEFAULT 0,
        songs_guessed INTEGER DEFAULT 0,
        games_played INTEGER DEFAULT 0,
        games_won INTEGER DEFAULT 0,
        best_level INTEGER DEFAULT 0,
        PRIMARY KEY (user_id, guild_id)
      );
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS game_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        category TEXT NOT NULL,
        winner_id TEXT,
        winner_name TEXT,
        top_score INTEGER DEFAULT 0,
        total_rounds INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    try {
      this.db.run("ALTER TABLE user_stats ADD COLUMN songs_guessed INTEGER DEFAULT 0");
    } catch {}
  }

  /**
   * Oyuncunun tahmin sonucunu kaydeder.
   */
  public recordGuess(
    userId: string,
    guildId: string,
    username: string,
    category: string,
    level: number,
    points: number,
    isCorrect: boolean
  ): void {
    const existing = this.db.query<UserStats, [string, string]>(
      "SELECT * FROM user_stats WHERE user_id = ? AND guild_id = ?"
    ).get(userId, guildId);

    if (!existing) {
      this.db.run(
        `INSERT INTO user_stats (
          user_id, guild_id, username, total_score, correct_guesses,
          wrong_guesses, flags_guessed, minecraft_guessed, songs_guessed, best_level
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          userId,
          guildId,
          username,
          isCorrect ? points : 0,
          isCorrect ? 1 : 0,
          isCorrect ? 0 : 1,
          isCorrect && category === "flags" ? 1 : 0,
          isCorrect && category === "minecraft" ? 1 : 0,
          isCorrect && category === "songs" ? 1 : 0,
          isCorrect ? level : 0
        ]
      );
    } else {
      const newBest = isCorrect ? Math.max(existing.best_level, level) : existing.best_level;
      this.db.run(
        `UPDATE user_stats SET
          username = ?,
          total_score = total_score + ?,
          correct_guesses = correct_guesses + ?,
          wrong_guesses = wrong_guesses + ?,
          flags_guessed = flags_guessed + ?,
          minecraft_guessed = minecraft_guessed + ?,
          songs_guessed = songs_guessed + ?,
          best_level = ?
        WHERE user_id = ? AND guild_id = ?`,
        [
          username,
          isCorrect ? points : 0,
          isCorrect ? 1 : 0,
          isCorrect ? 0 : 1,
          isCorrect && category === "flags" ? 1 : 0,
          isCorrect && category === "minecraft" ? 1 : 0,
          isCorrect && category === "songs" ? 1 : 0,
          newBest,
          userId,
          guildId
        ]
      );
    }
  }

  /**
   * Oyun bittiğinde oturum özetini ve oyun sayılarını işler.
   */
  public recordGameFinish(
    guildId: string,
    channelId: string,
    category: string,
    scores: Map<string, { username: string; score: number }>,
    totalRounds: number
  ): void {
    if (scores.size === 0) return;

    const sorted = Array.from(scores.entries()).sort((a, b) => b[1].score - a[1].score);
    const firstEntry = sorted[0];
    if (!firstEntry) return;
    const [winnerId, winnerData] = firstEntry;
    const topScore = winnerData.score;
    this.db.run(
      `INSERT INTO game_history (guild_id, channel_id, category, winner_id, winner_name, top_score, total_rounds)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [guildId, channelId, category, winnerId, winnerData.username, topScore, totalRounds]
    );

    for (const [uid, udata] of scores.entries()) {
      const isWinner = uid === winnerId && topScore > 0;
      this.db.run(
        `INSERT INTO user_stats (user_id, guild_id, username, games_played, games_won)
         VALUES (?, ?, ?, 1, ?)
         ON CONFLICT(user_id, guild_id) DO UPDATE SET
           games_played = games_played + 1,
           games_won = games_won + ?`,
        [uid, guildId, udata.username, isWinner ? 1 : 0, isWinner ? 1 : 0]
      );
    }
  }

  /**
   * Sunucu Top 10 sıralamasını getirir.
   */
  public getLeaderboard(guildId: string, limit: number = 10): UserStats[] {
    return this.db.query<UserStats, [string, number]>(
      `SELECT user_id, username, total_score, correct_guesses, games_won
       FROM user_stats
       WHERE guild_id = ?
       ORDER BY total_score DESC
       LIMIT ?`
    ).all(guildId, limit);
  }

  /**
   * Kullanıcı istatistik profilini getirir.
   */
  public getUserProfile(userId: string, guildId: string): UserStats | null {
    const user = this.db.query<UserStats, [string, string]>(
      "SELECT * FROM user_stats WHERE user_id = ? AND guild_id = ?"
    ).get(userId, guildId);

    if (!user) return null;

    const rankResult = this.db.query<{ rank: number }, [string, number]>(
      "SELECT COUNT(*) + 1 as rank FROM user_stats WHERE guild_id = ? AND total_score > ?"
    ).get(guildId, user.total_score);

    user.rank = rankResult?.rank ?? 1;
    return user;
  }

  public close(): void {
    this.db.close();
  }
}

export const db = new AppDatabase();
