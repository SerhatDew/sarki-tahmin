import { afterEach, expect, mock, spyOn, test } from "bun:test";
import { MessageFlags, type ActionRowBuilder, type ButtonBuilder, type ButtonInteraction, type EmbedBuilder, type Message, type ModalBuilder, type ModalSubmitInteraction, type TextChannel, type User } from "discord.js";
import { activeSessions, GameSession } from "../src/gameSession";
import { dataManager, type GameItem } from "../src/dataManager";
import { db } from "../src/database";
import { imageProcessor } from "../src/imageProcessor";
import * as songLyrics from "../src/songLyrics";
import { CONFIG } from "../src/config";
import type { SongLyrics } from "../src/songLyrics";

interface PanelPayload {
  embeds?: EmbedBuilder[];
  components?: ActionRowBuilder<ButtonBuilder>[];
  files?: unknown[];
  attachments?: unknown[];
}

interface CapturedTimer {
  callback: () => void;
  delay: number;
  fired: boolean;
  cancelled: boolean;
}

function createSession(totalRounds = 2) {
  const panels: PanelPayload[] = [];
  const message = {
    id: "lyrics-shared-panel",
    edit: mock(async (payload: PanelPayload) => {
      panels.push(payload);
      return message;
    })
  } as unknown as Message;
  const send = mock(async (payload: PanelPayload) => {
    panels.push(payload);
    return message;
  });
  const channel = { id: "lyrics-channel", guildId: "lyrics-guild", send } as unknown as TextChannel;
  const user = {
    id: "lyrics-player",
    displayName: "Söz Oyuncusu",
    displayAvatarURL: () => "https://example.com/avatar.png"
  } as User;
  const session = new GameSession(channel, user, "songs", "lyrics", totalRounds);
  session.isRunning = true;
  activeSessions.set(channel.id, session);

  spyOn(db, "recordGuess").mockImplementation(() => {});
  spyOn(db, "recordGameFinish").mockImplementation(() => {});
  spyOn(imageProcessor, "generateScoreboardImage").mockReturnValue(Buffer.from("podium"));
  spyOn(imageProcessor, "getBlurredImageBuffer").mockResolvedValue(Buffer.from("image"));

  function button(action: string, player = user) {
    const data = panels.at(-1)?.components
      ?.flatMap(row => row.components.map(component => component.toJSON()))
      .find(component => "custom_id" in component && component.custom_id.endsWith(`:${action}`));
    if (!data || !("custom_id" in data)) throw new Error(`Buton bulunamadı: ${action}`);

    const reply = mock(async (_payload: { flags?: MessageFlags }) => {});
    const showModal = mock(async (_modal: ModalBuilder) => {});
    const interaction = {
      customId: data.custom_id,
      channelId: channel.id,
      message,
      user: player,
      reply,
      showModal,
      deferUpdate: mock(async () => {})
    } as unknown as ButtonInteraction;
    return { interaction, reply, showModal };
  }

  async function openForm(player = user) {
    const click = button("guess", player);
    await session.handleButtonInteraction(click.interaction);
    const modal = click.showModal.mock.calls[0]?.[0];
    if (!modal) throw new Error("Tahmin formu açılmadı");
    return { formId: modal.toJSON().custom_id as string, modal, click };
  }

  function submission(formId: string, answer: string, player = user) {
    const reply = mock(async (_payload: { flags?: MessageFlags }) => {});
    const interaction = {
      customId: formId,
      channelId: channel.id,
      user: player,
      reply,
      fields: { getTextInputValue: () => answer }
    } as unknown as ModalSubmitInteraction;
    return { interaction, reply };
  }

  return { session, user, message, send, panels, button, openForm, submission };
}

function fixture(item: GameItem, lines: string[], sourceUrl = "https://lrclib.net/api/get?track_name=hidden-answer") : SongLyrics {
  return { item, lines, sourceUrl };
}

function payloadText(panel: PanelPayload | undefined): string {
  return JSON.stringify(panel?.embeds?.map(embed => embed.toJSON()) ?? []);
}

function lyricFields(panel: PanelPayload | undefined, marker: string): Array<{ name: string; value: string }> {
  const fields = panel?.embeds?.flatMap(embed => embed.toJSON().fields ?? []) ?? [];
  return fields.filter(field => field.value.includes(marker));
}

async function flushMicrotasks() {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

function fakeTimers() {
  const timers: CapturedTimer[] = [];
  let now = Date.now();
  spyOn(Date, "now").mockImplementation(() => now);
  spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void, delay = 0) => {
    const timer: CapturedTimer = { callback, delay, fired: false, cancelled: false };
    timers.push(timer);
    return timer as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout);
  spyOn(globalThis, "clearTimeout").mockImplementation(((timer: ReturnType<typeof setTimeout>) => {
    const captured = timer as unknown as CapturedTimer;
    captured.cancelled = true;
  }) as typeof clearTimeout);

  async function runNext(delay?: number): Promise<boolean> {
    const timer = timers.find(candidate =>
      !candidate.fired && !candidate.cancelled && (delay === undefined || candidate.delay === delay));
    if (!timer) return false;
    timer.fired = true;
    now += timer.delay;
    timer.callback();
    await flushMicrotasks();
    return true;
  }

  return { timers, runNext };
}

