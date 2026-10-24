export type SummarySection = {
  heading: string;
  bullets: string[];
};

export type Summary = {
  title: string;
  overview: string;
  keyPoints: string[];
  sections: SummarySection[];
  mode: "extractive" | "abstractive";
  model?: string;
};

export type TranscriptSegment = {
  start: number;
  duration: number;
  text: string;
};

export type SummarizeInput = {
  title: string;
  transcript: string;
  segments?: TranscriptSegment[];
};

export type SummarizeOutput = {
  summary: Summary;
  notice?: string;
};
