import type {
  SummarizeInput,
  SummarizeOutput,
  Summary,
  SummarySection,
  TranscriptSegment,
} from "@/lib/summary";

const STOP = new Set(
  `a an the and or but if then else when where who what which how why this that these those it its of to for from in on at by with as is are was were be been being have has had do does did not no nor so too very can could should would will just about into over after before than also you your we our they their i me my he she his her them our there here out up down more most other some any each few such only own same because back like come comes came get gets got make makes made still next even really going want gonna dont don't it's its that's there's here's thing things something anything everything someone people one two`.split(
    /\s+/,
  ),
);

const SECTION_FALLBACKS = ["Opening", "What follows", "Further on", "Later", "Closing"];

function cleanCaption(text: string): string {
  return text
    .replace(/\[[^\]]{0,48}\]/g, " ")
    .replace(/[♪♫]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9'\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2 && !STOP.has(word));
}

function wordFreq(text: string): Map<string, number> {
  const freq = new Map<string, number>();
  for (const word of tokens(text)) {
    freq.set(word, (freq.get(word) ?? 0) + 1);
  }
  return freq;
}

function scoreText(text: string, freq: Map<string, number>): number {
  const words = tokens(text);
  if (words.length === 0) return 0;
  const total = words.reduce((sum, word) => sum + (freq.get(word) ?? 0), 0);
  return total / Math.sqrt(words.length);
}

function jaccard(a: string, b: string): number {
  const left = new Set(tokens(a));
  const right = new Set(tokens(b));
  if (left.size === 0 || right.size === 0) return 0;
  let intersection = 0;
  for (const word of left) {
    if (right.has(word)) intersection += 1;
  }
  return intersection / (left.size + right.size - intersection);
}

function tooSimilar(text: string, chosen: string[]): boolean {
  return chosen.some((other) => jaccard(text, other) > 0.62);
}

function chunksFromSegments(segments: TranscriptSegment[]): string[] {
  const chunks: string[] = [];
  let parts: string[] = [];
  let words = 0;
  let lastEnd = 0;

  const flush = () => {
    const text = cleanCaption(parts.join(" "));
    const count = text.split(/\s+/).filter(Boolean).length;
    if (count >= 8) chunks.push(text);
    parts = [];
    words = 0;
  };

  for (const segment of segments) {
    const piece = cleanCaption(segment.text);
    if (!piece) continue;
    const gap = parts.length ? segment.start - lastEnd : 0;
    const count = piece.split(/\s+/).length;
    if (parts.length && (gap > 1.4 || words >= 30)) flush();
    parts.push(piece);
    words += count;
    lastEnd = segment.start + (segment.duration || 0);
  }
  flush();
  return chunks;
}

function chunksFromText(transcript: string): string[] {
  const cleaned = cleanCaption(transcript);
  const sentences = cleaned
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.split(/\s+/).length >= 6);

  if (sentences.length >= 4) return sentences;

  const words = cleaned.split(/\s+/).filter(Boolean);
  const chunks: string[] = [];
  const size = 28;
  for (let index = 0; index < words.length; index += size) {
    const slice = words.slice(index, index + size);
    if (slice.length >= 8) chunks.push(slice.join(" "));
  }
  return chunks;
}

function selectIndexes(chunks: string[], target: number): number[] {
  if (chunks.length <= target) return chunks.map((_, index) => index);

  const freq = wordFreq(chunks.join(" "));
  const scored = chunks.map((text, index) => ({
    index,
    text,
    score: scoreText(text, freq),
  }));
  const bins = Math.min(target, chunks.length);
  const chosen: number[] = [];
  const used: string[] = [];

  for (let bin = 0; bin < bins; bin += 1) {
    const start = Math.floor((bin * chunks.length) / bins);
    const end = Math.max(start + 1, Math.floor(((bin + 1) * chunks.length) / bins));
    const ranked = scored.slice(start, end).sort((a, b) => b.score - a.score);
    const pick = ranked.find((item) => !tooSimilar(item.text, used)) ?? ranked[0];
    if (!pick || chosen.includes(pick.index)) continue;
    chosen.push(pick.index);
    used.push(pick.text);
  }

  if (chosen.length < Math.min(4, target)) {
    for (const item of [...scored].sort((a, b) => b.score - a.score)) {
      if (chosen.includes(item.index) || tooSimilar(item.text, used)) continue;
      chosen.push(item.index);
      used.push(item.text);
      if (chosen.length >= target) break;
    }
  }

  return chosen.sort((a, b) => a - b);
}

function toPoint(text: string): string {
  const compact = cleanCaption(text).replace(/\s+/g, " ");
  const clipped = compact.length > 220 ? `${compact.slice(0, 217).replace(/\s+\S*$/, "")}…` : compact;
  const capitalized = clipped.charAt(0).toUpperCase() + clipped.slice(1);
  if (/[.!?…]$/.test(capitalized)) return capitalized;
  return `${capitalized}.`;
}

function headingFor(texts: string[], sectionIndex: number): string {
  const source = texts[0] ?? "";
  const clause = source.split(/[,.]|(?:\s+and\s+)/i)[0]?.trim() ?? "";
  const words = clause.split(/\s+/).filter(Boolean).slice(0, 6);
  const heading = words.join(" ").replace(/[.!?…,:;]$/, "");
  if (heading.length >= 8) return heading.charAt(0).toUpperCase() + heading.slice(1);
  return SECTION_FALLBACKS[sectionIndex] ?? `Part ${sectionIndex + 1}`;
}