async function runLyricSteps(runNext: (delay?: number) => Promise<boolean>, count: number) {
  for (let i = 0; i < count; i++) {
    const ran = await runNext(CONFIG.BLUR_STEP_SECONDS * 1000);
    if (!ran) break;
  }
}

afterEach(async () => {
  for (const session of [...activeSessions.values()]) {
    if (session.isRunning) await session.endGame();
  }
  activeSessions.clear();
  mock.restore();
});

test("lyrics mode reveals new lines beyond 25 seconds without timeout or answer leakage", async () => {
  const { session, panels } = createSession();
  const timers = fakeTimers();
  const lines = Array.from({ length: 10 }, (_, index) => `lyric-after-deadline-${index}`);
  const item = dataManager.songs[0]!;
  spyOn(dataManager, "getRandomItem").mockReturnValue(item);
  spyOn(songLyrics, "resolveSongLyrics").mockResolvedValue(fixture(item, lines));

  await session.nextRound();
  expect(session.currentRound).toBe(1);
  expect(session.roundFinished).toBe(false);
  expect(session.history).toHaveLength(0);
  expect(payloadText(panels.at(-1))).toContain(lines[0]!);

  await runLyricSteps(timers.runNext, 6);

  expect(session.isRunning).toBe(true);
  expect(session.roundFinished).toBe(false);
  expect(session.currentRound).toBe(1);
  expect(session.history).toHaveLength(0);
  expect(payloadText(panels.at(-1))).toContain(lines[6]!);
  expect(payloadText(panels.at(-1))).not.toContain("hidden-answer");
});

test("lyrics score reaches 10 and hint still reveals a line at minimum score", async () => {
  const { session, panels, button, user, openForm, submission } = createSession(1);
  const timers = fakeTimers();
  const lines = Array.from({ length: 9 }, (_, index) => `minimum-score-line-${index}`);
  const item = dataManager.songs[0]!;
  spyOn(dataManager, "getRandomItem").mockReturnValue(item);
  spyOn(songLyrics, "resolveSongLyrics").mockResolvedValue(fixture(item, lines));

  await session.nextRound();
  expect(session.currentLevel).toBe(5);
  await runLyricSteps(timers.runNext, 4);
  expect(session.currentLevel).toBe(1);

  expect(payloadText(panels.at(-1))).not.toContain(lines[5]!);
  const hint = button("hint");
  await session.handleButtonInteraction(hint.interaction);
  await flushMicrotasks();

  expect(session.currentLevel).toBe(1);
  expect(payloadText(panels.at(-1))).toContain(lines[5]!);
  const { formId } = await openForm();
  const correct = submission(formId, session.currentItem!.name);
  const pending = session.handleModalGuess(correct.interaction);
  await flushMicrotasks();
  await timers.runNext(4000);
  await pending;
  expect(session.scores.get(user.id)?.score).toBe(10);
});

test("exhausted lyric lines do not repeat, close, or award points", async () => {
  const { session, panels, openForm, submission } = createSession();
  const timers = fakeTimers();
  const lines = ["exhausted-line-one", "exhausted-line-two", "exhausted-line-three"];
  const item = dataManager.songs[0]!;
  spyOn(dataManager, "getRandomItem").mockReturnValue(item);
  spyOn(songLyrics, "resolveSongLyrics").mockResolvedValue(fixture(item, lines));

  await session.nextRound();
  await runLyricSteps(timers.runNext, lines.length - 1);
  const exhaustedPanel = payloadText(panels.at(-1));
  const exhaustedOccurrences = lines.map(line => exhaustedPanel.split(line).length - 1);
  await runLyricSteps(timers.runNext, 3);

  expect(payloadText(panels.at(-1))).toBe(exhaustedPanel);
  expect(exhaustedOccurrences).toEqual([1, 1, 1]);
  expect(session.isRunning).toBe(true);
  expect(session.roundFinished).toBe(false);
  expect(session.history).toHaveLength(0);
  expect(session.scores.size).toBe(0);

  const { formId } = await openForm();
  const wrong = submission(formId, "this is not the song");
  await session.handleModalGuess(wrong.interaction);
  expect(session.isRunning).toBe(true);
  expect(session.roundFinished).toBe(false);
  expect(session.scores.size).toBe(0);
});

