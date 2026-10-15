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
  ModalBuilder,
  LabelBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
  type ButtonInteraction,
  type ModalSubmitInteraction
} from "discord.js";
import { CONFIG } from "./config";
import { dataManager, type GameItem } from "./dataManager";
import { imageProcessor } from "./imageProcessor";
import { db } from "./database";
import type { SongAudio } from "./voicePlayback";
import { resolveSongPreview, type SongPreview } from "./songPreview";
import { randomUUID } from "node:crypto";

interface PanelContent {
  embeds: EmbedBuilder[];
  files?: AttachmentBuilder[];
  components?: ActionRowBuilder<ButtonBuilder>[];
}


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
  private panelQueue: Promise<void> = Promise.resolve();
  private readonly sessionId = randomUUID();
  private roundOptions: GameItem[] = [];
  private roundTimer: NodeJS.Timeout | null = null;
  private wrongGuessCount: number = 0;
  private currentPreview: SongPreview | null = null;
  private songLookup: AbortController | null = null;

  constructor(
    public channel: TextChannel | VoiceChannel,
    public author: User,
    public category: string = "minecraft",
    public gameMode: string = "form",
    public totalRounds: number = CONFIG.DEFAULT_ROUNDS,
    public audio: SongAudio | null = null
  ) {
    this.currentCategory = category;
  }

  public getCategoryTitle(cat?: string): string {
    const c = cat || this.currentCategory;
    if (c === "flags") return "Ülke Bayrakları";
    if (c === "minecraft") return "Minecraft Eşyaları";
    if (c === "songs") return "Şarkı ve Müzik";
    return "Karışık (Şarkı, Bayrak ve Minecraft)";
  }

  public async start(): Promise<void> {
    this.isRunning = true;
    const startEmbed = new EmbedBuilder()
      .setTitle(this.audio ? "Sesli şarkı tahmini başlıyor" : "Tahmin oyunu başlıyor")
      .setDescription(
        `**Kategori:** ${this.getCategoryTitle(this.category)}\n` +
        `**Toplam tur:** ${this.totalRounds} · **Tur süresi:** ${CONFIG.ROUND_DURATION} saniye\n\n` +
        (this.audio ? "Şarkı kesitleri bu ses kanalında çalacak.\n" : "") +
        (this.gameMode === "buttons"
          ? "Paneldeki dört seçenekten doğru cevabı seçin.\n"
          : "**Tahmin Et** butonuna basıp açılan forma cevabınızı yazın. Cevabınız yalnızca size görünür.\n") +
        "Erken bilen daha çok puan kazanır. İlk tur hazırlanıyor."
      )
      .setColor(CONFIG.COLORS.PRIMARY);
    await this.updatePanel({ embeds: [startEmbed] });
    await delay(3000);
    await this.nextRound();
  }

  private updatePanel(content: PanelContent): Promise<void> {
    const payload = { files: [], components: [], ...content };
    const update = this.panelQueue.then(async () => {
      if (this.gameMessage) {
        await this.gameMessage.edit({ ...payload, attachments: [] });
      } else {
        this.gameMessage = await this.channel.send(payload);
      }
    });
    this.panelQueue = update.catch(() => {});
    return update;
  }

  private componentId(action: string): string {
    return `game:${this.sessionId}:${this.currentRound}:${action}`;
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
    this.roundOptions = this.gameMode === "buttons"
      ? dataManager.getMultipleChoiceOptions(this.currentCategory, this.currentItem, 4)
      : [];

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
    await this.updatePanel({
      files,
      embeds: [this.createRoundEmbed(filename)],
      components: this.createRoundComponents()
    });
    if (!this.isRunning || this.currentRound !== round) return;
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
      return `**Müzik Türü:** \`${item.genre || "Bilinmiyor"}\``;
    } else if (level === 4) {
      return `**Çıkış Yılı:** \`${item.year || "Bilinmiyor"}\` · **Tür:** \`${item.genre || "Bilinmiyor"}\``;
    } else if (level === 3) {
      return `**Sanatçı İpucu:** \`${maskArtist(item.artist || "")}\` · **Yıl:** \`${item.year || ""}\``;
    } else if (level === 2) {
      return `**Şarkı Sözü İpucu:** *"${item.lyrics || ""}"*`;
    } else {
      return `**Sanatçı:** **${item.artist || ""}** · Şarkı adını tahmin edin.`;
    }
  }

  private createRoundEmbed(attachmentName?: string): EmbedBuilder {
    const points = CONFIG.POINTS_MAP[this.currentLevel] ?? 10;
    const progress = Math.min(this.totalRounds, this.currentRound);

    const embed = new EmbedBuilder()
      .setTitle(`Tur ${progress} / ${this.totalRounds} — ${this.getCategoryTitle()}`)
      .setDescription(
        `**${this.audio ? "İpucu" : "Bulanıklık"} seviyesi:** ${this.currentLevel} / 5\n` +
        `**Bu turun değeri:** ${points} puan\n\n` +
        (this.gameMode === "buttons"
          ? "Aşağıdaki seçeneklerden doğru cevabı seçin."
          : "**Tahmin Et** butonuna basıp cevabınızı özel formdan gönderin.")
      )
      .setImage(attachmentName ? `attachment://${attachmentName}` : null)
      .setColor(this.currentLevel > 2 ? CONFIG.COLORS.PRIMARY : CONFIG.COLORS.WARNING)
      .setFooter({ text: `Şarkı/Görsel Tahmin Sistemi • Tur Süresi: ${CONFIG.ROUND_DURATION}s` });

    if (this.scores.size > 0) {
      const topLeaders = Array.from(this.scores.values())
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);
      const leaderStr = topLeaders.map(l => `**${l.username}**: ${l.score}p`).join("  •  ");
      embed.addFields({ name: "Anlık Skorlar", value: leaderStr, inline: false });
    }

    if (this.currentCategory === "songs" && this.currentItem) {
      embed.addFields({
        name: "Şarkı İpucu",
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
      const labels = ["A", "B", "C", "D"];

      const row1 = new ActionRowBuilder<ButtonBuilder>();
      const row2 = new ActionRowBuilder<ButtonBuilder>();

      this.roundOptions.forEach((opt, idx) => {
        const labelText = opt.artist
          ? `${labels[idx]}) ${opt.name} - ${opt.artist}`
          : `${labels[idx]}) ${opt.name}`;
        const trimmedLabel = labelText.length > 80 ? labelText.slice(0, 77) + "..." : labelText;
        const btn = new ButtonBuilder()
          .setCustomId(this.componentId(`choice_${idx}`))
          .setLabel(trimmedLabel)
          .setStyle(ButtonStyle.Primary);
        if (idx < 2) row1.addComponents(btn);
        else row2.addComponents(btn);
      });

      rows.push(row1, row2);
    }
    else {
      rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(this.componentId("guess"))
          .setLabel("Tahmin Et")
          .setStyle(ButtonStyle.Primary)
      ));
    }

    // Kontrol butonları
    const controlRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(this.componentId("hint"))
        .setLabel(this.audio ? "İpucu (-10 Puan)" : "Netleştir (-10 Puan)")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(this.componentId("skip"))
        .setLabel("Turu Atla")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(this.componentId("stop"))
        .setLabel("Bitir")
        .setStyle(ButtonStyle.Danger)
    );

    rows.push(controlRow);
    return rows;
  }

  private stopRound(): void {
    if (this.roundTimer) clearTimeout(this.roundTimer);
    this.roundTimer = null;
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
    const round = this.currentRound;
    const level = this.currentLevel;

    try {
      if (this.audio) {
        await this.updatePanel({
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

      await this.updatePanel({
        files: [attachment],
        embeds: [embed],
        components: this.createRoundComponents()
      });
    } catch (e) {
      console.error("[!] Görsel güncelleme hatası:", e);
    }
  }

  public async handleButtonInteraction(interaction: ButtonInteraction): Promise<void> {
    const prefix = this.componentId("");
    if (!this.isRunning || this.roundFinished || !this.currentItem ||
        interaction.channelId !== this.channel.id || interaction.message.id !== this.gameMessage?.id ||
        !interaction.customId.startsWith(prefix)) {
      await interaction.reply({ content: "Bu tur artık tahmin kabul etmiyor.", flags: MessageFlags.Ephemeral });
      return;
    }
    const action = interaction.customId.slice(prefix.length);
    if (action === "guess" && this.gameMode !== "buttons") {
      const input = new TextInputBuilder()
        .setCustomId("answer")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(150);
      await interaction.showModal(new ModalBuilder()
        .setCustomId(this.componentId("submit"))
        .setTitle("Tahminini yaz")
        .addLabelComponents(new LabelBuilder()
          .setLabel(this.currentCategory === "songs" ? "Şarkının adı" : "Cevabınız")
          .setTextInputComponent(input)));
    } else if (action === "hint") {
      if (this.currentLevel <= 1) {
        await interaction.reply({ content: "Son ipucu zaten açık.", flags: MessageFlags.Ephemeral });
        return;
      }
      this.currentLevel--;
      await Promise.all([interaction.deferUpdate(), this.updateImageAndEmbed()]);
    } else if (action === "skip") {
      await Promise.all([interaction.deferUpdate(), this.onRoundTimeout()]);
    } else if (action === "stop") {
      await Promise.all([interaction.deferUpdate(), this.endGame("Oyun durduruldu.")]);
    } else if (this.gameMode === "buttons" && /^choice_[0-3]$/.test(action)) {
      const choice = this.roundOptions[Number(action.slice(-1))];
      if (!choice) return;
      await this.submitGuess(interaction, choice.id === this.currentItem.id);
    } else {
      await interaction.reply({ content: "Bu buton artık kullanılamıyor.", flags: MessageFlags.Ephemeral });
    }
  }

  public async handleModalGuess(interaction: ModalSubmitInteraction): Promise<void> {
    if (!this.isRunning || this.roundFinished || !this.currentItem || this.gameMode === "buttons" ||
        interaction.channelId !== this.channel.id || interaction.customId !== this.componentId("submit")) {
      await interaction.reply({ content: "Bu formun turu sona erdi. Güncel panelden tekrar tahmin edin.", flags: MessageFlags.Ephemeral });
      return;
    }
    const answer = interaction.fields.getTextInputValue("answer").trim();
    if (!answer) {
      await interaction.reply({ content: "Bir cevap yazın.", flags: MessageFlags.Ephemeral });
      return;
    }
    await this.submitGuess(interaction, dataManager.checkGuess(this.currentItem, answer));
  }

  private async submitGuess(interaction: ButtonInteraction | ModalSubmitInteraction, correct: boolean): Promise<void> {
    if (correct) {
      const points = CONFIG.POINTS_MAP[this.currentLevel] ?? 10;
      const result = this.onCorrectGuess(interaction.user);
      await Promise.all([
        interaction.reply({ content: `Doğru cevap! ${points} puan kazandınız.`, flags: MessageFlags.Ephemeral }),
        result
      ]);
      return;
    }
    db.recordGuess(interaction.user.id, this.channel.guildId, interaction.user.displayName,
      this.currentCategory, this.currentLevel, 0, false);
    this.wrongGuessCount++;
    const revealHint = this.currentLevel > 1 && (this.gameMode === "buttons" || this.wrongGuessCount % 3 === 0);
    if (revealHint) this.currentLevel--;
    await Promise.all([
      interaction.reply({ content: "Yanlış cevap. Tekrar tahmin edebilirsiniz.", flags: MessageFlags.Ephemeral }),
      revealHint ? this.updateImageAndEmbed() : Promise.resolve()
    ]);
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
      .setTitle(`${user.displayName} doğru bildi`)
      .setDescription(
        (this.currentItem!.artist
          ? `**Doğru cevap:** **${this.currentItem!.name}** — *${this.currentItem!.artist}* (${this.currentItem!.year})\n` +
            `**Albüm:** *${this.currentItem!.album}* · **Tür:** \`${this.currentItem!.genre}\`\n`
          : `**Doğru cevap:** **${this.currentItem!.name}**\n`) +
        `**Kazanılan:** +${points} puan · Seviye ${this.currentLevel}\n` +
        `**${user.displayName} toplam puanı:** ${currentScore.score}\n\n` +
        "Sıradaki tur 4 saniye içinde başlıyor."
      )
      .setThumbnail(user.displayAvatarURL())
      .setImage("attachment://reveal.png")
      .setColor(CONFIG.COLORS.SUCCESS)
      .setFooter({ text: `Tur ${this.currentRound}/${this.totalRounds} Tamamlandı` });
    if (this.currentPreview) {
      embed.addFields({ name: "Kaynak", value: `[Apple Music / iTunes](${this.currentPreview.sourceUrl})` });
    }

    await this.updatePanel({ files: [origFile], embeds: [embed] });
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
      .setTitle("Süre doldu, kimse bilemedi")
      .setDescription(
        (this.currentItem!.artist
          ? `**Doğru cevap:** **${this.currentItem!.name}** — *${this.currentItem!.artist}* (${this.currentItem!.year})\n` +
            `**Albüm:** *${this.currentItem!.album}* · **Tür:** \`${this.currentItem!.genre}\`\n`
          : `**Doğru cevap:** **${this.currentItem!.name}**\n`) +
        "Bu turda kimse puan kazanamadı.\n\nSıradaki tur 4 saniye içinde başlıyor."
      )
      .setImage("attachment://timeout.png")
      .setColor(CONFIG.COLORS.DANGER)
      .setFooter({ text: `Tur ${this.currentRound}/${this.totalRounds} Tamamlandı` });
    if (this.currentPreview) {
      embed.addFields({ name: "Kaynak", value: `[Apple Music / iTunes](${this.currentPreview.sourceUrl})` });
    }

    await this.updatePanel({ files: [origFile], embeds: [embed] });
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
    const completedRounds = this.history.length;
    db.recordGameFinish(guildId, this.channel.id, this.category, this.scores, completedRounds);

    const sortedScores = Array.from(this.scores.values()).sort((a, b) => b.score - a.score);

    const embed = new EmbedBuilder()
      .setTitle("Oyun Sonu — Skor Tablosu")
      .setDescription(
        `${reason}\n\n` +
        `**Kategori:** ${this.getCategoryTitle(this.category)}\n` +
        `**Tamamlanan Tur:** ${completedRounds} / ${this.totalRounds}\n\n`
      )
      .setColor(CONFIG.COLORS.GOLD);

    if (sortedScores.length > 0) {
      let text = "";
      sortedScores.slice(0, 5).forEach((p, idx) => {
        text += `${idx + 1}. **${p.username}**: **${p.score} puan**\n`;
      });
      embed.setDescription(embed.data.description + text);
    } else {
      embed.setDescription(embed.data.description + "*Bu oyunda hiç kimse puan kazanamadı.*");
    }

    if (this.history.length > 0) {
      let historyText = "";
      this.history.slice(-10).forEach(h => {
        historyText += `Tur ${h.round}: **${h.item}** → ${h.winner} (${h.points}p)\n`;
      });
      embed.addFields({ name: "Tur Dökümü", value: historyText, inline: false });
    }

    const podiumBuffer = imageProcessor.generateScoreboardImage(
      this.scores,
      this.getCategoryTitle(this.category),
      this.totalRounds
    );
    const podiumFile = new AttachmentBuilder(podiumBuffer, { name: "podium.png" });

    embed.setImage("attachment://podium.png");
    embed.setFooter({ text: "Yeni oyun başlatmak için: /oyun" });

    await this.updatePanel({ files: [podiumFile], embeds: [embed] });
  }
}
