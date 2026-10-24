import { NextResponse } from "next/server";

import { summarize } from "@/lib/summarize";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_TRANSCRIPT = 80_000;

function videoPayload(videoId: string, title?: string | null) {
  return {
    videoId,
    title: title ?? null,
    url: `https://www.youtube.com/watch?v=${videoId}`,
  };
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json", message: "Send a JSON body." }, { status: 400 });
  }

  const payload = (body ?? {}) as { url?: unknown; transcript?: unknown; title?: unknown };

  if (typeof payload.transcript === "string" && payload.transcript.trim()) {
    const transcript = payload.transcript.trim();
    if (transcript.length > MAX_TRANSCRIPT) {
      return NextResponse.json(
        { error: "too_long", message: "Paste a transcript under 80,000 characters." },
        { status: 400 },
      );
    }
    const title =
      typeof payload.title === "string" && payload.title.trim()
        ? payload.title.trim().slice(0, 180)
        : "Pasted transcript";
    try {
      const result = await summarize({ title, transcript });
      return NextResponse.json({ ...result, transcript, video: null });
    } catch {
      return NextResponse.json(
        { error: "failed", message: "That transcript could not be summarized." },
        { status: 500 },
      );
    }
  }

  if (typeof payload.url !== "string" || !payload.url.trim()) {
    return NextResponse.json(
      { error: "invalid_url", message: "Paste a YouTube URL or a transcript." },
      { status: 400 },
    );
  }

  let youtube: typeof import("@/lib/youtube");
  try {
    youtube = await import("@/lib/youtube");
  } catch {
    return NextResponse.json(
      {
        error: "failed",
        message: "Captions could not be loaded. Paste a transcript to continue.",
      },
      { status: 500 },
    );
  }

  try {
    const video = await youtube.fetchTranscript(payload.url);
    const result = await summarize({
      title: video.title,
      transcript: video.text,
      segments: video.segments,
    });
    return NextResponse.json({
      ...result,
      transcript: video.text,
      video: {
        videoId: video.videoId,
        title: video.title,
        author: video.author,
        durationSeconds: video.durationSeconds,
        language: video.language,
        kind: video.kind,
        url: `https://www.youtube.com/watch?v=${video.videoId}`,
      },
    });
  } catch (error) {
    if (error instanceof youtube.TranscriptError) {
      const status = error.code === "invalid_url" ? 400 : 422;
      return NextResponse.json(
        {
          error: error.code,
          message: error.message,
          video: error.videoId ? videoPayload(error.videoId, error.title) : null,
        },
        { status },
      );
    }
    console.error(error);
    return NextResponse.json(
      {
        error: "failed",
        message: "Something went wrong while reading that video. Paste a transcript to continue.",
      },
      { status: 500 },
    );
  }
}
