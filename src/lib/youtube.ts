/**
 * Fetch public YouTube captions from the server.
 *
 * Innertube player clients return signed timedtext URLs. The YouTube Kids
 * client still answers from datacenter addresses when the main Android client
 * answers "Sign in to confirm you're not a bot". The watch page is the next
 * try. A PoToken is minted only when a track exists and the transcript body
 * is empty.
 */
import type { TranscriptSegment } from "@/lib/summary";

const WEB_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

export type TranscriptKind = "manual" | "auto-generated";

export type Transcript = {
  videoId: string;
  title: string;
  author: string;
  durationSeconds: number | null;
  language: string;
  kind: TranscriptKind;
  text: string;
  segments: TranscriptSegment[];
};

export type TranscriptFailureCode =
  | "invalid_url"
  | "unavailable"
  | "no_captions"
  | "blocked"
  | "empty";

export class TranscriptError extends Error {
  code: TranscriptFailureCode;
  title?: string;
  videoId?: string;

  constructor(
    code: TranscriptFailureCode,
    message: string,
    extra?: { title?: string; videoId?: string },
  ) {
    super(message);
    this.name = "TranscriptError";
    this.code = code;
    this.title = extra?.title;
    this.videoId = extra?.videoId;
  }
}

type CaptionTrack = {
  baseUrl: string;
  languageCode?: string;
  kind?: string;
};

type PlayerResponse = {
  videoDetails?: {
    title?: string;
    author?: string;
    lengthSeconds?: string;
  };
  playabilityStatus?: {
    status?: string;
    reason?: string;
    errorCode?: string;
  };
  captions?: {
    playerCaptionsTracklistRenderer?: {
      captionTracks?: CaptionTrack[];
    };
  };
};

type Client = {
  clientName: string;
  clientVersion: string;
  userAgent: string;
  extra?: Record<string, string | number>;
};

type VideoMeta = {
  title: string;
  author: string;
  durationSeconds: number | null;
};

type PendingTrack = {
  track: CaptionTrack;
  userAgent: string;
  meta: VideoMeta;
  videoId: string;
};

const CLIENTS: Client[] = [
  {
    // The Kids app is not on the same bot wall as the main player clients, so
    // public videos it can open still return caption tracks from Vercel.
    clientName: "ANDROID_KIDS",
    clientVersion: "8.49.3",
    userAgent: "com.google.android.apps.youtube.kids/8.49.3 (Linux; U; Android 11) gzip",
    extra: { androidSdkVersion: 30, osName: "Android", osVersion: "11" },
  },
  {
    clientName: "ANDROID",
    clientVersion: "20.10.38",
    userAgent: "com.google.android.youtube/20.10.38 (Linux; U; Android 11) gzip",
    extra: { androidSdkVersion: 30, osName: "Android", osVersion: "11" },
  },
  {
    clientName: "ANDROID",
    clientVersion: "21.26.364",
    userAgent: "com.google.android.youtube/21.26.364 (Linux; U; Android 11) gzip",
    extra: { androidSdkVersion: 30, osName: "Android", osVersion: "11" },
  },
  {
    clientName: "ANDROID_VR",
    clientVersion: "1.65.10",
    userAgent:
      "com.google.android.apps.youtube.vr.oculus/1.65.10 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip",
    extra: {
      deviceMake: "Oculus",
      deviceModel: "Quest 3",
      androidSdkVersion: 32,
      osName: "Android",
      osVersion: "12L",
    },
  },
  {
    clientName: "IOS",
    clientVersion: "21.26.4",
    userAgent: "com.google.ios.youtube/21.26.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)",
    extra: {
      deviceMake: "Apple",
      deviceModel: "iPhone16,2",
      osName: "iPhone",
      osVersion: "18.3.2.22D82",
    },
  },
  {
    clientName: "TVHTML5",
    clientVersion: "7.20260707.07.00",
    userAgent:
      "Mozilla/5.0 (ChromiumStylePlatform) Cobalt/25.lts.30.1034943-gold (unlike Gecko), Unknown_TV_Unknown_0/Unknown (Unknown, Unknown)",
  },
  {
    clientName: "TVHTML5_SIMPLY",
    clientVersion: "1.0",
    userAgent: "Mozilla/5.0 (SMART-TV; Linux; Tizen 6.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  },
  {
    clientName: "VISIONOS",
    clientVersion: "1.04",
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15",
    extra: {
      deviceMake: "Apple",
      deviceModel: "RealityDevice17,1",
      osName: "visionOS",
      osVersion: "26.6.0.23O770",
    },
  },
  {
    clientName: "MWEB",
    clientVersion: "2.20260708.05.00",
    userAgent:
      "Mozilla/5.0 (iPad; CPU OS 16_7_10 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1,gzip(gfe)",
  },
];

const cache = new Map<string, { at: number; value: Transcript }>();
const CACHE_MS = 10 * 60 * 1000;

export function parseVideoId(input: string): string | null {
  const trimmed = input.trim();
  if (VIDEO_ID_RE.test(trimmed)) return trimmed;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./, "").replace(/^m\./, "");
  if (host === "youtu.be") {
    const parts = url.pathname.split("/").filter(Boolean);
    const id = parts[0] === "shorts" || parts[0] === "embed" || parts[0] === "live" ? parts[1] : parts[0];
    return id && VIDEO_ID_RE.test(id) ? id : null;
  }
  if (host === "youtube.com" || host === "music.youtube.com" || host === "youtube-nocookie.com") {
    const watchId = url.searchParams.get("v");
    if (watchId && VIDEO_ID_RE.test(watchId)) return watchId;
    const nested = url.searchParams.get("u");
    if (nested) {
      const fromNested = parseVideoId(decodeURIComponent(nested));
      if (fromNested) return fromNested;
    }
    const match = url.pathname.match(/^\/(?:shorts|embed|live|v)\/([A-Za-z0-9_-]{11})/);
    if (match) return match[1];
  }
  return null;
}

