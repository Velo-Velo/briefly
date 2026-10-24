import type { Summary } from "@/lib/summary";

export type MindNode = {
  id: string;
  label: string;
  fullLabel: string;
  depth: number;
  x: number;
  y: number;
  w: number;
  h: number;
  lines: string[];
};

export type MindLayout = {
  nodes: MindNode[];
  edges: { x1: number; y1: number; x2: number; y2: number }[];
  width: number;
  height: number;
};

const LINE = 18;
const PAD_Y = 12;
const GAP_X = 56;
const GAP_Y = 14;
const MARGIN = 28;

function wrap(text: string, maxChars: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > maxChars && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function nodeBox(label: string, depth: number): { w: number; h: number; lines: string[] } {
  const w = depth === 0 ? 250 : depth === 1 ? 210 : 260;
  const maxChars = depth === 2 ? 34 : 26;
  const wrapped = wrap(label, maxChars);
  const lines = wrapped.slice(0, 3);
  if (wrapped.length > 3) {
    lines[2] = `${lines[2].replace(/…$/, "")}…`;
  }
  return { w, h: PAD_Y * 2 + lines.length * LINE, lines };
}

type Draft = {
  id: string;
  label: string;
  fullLabel: string;
  depth: number;
  w: number;
  h: number;
  lines: string[];
  children: Draft[];
};

function toDraft(
  id: string,
  label: string,
  depth: number,
  children: Draft[] = [],
): Draft {
  const box = nodeBox(label, depth);
  return { id, label, fullLabel: label, depth, ...box, children };
}

function subtreeHeight(node: Draft): number {
  if (node.children.length === 0) return node.h;
  const children = node.children.reduce(
    (sum, child, index) => sum + subtreeHeight(child) + (index > 0 ? GAP_Y : 0),
    0,
  );
  return Math.max(node.h, children);
}

export function layoutMindMap(summary: Summary): MindLayout {
  const root = toDraft(
    "root",
    summary.title,
    0,
    summary.sections.map((section, sectionIndex) =>
      toDraft(
        `section-${sectionIndex}`,
        section.heading,
        1,
        section.bullets.map((bullet, bulletIndex) =>
          toDraft(`section-${sectionIndex}-bullet-${bulletIndex}`, bullet, 2),
        ),
      ),
    ),
  );

  const nodes: MindNode[] = [];
  const edges: MindLayout["edges"] = [];

  function place(node: Draft, x: number, y: number) {
    const height = subtreeHeight(node);
    const placed: MindNode = {
      id: node.id,
      label: node.label,
      fullLabel: node.fullLabel,
      depth: node.depth,
      x,
      y: y + (height - node.h) / 2,
      w: node.w,
      h: node.h,
      lines: node.lines,
    };
    nodes.push(placed);
    let cursor = y;
    for (const child of node.children) {
      const childHeight = subtreeHeight(child);
      place(child, x + node.w + GAP_X, cursor);
      const childNode = nodes[nodes.length - 1];
      const childRoot = nodes.find((item) => item.id === child.id) ?? childNode;
      edges.push({
        x1: placed.x + placed.w,
        y1: placed.y + placed.h / 2,
        x2: childRoot.x,
        y2: childRoot.y + childRoot.h / 2,
      });
      cursor += childHeight + GAP_Y;
    }
  }

  place(root, MARGIN, MARGIN);
  const width = Math.max(...nodes.map((node) => node.x + node.w), 320) + MARGIN;
  const height = Math.max(...nodes.map((node) => node.y + node.h), 160) + MARGIN;
  return { nodes, edges, width, height };
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function fillFor(depth: number): { fill: string; color: string; stroke: string } {
  if (depth === 0) return { fill: "#1C1915", color: "#F6F3EC", stroke: "#1C1915" };
  if (depth === 1) return { fill: "#1F6A4A", color: "#F6F3EC", stroke: "#1F6A4A" };
  return { fill: "#FFFDF8", color: "#1C1915", stroke: "#D9D0C1" };
}

export function mindMapSvg(layout: MindLayout): string {
  const paths = layout.edges
    .map((edge) => {
      const mid = (edge.x1 + edge.x2) / 2;
      return `<path d="M ${edge.x1} ${edge.y1} C ${mid} ${edge.y1}, ${mid} ${edge.y2}, ${edge.x2} ${edge.y2}" fill="none" stroke="#C8BEB0" stroke-width="1.5"/>`;
    })
    .join("");

  const nodes = layout.nodes
    .map((node) => {
      const palette = fillFor(node.depth);
      const text = node.lines
        .map((line, index) => {
          const y = node.y + PAD_Y + 13 + index * LINE;
          return `<text x="${node.x + 14}" y="${y}" fill="${palette.color}" font-family="Georgia, 'Iowan Old Style', serif" font-size="13">${escapeXml(line)}</text>`;
        })
        .join("");
      return `<g><rect x="${node.x}" y="${node.y}" width="${node.w}" height="${node.h}" rx="12" fill="${palette.fill}" stroke="${palette.stroke}"/>${text}</g>`;
    })
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${layout.width}" height="${layout.height}" viewBox="0 0 ${layout.width} ${layout.height}">
  <rect width="100%" height="100%" fill="#F7F3EA"/>
  ${paths}
  ${nodes}
</svg>`;
}

export function mindMapMarkdown(summary: Summary): string {
  const lines = [`# ${summary.title}`, "", summary.overview, "", "## Key points"];
  for (const point of summary.keyPoints) lines.push(`- ${point}`);
  lines.push("");
  for (const section of summary.sections) {
    lines.push(`## ${section.heading}`);
    for (const bullet of section.bullets) lines.push(`- ${bullet}`);
    lines.push("");
  }
  return lines.join("\n").trim() + "\n";
}

export function mindMapJson(summary: Summary): string {
  return JSON.stringify(
    {
      title: summary.title,
      overview: summary.overview,
      children: summary.sections.map((section) => ({
        label: section.heading,
        children: section.bullets.map((bullet) => ({ label: bullet })),
      })),
    },
    null,
    2,
  );
}
