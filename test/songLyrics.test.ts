import { afterEach, expect, mock, spyOn, test, type Mock } from "bun:test";
import { resolveSongLyrics } from "../src/songLyrics";
import type { GameItem } from "../src/dataManager";

const item: GameItem = {
  id: "song-1",
  name: "Dönence",
  artist: "Barış Manço",
  album: "Manço",
  aliases: ["Donence"],
};

const result = (overrides: Record<string, unknown> = {}) => ({
  id: 123,
  trackName: "Dönence",
  artistName: "Barış Manço",
  albumName: "Manço",
  instrumental: false,
  plainLyrics: "[Verse 1]\nFirst line\nFirst line\nSecond line",
  syncedLyrics: null,
  ...overrides,
});

let fetchSpy: Mock<typeof fetch> | undefined;
afterEach(() => {
  fetchSpy?.mockRestore();
  fetchSpy = undefined;
});

function mockResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: mock(async () => body) } as unknown as Response;
}

function install(body: unknown, ok = true, status = 200) {
  fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(mockResponse(body, ok, status));
}

test("returns plain lyrics in order, preferring the requested album", async () => {
  install([
    result({ id: 1, albumName: "Başka Albüm", plainLyrics: "wrong album" }),
    result({ id: 2 }),
  ]);
  const resolved = await resolveSongLyrics(item);

  expect(resolved).toEqual({
    item,
    lines: ["First line", "Second line"],
    sourceUrl: "https://lrclib.net/api/get/2",
  });
});

test("uses synced lyrics when plain lyrics are absent and strips timestamps and metadata", async () => {
  install([
    result({
      plainLyrics: null,
      syncedLyrics: "[ar:Barış Manço]\n[00:01.00]First line\n[00:02.50] First line\n[00:03.00] [Chorus]\n[00:04.00]Second line",
    }),
  ]);

  const resolved = await resolveSongLyrics(item);

  expect(resolved?.lines).toEqual(["First line", "Second line"]);
});

test("accepts a primary artist when the local title credits a featured artist", async () => {
  const featuredItem = { ...item, artist: "Barış Manço feat. Konuk Sanatçı" };
  install([result({ artistName: "Barış Manço" })]);

  const resolved = await resolveSongLyrics(featuredItem);

  expect(resolved?.lines).toEqual(["First line", "Second line"]);
});

test("rejects title and artist variants that are not exact local matches", async () => {
  install([
    result({ trackName: "Dönence (Live)" }),
    result({ artistName: "Başka Sanatçı" }),
  ]);

  expect(await resolveSongLyrics(item)).toBeNull();
});

test("returns null for no match, instrumental records, and records without useful lyrics", async () => {
  install([]);
  expect(await resolveSongLyrics(item)).toBeNull();

  fetchSpy?.mockRestore();
  install([result({ instrumental: true, plainLyrics: "A line" })]);
  expect(await resolveSongLyrics(item)).toBeNull();

  fetchSpy?.mockRestore();
  install([result({ plainLyrics: "[Verse 1]\n\n[Chorus]", syncedLyrics: null })]);
  expect(await resolveSongLyrics(item)).toBeNull();
});

test("throws for HTTP and malformed response failures", async () => {
  install({}, false, 503);
  await expect(resolveSongLyrics(item)).rejects.toThrow("HTTP 503");

  fetchSpy?.mockRestore();
  install({ records: [] });
  await expect(resolveSongLyrics(item)).rejects.toThrow("malformed response");

  fetchSpy?.mockRestore();
  fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue({
    ok: true,
    status: 200,
    json: mock(async () => {
      throw new SyntaxError("invalid JSON");
    }),
  } as unknown as Response);
  await expect(resolveSongLyrics(item)).rejects.toThrow("malformed JSON");
});

test("honors already-aborted and in-flight cancellation", async () => {
  const alreadyAborted = new AbortController();
  alreadyAborted.abort();
  fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(mockResponse([]));
  await expect(resolveSongLyrics(item, alreadyAborted.signal)).rejects.toHaveProperty("name", "AbortError");
  expect(fetchSpy).not.toHaveBeenCalled();

  fetchSpy?.mockRestore();
  const controller = new AbortController();
  const abortFetch = Object.assign(
    (_input: unknown, init?: { signal?: AbortSignal | null }) => new Promise<Response>((_resolve, reject) => {
      if (init?.signal?.aborted) {
        reject(init.signal.reason);
        return;
      }
      init?.signal?.addEventListener("abort", () => reject(init.signal!.reason), { once: true });
    }),
    { preconnect: fetch.preconnect }
  );
  fetchSpy = spyOn(globalThis, "fetch").mockImplementation(abortFetch);

  const pending = resolveSongLyrics(item, controller.signal);
  controller.abort();
  await expect(pending).rejects.toHaveProperty("name", "AbortError");
});

test("does not return lyrics if cancellation arrives during JSON parsing", async () => {
  const controller = new AbortController();
  const reading = Promise.withResolvers<void>();
  const body = Promise.withResolvers<unknown>();
  fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue({
    ok: true,
    status: 200,
    json: () => { reading.resolve(); return body.promise; }
  } as unknown as Response);
  const pending = resolveSongLyrics(item, controller.signal);
  await reading.promise;
  controller.abort();
  body.resolve([result()]);
  await expect(pending).rejects.toHaveProperty("name", "AbortError");
});