function extractJsonAfter(html: string, marker: string): PlayerResponse | null {
  const start = html.indexOf(marker);
  if (start === -1) return null;
  const jsonStart = start + marker.length;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = jsonStart; index < html.length; index += 1) {
    const char = html[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === '"') inString = !inString;
    if (inString) continue;
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(jsonStart, index + 1)) as PlayerResponse;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function pickTrack(tracks: CaptionTrack[], languages: string[]): CaptionTrack {
  const norm = (code: string | undefined) => (code ?? "").toLowerCase().split("-")[0];
  const wanted = languages.map((language) => language.toLowerCase().split("-")[0]);
  const score = (track: CaptionTrack) => {
    let value = 0;
    const index = wanted.indexOf(norm(track.languageCode));
    if (index !== -1) value += (wanted.length - index) * 100;
    if (track.kind !== "asr") value += 50;
    if (norm(track.languageCode) === "en") value += 10;
    return value;
  };
  return [...tracks].sort((a, b) => score(b) - score(a))[0];
}

function videoMeta(player: PlayerResponse | null): VideoMeta {
  const length = Number(player?.videoDetails?.lengthSeconds);
  return {
    title: player?.videoDetails?.title?.trim() || "Untitled video",
    author: player?.videoDetails?.author?.trim() || "",
    durationSeconds: Number.isFinite(length) ? length : null,
  };
}

function isBot(player: PlayerResponse | null): boolean {
  const status = player?.playabilityStatus?.status ?? "";
  const reason = player?.playabilityStatus?.reason ?? "";
  return status === "LOGIN_REQUIRED" || /bot|sign in/i.test(reason);
}

function decodeEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function segmentsFromXml(xml: string): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  for (const match of xml.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/gi)) {
    const attrs = match[1] ?? "";
    const text = decodeEntities(match[2] ?? "").replace(/\s+/g, " ").trim();
    if (!text) continue;
    segments.push({
      start: Number(/start="([^"]+)"/.exec(attrs)?.[1] ?? 0),
      duration: Number(/dur="([^"]+)"/.exec(attrs)?.[1] ?? 0),
      text,
    });
  }
  if (segments.length) return segments;
  for (const match of xml.matchAll(/<p\b([^>]*)>([\s\S]*?)<\/p>/gi)) {
    const attrs = match[1] ?? "";
    const text = decodeEntities((match[2] ?? "").replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
    if (!text) continue;
    segments.push({
      start: Number(/t="([^"]+)"/.exec(attrs)?.[1] ?? 0) / 1000,
      duration: Number(/d="([^"]+)"/.exec(attrs)?.[1] ?? 0) / 1000,
      text,
    });
  }
  return segments;
}

