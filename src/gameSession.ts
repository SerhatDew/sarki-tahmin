/**
 * src/gameSession.ts - Aktif Oyun Oturumu, Tur Yönetimi ve Discord v14 UI Butonları
 * Kademeli blur geçişleri, görsel durum rozetleri, anlık skor takibi ve oyun sonu podyum grafiği.
 */

import {
  TextChannel,
  type VoiceChannel,
  User,
  Message,
  EmbedBuilder,
  AttachmentBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  type ButtonInteraction,
  type InteractionCollector
} from "discord.js";
import { CONFIG } from "./config";
import { dataManager, type GameItem } from "./dataManager";
import { imageProcessor } from "./imageProcessor";
import { db } from "./database";
import type { SongAudio } from "./voicePlayback";
import { resolveSongPreview, type SongPreview } from "./songPreview";


function delay(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}
function maskArtist(artist: string): string {
  return artist
    .split(" ")
    .map(word => {
      if (word.length <= 1) return word;
      return word[0] + "*".repeat(Math.max(1, word.length - 1));
    })
    .join(" ");
}

export const activeSessions = new Map<string, GameSession>();

export class GameSession {
  public isRunning: boolean = false;
  public currentRound: number = 0;
  public currentItem: GameItem | null = null;
  public currentCategory: string;
  public currentLevel: number = 5;
  public roundFinished: boolean = true;
  public excludedIds: Set<string> = new Set();

  public scores: Map<string, { username: string; score: number }> = new Map();
  public history: Array<{
    round: number;
    item: string;
    winner: string;
    points: number;
    level: number;
  }> = [];

  private gameMessage: Message | null = null;
  private roundTimer: NodeJS.Timeout | null = null;
  private buttonCollector: InteractionCollector<ButtonInteraction> | null = null;
  private wrongGuessCount: number = 0;
  private currentPreview: SongPreview | null = null;
  private songLookup: AbortController | null = null;

  constructor(
    public channel: TextChannel | VoiceChannel,
    public author: User,
    public category: string = "minecraft",
    public gameMode: string = "chat",
    public totalRounds: number = CONFIG.DEFAULT_ROUNDS,
    public audio: SongAudio | null = null
  ) {
    this.currentCategory = category;
  }

  public getCategoryTitle(cat?: string): string {
    const c = cat || this.currentCategory;
    if (c === "flags") return "🎌 Ülke Bayrakları";
    if (c === "minecraft") return "⛏️ Minecraft Eşyaları";
    if (c === "songs") return "🎵 Şarkı ve Müzik";
    return "🎲 Karışık (Şarkı, Bayrak & Minecraft)";
  }

  public async start(): Promise<void> {
    this.isRunning = true;
    const startEmbed = new EmbedBuilder()
      .setTitle("🎮 Şarkı / Görsel Tahmin Oyunu Başlıyor!")
      .setDescription(
        `**Kategori:** ${this.getCategoryTitle(this.category)}\n` +
        `**Oyun Modu:** ${this.gameMode === "chat" ? "💬 Sohbet Modu (Mesajla Hızlı Tahmin)" : "🔘 Buton Modu (4 Şıklı Çoktan Seçmeli)"}\n` +
        `**Toplam Tur:** 🎯 ${this.totalRounds} Tur\n\n` +
        `**Mekanik:**\n` +
        `• Görsel en yüksek bulanıklıkta (Seviye 5) gelir.\n` +
        `• Süre geçtikçe veya yanlış tahmin edildikçe kademeli olarak netleşir!\n` +
        `• **Seviye 5'te bilene 50 Puan**, **Seviye 1'de bilene 10 Puan**!\n\n` +
        `⚡ *1. Tur hazırlanıyor, başarılar!*`
      )
      .setColor(CONFIG.COLORS.PRIMARY)
      .setFooter({ text: "Hazırlayan: Şarkı Tahmin Sistemi • /yardım" });
    if (this.audio) {
      startEmbed
        .setTitle("Sesli şarkı tahmini başlıyor")
        .setDescription(
          `Şarkı kesitleri bu ses kanalında çalacak. Cevapları kanalın sohbetine yazın.\n` +
          `Toplam ${this.totalRounds} tur; her tur ${CONFIG.ROUND_DURATION} saniye.\n` +
          "Şarkı adını erken bilen daha çok puan kazanır. Yalnızca sanatçı adı yeterli değildir."
        );
    }

    await this.channel.send({ embeds: [startEmbed] });
    await delay(3000);
    await this.nextRound();
  }

