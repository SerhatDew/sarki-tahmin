import { afterEach, expect, mock, spyOn, test, type Mock } from "bun:test";
import { EventEmitter } from "node:events";
import type { Message, TextChannel, User } from "discord.js";
import { activeSessions, GameSession } from "../src/gameSession";
import { dataManager } from "../src/dataManager";
import { db } from "../src/database";
import { imageProcessor } from "../src/imageProcessor";

function createSession(mode = "chat") {
  const collectors: Array<EventEmitter & { stop: Mock<() => void> }> = [];
  const edit = mock(async (_payload: unknown) => {});
  const message = {
    edit,
    createMessageComponentCollector() {
      const collector = Object.assign(new EventEmitter(), { stop: mock(() => {}) });
      collectors.push(collector);
      return collector;
    }
  } as unknown as Message;
  const send = mock(async (_payload: unknown) => message);
  const channel = { id: "session-test", guildId: "guild-test", send } as unknown as TextChannel;
  const user = { id: "player-test", displayName: "Oyuncu", displayAvatarURL: () => "https://example.com/avatar.png" } as User;
  const session = new GameSession(channel, user, "songs", mode, 3);
  session.isRunning = true;
  activeSessions.set(channel.id, session);
  spyOn(imageProcessor, "getBlurredImageBuffer").mockResolvedValue(Buffer.from("image"));
  spyOn(db, "recordGuess").mockImplementation(() => {});
  const finish = spyOn(db, "recordGameFinish").mockImplementation(() => {});
  return { session, user, send, edit, collectors, finish };
}

afterEach(async () => {
  const sessions = [...activeSessions.values()];
  for (const session of sessions) {
    if (session.isRunning) await session.endGame();
  }
  activeSessions.clear();
  mock.restore();
});

test("kapanan oturum geç gelen cevaba puan vermez ve bir kez kaydedilir", async () => {
  const { session, user, finish } = createSession();
  session.currentItem = dataManager.songs[0]!;
  await session.endGame();
  await session.endGame();
  await session.onCorrectGuess(user);
  expect(session.scores.has(user.id)).toBe(false);
  expect(finish).toHaveBeenCalledTimes(1);
});

test("görsel hazırlanırken kapanan oturum yeni tur mesajı göndermez", async () => {
  const { session, send } = createSession();
  const image = Promise.withResolvers<Buffer>();
  spyOn(imageProcessor, "getBlurredImageBuffer").mockReturnValueOnce(image.promise);
  const pending = session.nextRound();
  await session.endGame();
  image.resolve(Buffer.from("image"));
  await pending;
  expect(send).toHaveBeenCalledTimes(1);
});

test("eski turun butonları yeni turun seviyesini değiştirmez", async () => {
  const { session, collectors } = createSession("buttons");
  await session.nextRound();
  const oldCollector = collectors[0]!;
  await session.nextRound();
  const reply = mock(async (_payload: unknown) => {});
  oldCollector.emit("collect", { customId: "action_clarify", user: session.author, reply });
  await Promise.resolve();
  expect(session.currentLevel).toBe(5);
  expect(oldCollector.stop).toHaveBeenCalled();
});

test("eski zamanlayıcı yeni turun puanını düşürmez", async () => {
  const { session } = createSession();
  const callbacks: Array<() => void> = [];
  spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void) => {
    callbacks.push(callback);
    return callbacks.length as unknown as NodeJS.Timeout;
  }) as typeof setTimeout);
  const clear = spyOn(globalThis, "clearTimeout").mockImplementation(() => {});
  await session.nextRound();
  const oldTick = callbacks[0]!;
  await session.nextRound();
  oldTick();
  await Promise.resolve();
  expect(session.currentLevel).toBe(5);
  expect(clear).toHaveBeenCalled();
});