function segmentsFromPayload(payload: {
  events?: { tStartMs?: number; dDurationMs?: number; segs?: { utf8?: string }[] }[];
}): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  for (const event of payload.events ?? []) {
    if (!event.segs) continue;
    const text = event.segs
      .map((segment) => segment.utf8 ?? "")
      .join("")
      .replace(/\s+/g, " ")
      .trim();
    if (!text || text === "\n") continue;
    segments.push({
      start: Math.round(event.tStartMs ?? 0) / 1000,
      duration: Math.round(event.dDurationMs ?? 0) / 1000,
      text,
    });
  }
  return segments;
}

function toTranscript(
  videoId: string,
  meta: VideoMeta,
  track: CaptionTrack,
  segments: TranscriptSegment[],
): Transcript {
  return {
    videoId,
    title: meta.title,
    author: meta.author,
    durationSeconds: meta.durationSeconds,
    language: track.languageCode || "und",
    kind: track.kind === "asr" ? "auto-generated" : "manual",
    segments,
    text: segments.map((segment) => segment.text).join(" "),
  };
}

async function readTimedText(baseUrl: string, userAgent: string, pot?: string): Promise<TranscriptSegment[] | null> {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (pot) url.searchParams.set("pot", pot);

  const headers = {
    "User-Agent": userAgent,
    Origin: "https://www.youtube.com",
    Referer: "https://www.youtube.com/",
  };

  for (const fmt of ["json3", "srv3"]) {
    url.searchParams.set("fmt", fmt);
    const response = await fetch(url, { signal: AbortSignal.timeout(12_000), headers });
    if (!response.ok) continue;
    const body = await response.text();
    if (!body.trim()) continue;
    if (fmt === "json3") {
      try {
        const segments = segmentsFromPayload(JSON.parse(body) as Parameters<typeof segmentsFromPayload>[0]);
        if (segments.length) return segments;
      } catch {
        const xml = segmentsFromXml(body);
        if (xml.length) return xml;
      }
      continue;
    }
    const segments = segmentsFromXml(body);
    if (segments.length) return segments;
  }
  return null;
}

async function fetchPlayer(videoId: string, client: Client): Promise<PlayerResponse | null> {
  const response = await fetch("https://www.youtube.com/youtubei/v1/player?prettyPrint=false", {
    method: "POST",
    signal: AbortSignal.timeout(12_000),
    headers: {
      "Content-Type": "application/json",
      "User-Agent": client.userAgent,
      Origin: "https://www.youtube.com",
    },
    body: JSON.stringify({
      context: {
        client: {
          clientName: client.clientName,
          clientVersion: client.clientVersion,
          hl: "en",
          gl: "US",
          ...client.extra,
        },
      },
      videoId,
      contentCheckOk: true,
      racyCheckOk: true,
    }),
  });
  if (!response.ok) return null;
  return (await response.json()) as PlayerResponse;
}

async function fetchWatchPage(videoId: string): Promise<{ html: string; player: PlayerResponse | null }> {
  const response = await fetch(
    `https://www.youtube.com/watch?v=${videoId}&hl=en&bpctr=9999999999&has_verified=1`,
    {
      signal: AbortSignal.timeout(12_000),
      headers: {
        "User-Agent": WEB_UA,
        "Accept-Language": "en-US,en;q=0.9",
        Cookie: "CONSENT=YES+cb; SOCS=CAESEwgDEgk0ODE3Nzk3MjQaAmVuIAEaBgiA_LyaBg",
      },
    },
  );
  const html = await response.text();
  return { html, player: extractJsonAfter(html, "ytInitialPlayerResponse = ") };
}

async function tracksToTranscript(
  videoId: string,
  tracks: CaptionTrack[],
  languages: string[],
  userAgent: string,
  meta: VideoMeta,
  pending: PendingTrack[],
): Promise<Transcript | null> {
  if (!tracks.length) return null;
  const preferred = pickTrack(tracks, languages);
  const ordered = [preferred, ...tracks.filter((track) => track !== preferred)];
  const seen = new Set<string>();
  for (const track of ordered) {
    if (!track?.baseUrl || seen.has(track.baseUrl)) continue;
    seen.add(track.baseUrl);
    try {
      const segments = await readTimedText(track.baseUrl, userAgent);
      if (segments) return toTranscript(videoId, meta, track, segments);
      pending.push({ track, userAgent, meta, videoId });
    } catch {
      pending.push({ track, userAgent, meta, videoId });
    }
  }
  return null;
}

