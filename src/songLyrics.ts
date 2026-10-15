import type { GameItem } from "./dataManager";
import { dataManager } from "./dataManager";

export interface SongLyrics {
  item: GameItem;
  lines: string[];
  sourceUrl: string;
}

interface LyricsRecord {
  id: unknown;
  trackName: unknown;
  artistName: unknown;
  albumName: unknown;
  instrumental: unknown;
  plainLyrics: unknown;
  syncedLyrics: unknown;
}

const REQUEST_TIMEOUT_MS = 8_000;
const LRCLIB_API_URL = "https://lrclib.net/api/search";
const LRCLIB_SOURCE_URL = "https://lrclib.net/api/get";

function artistMatches(localArtist: string | undefined, remoteArtist: string): boolean {
  const local = dataManager.normalizeText(localArtist ?? "");
  const remote = dataManager.normalizeText(remoteArtist);
  if (!local || local === remote) return Boolean(local);

  // The local catalogue may retain featured artists while LRCLIB credits only the primary artist.
  const primary = local.split(/\s+(?:ft|feat|featuring)\s+/)[0]!.trim();
  return primary.length > 0 && primary === remote;
}

function asLyricsRecord(value: unknown): LyricsRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("LRCLIB API returned malformed response");
  }
  const record = value as Record<string, unknown>;
  if (
    !hasValidId(record.id)
    || typeof record.trackName !== "string"
    || typeof record.artistName !== "string"
    || (record.albumName !== undefined && record.albumName !== null && typeof record.albumName !== "string")
    || (record.instrumental !== undefined && typeof record.instrumental !== "boolean")
    || (record.plainLyrics !== undefined && record.plainLyrics !== null && typeof record.plainLyrics !== "string")
    || (record.syncedLyrics !== undefined && record.syncedLyrics !== null && typeof record.syncedLyrics !== "string")
  ) {
    throw new Error("LRCLIB API returned malformed response");
  }
  return {
    id: record.id,
    trackName: record.trackName,
    artistName: record.artistName,
    albumName: record.albumName,
    instrumental: record.instrumental,
    plainLyrics: record.plainLyrics,
    syncedLyrics: record.syncedLyrics,
  };
}

function isSectionMetadata(line: string): boolean {
  return /^\[(?:verse|chorus|pre-?chorus|post-?chorus|bridge|intro|outro|refrain|hook|instrumental|spoken|nakarat|kıta)(?:\s+\d+)?(?:\s*[:\-].*)?\]$/i.test(line);
}

function stripLineMetadata(line: string): string {
  let cleaned = line.replace(/^\uFEFF/, "").trim();
  cleaned = cleaned.replace(/^(?:\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\]\s*)+/, "").trim();
  if (/^\[(?:ar|al|ti|by|re|ve|length|offset):[^\]]*\]$/i.test(cleaned)) return "";
  if (isSectionMetadata(cleaned)) return "";
  return cleaned;
}

function lyricLines(value: unknown): string[] {
  if (typeof value !== "string" || !value.trim()) return [];

  const lines: string[] = [];
  const seen = new Set<string>();
  for (const rawLine of value.split(/\r?\n/)) {
    const line = stripLineMetadata(rawLine);
    if (!line) continue;

    const key = dataManager.normalizeText(line) || line;
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(line);
  }
  return lines;
}

function matchingRecord(record: LyricsRecord, item: GameItem): boolean {
  return typeof record.trackName === "string"
    && dataManager.normalizeText(record.trackName) === dataManager.normalizeText(item.name)
    && typeof record.artistName === "string"
    && artistMatches(item.artist, record.artistName);
}

function hasValidId(id: unknown): id is number {
  return typeof id === "number" && Number.isInteger(id) && id > 0;
}

function extractLines(record: LyricsRecord): string[] {
  if (record.instrumental === true) return [];

  const plain = lyricLines(record.plainLyrics);
  if (plain.length > 0) return plain;
  return lyricLines(record.syncedLyrics);
}


export async function resolveSongLyrics(item: GameItem, signal?: AbortSignal): Promise<SongLyrics | null> {
  signal?.throwIfAborted();
  const artist = item.artist?.trim();
  const title = item.name.trim();
  if (!title || !artist) return null;

  const query = new URLSearchParams({ track_name: title, artist_name: artist });
  const endpoint = `${LRCLIB_API_URL}?${query.toString()}`;

  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), REQUEST_TIMEOUT_MS);
  const requestSignal = signal ? AbortSignal.any([signal, timeout.signal]) : timeout.signal;

  try {
    requestSignal.throwIfAborted();
    const response = await fetch(endpoint, {
      headers: {
        Accept: "application/json",
        "User-Agent": "sarki-tahmin/1.0 (+https://github.com/SerhatDew/sarki-tahmin)",
      },
      signal: requestSignal,
    });
    requestSignal.throwIfAborted();
    if (!response.ok) throw new Error(`LRCLIB API returned HTTP ${response.status}`);

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      if (requestSignal.aborted) requestSignal.throwIfAborted();
      throw new Error("LRCLIB API returned malformed JSON", { cause: error });
    }
    requestSignal.throwIfAborted();
    if (!Array.isArray(payload)) throw new Error("LRCLIB API returned malformed response");

    const records = payload.map(asLyricsRecord).filter(record => matchingRecord(record, item));
    if (records.length === 0) return null;

    const requestedAlbum = dataManager.normalizeText(item.album ?? "");
    const preferred = requestedAlbum
      ? records.filter(record => typeof record.albumName === "string"
        && dataManager.normalizeText(record.albumName) === requestedAlbum)
      : [];
    const candidates = [...preferred, ...records.filter(record => !preferred.includes(record))];

    for (const record of candidates) {
      const lines = extractLines(record);
      if (lines.length === 0) continue;
      return {
        item,
        lines,
        sourceUrl: `${LRCLIB_SOURCE_URL}/${record.id}`,
      };
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}
