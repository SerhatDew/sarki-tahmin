import { PermissionFlagsBits, type User, type VoiceChannel } from "discord.js";
import { CONFIG } from "./config";
import { activeSessions, GameSession } from "./gameSession";
import { VoicePlayback } from "./voicePlayback";

export function hasHumanListeners(channel: VoiceChannel): boolean {
  return channel.members.some(member => !member.user.bot);
}

export async function stopEmptyVoiceGame(channel: VoiceChannel): Promise<void> {
  const session = activeSessions.get(channel.id);
  if (session?.audio && !hasHumanListeners(channel)) {
    await session.endGame("Ses kanalında oyuncu kalmadı; oyun kapatıldı.");
  }
}

export async function startVoiceGame(channel: VoiceChannel, author: User, rounds = CONFIG.DEFAULT_ROUNDS): Promise<GameSession> {
  if (!hasHumanListeners(channel)) {
    throw new Error("Sesli oyun için kanalda en az bir oyuncu bulunmalı.");
  }
  const permissions = channel.permissionsFor(channel.client.user!);
  const required = [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.Connect,
    PermissionFlagsBits.Speak,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.EmbedLinks,
    PermissionFlagsBits.AttachFiles
  ];
  if (!permissions?.has(required)) {
    throw new Error("Botun ses kanalında görüntüleme, bağlanma, konuşma ve sohbet mesajı/dosya gönderme izinleri gerekiyor.");
  }
  for (const session of activeSessions.values()) {
    if (session.channel.id === channel.id || (session.audio && session.channel.guildId === channel.guildId)) {
      throw new Error("Bu kanalda oyun veya sunucuda başka bir sesli oyun zaten açık.");
    }
  }

  const audio = new VoicePlayback(channel, error => {
    console.error("Ses bağlantısı hatası:", error);
    void session.endGame("Ses bağlantısı kesildi; oyun kapatıldı.").catch(endError => {
      console.error("Sesli oyun kapatılamadı:", endError);
    });
  });
  const session = new GameSession(channel, author, "songs", "voice", rounds, audio);
  session.isRunning = true;
  activeSessions.set(channel.id, session);
  try {
    await audio.connect();
    await stopEmptyVoiceGame(channel);
    if (session.isRunning) await session.start();
    if (!session.isRunning) throw new Error("Sesli oyun hazırlanırken kapatıldı.");
    return session;
  } catch (error) {
    await session.endGame("Sesli oyun başlatılamadı.");
    throw error;
  }
}
