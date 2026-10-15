import { afterEach, expect, mock, spyOn, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MessageFlags, type ActionRowBuilder, type AttachmentBuilder, type ButtonBuilder, type ButtonInteraction, type EmbedBuilder, type Message, type ModalBuilder, type ModalSubmitInteraction, type TextChannel, type User } from "discord.js";
import { activeSessions, GameSession } from "../src/gameSession";
import { dataManager } from "../src/dataManager";
import { AppDatabase, db } from "../src/database";
import { imageProcessor } from "../src/imageProcessor";
import * as previews from "../src/songPreview";

interface PanelPayload {
  embeds?: EmbedBuilder[];
  files?: AttachmentBuilder[];
  components?: ActionRowBuilder<ButtonBuilder>[];
  attachments?: unknown[];
}

function createSession(mode = "form") {
  const panels: PanelPayload[] = [];
  const edit = mock(async (payload: PanelPayload) => { panels.push(payload); return message; });
  const message = { id: "shared-panel", edit } as unknown as Message;
  const send = mock(async (payload: PanelPayload) => { panels.push(payload); return message; });
  const channel = { id: "session-test", guildId: "guild-test", send } as unknown as TextChannel;
  const user = { id: "player-test", displayName: "Oyuncu", displayAvatarURL: () => "https://example.com/avatar.png" } as User;
  const session = new GameSession(channel, user, "songs", mode, 3);
  session.isRunning = true;
  activeSessions.set(channel.id, session);
  spyOn(imageProcessor, "getBlurredImageBuffer").mockResolvedValue(Buffer.from("image"));
  const guesses = spyOn(db, "recordGuess").mockImplementation(() => {});
  const finish = spyOn(db, "recordGameFinish").mockImplementation(() => {});

  function button(action: string, player = user) {
    const data = panels.at(-1)?.components?.flatMap(row => row.components.map(component => component.toJSON()))
      .find(component => "custom_id" in component && component.custom_id.endsWith(`:${action}`));
    if (!data || !("custom_id" in data)) throw new Error(`Buton bulunamadı: ${action}`);
    const reply = mock(async (_payload: { flags?: MessageFlags }) => {});
    const showModal = mock(async (_modal: ModalBuilder) => {});
    const interaction = {
      customId: data.custom_id, channelId: channel.id, message, user: player,
      reply, showModal, deferUpdate: mock(async () => {})
    } as unknown as ButtonInteraction;
    return { interaction, reply, showModal };
  }

  async function openForm(player = user) {
    const click = button("guess", player);
    await session.handleButtonInteraction(click.interaction);
    const modal = click.showModal.mock.calls[0]?.[0];
    if (!modal) throw new Error("Tahmin formu açılmadı");
    return modal.toJSON().custom_id;
  }

  function submission(formId: string, answer: string, player = user) {
    const reply = mock(async (_payload: { flags?: MessageFlags }) => {});
    const interaction = {
      customId: formId, channelId: channel.id, user: player, reply,
      fields: { getTextInputValue: () => answer }
    } as unknown as ModalSubmitInteraction;
    return { interaction, reply };
  }
  return { session, user, message, send, edit, panels, guesses, finish, button, openForm, submission };
}

