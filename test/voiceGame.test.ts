import { afterEach, expect, mock, spyOn, test } from "bun:test";
import { Collection, PermissionFlagsBits, PermissionsBitField, type GuildMember, type Message, type User, type VoiceChannel } from "discord.js";
import { activeSessions, GameSession } from "../src/gameSession";
import { dataManager } from "../src/dataManager";
import { db } from "../src/database";
import * as previews from "../src/songPreview";
import { VoicePlayback } from "../src/voicePlayback";
import { startVoiceGame, stopEmptyVoiceGame } from "../src/voiceGame";

function createChannel(humans: number, bots = 1) {
  const members = new Collection<string, GuildMember>();
  for (let i = 0; i < humans + bots; i++) {
    const id = i < humans ? `human-${i}` : `bot-${i}`;
    members.set(id, { id, user: { id, bot: i >= humans } } as GuildMember);
  }
  const message = { id: "voice-panel", edit: mock(async () => message) } as unknown as Message;
  const send = mock(async () => message);
  const author = { id: "human-0", displayName: "Oyuncu" } as User;
  const channel = {
    id: "voice-test", guildId: "guild-test", members, send,
    client: { user: { id: "bot", bot: true } },
    permissionsFor: () => new PermissionsBitField(PermissionFlagsBits.Administrator)
  } as unknown as VoiceChannel;
  const connect = spyOn(VoicePlayback.prototype, "connect").mockResolvedValue();
  spyOn(VoicePlayback.prototype, "play").mockResolvedValue();
  const destroy = spyOn(VoicePlayback.prototype, "destroy");
  spyOn(db, "recordGameFinish").mockImplementation(() => {});
  spyOn(previews, "resolveSongPreview").mockResolvedValue({
    item: dataManager.songs[0]!, previewUrl: "https://audio-ssl.itunes.apple.com/preview.m4a",
    sourceUrl: "https://music.apple.com/tr/album/song/123"
  });
  return { channel, author, members, send, connect, destroy };
}

afterEach(async () => {
  for (const session of [...activeSessions.values()]) await session.endGame();
  activeSessions.clear();
  mock.restore();
});

for (const bots of [0, 2]) {
  test(`insan olmayan kanalda oyun veya bağlantı açılmaz (${bots} bot)`, async () => {
    const { channel, author, connect, send } = createChannel(0, bots);
    await expect(startVoiceGame(channel, author)).rejects.toThrow("oyuncu");
    expect(activeSessions.has(channel.id)).toBe(false);
    expect(connect).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
}

test("bir oyuncu kaldığı sürece sesli oyun devam eder", async () => {
  const { channel, author, members, destroy } = createChannel(2);
  const session = await startVoiceGame(channel, author);
  members.delete("human-0");
  await stopEmptyVoiceGame(channel);
  expect(session.isRunning).toBe(true);
  expect(activeSessions.get(channel.id)).toBe(session);
  expect(destroy).not.toHaveBeenCalled();
});

test("son oyuncu çıkınca diğer botlar oyunu açık tutamaz", async () => {
  const { channel, author, members, destroy, send } = createChannel(1, 2);
  const session = await startVoiceGame(channel, author);
  members.delete("human-0");
  await stopEmptyVoiceGame(channel);
  await stopEmptyVoiceGame(channel);
  expect(session.isRunning).toBe(false);
  expect(session.roundFinished).toBe(true);
  expect(activeSessions.has(channel.id)).toBe(false);
  expect(destroy).toHaveBeenCalledTimes(1);
  expect(send).toHaveBeenCalledTimes(1);
});

test("bağlantı hazırlanırken boşalan kanal kapanır ve geç sonuç oyunu başlatmaz", async () => {
  const { channel, author, members, connect, destroy } = createChannel(1);
  const ready = Promise.withResolvers<void>();
  connect.mockReturnValueOnce(ready.promise);
  const pending = startVoiceGame(channel, author);
  const session = activeSessions.get(channel.id)!;
  members.delete("human-0");
  await stopEmptyVoiceGame(channel);
  ready.resolve();
  await expect(pending).rejects.toThrow("kapatıldı");
  expect(session.isRunning).toBe(false);
  expect(session.currentRound).toBe(0);
  expect(activeSessions.has(channel.id)).toBe(false);
  expect(destroy).toHaveBeenCalledTimes(1);
});

test("bağlantı sonunda üyelik yeniden kontrol edilir", async () => {
  const { channel, author, members, connect } = createChannel(1);
  connect.mockImplementationOnce(async () => { members.delete("human-0"); });
  await expect(startVoiceGame(channel, author)).rejects.toThrow("kapatıldı");
  expect(activeSessions.has(channel.id)).toBe(false);
});

test("boş kanal kontrolü görsel oyunu kapatmaz", async () => {
  const { channel, author } = createChannel(0);
  const session = new GameSession(channel, author, "flags");
  session.isRunning = true;
  activeSessions.set(channel.id, session);
  await stopEmptyVoiceGame(channel);
  expect(session.isRunning).toBe(true);
  expect(activeSessions.get(channel.id)).toBe(session);
});
