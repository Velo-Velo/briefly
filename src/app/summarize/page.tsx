import type { Metadata } from "next";

import { Summarizer } from "@/components/summarizer";

export const metadata: Metadata = {
  title: "Summarize YouTube",
  description: "Paste a YouTube URL and download a brief as a mind map, PowerPoint, or Word document.",
};

export default function SummarizePage() {
  return <Summarizer />;
}
