/**
 * src/imageProcessor.ts - Canvas Tabanlı Görsel İşleme ve Bulanıklaştırma Motoru (@napi-rs/canvas)
 * Görselleri Discord koyu temasına uygun kart içine yerleştirir, kademeli blur uygular,
 * durum rozetleri çizer ve oyun sonu podyum görseli üretir.
 */

import { createCanvas, loadImage, Image } from "@napi-rs/canvas";
import path from "path";
import fs from "fs";
import { CONFIG } from "./config";

export class ImageProcessor {
  private cache: Map<string, Buffer> = new Map();
  private loadedAssets: Map<string, Image> = new Map();

  private getAssetPath(category: string, itemId: string): string {
    let folder = "minecraft";
    if (category === "flags") folder = "flags";
    else if (category === "songs") folder = "songs";
    return path.join(process.cwd(), "assets", folder, `${itemId}.png`);
  }

  private async getAssetImage(category: string, itemId: string): Promise<Image> {
    const key = `${category}:${itemId}`;
    if (this.loadedAssets.has(key)) {
      return this.loadedAssets.get(key)!;
    }
    const assetPath = this.getAssetPath(category, itemId);
    if (!fs.existsSync(assetPath)) {
      throw new Error(`Asset bulunamadı: ${assetPath}`);
    }
    const img = await loadImage(assetPath);
    this.loadedAssets.set(key, img);
    return img;
  }

  /**
   * Belirtilen kategori, eşya ID'si ve blur seviyesi (5-0) için yüksek kaliteli kart üretir.
   */
  public async getBlurredImageBuffer(
    category: string,
    itemId: string,
    level: number,
    itemName: string = ""
  ): Promise<Buffer> {
    const cacheKey = `${category}:${itemId}:${level}:${itemName}`;
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }

    const rawImg = await this.getAssetImage(category, itemId);

    const canvasWidth = 460;
    const canvasHeight = 460;
    const canvas = createCanvas(canvasWidth, canvasHeight);
    const ctx = canvas.getContext("2d");

    // 1. Arka Plan
    ctx.fillStyle = "rgb(26, 27, 30)";
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    // Kart Kutusu (Koyu Gri)
    ctx.save();
    ctx.fillStyle = "rgb(35, 37, 41)";
    ctx.strokeStyle = "rgb(55, 58, 64)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(20, 20, canvasWidth - 40, canvasHeight - 40, 20);
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // 2. Bulanıklaştırılmış Görsel Katmanı
    const radius = CONFIG.BLUR_RADII[level] ?? 0;
    ctx.save();
    if (radius > 0) {
      ctx.filter = `blur(${radius}px)`;
    }

    if (category === "minecraft") {
      ctx.imageSmoothingEnabled = false; // Piksel çizim netliği
      const targetSize = 230;
      const x = Math.floor((canvasWidth - targetSize) / 2);
      const y = 110;
      ctx.drawImage(rawImg, x, y, targetSize, targetSize);
    } else if (category === "songs") {
      ctx.imageSmoothingEnabled = true;
      const targetSize = 240;
      const x = Math.floor((canvasWidth - targetSize) / 2);
      const y = 105;
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(x, y, targetSize, targetSize, 14);
      ctx.clip();
      ctx.drawImage(rawImg, x, y, targetSize, targetSize);
      ctx.restore();
    } else {
      ctx.imageSmoothingEnabled = true;
      const aspect = rawImg.width / Math.max(1, rawImg.height);
      let targetW = 300;
      let targetH = Math.floor(targetW / aspect);
      if (targetH > 210) {
        targetH = 210;
        targetW = Math.floor(targetH * aspect);
      }
      const x = Math.floor((canvasWidth - targetW) / 2);
      const y = 110 + Math.floor((220 - targetH) / 2);
      ctx.drawImage(rawImg, x, y, targetW, targetH);
    }
    ctx.restore();

    // 3. Durum Rozeti (Pill Badge)
    const badgeColors: Record<number, string> = {
      5: "rgb(237, 66, 69)",   // Kırmızı
      4: "rgb(230, 126, 34)",  // Turuncu
      3: "rgb(241, 196, 15)",  // Sarı
      2: "rgb(52, 152, 219)",  // Mavi
      1: "rgb(46, 204, 113)",  // Yeşil
      0: "rgb(241, 196, 15)"   // Altın
    };
    const bColor = badgeColors[level] || "rgb(88, 101, 242)";
    const points = CONFIG.POINTS_MAP[level] ?? 0;

    const badgeText =
      level === 0
        ? `COZULDU: ${itemName ? itemName.toUpperCase() : "TEBRIKLER!"}`
        : `BULANIKLIK: SEVIYE ${level}  |  ${points} PUAN`;

    ctx.save();
    ctx.font = "bold 15px sans-serif";
    const textMetrics = ctx.measureText(badgeText);
    const badgeW = Math.min(400, textMetrics.width + 40);
    const badgeH = 36;
    const badgeX = Math.floor((canvasWidth - badgeW) / 2);
    const badgeY = 36;