  public async nextRound(): Promise<void> {
    if (!this.isRunning) return;

    this.stopRound();
    this.roundFinished = true;

    this.currentRound++;
    if (this.currentRound > this.totalRounds) {
      await this.endGame("Oyun tamamlandı!");
      return;
    }

    if (this.category === "mixed") {
      const pool = ["songs", "flags", "minecraft"] as const;
      this.currentCategory = pool[Math.floor(Math.random() * pool.length)]!;
    } else {
      this.currentCategory = this.category;
    }

    const round = this.currentRound;
    this.currentPreview = null;
    if (this.audio) {
      const lookup = new AbortController();
      this.songLookup = lookup;
      try {
        this.currentPreview = await this.selectVoiceSong(lookup.signal);
      } catch (error) {
        if (!this.isRunning || lookup.signal.aborted || this.currentRound !== round) return;
        console.error("Şarkı önizlemesi hazırlanamadı:", error);
        await this.endGame("Şarkı kaynağına erişilemedi; sesli oyun kapatıldı.");
        return;
      }
      if (!this.isRunning || this.currentRound !== round) return;
      this.currentItem = this.currentPreview.item;
    } else {
      this.currentItem = dataManager.getRandomItem(this.currentCategory, Array.from(this.excludedIds));
    }
    this.excludedIds.add(this.currentItem.id);
    this.currentLevel = 5;
    this.wrongGuessCount = 0;

    const files: AttachmentBuilder[] = [];
    let filename: string | undefined;
    if (!this.audio) {
      const imgBuffer = await imageProcessor.getBlurredImageBuffer(
        this.currentCategory, this.currentItem.id, this.currentLevel
      );
      if (!this.isRunning || this.currentRound !== round) return;
      filename = `round_${this.currentRound}.png`;
      files.push(new AttachmentBuilder(imgBuffer, { name: filename }));
    }
    const message = await this.channel.send({
      files,
      embeds: [this.createRoundEmbed(filename)],
      components: this.createRoundComponents()
    });
    if (!this.isRunning || this.currentRound !== round) {
      await message.edit({ components: [] });
      return;
    }
    this.gameMessage = message;
    if (this.audio && this.currentPreview) {
      try {
        await this.audio.play(this.currentPreview.previewUrl);
      } catch (error) {
        if (!this.isRunning) return;
        console.error("Şarkı çalınamadı:", error);
        await this.endGame("Ses oynatılamadı; bağlantı kapatıldı.");
        return;
      }
      if (!this.isRunning || this.currentRound !== round) return;
    }
    this.roundFinished = false;
    this.startTimerLoop();
    this.setupButtonCollector();
  }

  private async selectVoiceSong(signal: AbortSignal): Promise<SongPreview> {
    let pool = dataManager.songs.filter(song => !this.excludedIds.has(song.id));
    if (pool.length === 0) pool = [...dataManager.songs];
    while (pool.length > 0) {
      signal.throwIfAborted();
      const index = Math.floor(Math.random() * pool.length);
      const [song] = pool.splice(index, 1);
      const preview = await resolveSongPreview(song!, signal);
      if (preview) return preview;
    }
    throw new Error("Katalogdaki şarkılar için ses önizlemesi bulunamadı.");
  }

  private getSongHint(level: number, item: GameItem): string {
    if (level === 5) {
      return `🎧 **Müzik Türü:** \`${item.genre || "Bilinmiyor"}\``;
    } else if (level === 4) {
      return `📅 **Çıkış Yılı:** \`${item.year || "Bilinmiyor"}\`  •  🎧 **Tür:** \`${item.genre || "Bilinmiyor"}\``;
    } else if (level === 3) {
      return `🎤 **Sanatçı İpucu:** \`${maskArtist(item.artist || "")}\`  •  📅 **Yıl:** \`${item.year || ""}\``;
    } else if (level === 2) {
      return `📜 **Şarkı Sözü İpucu:** *" ${item.lyrics || ""} "*`;
    } else {
      return `🎤 **Sanatçı:** **${item.artist || ""}**  *(Şarkı adını tahmin edin!)*`;
    }
  }

