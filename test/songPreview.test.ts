import { afterEach, expect, mock, spyOn, test, type Mock } from "bun:test";
import { resolveSongPreview } from "../src/songPreview";
import type { GameItem } from "../src/dataManager";

const item: GameItem = { id: "song-1", name: "Dönence", artist: "Barış Manço", album: "Manço" , aliases: ["Donence"] };
const result = (overrides: Record<string, unknown> = {}) => ({
  trackName: "Dönence",
  artistName: "Barış Manço",
  collectionName: "Manço",
  previewUrl: "https://audio-ssl.itunes.apple.com/preview.m4a",
  trackViewUrl: "https://music.apple.com/tr/song/donence/1",
  ...overrides
});

let fetchSpy: Mock<typeof fetch> | undefined;
afterEach(() => fetchSpy?.mockRestore());

function mockResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: mock(async () => body) } as unknown as Response;
}

function install(body: unknown, ok = true, status = 200) {
  fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(mockResponse(body, ok, status));
}

test("returns exact legitimate preview and preserves local item", async () => {
  install({ resultCount: 1, results: [result()] });
  const resolved = await resolveSongPreview(item);
  expect(resolved).toEqual({ item, previewUrl: "https://audio-ssl.itunes.apple.com/preview.m4a", sourceUrl: "https://music.apple.com/tr/song/donence/1" });
});

test("rejects wrong artist and live or remix title variants", async () => {
  install({ results: [result({ artistName: "Another Artist" }), result({ trackName: "Dönence (Live)" }), result({ trackName: "Dönence (Remix)" })] });
  expect(await resolveSongPreview(item)).toBeNull();
});

test("rejects missing or non-Apple preview URLs", async () => {
  install({ results: [result({ previewUrl: undefined }), result({ previewUrl: "https://example.com/preview.m4a" })] });
  expect(await resolveSongPreview(item)).toBeNull();
});

test("prefers requested album among exact matches", async () => {
  install({ results: [result({ collectionName: "Other Album", trackViewUrl: "https://music.apple.com/tr/song/other/2" }), result()] });
  const resolved = await resolveSongPreview(item);
  expect(resolved?.sourceUrl).toBe("https://music.apple.com/tr/song/donence/1");
});

test("throws for HTTP failures and malformed responses", async () => {
  install({}, false, 503);
  await expect(resolveSongPreview(item)).rejects.toThrow("HTTP 503");
  fetchSpy?.mockRestore();
  install({ results: "invalid" });
  await expect(resolveSongPreview(item)).rejects.toThrow("malformed response");
});

test("respects cancellation", async () => {
  const controller = new AbortController();
  const abortFetch = Object.assign(
    (_input: unknown, init?: { signal?: AbortSignal | null }) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }),
    { preconnect: fetch.preconnect }
  );
  fetchSpy = spyOn(globalThis, "fetch").mockImplementation(abortFetch);
  const pending = resolveSongPreview(item, controller.signal);
  controller.abort();
  await expect(pending).rejects.toHaveProperty("name", "AbortError");
});
