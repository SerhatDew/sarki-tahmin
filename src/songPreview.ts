import type { GameItem } from "./dataManager";
import { dataManager } from "./dataManager";

export interface SongPreview {
  item: GameItem;
  previewUrl: string;
  sourceUrl: string;
}

interface SearchResult {
  trackName?: unknown;
  artistName?: unknown;
  collectionName?: unknown;
  previewUrl?: unknown;
  trackViewUrl?: unknown;
  kind?: unknown;
}

interface SearchResponse {
  resultCount?: unknown;
  results?: unknown;
}

const REQUEST_TIMEOUT_MS = 8_000;

function isAppleHost(url: string, expected: "preview" | "source"): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    const host = parsed.hostname.toLowerCase();
    return expected === "source"
      ? host === "music.apple.com" || host.endsWith(".music.apple.com")
      : host === "audio-ssl.itunes.apple.com" || host.endsWith(".apple.com");
  } catch {
    return false;
  }
}

function artistMatches(localArtist: string | undefined, remoteArtist: string): boolean {
  const local = dataManager.normalizeText(localArtist ?? "");
  const remote = dataManager.normalizeText(remoteArtist);
  if (!local || local === remote) return Boolean(local);

  // Local data may retain featured artists while iTunes credits only the primary artist.
  const primary = local.split(/\s+(?:ft|feat|featuring)\s+/)[0]!.trim();
  return primary.length > 0 && primary === remote;
}

function validResult(result: SearchResult, item: GameItem): result is SearchResult & {
  trackName: string;
  artistName: string;
  previewUrl: string;
  trackViewUrl: string;
} {
  if (typeof result.trackName !== "string" || typeof result.artistName !== "string") return false;
  if (dataManager.normalizeText(result.trackName) !== dataManager.normalizeText(item.name)) return false;
  if (!artistMatches(item.artist, result.artistName)) return false;
  if (typeof result.previewUrl !== "string" || !isAppleHost(result.previewUrl, "preview")) return false;
  if (typeof result.trackViewUrl !== "string" || !isAppleHost(result.trackViewUrl, "source")) return false;
  return true;
}

export async function resolveSongPreview(item: GameItem, signal?: AbortSignal): Promise<SongPreview | null> {
  const artist = item.artist?.trim();
  if (!item.name.trim() || !artist) return null;

  const query = encodeURIComponent(`${artist} ${item.name}`);
  const endpoint = `https://itunes.apple.com/search?term=${query}&country=TR&entity=song&limit=10`;
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), REQUEST_TIMEOUT_MS);
  const requestSignal = signal ? AbortSignal.any([signal, timeout.signal]) : timeout.signal;

  try {
    const response = await fetch(endpoint, { signal: requestSignal });
    if (!response.ok) throw new Error(`iTunes Search API returned HTTP ${response.status}`);

    let payload: SearchResponse;
    try {
      payload = await response.json() as SearchResponse;
    } catch (error) {
      if (requestSignal.aborted) throw requestSignal.reason;
      throw new Error("iTunes Search API returned malformed JSON", { cause: error });
    }
    if (!payload || !Array.isArray(payload.results)) {
      throw new Error("iTunes Search API returned malformed response");
    }
    const matches = payload.results
      .filter((result): result is SearchResult => Boolean(result && typeof result === "object"))
      .filter(result => validResult(result, item));
    if (matches.length === 0) return null;

    const requestedAlbum = dataManager.normalizeText(item.album ?? "");
    const preferred = requestedAlbum
      ? matches.find(result => typeof result.collectionName === "string" && dataManager.normalizeText(result.collectionName) === requestedAlbum)
      : undefined;
    const match = preferred ?? matches[0]!;
    return { item, previewUrl: match.previewUrl, sourceUrl: match.trackViewUrl };
  } finally {
    clearTimeout(timer);
  }
}