  private createRoundEmbed(attachmentName?: string): EmbedBuilder {
    const points = CONFIG.POINTS_MAP[this.currentLevel] ?? 10;
    const progPct = Math.floor(((this.currentRound - 1) / Math.max(1, this.totalRounds)) * 100);
    const filledCnt = Math.floor(progPct / 10);
    const progBar = "🟩".repeat(filledCnt) + "⬛".repeat(10 - filledCnt);

    const blurMap: Record<number, string> = {
      5: "🟥🟥🟥🟥🟥 (En Bulanık)",
      4: "🟧🟧🟧🟧⬛ (Bulanık)",
      3: "🟨🟨🟨⬛⬛ (Orta)",
      2: "🟦🟦⬛⬛⬛ (Netleşti)",
      1: "🟩⬛⬛⬛⬛ (Çok Net)"
    };
    const levelStr = blurMap[this.currentLevel] || "⬛⬛⬛⬛⬛";

    const embed = new EmbedBuilder()
      .setTitle(`🎯 Tur ${this.currentRound} / ${this.totalRounds} — ${this.getCategoryTitle()}`)
      .setDescription(
        `**Oyun İlerlemesi:** \`[${progBar}]\` (%${progPct})\n` +
        (this.audio ? `**İpucu Seviyesi:** ${this.currentLevel}\n` : `**Bulanıklık Seviyesi:** ${levelStr}\n`) +
        `**Bu Turun Değeri:** ⭐ **${points} Puan**\n\n` +
        (this.gameMode !== "buttons"
          ? "💬 👉 **Tahmininizi sohbete doğrudan yazın!**"
          : "🔘 👉 **Aşağıdaki butonlardan doğru şıkkı seçin!**")
      )
      .setImage(attachmentName ? `attachment://${attachmentName}` : null)
      .setColor(this.currentLevel > 2 ? CONFIG.COLORS.PRIMARY : CONFIG.COLORS.WARNING)
      .setFooter({ text: `Şarkı/Görsel Tahmin Sistemi • Tur Süresi: ${CONFIG.ROUND_DURATION}s` });

    if (this.scores.size > 0) {
      const topLeaders = Array.from(this.scores.values())
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);
      const leaderStr = topLeaders.map(l => `**${l.username}**: ${l.score}p`).join("  •  ");
      embed.addFields({ name: "🏆 Anlık Skor Tablosu", value: leaderStr, inline: false });
    }

    if (this.currentCategory === "songs" && this.currentItem) {
      embed.addFields({
        name: "💡 Şarkı İpucu",
        value: this.getSongHint(this.currentLevel, this.currentItem),
        inline: false
      });
    }

