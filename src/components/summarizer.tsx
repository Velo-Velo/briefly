"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { MindMap } from "@/components/mind-map";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  downloadMindMapPng,
  downloadMindMapSvg,
  downloadOutlineJson,
  downloadOutlineMarkdown,
  downloadSummaryDocx,
  downloadSummaryPptx,
} from "@/lib/exports";
import { SAMPLE_TRANSCRIPT, SAMPLE_TRANSCRIPT_TITLE, SAMPLE_VIDEO_URL } from "@/lib/sample-transcript";
import type { Summary } from "@/lib/summary";

type VideoMeta = {
  videoId: string;
  title: string | null;
  author?: string;
  durationSeconds?: number | null;
  language?: string;
  kind?: string;
  url: string;
};

type Ready = {
  summary: Summary;
  transcript: string;
  video: VideoMeta | null;
  notice?: string;
};

function formatDuration(seconds: number | null | undefined): string | null {
  if (seconds == null || !Number.isFinite(seconds)) return null;
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remain = total % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m ${remain.toString().padStart(2, "0")}s`;
}

async function readError(response: Response): Promise<{ message: string; error?: string; video?: VideoMeta | null }> {
  try {
    const payload = (await response.json()) as {
      message?: string;
      error?: string;
      video?: VideoMeta | null;
    };
    return {
      message: payload.message || "The summary could not be built.",
      error: payload.error,
      video: payload.video,
    };
  } catch {
    return { message: "The summary could not be built." };
  }
}

export function Summarizer() {
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [transcript, setTranscript] = useState("");
  const [showPaste, setShowPaste] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingLabel, setLoadingLabel] = useState("Reading captions");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Ready | null>(null);

  async function run(body: { url?: string; transcript?: string; title?: string }, label: string) {
    setLoading(true);
    setLoadingLabel(label);
    setError(null);
    setResult(null);
    try {
      const response = await fetch("/api/summarize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const problem = await readError(response);
        setError(problem.message);
        if (problem.error && problem.error !== "invalid_url") {
          setShowPaste(true);
          if (problem.video?.title) setTitle(problem.video.title);
        }
        return;
      }
      const payload = (await response.json()) as Ready;
      setResult(payload);
      if (payload.notice) toast.message(payload.notice);
    } catch {
      setError("The request did not finish. Check your connection, or paste a transcript.");
      setShowPaste(true);
    } finally {
      setLoading(false);
    }
  }

  async function exportFile(action: () => Promise<void> | void, label: string) {
    if (!result) return;
    try {
      await action();
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : `Could not export ${label}.`;
      toast.error(message);
    }
  }

  const duration = formatDuration(result?.video?.durationSeconds);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-5 py-8 md:py-12">
      <div className="max-w-2xl">
        <p className="text-sm font-medium text-pine">YouTube summarizer</p>
        <h1 className="mt-2 font-heading text-4xl tracking-tight text-balance md:text-5xl">
          Paste a link. Take the brief with you.
        </h1>
        <p className="mt-3 text-base leading-7 text-muted-foreground">
          Briefly reads public captions and turns them into key points, a mind map, a PowerPoint, and a Word doc.
          No account. If a video has no captions, paste the transcript.
        </p>
      </div>

      <form
        className="rounded-2xl border border-border bg-card p-4 shadow-sm md:p-5"
        onSubmit={(event) => {
          event.preventDefault();
          void run({ url }, "Fetching public captions");
        }}
      >
        <Label htmlFor="youtube-url">YouTube URL</Label>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <Input
            id="youtube-url"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://www.youtube.com/watch?v=…"
            inputMode="url"
            autoComplete="off"
            className="h-11 px-3 text-base md:text-base"
          />
          <Button type="submit" disabled={loading || !url.trim()} className="h-11 px-4">
            {loading ? <Loader2 className="animate-spin" /> : null}
            Summarize
          </Button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={loading}
            onClick={() => {
              setUrl(SAMPLE_VIDEO_URL);
              void run({ url: SAMPLE_VIDEO_URL }, "Fetching public captions");
            }}
          >
            Try a captioned video
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setShowPaste(true);
              setTitle(SAMPLE_TRANSCRIPT_TITLE);
              setTranscript(SAMPLE_TRANSCRIPT);
            }}
          >
            Load a sample transcript
          </Button>
          <Button type="button" variant="ghost" onClick={() => setShowPaste((open) => !open)}>
            {showPaste ? "Hide transcript paste" : "Paste a transcript"}
          </Button>
        </div>

        {showPaste ? (
          <div className="mt-4 grid gap-3 border-t border-border pt-4">
            {error ? (
              <div role="alert" className="rounded-xl border border-clay/30 bg-clay/10 px-3 py-3 text-sm leading-6">
                <p>{error}</p>
                <p className="mt-2 font-medium">Paste a transcript to finish this brief</p>
                <ol className="mt-1 list-decimal space-y-1 pl-5 text-muted-foreground">
                  <li>Open the video on YouTube.</li>
                  <li>In the description, choose Show transcript.</li>
                  <li>Copy the transcript, paste it here, and summarize it.</li>
                </ol>
              </div>
            ) : null}
            <div className="grid gap-2">
              <Label htmlFor="brief-title">Title</Label>
              <Input
                id="brief-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Name this brief"
                className="h-11 px-3"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="transcript">Transcript</Label>
              <Textarea
                id="transcript"
                value={transcript}
                onChange={(event) => setTranscript(event.target.value)}
                placeholder="Paste the YouTube transcript here…"
                className="min-h-40 text-base md:text-sm"
              />
              <p className="text-xs text-muted-foreground">{transcript.length.toLocaleString()} characters</p>
            </div>
            <div>
              <Button
                type="button"
                disabled={loading || !transcript.trim()}
                className="h-11 px-4"
                onClick={() => void run({ transcript, title }, "Writing the brief")}
              >
                Summarize transcript
              </Button>
            </div>
          </div>
        ) : null}
      </form>

      {loading ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <Loader2 className="size-4 animate-spin" />
          {loadingLabel}. The first caption fetch can take a few seconds.
        </p>
      ) : null}

      {error && !showPaste ? (
        <div role="alert" className="rounded-2xl border border-clay/30 bg-clay/10 px-4 py-3 text-sm leading-6">
          {error}
        </div>
      ) : null}

      {result ? (
        <div className="grid gap-8">
          <header className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary">{result.summary.mode === "abstractive" ? "AI brief" : "Extractive brief"}</Badge>
              {result.video?.kind ? <Badge variant="outline">{result.video.kind} captions</Badge> : null}
              {result.video?.language ? <Badge variant="outline">{result.video.language}</Badge> : null}
              {duration ? <Badge variant="outline">{duration}</Badge> : null}
            </div>
            <h2 className="font-heading text-3xl tracking-tight text-balance">{result.summary.title}</h2>
            {result.video?.author ? <p className="text-sm text-muted-foreground">{result.video.author}</p> : null}
            {result.notice ? <p className="text-sm text-muted-foreground">{result.notice}</p> : null}
          </header>

          <div className="flex flex-wrap gap-2" aria-label="Downloads">
            <Button type="button" onClick={() => void exportFile(() => downloadSummaryDocx(result.summary), "Word")}>
              Word
            </Button>
            <Button type="button" variant="outline" onClick={() => void exportFile(() => downloadSummaryPptx(result.summary), "PowerPoint")}>
              PowerPoint
            </Button>
            <Button type="button" variant="outline" onClick={() => void exportFile(() => downloadMindMapSvg(result.summary), "SVG")}>
              Mind map SVG
            </Button>
            <Button type="button" variant="outline" onClick={() => void exportFile(() => downloadMindMapPng(result.summary), "PNG")}>
              Mind map PNG
            </Button>
            <Button type="button" variant="ghost" onClick={() => downloadOutlineMarkdown(result.summary)}>
              Markdown
            </Button>
            <Button type="button" variant="ghost" onClick={() => downloadOutlineJson(result.summary)}>
              JSON
            </Button>
          </div>

          <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1.05fr)_minmax(280px,0.95fr)]">
            <article className="grid gap-6">
              <section>
                <h3 className="font-heading text-xl">Overview</h3>
                <p className="mt-2 text-base leading-7">{result.summary.overview}</p>
              </section>
              <section>
                <h3 className="font-heading text-xl">Key points</h3>
                <ul className="mt-2 grid list-disc gap-2 pl-5 text-sm leading-6">
                  {result.summary.keyPoints.map((point) => (
                    <li key={point}>{point}</li>
                  ))}
                </ul>
              </section>
              {result.summary.sections.map((section) => (
                <section key={section.heading}>
                  <h3 className="font-heading text-xl">{section.heading}</h3>
                  <ul className="mt-2 grid list-disc gap-2 pl-5 text-sm leading-6">
                    {section.bullets.map((bullet) => (
                      <li key={bullet}>{bullet}</li>
                    ))}
                  </ul>
                </section>
              ))}
            </article>
            <MindMap summary={result.summary} />
          </div>

          <details className="rounded-2xl border border-border bg-card px-4 py-3">
            <summary className="cursor-pointer text-sm font-medium">Transcript used for this brief</summary>
            <p className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
              {result.transcript}
            </p>
          </details>
        </div>
      ) : null}
    </div>
  );
}
