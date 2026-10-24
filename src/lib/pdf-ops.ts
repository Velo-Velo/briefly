import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

import type { Annotation } from "@/lib/pdf-types";
import { PdfEditError } from "@/lib/pdf-types";

function hexToRgb(hex: string) {
  const normalized = hex.replace("#", "");
  const value = Number.parseInt(normalized, 16);
  if (!Number.isFinite(value)) return rgb(0.11, 0.1, 0.08);
  return rgb(((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255);
}

function winAnsi(text: string): string {
  return text.replace(/[^\n\r\t\x20-\x7E\u00A0-\u00FF]/g, "");
}

async function loadPdf(bytes: Uint8Array) {
  try {
    return await PDFDocument.load(bytes);
  } catch {
    throw new PdfEditError(
      "This PDF is encrypted, damaged, or not a standard PDF. Briefly can edit files that open without a password.",
    );
  }
}

export async function reorderPages(bytes: Uint8Array, order: number[]): Promise<Uint8Array> {
  const source = await loadPdf(bytes);
  const next = await PDFDocument.create();
  const pages = await next.copyPages(source, order);
  pages.forEach((page) => next.addPage(page));
  next.setProducer("Briefly");
  next.setCreator("Briefly");
  return next.save();
}

export async function appendPdf(base: Uint8Array, extra: Uint8Array): Promise<Uint8Array> {
  const left = await loadPdf(base);
  const right = await loadPdf(extra);
  const pages = await left.copyPages(right, right.getPageIndices());
  pages.forEach((page) => left.addPage(page));
  return left.save();
}

function wrapToWidth(font: PDFFont, text: string, fontSize: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    if (!paragraph) {
      lines.push("");
      continue;
    }
    let remaining = paragraph;
    while (remaining.length) {
      if (font.widthOfTextAtSize(remaining, fontSize) <= maxWidth) {
        lines.push(remaining);
        break;
      }
      let cut = remaining.length;
      while (cut > 1 && font.widthOfTextAtSize(remaining.slice(0, cut), fontSize) > maxWidth) {
        const space = remaining.lastIndexOf(" ", cut - 1);
        cut = space > 0 ? space : cut - 1;
      }
      const piece = remaining.slice(0, Math.max(1, cut)).trimEnd();
      lines.push(piece);
      remaining = remaining.slice(Math.max(1, cut)).trimStart();
    }
  }
  return lines;
}

function drawWrappedText(page: PDFPage, font: PDFFont, annotation: Extract<Annotation, { type: "text" }>) {
  const { width, height } = page.getSize();
  const text = winAnsi(annotation.text);
  if (!text.trim()) return;
  const fontSize = annotation.size;
  const boxWidth = Math.max(4, annotation.w * width);
  const boxTop = height - annotation.y * height;
  const boxBottom = height - (annotation.y + annotation.h) * height;
  const lineHeight = fontSize * 1.3;
  wrapToWidth(font, text, fontSize, boxWidth).forEach((line, index) => {
    const baseline = boxTop - fontSize - index * lineHeight;
    if (baseline < boxBottom - 1 || !line) return;
    page.drawText(line, {
      x: annotation.x * width,
      y: baseline,
      size: fontSize,
      font,
      color: hexToRgb(annotation.color),
    });
  });
}

export async function burnAnnotations(bytes: Uint8Array, annotations: Annotation[]): Promise<Uint8Array> {
  const document = await loadPdf(bytes);
  const font = await document.embedFont(StandardFonts.Helvetica);
  const ordered = [
    ...annotations.filter((item) => item.type === "highlight"),
    ...annotations.filter((item) => item.type === "draw"),
    ...annotations.filter((item) => item.type === "text"),
  ];

  for (const annotation of ordered) {
    if (annotation.page < 1 || annotation.page > document.getPageCount()) continue;
    const page = document.getPage(annotation.page - 1);
    const { width, height } = page.getSize();

    if (annotation.type === "highlight") {
      page.drawRectangle({
        x: annotation.x * width,
        y: height - (annotation.y + annotation.h) * height,
        width: annotation.w * width,
        height: annotation.h * height,
        color: hexToRgb(annotation.color),
        opacity: 0.38,
      });
    }

    if (annotation.type === "draw" && annotation.points.length > 1) {
      for (let index = 1; index < annotation.points.length; index += 1) {
        const from = annotation.points[index - 1];
        const to = annotation.points[index];
        page.drawLine({
          start: { x: from.x * width, y: height - from.y * height },
          end: { x: to.x * width, y: height - to.y * height },
          thickness: annotation.width,
          color: hexToRgb(annotation.color),
        });
      }
    }

    if (annotation.type === "text") drawWrappedText(page, font, annotation);
  }

  document.setProducer("Briefly");
  document.setCreator("Briefly");
  return document.save();
}

export async function makeSamplePdf(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const serif = await document.embedFont(StandardFonts.TimesRoman);
  const serifBold = await document.embedFont(StandardFonts.TimesRomanBold);
  const sans = await document.embedFont(StandardFonts.Helvetica);

  const first = document.addPage([612, 792]);
  first.drawRectangle({ x: 0, y: 742, width: 612, height: 50, color: rgb(0.12, 0.42, 0.29) });
  first.drawText("North Lot tool library", {
    x: 48,
    y: 760,
    size: 18,
    font: sans,
    color: rgb(0.97, 0.95, 0.92),
  });
  first.drawText("Saturday field notes", {
    x: 48,
    y: 690,
    size: 28,
    font: serifBold,
    color: rgb(0.11, 0.1, 0.08),
  });

  const paragraphs = [
    "Members borrow hand tools for a week. Power tools go out for a weekend, one per household, and come back clean.",
    "Ladders taller than twelve feet and anything with a chain stay in the shed. If a blade is dull, leave a note on the tag instead of forcing it.",
    "The repair fund is the city microgrant plus the bake sale. Receipts live in the clipboard by the door.",
  ];
  paragraphs.forEach((paragraph, index) => {
    first.drawText(paragraph, {
      x: 48,
      y: 620 - index * 78,
      size: 13,
      font: serif,
      color: rgb(0.16, 0.14, 0.12),
      maxWidth: 516,
      lineHeight: 18,
    });
  });

  const second = document.addPage([612, 792]);
  second.drawText("Maintenance rotation", {
    x: 48,
    y: 720,
    size: 26,
    font: serifBold,
    color: rgb(0.11, 0.1, 0.08),
  });
  const tasks = [
    "Oil the hinge on the shed door.",
    "Count the 10mm sockets and write the missing ones on the board.",
    "Wipe the circular saw and check the guard.",
    "Set aside anything with a red tag for next Saturday's repair hour.",
  ];
  tasks.forEach((task, index) => {
    second.drawText(`${index + 1}.  ${task}`, {
      x: 48,
      y: 660 - index * 36,
      size: 14,
      font: serif,
      color: rgb(0.16, 0.14, 0.12),
    });
  });

  const tableLeft = 48;
  const tableRight = 540;
  const tableTop = 470;
  const rowHeight = 22;
  const columns = [48, 210, 360, 540];
  const tableRows = ["Tool", "Out", "Due back", "Awl", "Priya", "Sat 4pm", "Level", "Jonah", "Sun noon", "Saw", "Mina", "Sat 6pm"];
  second.drawText("Checkout", {
    x: tableLeft,
    y: tableTop + 14,
    size: 13,
    font: serifBold,
    color: rgb(0.11, 0.1, 0.08),
  });
  for (let row = 0; row <= 4; row += 1) {
    const y = tableTop - row * rowHeight;
    second.drawLine({
      start: { x: tableLeft, y },
      end: { x: tableRight, y },
      thickness: 0.6,
      color: rgb(0.25, 0.22, 0.18),
    });
  }
  for (const x of columns) {
    second.drawLine({
      start: { x, y: tableTop },
      end: { x, y: tableTop - 4 * rowHeight },
      thickness: 0.6,
      color: rgb(0.25, 0.22, 0.18),
    });
  }
  tableRows.forEach((label, index) => {
    const column = index % 3;
    const row = Math.floor(index / 3);
    second.drawText(label, {
      x: columns[column] + 4,
      y: tableTop - row * rowHeight - 15,
      size: 9,
      font: row === 0 ? sans : serif,
      color: rgb(0.16, 0.14, 0.12),
    });
  });

  document.setTitle("North Lot field notes");
  document.setProducer("Briefly");
  document.setCreator("Briefly");
  return document.save();
}
