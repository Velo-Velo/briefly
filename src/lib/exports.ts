import { downloadBlob, downloadText, slugify } from "@/lib/download";
import { mindMapJson, mindMapMarkdown, mindMapSvg, layoutMindMap } from "@/lib/mindmap";
import type { Summary } from "@/lib/summary";

export async function downloadSummaryDocx(summary: Summary) {
  const { Document, HeadingLevel, Packer, Paragraph, TextRun } = await import("docx");
  const children = [
    new Paragraph({
      heading: HeadingLevel.TITLE,
      children: [new TextRun(summary.title)],
    }),
    new Paragraph({
      spacing: { after: 200 },
      children: [new TextRun(summary.overview)],
    }),
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      children: [new TextRun("Key points")],
    }),
    ...summary.keyPoints.map(
      (point) =>
        new Paragraph({
          bullet: { level: 0 },
          children: [new TextRun(point)],
        }),
    ),
    ...summary.sections.flatMap((section) => [
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [new TextRun(section.heading)],
      }),
      ...section.bullets.map(
        (bullet) =>
          new Paragraph({
            bullet: { level: 0 },
            children: [new TextRun(bullet)],
          }),
      ),
    ]),
  ];

  const document = new Document({
    creator: "Briefly",
    title: summary.title,
    description: "YouTube summary from Briefly",
    sections: [{ children }],
  });
  const blob = await Packer.toBlob(document);
  downloadBlob(blob, `${slugify(summary.title)}.docx`);
}

export async function downloadSummaryPptx(summary: Summary) {
  const pptxModule = await import("pptxgenjs");
  const PptxGenJS = pptxModule.default;
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: "WIDE", width: 13.333, height: 7.5 });
  pptx.layout = "WIDE";
  pptx.author = "Briefly";
  pptx.title = summary.title;
  pptx.subject = "YouTube summary";

  const titleSlide = pptx.addSlide();
  titleSlide.background = { color: "F7F3EA" };
  titleSlide.addShape("rect", { x: 0, y: 0, w: 0.22, h: 7.5, fill: { color: "1F6A4A" } });
  titleSlide.addText("BRIEFLY", {
    x: 0.7,
    y: 1.7,
    w: 10,
    h: 0.3,
    fontFace: "Calibri",
    fontSize: 14,
    color: "1F6A4A",
    bold: true,
    margin: 0,
  });
  titleSlide.addText(summary.title, {
    x: 0.7,
    y: 2.15,
    w: 11.5,
    h: 2.2,
    fontFace: "Calibri",
    fontSize: 36,
    color: "1C1915",
    bold: true,
    margin: 0,
  });
  titleSlide.addText(summary.overview, {
    x: 0.7,
    y: 4.6,
    w: 11.2,
    h: 1.8,
    fontFace: "Calibri",
    fontSize: 16,
    color: "3F3A33",
    margin: 0,
  });

  const points = pptx.addSlide();
  points.background = { color: "F7F3EA" };
  points.addText("Key points", {
    x: 0.6,
    y: 0.4,
    w: 12,
    h: 0.6,
    fontFace: "Calibri",
    fontSize: 28,
    bold: true,
    color: "1C1915",
    margin: 0,
  });
  points.addText(
    summary.keyPoints.map((point) => ({ text: point, options: { bullet: true, breakLine: true } })),
    {
      x: 0.7,
      y: 1.4,
      w: 11.8,
      h: 5.4,
      fontFace: "Calibri",
      fontSize: 18,
      color: "1C1915",
      paraSpaceAfter: 12,
    },
  );

  for (const section of summary.sections) {
    const slide = pptx.addSlide();
    slide.background = { color: "F7F3EA" };
    slide.addShape("rect", { x: 0, y: 0, w: 13.333, h: 0.16, fill: { color: "1F6A4A" } });
    slide.addText(section.heading, {
      x: 0.6,
      y: 0.45,
      w: 12,
      h: 0.7,
      fontFace: "Calibri",
      fontSize: 28,
      bold: true,
      color: "1C1915",
      margin: 0,
    });
    slide.addText(
      section.bullets.map((bullet) => ({ text: bullet, options: { bullet: true, breakLine: true } })),
      {
        x: 0.7,
        y: 1.5,
        w: 11.8,
        h: 5.3,
        fontFace: "Calibri",
        fontSize: 18,
        color: "1C1915",
        paraSpaceAfter: 12,
      },
    );
  }

  await pptx.writeFile({ fileName: `${slugify(summary.title)}.pptx` });
}

export function downloadMindMapSvg(summary: Summary) {
  const svg = mindMapSvg(layoutMindMap(summary));
  downloadText(svg, `${slugify(summary.title)}-mind-map.svg`, "image/svg+xml");
}

export async function downloadMindMapPng(summary: Summary) {
  const layout = layoutMindMap(summary);
  const svg = mindMapSvg(layout);
  const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("Could not draw the mind map"));
      image.src = url;
    });
    const scale = 2;
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(layout.width * scale);
    canvas.height = Math.ceil(layout.height * scale);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas is unavailable");
    context.scale(scale, scale);
    context.drawImage(image, 0, 0, layout.width, layout.height);
    const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!png) throw new Error("Could not create the PNG");
    downloadBlob(png, `${slugify(summary.title)}-mind-map.png`);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function downloadOutlineMarkdown(summary: Summary) {
  downloadText(mindMapMarkdown(summary), `${slugify(summary.title)}-outline.md`, "text/markdown");
}

export function downloadOutlineJson(summary: Summary) {
  downloadText(mindMapJson(summary), `${slugify(summary.title)}-mind-map.json`, "application/json");
}