function trimOverview(chunks: string[]): string {
  const joined = chunks.slice(0, 2).map(toPoint).join(" ");
  if (joined.length <= 480) return joined;
  return `${joined.slice(0, 477).replace(/\s+\S*$/, "")}…`;
}

export function extractiveSummary(input: SummarizeInput): Summary {
  const title = input.title.trim() || "Untitled video";
  const fromSegments = input.segments?.length ? chunksFromSegments(input.segments) : [];
  const chunks = fromSegments.length >= 3 ? fromSegments : chunksFromText(input.transcript);

  if (chunks.length === 0) {
    const fallback = cleanCaption(input.transcript);
    return {
      title,
      overview: fallback || "The transcript was too short to summarize.",
      keyPoints: fallback ? [toPoint(fallback)] : [],
      sections: fallback
        ? [{ heading: "Notes", bullets: [toPoint(fallback)] }]
        : [],
      mode: "extractive",
    };
  }

  const target = Math.min(12, Math.max(4, Math.round(chunks.length * 0.35)));
  const indexes = selectIndexes(chunks, target);
  const picked = indexes.map((index) => chunks[index]);
  const points = picked.map(toPoint);
  const groupSize = points.length > 8 ? 3 : 2;
  const sections: SummarySection[] = [];

  for (let index = 0; index < points.length; index += groupSize) {
    const bullets = points.slice(index, index + groupSize);
    const source = picked.slice(index, index + groupSize);
    sections.push({
      heading: headingFor(source, sections.length),
      bullets,
    });
  }

  return {
    title,
    overview: trimOverview(picked),
    keyPoints: points.slice(0, 6),
    sections,
    mode: "extractive",
  };
}

function sampleTranscript(text: string, max: number): string {
  const cleaned = cleanCaption(text);
  if (cleaned.length <= max) return cleaned;
  const head = Math.floor(max * 0.45);
  const middle = Math.floor(max * 0.25);
  const tail = Math.max(0, max - head - middle - 20);
  const middleStart = Math.max(0, Math.floor((cleaned.length - middle) / 2));
  return [
    cleaned.slice(0, head),
    " … ",
    cleaned.slice(middleStart, middleStart + middle),
    " … ",
    cleaned.slice(-tail),
  ].join("");
}

function asSummaryShape(value: unknown): {
  overview: string;
  keyPoints: string[];
  sections: SummarySection[];
} | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.overview !== "string" || !record.overview.trim()) return null;
  if (!Array.isArray(record.keyPoints)) return null;
  const keyPoints = record.keyPoints
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 8);
  if (!Array.isArray(record.sections)) return null;
  const sections = record.sections
    .map((section) => {
      if (!section || typeof section !== "object") return null;
      const item = section as Record<string, unknown>;
      if (typeof item.heading !== "string" || !Array.isArray(item.bullets)) return null;
      const bullets = item.bullets
        .filter((bullet): bullet is string => typeof bullet === "string")
        .map((bullet) => bullet.trim())
        .filter(Boolean)
        .slice(0, 6);
      if (!item.heading.trim() || bullets.length === 0) return null;
      return { heading: item.heading.trim().slice(0, 80), bullets };
    })
    .filter((section): section is SummarySection => section !== null)
    .slice(0, 6);
  if (keyPoints.length === 0 || sections.length === 0) return null;
  return {
    overview: record.overview.trim().slice(0, 900),
    keyPoints,
    sections,
  };
}

async function abstractiveSummary(input: SummarizeInput, apiKey: string): Promise<Summary> {
  const model = process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini";
  const transcript = sampleTranscript(input.transcript, 16_000);
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    signal: AbortSignal.timeout(30_000),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You summarize transcripts. Reply with JSON only: {\"overview\": string, \"keyPoints\": string[], \"sections\": [{\"heading\": string, \"bullets\": string[]}]}. Use only facts from the transcript. Write 2-4 sentence overview, 5-7 key points, and 3-6 sections with short headings and 2-4 bullets each. No markdown.",
        },
        {
          role: "user",
          content: `Title: ${input.title}\n\nTranscript:\n${transcript}`,
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI request failed (${response.status})`);
  }

  const payload = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error("OpenAI returned an empty summary");
  const parsed = asSummaryShape(JSON.parse(content));
  if (!parsed) throw new Error("OpenAI returned an unexpected summary shape");

  return {
    title: input.title.trim() || "Untitled video",
    overview: parsed.overview,
    keyPoints: parsed.keyPoints,
    sections: parsed.sections,
    mode: "abstractive",
    model,
  };
}

export async function summarize(input: SummarizeInput): Promise<SummarizeOutput> {
  const transcript = input.transcript.trim();
  if (!transcript) {
    throw new Error("Transcript is empty");
  }

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return { summary: extractiveSummary({ ...input, transcript }) };
  }

  try {
    const summary = await abstractiveSummary({ ...input, transcript }, apiKey);
    return { summary };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "AI summary failed";
    return {
      summary: extractiveSummary({ ...input, transcript }),
      notice: `The AI summary did not complete (${reason}). This brief is built directly from the transcript.`,
    };
  }
}