    // Rozet Arka Planı
    ctx.fillStyle = bColor.replace("rgb", "rgba").replace(")", ", 0.18)");
    ctx.strokeStyle = bColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 18);
    ctx.fill();
    ctx.stroke();

    // Rozet Metni
    ctx.fillStyle = "rgb(255, 255, 255)";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(badgeText, canvasWidth / 2, badgeY + badgeH / 2);
    ctx.restore();

    // 4. Alt İlerleme Göstergeleri (5 Nokta)
    ctx.save();
    for (let i = 0; i < 5; i++) {
      const cx = 160 + i * 35;
      const cy = 415;
      const isActive = i <= (5 - level);
      ctx.fillStyle = isActive ? bColor : "rgb(60, 63, 70)";
      ctx.beginPath();
      ctx.arc(cx, cy, 7, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    const buffer = canvas.toBuffer("image/png");

    if (this.cache.size > 300) {
      this.cache.clear();
    }
    this.cache.set(cacheKey, buffer);

    return buffer;
  }

  /**
   * Oyun sonu için profesyonel podyum grafiği üretir (1., 2., 3.).
   */
  public generateScoreboardImage(
    scores: Map<string, { username: string; score: number }>,
    categoryTitle: string,
    totalRounds: number
  ): Buffer {
    const w = 640;
    const h = 340;
    const canvas = createCanvas(w, h);
    const ctx = canvas.getContext("2d");

    // Dış Kart
    ctx.fillStyle = "rgb(26, 27, 30)";
    ctx.fillRect(0, 0, w, h);

    ctx.fillStyle = "rgb(35, 37, 41)";
    ctx.strokeStyle = "rgb(55, 58, 64)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(15, 15, w - 30, h - 30, 20);
    ctx.fill();
    ctx.stroke();

    // Başlık
    ctx.textAlign = "center";
    ctx.fillStyle = "rgb(241, 196, 15)";
    ctx.font = "bold 24px sans-serif";
    ctx.fillText("OYUN SONU PODYUMU", w / 2, 52);

    ctx.fillStyle = "rgb(160, 165, 175)";
    ctx.font = "14px sans-serif";
    ctx.fillText(`${totalRounds} Tur Tamamlandi  |  ${categoryTitle}`, w / 2, 78);

    const sorted = Array.from(scores.values()).sort((a, b) => b.score - a.score);
    const p1 = sorted[0] || { username: "Kimse", score: 0 };
    const p2 = sorted[1] || { username: "-", score: 0 };
    const p3 = sorted[2] || { username: "-", score: 0 };

    const baseY = 295;

    // 2. Sıra (Gümüş - Sol)
    ctx.fillStyle = "rgba(149, 165, 166, 0.7)";
    ctx.strokeStyle = "rgb(189, 195, 199)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(130, baseY - 100, 110, 100, 8);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "rgb(255, 255, 255)";
    ctx.font = "bold 36px sans-serif";
    ctx.fillText("2", 185, baseY - 40);

    ctx.fillStyle = "rgb(220, 225, 230)";
    ctx.font = "bold 16px sans-serif";
    ctx.fillText(p2.username.slice(0, 12), 185, baseY - 118);
    ctx.font = "14px sans-serif";
    ctx.fillStyle = "rgb(189, 195, 199)";
    ctx.fillText(`${p2.score} Puan`, 185, baseY - 138);

    // 1. Sıra (Altın - Orta)
    ctx.fillStyle = "rgba(241, 196, 15, 0.75)";
    ctx.strokeStyle = "rgb(243, 156, 18)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(265, baseY - 140, 110, 140, 8);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "rgb(255, 255, 255)";
    ctx.font = "bold 38px sans-serif";
    ctx.fillText("1", 320, baseY - 55);

    ctx.fillStyle = "rgb(255, 235, 120)";
    ctx.font = "bold 17px sans-serif";
    ctx.fillText(`${p1.username.slice(0, 12)} (Lider)`, 320, baseY - 160);
    ctx.font = "bold 15px sans-serif";
    ctx.fillStyle = "rgb(241, 196, 15)";
    ctx.fillText(`${p1.score} Puan`, 320, baseY - 182);

    // 3. Sıra (Bronz - Sağ)
    ctx.fillStyle = "rgba(211, 84, 0, 0.65)";
    ctx.strokeStyle = "rgb(230, 126, 34)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(400, baseY - 70, 110, 70, 8);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "rgb(255, 255, 255)";
    ctx.font = "bold 32px sans-serif";
    ctx.fillText("3", 455, baseY - 25);

    ctx.fillStyle = "rgb(230, 180, 150)";
    ctx.font = "bold 15px sans-serif";
    ctx.fillText(p3.username.slice(0, 12), 455, baseY - 88);
    ctx.font = "14px sans-serif";
    ctx.fillStyle = "rgb(230, 126, 34)";
    ctx.fillText(`${p3.score} Puan`, 455, baseY - 108);

    return canvas.toBuffer("image/png");
  }
}

export const imageProcessor = new ImageProcessor();
