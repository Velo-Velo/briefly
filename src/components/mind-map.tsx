"use client";

import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { layoutMindMap, type MindLayout } from "@/lib/mindmap";
import type { Summary } from "@/lib/summary";

function palette(depth: number) {
  if (depth === 0) return { fill: "#1C1915", color: "#F6F3EC", stroke: "#1C1915" };
  if (depth === 1) return { fill: "#1F6A4A", color: "#F6F3EC", stroke: "#1F6A4A" };
  return { fill: "#FFFDF8", color: "#1C1915", stroke: "#D9D0C1" };
}

export function MindMap({ summary }: { summary: Summary }) {
  const layout = useMemo(() => layoutMindMap(summary), [summary]);
  const [zoom, setZoom] = useState(1);
  const [selected, setSelected] = useState<string>("root");
  const active = layout.nodes.find((node) => node.id === selected) ?? layout.nodes[0];

  return (
    <section className="flex min-w-0 flex-col gap-3" aria-label="Mind map">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-heading text-xl">Mind map</h2>
        <div className="flex items-center gap-1">
          <Button type="button" variant="outline" size="sm" onClick={() => setZoom((value) => Math.max(0.6, value - 0.15))}>
            Smaller
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => setZoom(1)}>
            Fit
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => setZoom((value) => Math.min(1.8, value + 0.15))}>
            Larger
          </Button>
        </div>
      </div>
      <div className="overflow-auto rounded-2xl border border-border bg-[#f7f3ea]">
        <MindSvg layout={layout} zoom={zoom} selected={selected} onSelect={setSelected} />
      </div>
      {active ? (
        <p className="rounded-xl bg-muted px-3 py-2 text-sm leading-6 text-foreground">
          <span className="font-medium">{active.depth === 0 ? "Center" : active.depth === 1 ? "Branch" : "Point"}.</span>{" "}
          {active.fullLabel}
        </p>
      ) : null}
    </section>
  );
}

function MindSvg({
  layout,
  zoom,
  selected,
  onSelect,
}: {
  layout: MindLayout;
  zoom: number;
  selected: string;
  onSelect: (id: string) => void;
}) {
  return (
    <svg
      role="img"
      aria-label="Interactive mind map of the brief"
      width={layout.width * zoom}
      height={layout.height * zoom}
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      className="block"
    >
      <rect width={layout.width} height={layout.height} fill="#F7F3EA" />
      {layout.edges.map((edge, index) => {
        const mid = (edge.x1 + edge.x2) / 2;
        return (
          <path
            key={index}
            d={`M ${edge.x1} ${edge.y1} C ${mid} ${edge.y1}, ${mid} ${edge.y2}, ${edge.x2} ${edge.y2}`}
            fill="none"
            stroke="#C8BEB0"
            strokeWidth={1.5}
          />
        );
      })}
      {layout.nodes.map((node) => {
        const colors = palette(node.depth);
        const isSelected = node.id === selected;
        return (
          <g
            key={node.id}
            tabIndex={0}
            role="button"
            aria-pressed={isSelected}
            aria-label={node.fullLabel}
            className="cursor-pointer outline-none"
            onClick={() => onSelect(node.id)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onSelect(node.id);
              }
            }}
          >
            <rect
              x={node.x}
              y={node.y}
              width={node.w}
              height={node.h}
              rx={12}
              fill={colors.fill}
              stroke={isSelected ? "#C24D32" : colors.stroke}
              strokeWidth={isSelected ? 2.5 : 1}
            />
            {node.lines.map((line, index) => (
              <text
                key={index}
                x={node.x + 14}
                y={node.y + 12 + 14 + index * 18}
                fill={colors.color}
                fontFamily="Georgia, 'Iowan Old Style', serif"
                fontSize={13}
              >
                {line}
              </text>
            ))}
          </g>
        );
      })}
    </svg>
  );
}
