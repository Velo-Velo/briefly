import type { Metadata } from "next";

import { PdfEditor } from "@/components/pdf-editor";

export const metadata: Metadata = {
  title: "Edit PDF",
  description: "Highlight, annotate, reorder, and download a PDF in the browser. Free and private.",
};

export default function PdfPage() {
  return <PdfEditor />;
}