export async function fetchTranscript(input: string, languages: string[] = ["en"]): Promise<Transcript> {
  const videoId = parseVideoId(input);
  if (!videoId) {
    throw new TranscriptError(
      "invalid_url",
      "That doesn't look like a YouTube link. Use a youtube.com, youtu.be, or shorts URL.",
    );
  }

  const cached = cache.get(videoId);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;

  const pending: PendingTrack[] = [];
  let sawPlayableWithoutCaptions = false;
  let sawBot = false;
  let unavailableReason: string | null = null;
  let knownTitle = "Untitled video";
  let visitorData = "";

  for (const client of CLIENTS) {
    let player: PlayerResponse | null = null;
    try {
      player = await fetchPlayer(videoId, client);
    } catch {
      continue;
    }
    if (!player) continue;
    const meta = videoMeta(player);
    if (meta.title !== "Untitled video") knownTitle = meta.title;
    const tracks = player.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
    const status = player.playabilityStatus?.status;

    if (tracks.length) {
      const transcript = await tracksToTranscript(videoId, tracks, languages, client.userAgent, meta, pending);
      if (transcript) {
        cache.set(videoId, { at: Date.now(), value: transcript });
        return transcript;
      }
      continue;
    }

    if (status === "OK") {
      sawPlayableWithoutCaptions = true;
      continue;
    }
    if (isBot(player)) {
      sawBot = true;
      continue;
    }
    // The Kids client refuses ordinary videos with this code. That is not
    // "the video does not exist", so the other clients still get a turn.
    if (player.playabilityStatus?.errorCode === "PLAYABILITY_ERROR_CODE_VIDEO_BLOCK_BY_MRM") continue;
    if (status) unavailableReason = player.playabilityStatus?.reason || status;
  }

  try {
    const watch = await fetchWatchPage(videoId);
    visitorData = watch.html.match(/"visitorData":"([^"]+)"/)?.[1] ?? "";
    const meta = videoMeta(watch.player);
    if (meta.title !== "Untitled video") knownTitle = meta.title;
    const tracks = watch.player?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
    if (tracks.length) {
      const transcript = await tracksToTranscript(videoId, tracks, languages, WEB_UA, meta, pending);
      if (transcript) {
        cache.set(videoId, { at: Date.now(), value: transcript });
        return transcript;
      }
    } else if (watch.player?.playabilityStatus?.status === "OK") {
      sawPlayableWithoutCaptions = true;
    } else if (isBot(watch.player)) {
      sawBot = true;
    } else if (watch.player?.playabilityStatus?.status) {
      unavailableReason = watch.player.playabilityStatus.reason || watch.player.playabilityStatus.status;
    }
  } catch {
    sawBot = true;
  }

  if (pending.length) {
    try {
      const { mintPoToken } = await import("@/lib/youtube-pot");
      const pot = await mintPoToken(visitorData, videoId);
      for (const item of pending) {
        const segments = await readTimedText(item.track.baseUrl, item.userAgent, pot);
        if (!segments) continue;
        const transcript = toTranscript(item.videoId, item.meta, item.track, segments);
        cache.set(videoId, { at: Date.now(), value: transcript });
        return transcript;
      }
      throw new TranscriptError(
        "empty",
        "Captions were listed, but the transcript came back empty. Paste the transcript to continue.",
        { title: pending[0]?.meta.title || knownTitle, videoId },
      );
    } catch (error) {
      if (error instanceof TranscriptError) throw error;
    }
  }

  if (sawPlayableWithoutCaptions) {
    throw new TranscriptError(
      "no_captions",
      "This video has no public captions. Captions are required for the automatic path. Paste a transcript to build the brief.",
      { title: knownTitle, videoId },
    );
  }

  if (unavailableReason && !sawBot) {
    throw new TranscriptError(
      "unavailable",
      `This video isn't available for caption reading (${unavailableReason}). Paste a transcript if you have one.`,
      { title: knownTitle, videoId },
    );
  }

  throw new TranscriptError(
    "blocked",
    "YouTube blocked the caption request for this video. Open the video, choose Show transcript, and paste it below to build the brief.",
    { title: knownTitle === "Untitled video" ? undefined : knownTitle, videoId },
  );
}
