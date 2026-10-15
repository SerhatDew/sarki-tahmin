import { createCanvas } from "@napi-rs/canvas";
import fs from "fs";
import path from "path";

interface SongData {
  id: string;
  name: string;
  artist: string;
  album: string;
  year: number;
  genre: string;
}

const songsPath = path.join(process.cwd(), "data", "songs.json");
const songs: SongData[] = JSON.parse(fs.readFileSync(songsPath, "utf-8"));

const outputDir = path.join(process.cwd(), "assets", "songs");
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// Genre color palettes [bg1, bg2, accent, vinylLabel]
const genreThemes: Record<string, [string, string, string, string]> = {
  "Anadolu Rock": ["#1a0f00", "#3d2100", "#d47500", "#f59e0b"],
  "Türkçe Rock": ["#0b132b", "#1c2541", "#48cae4", "#00b4d8"],
  "Alternatif Rock": ["#1b1b2f", "#1f4068", "#e43f5a", "#e43f5a"],
  "Nu-Metal / Rock": ["#181818", "#2c003e", "#fe346e", "#ff5722"],
  "Hard Rock": ["#111111", "#2b0909", "#e63946", "#ffb703"],
  "Rock": ["#0d1b2a", "#1b263b", "#415a77", "#778da9"],
  "Grunge / Rock": ["#1a1c20", "#2c3e50", "#bdc3c7", "#e74c3c"],
  "Ska Punk / Rock": ["#14213d", "#fca311", "#e5e5e5", "#fca311"],
  "Türkçe Pop": ["#2b0938", "#5c1d68", "#f72585", "#7209b7"],
  "Pop": ["#1a0033", "#430066", "#c77dff", "#e0aaff"],
  "Pop / Eurovision": ["#190061", "#240046", "#ff9e00", "#ffd60a"],
  "Synthwave / Pop": ["#0f051d", "#240046", "#ff007f", "#00f0ff"],
  "Türkçe Rap": ["#0d0d0d", "#1a1a2e", "#e94560", "#0f3460"],
  "Türkçe Trap / Rap": ["#050505", "#16001e", "#b5179e", "#4cc9f0"],
  "İndie Pop / Rock": ["#0d1f2d", "#1d2d44", "#a9d6e5", "#89c2d9"],
  "İndie Rock": ["#1e1b18", "#3a3028", "#d4a373", "#e9edc9"],
  "Funk / Disco": ["#200122", "#6f0000", "#ffba08", "#f48c06"],
  "Özgün Müzik": ["#1c1917", "#292524", "#78716c", "#a8a29e"]
};

function drawCover(song: SongData): Buffer {
  const width = 500;
  const height = 500;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  const [c1, c2, accent, vinylColor] = genreThemes[song.genre] || [
    "#121212",
    "#242424",
    "#3b82f6",
    "#60a5fa"
  ];

  // Background gradient
  const bgGrad = ctx.createLinearGradient(0, 0, width, height);
  bgGrad.addColorStop(0, c1);
  bgGrad.addColorStop(1, c2);
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, width, height);

  // Outer border & frame
  ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
  ctx.lineWidth = 10;
  ctx.strokeRect(10, 10, width - 20, height - 20);

  // Vinyl record in background
  const centerX = width / 2;
  const centerY = height / 2 - 30;
  const outerRadius = 160;

  // Vinyl shadow
  ctx.save();
  ctx.shadowColor = "rgba(0, 0, 0, 0.6)";
  ctx.shadowBlur = 24;
  ctx.fillStyle = "#111111";
  ctx.beginPath();
  ctx.arc(centerX, centerY, outerRadius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Vinyl grooves
  ctx.strokeStyle = "rgba(255, 255, 255, 0.05)";
  ctx.lineWidth = 1.5;
  for (let r = 75; r < outerRadius - 10; r += 10) {
    ctx.beginPath();
    ctx.arc(centerX, centerY, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Vinyl reflection highlights
  const sheenGrad = ctx.createLinearGradient(centerX - outerRadius, centerY - outerRadius, centerX + outerRadius, centerY + outerRadius);
  sheenGrad.addColorStop(0, "rgba(255, 255, 255, 0.12)");
  sheenGrad.addColorStop(0.3, "rgba(255, 255, 255, 0.0)");
  sheenGrad.addColorStop(0.7, "rgba(255, 255, 255, 0.08)");
  sheenGrad.addColorStop(1, "rgba(255, 255, 255, 0.0)");
  ctx.fillStyle = sheenGrad;
  ctx.beginPath();
  ctx.arc(centerX, centerY, outerRadius, 0, Math.PI * 2);
  ctx.fill();

  // Vinyl center label
  ctx.fillStyle = vinylColor;
  ctx.beginPath();
  ctx.arc(centerX, centerY, 62, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "rgba(0,0,0,0.3)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(centerX, centerY, 52, 0, Math.PI * 2);
  ctx.stroke();

  // Spindle hole
  ctx.fillStyle = "#111111";
  ctx.beginPath();
  ctx.arc(centerX, centerY, 14, 0, Math.PI * 2);
  ctx.fill();

  // Genre badge at top left
  ctx.fillStyle = "rgba(255, 255, 255, 0.1)";
  ctx.beginPath();
  ctx.roundRect(26, 26, 170, 32, 16);
  ctx.fill();

  ctx.fillStyle = accent;
  ctx.font = "bold 13px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(song.genre.toUpperCase(), 111, 47);

  // Year badge at top right
  ctx.fillStyle = "rgba(255, 255, 255, 0.1)";
  ctx.beginPath();
  ctx.roundRect(width - 96, 26, 70, 32, 16);
  ctx.fill();

  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 14px sans-serif";
  ctx.fillText(song.year.toString(), width - 61, 47);

  // Soundwave decorative visualizer
  const waveY = height - 120;
  const waveBars = 36;
  const barWidth = 6;
  const spacing = 6;
  const startX = (width - (waveBars * (barWidth + spacing))) / 2;

  ctx.fillStyle = accent;
  for (let i = 0; i < waveBars; i++) {
    // Generate harmonic-like heights
    const seed = (i * 19 + song.year) % 100;
    const barHeight = 8 + (Math.sin(i * 0.4) * 0.5 + 0.5) * 32 + (seed % 14);
    ctx.fillRect(startX + i * (barWidth + spacing), waveY - barHeight / 2, barWidth, barHeight);
  }

  // Song Title & Artist text container at bottom
  ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
  ctx.fillRect(0, height - 90, width, 90);

  ctx.strokeStyle = accent;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, height - 90);
  ctx.lineTo(width, height - 90);
  ctx.stroke();

  // Song title
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 24px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(song.name, width / 2, height - 52, width - 40);

  // Artist name
  ctx.fillStyle = "rgba(255, 255, 255, 0.75)";
  ctx.font = "16px sans-serif";
  ctx.fillText(song.artist, width / 2, height - 24, width - 40);

  return canvas.toBuffer("image/png");
}

let count = 0;
for (const song of songs) {
  const filePath = path.join(outputDir, `${song.id}.png`);
  const buffer = drawCover(song);
  fs.writeFileSync(filePath, buffer);
  count++;
}

console.log(`[+] ${count} adet sarki kapak gorseli olusturuldu: assets/songs/`);