    return embed;
  }

  private createRoundComponents(): ActionRowBuilder<ButtonBuilder>[] {
    const rows: ActionRowBuilder<ButtonBuilder>[] = [];

    // Çoktan seçmeli mod şık butonları
    if (this.gameMode === "buttons" && this.currentItem) {
      const options = dataManager.getMultipleChoiceOptions(this.currentCategory, this.currentItem, 4);
      const labels = ["A", "B", "C", "D"];

      const row1 = new ActionRowBuilder<ButtonBuilder>();
      const row2 = new ActionRowBuilder<ButtonBuilder>();

      options.forEach((opt, idx) => {
        const labelText = opt.artist
          ? `${labels[idx]}) ${opt.name} - ${opt.artist}`
          : `${labels[idx]}) ${opt.name}`;
        const trimmedLabel = labelText.length > 80 ? labelText.slice(0, 77) + "..." : labelText;
        const btn = new ButtonBuilder()
          .setCustomId(`choice_${opt.id}`)
          .setLabel(trimmedLabel)
          .setStyle(ButtonStyle.Primary);
        if (idx < 2) row1.addComponents(btn);
        else row2.addComponents(btn);
      });

      rows.push(row1, row2);
    }

    // Kontrol butonları
    const controlRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId("action_clarify")
        .setLabel(this.audio ? "İpucu (-10 Puan)" : "Netleştir (-10 Puan)")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId("action_skip")
        .setLabel("⏩ Turu Atla")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId("action_stop")
        .setLabel("⏹️ Bitir")
        .setStyle(ButtonStyle.Danger)
    );

    rows.push(controlRow);
    return rows;
  }

  private stopRound(): void {
    if (this.roundTimer) clearTimeout(this.roundTimer);
    this.roundTimer = null;
    this.buttonCollector?.stop("round-ended");
    this.buttonCollector = null;
    this.songLookup?.abort();
    this.songLookup = null;
    this.audio?.stop();
  }

  private startTimerLoop(): void {
    const round = this.currentRound;
    const step = CONFIG.BLUR_STEP_SECONDS * 1000;
    const deadline = Date.now() + CONFIG.ROUND_DURATION * 1000;
    const tick = async () => {
      if (!this.isRunning || this.roundFinished || this.currentRound !== round) return;
      if (Date.now() >= deadline) {
        await this.onRoundTimeout();
        return;
      }
      if (this.currentLevel > 1) {
        this.currentLevel--;
        await this.updateImageAndEmbed();
      }
      if (this.isRunning && !this.roundFinished && this.currentRound === round) {
        this.roundTimer = setTimeout(run, Math.min(step, Math.max(0, deadline - Date.now())));
      }
    };
    const run = () => {
      this.roundTimer = null;
      void tick().catch(error => console.error("Tur zamanlayıcısı hatası:", error));
    };
    this.roundTimer = setTimeout(run, Math.min(step, CONFIG.ROUND_DURATION * 1000));
  }

  private async updateImageAndEmbed(): Promise<void> {
    if (!this.gameMessage || this.roundFinished || !this.isRunning) return;
    const message = this.gameMessage;
    const round = this.currentRound;
    const level = this.currentLevel;

    try {
      if (this.audio) {
        await message.edit({
          embeds: [this.createRoundEmbed()],
          components: this.createRoundComponents()
        });
        return;
      }
      const imgBuffer = await imageProcessor.getBlurredImageBuffer(
        this.currentCategory,
        this.currentItem!.id,
        this.currentLevel
      );
      if (!this.isRunning || this.roundFinished || this.currentRound !== round || this.currentLevel !== level) return;
      const filename = `round_${this.currentRound}_lvl${this.currentLevel}.png`;
      const attachment = new AttachmentBuilder(imgBuffer, { name: filename });
      const embed = this.createRoundEmbed(filename);

      await message.edit({
        files: [attachment],
        embeds: [embed],
        components: this.createRoundComponents()
      });
    } catch (e) {
      console.error("[!] Görsel güncelleme hatası:", e);
    }
  }

  private setupButtonCollector(): void {
    if (!this.gameMessage) return;

    const collector = this.gameMessage.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: (CONFIG.ROUND_DURATION + 5) * 1000
    });
    this.buttonCollector = collector;
    const round = this.currentRound;

    collector.on("collect", async interaction => {
      if (!this.isRunning || this.roundFinished || this.currentRound !== round) {
        await interaction.reply({ content: "Bu tur zaten tamamlandı!", ephemeral: true });
        return;
      }

      const id = interaction.customId;

      if (id === "action_clarify") {
        if (this.currentLevel > 1) {
          this.currentLevel--;
          await interaction.reply({
            content: `**${interaction.user.displayName}** bir ipucu açtı. Yeni seviye: ${this.currentLevel}.`,
            ephemeral: false
          });
          await this.updateImageAndEmbed();
        } else {
          await interaction.reply({ content: "Görsel zaten en açık seviyede!", ephemeral: true });
        }
        return;
      }

      if (id === "action_skip") {
        await Promise.all([
          interaction.reply({ content: `**${interaction.user.displayName}** turu atladı.` }),
          this.onRoundTimeout()
        ]);
        return;
      }

      if (id === "action_stop") {
        await Promise.all([
          interaction.reply({ content: `**${interaction.user.displayName}** oyunu sonlandırdı.` }),
          this.endGame("Oyun durduruldu.")
        ]);
        return;
      }

      // Şık Butonu Kontrolü
      if (id.startsWith("choice_")) {
        const choiceId = id.replace("choice_", "");
        if (choiceId === this.currentItem?.id) {
          await Promise.all([
            interaction.reply({ content: "Doğru seçim!", ephemeral: true }),
            this.onCorrectGuess(interaction.user)
          ]);
        } else {
          const guildId = interaction.guildId || "0";
          db.recordGuess(
            interaction.user.id,
            guildId,
            interaction.user.displayName,
            this.currentCategory,
            this.currentLevel,
            0,
            false
          );
          await interaction.reply({ content: "❌ Yanlış cevap!", ephemeral: true });
          if (this.currentLevel > 1) {
            this.currentLevel--;
            await this.updateImageAndEmbed();
          }
        }
      }
    });
  }

  public async handleChatGuess(message: Message): Promise<boolean> {
    if (!this.isRunning || this.roundFinished || !this.currentItem) return false;

    const isCorrect = dataManager.checkGuess(this.currentItem, message.content.trim());

    if (isCorrect) {
      await this.onCorrectGuess(message.author);
      return true;
    } else {
      this.wrongGuessCount++;
      if (this.wrongGuessCount % 3 === 0 && this.currentLevel > 1) {
        this.currentLevel--;
        await this.updateImageAndEmbed();
      }
      return false;
    }
  }

  public async onCorrectGuess(user: User): Promise<void> {
    if (!this.isRunning || this.roundFinished || !this.currentItem) return;
    this.roundFinished = true;
    this.stopRound();

    const points = CONFIG.POINTS_MAP[this.currentLevel] ?? 10;
    const currentScore = this.scores.get(user.id) || { username: user.displayName, score: 0 };
    currentScore.score += points;
    currentScore.username = user.displayName;
    this.scores.set(user.id, currentScore);

    const guildId = this.channel.guildId || "0";
    db.recordGuess(user.id, guildId, user.displayName, this.currentCategory, this.currentLevel, points, true);

    this.history.push({
      round: this.currentRound,
      item: this.currentItem!.name,
      winner: user.displayName,
      points,
      level: this.currentLevel
    });

    const origBuffer = await imageProcessor.getBlurredImageBuffer(
      this.currentCategory,
      this.currentItem!.id,
      0,
      this.currentItem!.name
    );
    if (!this.isRunning) return;
    const origFile = new AttachmentBuilder(origBuffer, { name: "reveal.png" });

    const embed = new EmbedBuilder()
      .setTitle(`🎉 TEBRİKLER! ${user.displayName} DOĞRU BİLDİ!`)
      .setDescription(
        (this.currentItem!.artist
          ? `🌟 **Doğru Cevap:** **${this.currentItem!.name}** — *${this.currentItem!.artist}* (${this.currentItem!.year})\n` +
            `💿 **Albüm:** *${this.currentItem!.album}*  •  🎧 **Tür:** \`${this.currentItem!.genre}\`\n`
          : `🌟 **Doğru Cevap:** **${this.currentItem!.name}**\n`) +
        `**Kazanılan:** +${points} Puan *(Seviye ${this.currentLevel})*\n` +
        `👤 **${user.displayName} Toplam Puanı:** **${currentScore.score} Puan**\n\n` +
        `⏱️ *Sıradaki tur 4 saniye içinde başlıyor...*`
      )
      .setThumbnail(user.displayAvatarURL())
      .setImage("attachment://reveal.png")
      .setColor(CONFIG.COLORS.SUCCESS)
      .setFooter({ text: `Tur ${this.currentRound}/${this.totalRounds} Tamamlandı` });
    if (this.currentPreview) {
      embed.addFields({ name: "Kaynak", value: `[Apple Music / iTunes](${this.currentPreview.sourceUrl})` });
    }

    if (this.gameMessage) {
      try {
        await this.gameMessage.edit({ components: [] });
      } catch {}
    }

    await this.channel.send({ files: [origFile], embeds: [embed] });
    await delay(4000);
    await this.nextRound();
  }

  public async onRoundTimeout(): Promise<void> {
    if (!this.isRunning || this.roundFinished || !this.currentItem) return;
    this.roundFinished = true;
    this.stopRound();

    this.history.push({
      round: this.currentRound,
      item: this.currentItem!.name,
      winner: "Kimse bilemedi",
      points: 0,
      level: 0
    });

    const origBuffer = await imageProcessor.getBlurredImageBuffer(
      this.currentCategory,
      this.currentItem!.id,
      0,
      this.currentItem!.name
    );
    if (!this.isRunning) return;
    const origFile = new AttachmentBuilder(origBuffer, { name: "timeout.png" });

    const embed = new EmbedBuilder()
      .setTitle("⌛ SÜRE DOLDU! KİMSE BİLEMEDİ")
      .setDescription(
        (this.currentItem!.artist
          ? `🔍 **Doğru Cevap:** **${this.currentItem!.name}** — *${this.currentItem!.artist}* (${this.currentItem!.year})\n` +
            `💿 **Albüm:** *${this.currentItem!.album}*  •  🎧 **Tür:** \`${this.currentItem!.genre}\`\n`
          : `🔍 **Doğru Cevap:** **${this.currentItem!.name}**\n`) +
        `Bu turda kimse puan kazanamadı.\n\n` +
        `⏱️ *Sıradaki tur 4 saniye içinde başlıyor...*`
      )
      .setImage("attachment://timeout.png")
      .setColor(CONFIG.COLORS.DANGER)
      .setFooter({ text: `Tur ${this.currentRound}/${this.totalRounds} Tamamlandı` });
    if (this.currentPreview) {
      embed.addFields({ name: "Kaynak", value: `[Apple Music / iTunes](${this.currentPreview.sourceUrl})` });
    }

    if (this.gameMessage) {
      try {
        await this.gameMessage.edit({ components: [] });
      } catch {}
    }

    await this.channel.send({ files: [origFile], embeds: [embed] });
    await delay(4000);
    await this.nextRound();
  }

  public async endGame(reason: string = "Oyun bitti!"): Promise<void> {
    if (!this.isRunning) return;
    this.isRunning = false;
    this.roundFinished = true;
    this.stopRound();
    this.audio?.destroy();
    if (activeSessions.get(this.channel.id) === this) activeSessions.delete(this.channel.id);

    const guildId = this.channel.guildId || "0";
    db.recordGameFinish(guildId, this.channel.id, this.category, this.scores, this.currentRound);
    if (this.gameMessage) {
      try {
        await this.gameMessage.edit({ components: [] });
      } catch (error) {
        console.warn("Oyun butonları kapatılamadı:", error);
      }
    }

    const sortedScores = Array.from(this.scores.values()).sort((a, b) => b.score - a.score);

    const embed = new EmbedBuilder()
      .setTitle("🏆 OYUN SONU — LİDERLİK TABLOSU")
      .setDescription(
        `${reason}\n\n` +
        `**Kategori:** ${this.getCategoryTitle(this.category)}\n` +
        `**Tamamlanan Tur:** ${this.currentRound > this.totalRounds ? this.totalRounds : this.currentRound} / ${this.totalRounds}\n\n`
      )
      .setColor(CONFIG.COLORS.GOLD);

    if (sortedScores.length > 0) {
      const medals = ["🥇", "🥈", "🥉", "4️⃣", "5️⃣"];
      let text = "";
      sortedScores.slice(0, 5).forEach((p, idx) => {
        const medal = medals[idx] || "▫️";
        text += `${medal} **${p.username}**: **${p.score} Puan**\n`;
      });
      embed.setDescription(embed.data.description + text);
    } else {
      embed.setDescription(embed.data.description + "*Bu oyunda hiç kimse puan kazanamadı.*");
    }

    if (this.history.length > 0) {
      let historyText = "";
      this.history.slice(-10).forEach(h => {
        const icon = h.winner !== "Kimse bilemedi" ? "✅" : "❌";
        historyText += `${icon} Tur ${h.round}: **${h.item}** → ${h.winner} (${h.points}p)\n`;
      });
      embed.addFields({ name: "📜 Tur Dökümü", value: historyText, inline: false });
    }

    const podiumBuffer = imageProcessor.generateScoreboardImage(
      this.scores,
      this.getCategoryTitle(this.category),
      this.totalRounds
    );
    const podiumFile = new AttachmentBuilder(podiumBuffer, { name: "podium.png" });

    embed.setImage("attachment://podium.png");
    embed.setFooter({ text: "Yeni oyun başlatmak için: /oyun" });

    await this.channel.send({ files: [podiumFile], embeds: [embed] });
  }
}