afterEach(async () => {
  for (const session of [...activeSessions.values()]) {
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

test("görsel hazırlanırken kapanan oturum paneli yeniden etkinleştirmez", async () => {
  const { session, send, panels } = createSession();
  const image = Promise.withResolvers<Buffer>();
  spyOn(imageProcessor, "getBlurredImageBuffer").mockReturnValueOnce(image.promise);
  const pending = session.nextRound();
  await session.endGame();
  const finalPanel = panels.at(-1);
  image.resolve(Buffer.from("image"));
  await pending;
  expect(send).toHaveBeenCalledTimes(1);
  expect(panels.at(-1)?.components).toEqual([]);
  expect(panels.at(-1)).toBe(finalPanel);
});

test("eski turun önbellekteki butonları yeni turun seviyesini değiştirmez", async () => {
  const { session, button } = createSession("buttons");
  await session.nextRound();
  const oldClick = button("hint");
  await session.nextRound();
  await session.handleButtonInteraction(oldClick.interaction);
  expect(session.currentLevel).toBe(5);
  expect(oldClick.reply.mock.calls[0]?.[0].flags).toBe(MessageFlags.Ephemeral);
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

test("ses başlamadan form açılmaz ve kapanan oturum yeniden canlanmaz", async () => {
  const { session, button } = createSession("voice");
  const item = dataManager.songs[0]!;
  spyOn(previews, "resolveSongPreview").mockResolvedValue({
    item, previewUrl: "https://audio-ssl.itunes.apple.com/preview.m4a",
    sourceUrl: "https://music.apple.com/tr/album/song/123"
  });
  const entered = Promise.withResolvers<void>();
  const ready = Promise.withResolvers<void>();
  const destroy = mock(() => {});
  session.audio = { play() { entered.resolve(); return ready.promise; }, stop() {}, destroy };
  const pending = session.nextRound();
  await entered.promise;
  const click = button("guess");
  await session.handleButtonInteraction(click.interaction);
  expect(click.showModal).not.toHaveBeenCalled();
  expect(session.scores.size).toBe(0);
  await session.endGame();
  ready.resolve();
  await pending;
  expect(session.roundFinished).toBe(true);
  expect(destroy).toHaveBeenCalledTimes(1);
});

test("eşzamanlı doğru formlarda yalnızca ilk oyuncu puan alır ve ses durur", async () => {
  const { session, user, send, guesses, openForm, submission } = createSession("voice");
  const item = dataManager.songs[0]!;
  spyOn(previews, "resolveSongPreview").mockResolvedValue({
    item, previewUrl: "https://audio-ssl.itunes.apple.com/preview.m4a",
    sourceUrl: "https://music.apple.com/tr/album/song/123"
  });
  let playing = false;
  session.audio = {
    async play() { playing = true; }, stop() { playing = false; }, destroy() { playing = false; }
  };
  await session.nextRound();
  const secondUser = { ...user, id: "second-player", displayName: "Diğer Oyuncu" } as User;
  const firstForm = await openForm();
  const secondForm = await openForm(secondUser);
  const first = submission(firstForm, item.name);
  const second = submission(secondForm, item.name, secondUser);
  expect(playing).toBe(true);
  const pending = session.handleModalGuess(first.interaction);
  expect(playing).toBe(false);
  await session.handleModalGuess(second.interaction);
  expect(session.scores.get(user.id)?.score).toBe(50);
  expect(session.scores.has(secondUser.id)).toBe(false);
  expect(guesses).toHaveBeenCalledTimes(1);
  expect(first.reply.mock.calls[0]?.[0].flags).toBe(MessageFlags.Ephemeral);
  expect(second.reply.mock.calls[0]?.[0].flags).toBe(MessageFlags.Ephemeral);
  await session.endGame();
  await pending;
  expect(send).toHaveBeenCalledTimes(1);
});

test("turlar ve oyun sonu aynı mesajı kullanır ve eski dosyalar temizlenir", async () => {
  const { session, send, panels } = createSession();
  await session.nextRound();
  await session.nextRound();
  await session.endGame();
  expect(send).toHaveBeenCalledTimes(1);
  expect(panels.at(-1)?.components).toEqual([]);
  expect(panels.at(-1)?.attachments).toEqual([]);
  const finalPanel = panels.at(-1)!;
  expect(finalPanel.embeds?.[0]?.data.image?.url).toBe(`attachment://${finalPanel.files?.[0]?.name}`);
});

test("herkes aynı panelden özel tahmin yapabilir ve üçüncü yanlışta ipucu açılır", async () => {
  const { session, user, openForm, submission, send } = createSession();
  await session.nextRound();
  const other = { ...user, id: "second-player" } as User;
  const form = await openForm();
  const otherForm = await openForm(other);
  for (let i = 0; i < 3; i++) {
    const wrong = submission(i % 2 ? otherForm : form, "katalogda olmayan bir cevap", i % 2 ? other : user);
    await session.handleModalGuess(wrong.interaction);
    expect(wrong.reply.mock.calls[0]?.[0].flags).toBe(MessageFlags.Ephemeral);
    expect(session.currentLevel).toBe(i < 2 ? 5 : 4);
  }
  expect(session.scores.size).toBe(0);
  expect(send).toHaveBeenCalledTimes(1);
});

test("önceki turda açılmış form yeni turda doğru cevapla bile puan kazandırmaz", async () => {
  const { session, openForm, submission, guesses } = createSession();
  spyOn(dataManager, "getRandomItem").mockReturnValue(dataManager.songs[0]!);
  await session.nextRound();
  const form = await openForm();
  await session.nextRound();
  const stale = submission(form, session.currentItem!.name);
  await session.handleModalGuess(stale.interaction);
  expect(session.scores.size).toBe(0);
  expect(guesses).not.toHaveBeenCalled();
  expect(stale.reply.mock.calls[0]?.[0].flags).toBe(MessageFlags.Ephemeral);
});

test("aynı kanaldaki yeni oturum önceki oyunun formunu kabul etmez", async () => {
  const old = createSession();
  await old.session.nextRound();
  const oldForm = await old.openForm();
  await old.session.endGame();
  const current = createSession();
  await current.session.nextRound();
  const stale = current.submission(oldForm, current.session.currentItem!.name);
  await current.session.handleModalGuess(stale.interaction);
  expect(current.session.scores.size).toBe(0);
  expect(current.session.roundFinished).toBe(false);
  expect(stale.reply.mock.calls[0]?.[0].flags).toBe(MessageFlags.Ephemeral);
});

test("ilk mesaj gönderilirken kapanan oyun ikinci bir panel oluşturmaz", async () => {
  const { session, message, send, panels } = createSession();
  const entered = Promise.withResolvers<void>();
  const sent = Promise.withResolvers<void>();
  send.mockImplementationOnce(async () => { entered.resolve(); await sent.promise; return message; });
  const round = session.nextRound();
  await entered.promise;
  const closing = session.endGame();
  sent.resolve();
  await Promise.all([round, closing]);
  expect(send).toHaveBeenCalledTimes(1);
  expect(panels.at(-1)?.components).toEqual([]);
});

test("geç tamamlanan görsel ipucu sonuç panelini yeniden açamaz", async () => {
  const { session, button, panels } = createSession();
  await session.nextRound();
  const image = Promise.withResolvers<Buffer>();
  spyOn(imageProcessor, "getBlurredImageBuffer").mockReturnValueOnce(image.promise);
  const pending = session.handleButtonInteraction(button("hint").interaction);
  await session.endGame();
  const finalPanel = panels.at(-1);
  image.resolve(Buffer.from("late-image"));
  await pending;
  expect(panels.at(-1)).toBe(finalPanel);
  expect(panels.at(-1)?.components).toEqual([]);
});

test("ipucu açılması şıkların yerini ve seçimin anlamını değiştirmez", async () => {
  const { session, user, button, send } = createSession("buttons");
  const [correct, wrong, third, fourth] = dataManager.songs;
  spyOn(dataManager, "getRandomItem").mockReturnValue(correct!);
  spyOn(dataManager, "getMultipleChoiceOptions")
    .mockReturnValueOnce([correct!, wrong!, third!, fourth!])
    .mockReturnValue([wrong!, correct!, third!, fourth!]);
  await session.nextRound();
  const choice = button("choice_0");
  await session.handleButtonInteraction(button("hint").interaction);
  const pending = session.handleButtonInteraction(choice.interaction);
  expect(session.scores.get(user.id)?.score).toBe(40);
  await session.endGame();
  await pending;
  expect(send).toHaveBeenCalledTimes(1);
});

test("süre dolunca cevap ve sonraki tur aynı panelde gösterilir", async () => {
  const { session, send, panels } = createSession();
  await session.nextRound();
  const answer = session.currentItem!.name;
  await session.onRoundTimeout();
  expect(session.history[0]?.item).toBe(answer);
  expect(session.history[0]?.points).toBe(0);
  expect(session.currentRound).toBe(2);
  expect(session.roundFinished).toBe(false);
  expect(send).toHaveBeenCalledTimes(1);
  const reveal = panels.find(panel => panel.components?.length === 0);
  expect(reveal?.embeds?.[0]?.data.description).toContain(answer);
  expect(panels.at(-1)?.attachments).toEqual([]);
});

for (const scenario of [
  { name: "normal bitiş", currentRound: 4, completed: 3 },
  { name: "erken bitiş", currentRound: 2, completed: 1 }
]) {
  test(`oyun geçmişi yalnızca tamamlanan turları sayar: ${scenario.name}`, async () => {
    const { session, user, finish } = createSession();
    const directory = mkdtempSync(join(tmpdir(), "sarki-history-"));
    const filename = join(directory, "stats.db");
    const storage = new AppDatabase(filename);
    try {
      finish.mockImplementation((...args) => storage.recordGameFinish(...args));
      session.currentRound = scenario.currentRound;
      session.scores.set(user.id, { username: user.displayName, score: 50 });
      for (let round = 1; round <= scenario.completed; round++) {
        session.history.push({ round, item: "Dönence", winner: user.displayName, points: 50, level: 5 });
      }
      await session.endGame();
      const reader = new Database(filename, { readonly: true });
      try {
        const result = reader.query<{ total_rounds: number }, []>("SELECT total_rounds FROM game_history").get();
        expect(result?.total_rounds).toBe(scenario.completed);
      } finally {
        reader.close();
      }
    } finally {
      storage.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
}