test("uses one panel and scores one private modal answer once", async () => {
  const { session, user, send, panels, openForm, submission } = createSession(1);
  const timers = fakeTimers();
  const item = dataManager.songs[0]!;
  const sourceUrl = "https://lrclib.net/api/get?track_name=answer-only-source";
  spyOn(dataManager, "getRandomItem").mockReturnValue(item);
  spyOn(songLyrics, "resolveSongLyrics").mockResolvedValue(fixture(item, ["private-answer-line", "second-line"], sourceUrl));

  await session.nextRound();
  const { formId } = await openForm();
  const first = submission(formId, session.currentItem!.name);
  const pending = session.handleModalGuess(first.interaction);
  await flushMicrotasks();
  await timers.runNext(4000);
  await pending;

  expect(send).toHaveBeenCalledTimes(1);
  expect(session.scores.get(user.id)?.score).toBe(50);
  expect(session.history).toHaveLength(1);
  expect(first.reply.mock.calls[0]?.[0].flags).toBe(MessageFlags.Ephemeral);
  expect(panels.some(panel => payloadText(panel).includes(sourceUrl))).toBe(true);

  const duplicate = submission(formId, session.currentItem?.name ?? item.name);
  await session.handleModalGuess(duplicate.interaction);
  expect(session.scores.get(user.id)?.score).toBe(50);
  expect(session.history).toHaveLength(1);
});

test("truncates a long source to one Discord-safe lyric field without exposing its URL", async () => {
  const { session, panels } = createSession();
  const timers = fakeTimers();
  const lines = Array.from({ length: 30 }, (_, index) => `long-line-${index}-${"x".repeat(90)}`);
  const sourceUrl = "https://lrclib.net/api/get?track_name=long-source-answer";
  const item = dataManager.songs[0]!;
  spyOn(dataManager, "getRandomItem").mockReturnValue(item);
  spyOn(songLyrics, "resolveSongLyrics").mockResolvedValue(fixture(item, lines, sourceUrl));

  await session.nextRound();
  await runLyricSteps(timers.runNext, 20);

  const lyricPayloads = panels.flatMap(panel => lyricFields(panel, "long-line-"));
  expect(lyricFields(panels.at(-1), "long-line-").at(-1)?.value).toContain(lines[20]!);
  expect(lyricPayloads.every(field => field.value.length <= 1024)).toBe(true);
  expect(panels.every(panel => !payloadText(panel).includes(sourceUrl))).toBe(true);
});

test("late lookup completion after end cannot revive the panel", async () => {
  const { session, panels } = createSession();
  const item = dataManager.songs[0]!;
  const lookup = Promise.withResolvers<SongLyrics | null>();
  spyOn(dataManager, "getRandomItem").mockReturnValue(item);
  spyOn(songLyrics, "resolveSongLyrics").mockImplementation(async () => lookup.promise);

  const pending = session.nextRound();
  await flushMicrotasks();
  await session.endGame("lookup cancelled");
  const finalPanel = panels.at(-1);
  lookup.resolve(fixture(item, ["late-line"]));
  await pending;

  expect(session.isRunning).toBe(false);
  expect(session.roundFinished).toBe(true);
  expect(panels.at(-1)).toBe(finalPanel);
  expect(finalPanel?.components).toEqual([]);
});

test("a timer from the previous lyric round cannot mutate the next round", async () => {
  const { session, panels } = createSession(2);
  const timers = fakeTimers();
  const item = dataManager.songs[0]!;
  const resolver = spyOn(songLyrics, "resolveSongLyrics");
  resolver
    .mockResolvedValueOnce(fixture(item, ["old-round-line", "old-round-next-line"]))
    .mockResolvedValueOnce(fixture(item, ["new-round-line"]));
  spyOn(dataManager, "getRandomItem").mockReturnValue(item);

  await session.nextRound();
  const oldTimer = timers.timers.find(timer => timer.delay === CONFIG.BLUR_STEP_SECONDS * 1000 && !timer.cancelled);
  if (!oldTimer) throw new Error("İlk tur zamanlayıcısı kurulmadı");
  await session.nextRound();
  const beforeStaleCallback = payloadText(panels.at(-1));
  oldTimer.callback();
  await flushMicrotasks();

  expect(session.currentRound).toBe(2);
  expect(session.roundFinished).toBe(false);
  expect(payloadText(panels.at(-1))).toBe(beforeStaleCallback);
  expect(payloadText(panels.at(-1))).toContain("new-round-line");
});

test("a late previous lookup cannot replace the current round's lyrics", async () => {
  const { session, panels } = createSession(2);
  const timers = fakeTimers();
  const item = dataManager.songs[0]!;
  const oldLookup = Promise.withResolvers<SongLyrics | null>();
  spyOn(songLyrics, "resolveSongLyrics")
    .mockReturnValueOnce(oldLookup.promise)
    .mockResolvedValueOnce(fixture(item, ["current-source-first", "current-source-next"]));
  const previousRound = session.nextRound();
  await flushMicrotasks();
  await session.nextRound();
  oldLookup.resolve(fixture(item, ["old-source-first", "old-source-next"]));
  await previousRound;
  await timers.runNext(CONFIG.BLUR_STEP_SECONDS * 1000);
  expect(session.currentRound).toBe(2);
  expect(payloadText(panels.at(-1))).toContain("current-source-next");
  expect(payloadText(panels.at(-1))).not.toContain("old-source");
});
