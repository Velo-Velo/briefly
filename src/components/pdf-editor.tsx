"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Loader2, Minus, Plus, Redo2, Trash2, Undo2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { appendPdf, burnAnnotations, makeSamplePdf, reorderPages } from "@/lib/pdf-ops";
import type { Annotation, DrawAnnotation, HighlightAnnotation, PdfTool, TextAnnotation } from "@/lib/pdf-types";
import { PdfEditError } from "@/lib/pdf-types";
import { downloadBytes } from "@/lib/download";

const HIGHLIGHTS = ["#FFE566", "#B6F0C2", "#FFD0E0", "#C9E4FF"];
const INKS = ["#1C1915", "#C24D32", "#1F6A4A", "#2458A6"];
const STROKE_WIDTHS = [1.5, 3, 6];
const MAX_BYTES = 32 * 1024 * 1024;
const MIN_ZOOM = 0.4;
const MAX_ZOOM = 5;
const ZOOM_FACTOR = 1.25;
const MIN_TEXT_SIZE = 6;
const MAX_TEXT_SIZE = 72;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

type TextHandle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

const TEXT_HANDLES: { id: TextHandle; x: string; y: string; cursor: string }[] = [
  { id: "nw", x: "0%", y: "0%", cursor: "nwse-resize" },
  { id: "n", x: "50%", y: "0%", cursor: "ns-resize" },
  { id: "ne", x: "100%", y: "0%", cursor: "nesw-resize" },
  { id: "e", x: "100%", y: "50%", cursor: "ew-resize" },
  { id: "se", x: "100%", y: "100%", cursor: "nwse-resize" },
  { id: "s", x: "50%", y: "100%", cursor: "ns-resize" },
  { id: "sw", x: "0%", y: "100%", cursor: "nesw-resize" },
  { id: "w", x: "0%", y: "50%", cursor: "ew-resize" },
];

function resizeTextBox(
  origin: TextAnnotation,
  handle: TextHandle,
  point: { x: number; y: number },
  page: { w: number; h: number },
): TextAnnotation {
  const minW = 20 / page.w;
  const minH = Math.max(8, origin.size * 1.15) / page.h;
  let left = origin.x;
  let top = origin.y;
  let right = origin.x + origin.w;
  let bottom = origin.y + origin.h;
  if (handle.includes("e")) right = point.x;
  if (handle.includes("s")) bottom = point.y;
  if (handle.includes("w")) left = point.x;
  if (handle.includes("n")) top = point.y;
  if (right - left < minW) {
    if (handle.includes("w")) left = right - minW;
    else right = left + minW;
  }
  if (bottom - top < minH) {
    if (handle.includes("n")) top = bottom - minH;
    else bottom = top + minH;
  }
  left = clamp(left, 0, 1);
  top = clamp(top, 0, 1);
  right = clamp(right, 0, 1);
  bottom = clamp(bottom, 0, 1);
  if (right - left < minW) {
    if (left + minW <= 1) right = left + minW;
    else {
      right = 1;
      left = Math.max(0, 1 - minW);
    }
  }
  if (bottom - top < minH) {
    if (top + minH <= 1) bottom = top + minH;
    else {
      bottom = 1;
      top = Math.max(0, 1 - minH);
    }
  }
  return { ...origin, x: left, y: top, w: right - left, h: bottom - top };
}

function moveTextBox(origin: TextAnnotation, dx: number, dy: number): TextAnnotation {
  return {
    ...origin,
    x: clamp(origin.x + dx, 0, Math.max(0, 1 - origin.w)),
    y: clamp(origin.y + dy, 0, Math.max(0, 1 - origin.h)),
  };
}

type PdfViewport = { width: number; height: number };

type PdfRenderTask = { promise: Promise<void>; cancel: () => void };

type PdfPage = {
  getViewport: (params: { scale: number }) => PdfViewport;
  render: (params: { canvas: HTMLCanvasElement; viewport: PdfViewport; transform?: number[] }) => PdfRenderTask;
};

type PdfDoc = {
  numPages: number;
  getPage: (pageNumber: number) => Promise<PdfPage>;
  cleanup: () => Promise<void> | void;
  destroy?: () => Promise<void> | void;
};

type EditorSession = {
  bytes: Uint8Array;
  fileName: string;
  annotations: Annotation[];
  page: number;
  pdf: PdfDoc | null;
};

// Survives a download-triggered remount so the open file and its marks stay put.
let editorSession: EditorSession | null = null;

type HistoryOp =
  | { kind: "annotations"; annotations: Annotation[] }
  | { kind: "document"; bytes: Uint8Array; annotations: Annotation[]; page: number };

function cloneAnnotations(annotations: Annotation[]): Annotation[] {
  return structuredClone(annotations);
}

async function readPdfFile(file: File): Promise<Uint8Array> {
  if (file.size > MAX_BYTES) {
    throw new PdfEditError("That PDF is over 32 MB. Briefly keeps files in memory, so smaller documents work better.");
  }
  if (file.type && file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
    throw new PdfEditError("Choose a PDF file.");
  }
  return new Uint8Array(await file.arrayBuffer());
}

export function PdfEditor() {
  const [bytes, setBytes] = useState<Uint8Array | null>(editorSession?.bytes ?? null);
  const [fileName, setFileName] = useState(editorSession?.fileName ?? "document.pdf");
  const [pageCount, setPageCount] = useState(editorSession?.pdf?.numPages ?? 0);
  const [currentPage, setCurrentPage] = useState(editorSession?.page ?? 1);
  const [annotations, setAnnotations] = useState<Annotation[]>(editorSession?.annotations ?? []);
  const [tool, setTool] = useState<PdfTool>("highlight");
  const [color, setColor] = useState(HIGHLIGHTS[0]);
  const [textSize, setTextSize] = useState(16);
  const [strokeWidth, setStrokeWidth] = useState(3);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftRect, setDraftRect] = useState<HighlightAnnotation | null>(null);
  const [draftInk, setDraftInk] = useState<DrawAnnotation | null>(null);
  const [pagePts, setPagePts] = useState({ w: 612, h: 792 });
  const [zoom, setZoom] = useState<number | null>(null);
  const [fitScale, setFitScale] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [docVersion, setDocVersion] = useState(0);

  const pdfRef = useRef<PdfDoc | null>(editorSession?.pdf ?? null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const toolRef = useRef<PdfTool>(tool);
  const annotationsRef = useRef(annotations);
  const colorRef = useRef(color);
  const loadGeneration = useRef(0);
  const loadedBytes = useRef<Uint8Array | null>(editorSession?.pdf ? editorSession.bytes : null);
  toolRef.current = tool;
  annotationsRef.current = annotations;
  colorRef.current = color;
  const thumbRefs = useRef<(HTMLCanvasElement | null)[]>([]);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const mergeRef = useRef<HTMLInputElement | null>(null);
  const past = useRef<HistoryOp[]>([]);
  const future = useRef<HistoryOp[]>([]);
  const dragRef = useRef<{
    id: string;
    pointer: { x: number; y: number };
    origin: Annotation;
  } | null>(null);
  const highlightStart = useRef<{ x: number; y: number } | null>(null);
  const draftInkRef = useRef<DrawAnnotation | null>(null);
  const renders = useRef(new Map<HTMLCanvasElement, PdfRenderTask>());
  const ignoreTextBlur = useRef(false);
  const zoomRef = useRef<number | null>(null);
  const fitScaleRef = useRef(0);
  const pagePtsRef = useRef(pagePts);
  const zoomAnchor = useRef<{ nx: number; ny: number; clientX: number; clientY: number } | null>(null);
  const displayScale = fitScale > 0 ? clamp(zoom ?? fitScale, MIN_ZOOM, MAX_ZOOM) : 0;
  const stageSize = { w: pagePts.w * displayScale, h: pagePts.h * displayScale };
  zoomRef.current = zoom;
  fitScaleRef.current = fitScale;
  pagePtsRef.current = pagePts;

  const syncHistoryFlags = useCallback(() => {
    setCanUndo(past.current.length > 0);
    setCanRedo(future.current.length > 0);
  }, []);

  const pushAnnotations = useCallback(
    (next: Annotation[]) => {
      past.current.push({ kind: "annotations", annotations: cloneAnnotations(annotations) });
      if (past.current.length > 40) past.current.shift();
      future.current = [];
      setAnnotations(next);
      syncHistoryFlags();
    },
    [annotations, syncHistoryFlags],
  );

  const pushDocument = useCallback(
    (nextBytes: Uint8Array, nextAnnotations: Annotation[], page: number) => {
      if (!bytes) return;
      past.current.push({
        kind: "document",
        bytes: bytes.slice(),
        annotations: cloneAnnotations(annotations),
        page: currentPage,
      });
      if (past.current.length > 12) past.current.shift();
      future.current = [];
      setBytes(nextBytes);
      setAnnotations(nextAnnotations);
      setCurrentPage(page);
      syncHistoryFlags();
    },
    [annotations, bytes, currentPage, syncHistoryFlags],
  );

  const undo = useCallback(() => {
    const op = past.current.pop();
    if (!op || !bytes) return;
    if (op.kind === "annotations") {
      future.current.push({ kind: "annotations", annotations: cloneAnnotations(annotations) });
      setAnnotations(op.annotations);
    } else {
      future.current.push({
        kind: "document",
        bytes: bytes.slice(),
        annotations: cloneAnnotations(annotations),
        page: currentPage,
      });
      setBytes(op.bytes);
      setAnnotations(op.annotations);
      setCurrentPage(op.page);
    }
    setSelectedId(null);
    setEditingId(null);
    syncHistoryFlags();
  }, [annotations, bytes, currentPage, syncHistoryFlags]);

  const redo = useCallback(() => {
    const op = future.current.pop();
    if (!op || !bytes) return;
    if (op.kind === "annotations") {
      past.current.push({ kind: "annotations", annotations: cloneAnnotations(annotations) });
      setAnnotations(op.annotations);
    } else {
      past.current.push({
        kind: "document",
        bytes: bytes.slice(),
        annotations: cloneAnnotations(annotations),
        page: currentPage,
      });
      setBytes(op.bytes);
      setAnnotations(op.annotations);
      setCurrentPage(op.page);
    }
    syncHistoryFlags();
  }, [annotations, bytes, currentPage, syncHistoryFlags]);

  const applyTool = useCallback((next: PdfTool) => {
    toolRef.current = next;
    setTool(next);
    if (next === "highlight") setColor(HIGHLIGHTS[0]);
    if (next === "text" || next === "draw") setColor(INKS[0]);
    highlightStart.current = null;
    draftInkRef.current = null;
    setDraftRect(null);
    setDraftInk(null);
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z" && !event.shiftKey) {
        event.preventDefault();
        undo();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z" && event.shiftKey) {
        event.preventDefault();
        redo();
        return;
      }
      if (!typing && (event.metaKey || event.ctrlKey) && (event.key === "=" || event.key === "+" || event.key === "-" || event.key === "_")) {
        event.preventDefault();
        const current = zoomRef.current ?? fitScaleRef.current;
        if (current <= 0 || !stageRef.current || !surfaceRef.current) return;
        const factor = event.key === "-" || event.key === "_" ? 1 / ZOOM_FACTOR : ZOOM_FACTOR;
        const stage = stageRef.current.getBoundingClientRect();
        const surface = surfaceRef.current.getBoundingClientRect();
        const clientX = stage.left + stage.width / 2;
        const clientY = stage.top + stage.height / 2;
        zoomAnchor.current = {
          nx: clamp((clientX - surface.left) / surface.width, 0, 1),
          ny: clamp((clientY - surface.top) / surface.height, 0, 1),
          clientX,
          clientY,
        };
        queueZoom(current * factor);
        return;
      }
      if (!typing && (event.metaKey || event.ctrlKey) && event.key === "0") {
        event.preventDefault();
        fitPageWidth();
        return;
      }
      if (typing) return;
      if (selectedId && (event.key === "ArrowLeft" || event.key === "ArrowRight" || event.key === "ArrowUp" || event.key === "ArrowDown")) {
        event.preventDefault();
        const surface = surfaceRef.current;
        const step = event.shiftKey ? 10 : 1;
        const dx = (event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0) / (surface?.clientWidth || 1);
        const dy = (event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0) / (surface?.clientHeight || 1);
        pushAnnotations(
          annotations.map((item) => {
            if (item.id !== selectedId) return item;
            if (item.type === "draw") {
              return { ...item, points: item.points.map((spot) => ({ x: spot.x + dx, y: spot.y + dy })) };
            }
            return { ...item, x: clamp(item.x + dx, 0, Math.max(0, 1 - item.w)), y: clamp(item.y + dy, 0, Math.max(0, 1 - item.h)) };
          }),
        );
        return;
      }
      if ((event.key === "Delete" || event.key === "Backspace") && selectedId) {
        event.preventDefault();
        pushAnnotations(annotations.filter((item) => item.id !== selectedId));
        setSelectedId(null);
      }
      if (event.metaKey || event.ctrlKey || event.altKey || event.repeat) return;
      if (event.key.toLowerCase() === "v") applyTool("select");
      if (event.key.toLowerCase() === "t") applyTool("text");
      if (event.key.toLowerCase() === "h") applyTool("highlight");
      if (event.key.toLowerCase() === "d") applyTool("draw");
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [annotations, applyTool, pushAnnotations, redo, selectedId, undo]);

  useEffect(() => {
    if (!bytes) {
      editorSession = null;
      return;
    }
    editorSession = {
      bytes,
      fileName,
      annotations,
      page: currentPage,
      pdf: pdfRef.current,
    };
  }, [annotations, bytes, currentPage, fileName]);

  useEffect(() => {
    if (!bytes) return;
    const generation = ++loadGeneration.current;
    if (loadedBytes.current === bytes && pdfRef.current) {
      setPageCount(pdfRef.current.numPages);
      setLoading(false);
      setDocVersion((version) => version + 1);
      return;
    }
    const data = new Uint8Array(bytes.byteLength);
    data.set(bytes);
    let cancelled = false;
    const hadDocument = pdfRef.current != null;

    (async () => {
      // Reordering or restoring an open file must not flash "Opening PDF" or drop marks.
      if (!hadDocument) setLoading(true);
      setError(null);
      try {
        const pdfjs = await import("pdfjs-dist");
        if (cancelled || generation !== loadGeneration.current) return;
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
        const loadingTask = pdfjs.getDocument({ data, disableAutoFetch: true });
        const pdf = (await loadingTask.promise) as unknown as PdfDoc;
        if (cancelled || generation !== loadGeneration.current) {
          await loadingTask.destroy();
          return;
        }
        const previous = pdfRef.current;
        pdfRef.current = pdf;
        loadedBytes.current = bytes;
        if (editorSession && editorSession.bytes === bytes) editorSession.pdf = pdf;
        setPageCount(pdf.numPages);
        setCurrentPage((page) => Math.min(Math.max(page, 1), pdf.numPages));
        setDocVersion((version) => version + 1);
        if (previous && previous !== pdf) await previous.destroy?.();
      } catch (reason) {
        if (!cancelled && generation === loadGeneration.current) {
          setError(reason instanceof Error ? reason.message : "This PDF could not be opened.");
        }
      } finally {
        if (!cancelled && generation === loadGeneration.current) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [bytes]);

  const paint = useCallback(async (pdf: PdfDoc, pageNumber: number, canvas: HTMLCanvasElement, scale: number) => {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale });
    // PDF.js 6 creates the 2D context itself with alpha:false. Calling
    // getContext("2d") first makes that second call return null, so the page
    // never paints and annotations have nothing to sit on.
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(viewport.width * ratio);
    canvas.height = Math.floor(viewport.height * ratio);
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;
    renders.current.get(canvas)?.cancel();
    const task = page.render({
      canvas,
      viewport,
      transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
    });
    renders.current.set(canvas, task);
    try {
      await task.promise;
    } catch (reason) {
      if (reason instanceof Error && reason.name === "RenderingCancelledException") return null;
      throw reason;
    } finally {
      if (renders.current.get(canvas) === task) renders.current.delete(canvas);
    }
    return viewport;
  }, []);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || !bytes) return;
    const update = () => {
      const styles = getComputedStyle(stage);
      const pad = Number.parseFloat(styles.paddingLeft) + Number.parseFloat(styles.paddingRight);
      const available = Math.max(200, stage.clientWidth - pad);
      const width = pagePtsRef.current.w;
      if (width > 0) setFitScale(available / width);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [bytes, pagePts.w]);

  useEffect(() => {
    const pdf = pdfRef.current;
    const canvas = canvasRef.current;
    if (!pdf || !canvas || pageCount === 0 || loadedBytes.current !== bytes || displayScale <= 0) return;
    let cancelled = false;

    (async () => {
      try {
        const probe = await pdf.getPage(currentPage);
        const base = probe.getViewport({ scale: 1 });
        if (cancelled) return;
        if (Math.abs(base.width - pagePts.w) > 0.5 || Math.abs(base.height - pagePts.h) > 0.5) {
          setPagePts({ w: base.width, h: base.height });
          return;
        }
        await paint(pdf, currentPage, canvas, displayScale);
      } catch (reason) {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : "This page could not be drawn.");
        }
      }
    })();

    return () => {
      cancelled = true;
      renders.current.get(canvas)?.cancel();
    };
  }, [bytes, currentPage, displayScale, docVersion, pageCount, pagePts.h, pagePts.w, paint]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || !bytes) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const current = zoomRef.current ?? fitScaleRef.current;
      const surface = surfaceRef.current?.getBoundingClientRect();
      if (current <= 0 || !surface || surface.width < 1) return;
      zoomAnchor.current = {
        nx: clamp((event.clientX - surface.left) / surface.width, 0, 1),
        ny: clamp((event.clientY - surface.top) / surface.height, 0, 1),
        clientX: event.clientX,
        clientY: event.clientY,
      };
      const factor = Math.exp(-event.deltaY * 0.0018);
      queueZoom(current * factor);
    };
    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => stage.removeEventListener("wheel", onWheel);
  }, [bytes]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || !bytes) return;
    const points = new Map<number, { x: number; y: number }>();
    let pinch: { distance: number; zoom: number } | null = null;
    const remember = (clientX: number, clientY: number) => {
      const surface = surfaceRef.current?.getBoundingClientRect();
      if (!surface || surface.width < 1) return;
      zoomAnchor.current = {
        nx: clamp((clientX - surface.left) / surface.width, 0, 1),
        ny: clamp((clientY - surface.top) / surface.height, 0, 1),
        clientX,
        clientY,
      };
    };
    const onDown = (event: PointerEvent) => {
      if (event.pointerType === "mouse") return;
      points.set(event.pointerId, { x: event.clientX, y: event.clientY });
    };
    const onMove = (event: PointerEvent) => {
      if (!points.has(event.pointerId)) return;
      points.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (points.size < 2) return;
      const [a, b] = [...points.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      const midX = (a.x + b.x) / 2;
      const midY = (a.y + b.y) / 2;
      if (!pinch) {
        pinch = { distance: Math.max(distance, 1), zoom: zoomRef.current ?? fitScaleRef.current };
        highlightStart.current = null;
        draftInkRef.current = null;
        dragRef.current = null;
        setDraftRect(null);
        setDraftInk(null);
        return;
      }
      remember(midX, midY);
      queueZoom(pinch.zoom * (distance / pinch.distance));
    };
    const onUp = (event: PointerEvent) => {
      points.delete(event.pointerId);
      if (points.size < 2) pinch = null;
    };
    stage.addEventListener("pointerdown", onDown, true);
    stage.addEventListener("pointermove", onMove, true);
    stage.addEventListener("pointerup", onUp, true);
    stage.addEventListener("pointercancel", onUp, true);
    return () => {
      stage.removeEventListener("pointerdown", onDown, true);
      stage.removeEventListener("pointermove", onMove, true);
      stage.removeEventListener("pointerup", onUp, true);
      stage.removeEventListener("pointercancel", onUp, true);
    };
  }, [bytes]);

  useLayoutEffect(() => {
    const anchor = zoomAnchor.current;
    const surface = surfaceRef.current;
    const stage = stageRef.current;
    if (!anchor || !surface || !stage) return;
    zoomAnchor.current = null;
    const rect = surface.getBoundingClientRect();
    const dx = rect.left + anchor.nx * rect.width - anchor.clientX;
    const dy = rect.top + anchor.ny * rect.height - anchor.clientY;
    const beforeLeft = stage.scrollLeft;
    const beforeTop = stage.scrollTop;
    stage.scrollLeft += dx;
    stage.scrollTop += dy;
    window.scrollBy(dx - (stage.scrollLeft - beforeLeft), dy - (stage.scrollTop - beforeTop));
  }, [displayScale, stageSize.h, stageSize.w]);

  useEffect(() => {
    const pdf = pdfRef.current;
    if (!pdf || pageCount === 0 || loadedBytes.current !== bytes) return;
    let cancelled = false;
    (async () => {
      try {
        for (let page = 1; page <= pdf.numPages; page += 1) {
          const canvas = thumbRefs.current[page - 1];
          if (!canvas || cancelled) continue;
          await paint(pdf, page, canvas, 0.18);
        }
      } catch {
        if (!cancelled) {
          // Thumbnails are optional. The main page still has to render.
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bytes, docVersion, pageCount, paint]);

  function openBytes(next: Uint8Array, name: string) {
    past.current = [];
    future.current = [];
    syncHistoryFlags();
    setAnnotations([]);
    setSelectedId(null);
    setEditingId(null);
    setZoom(null);
    setCurrentPage(1);
    setFileName(name);
    setBytes(next);
    setError(null);
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    try {
      const next = await readPdfFile(file);
      openBytes(next, file.name);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Could not read that PDF.";
      setError(message);
      toast.error(message);
    }
  }

  async function onMerge(file: File | undefined) {
    if (!file || !bytes) return;
    try {
      const extra = await readPdfFile(file);
      const next = await appendPdf(bytes, extra);
      pushDocument(next, annotations, currentPage);
      toast.success("Pages added to the end.");
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : "Could not add that PDF.");
    }
  }

  async function movePage(fromIndex: number, toIndex: number) {
    if (!bytes || fromIndex === toIndex) return;
    const order = Array.from({ length: pageCount }, (_, index) => index);
    const [moved] = order.splice(fromIndex, 1);
    order.splice(toIndex, 0, moved);
    try {
      const next = await reorderPages(bytes, order);
      const remap = new Map(order.map((oldIndex, newIndex) => [oldIndex + 1, newIndex + 1]));
      const nextAnnotations = annotations.map((item) => ({ ...item, page: remap.get(item.page) ?? item.page }));
      pushDocument(next, nextAnnotations, toIndex + 1);
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : "Could not reorder pages.");
    }
  }

  async function deletePage(index: number) {
    if (!bytes) return;
    if (pageCount <= 1) {
      toast.error("A PDF needs at least one page.");
      return;
    }
    const order = Array.from({ length: pageCount }, (_, page) => page).filter((page) => page !== index);
    try {
      const next = await reorderPages(bytes, order);
      const nextAnnotations = annotations.flatMap((item) => {
        if (item.page === index + 1) return [];
        return [{ ...item, page: item.page > index + 1 ? item.page - 1 : item.page }];
      });
      pushDocument(next, nextAnnotations, Math.min(currentPage, order.length));
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : "Could not delete that page.");
    }
  }

  function clientToPage(clientX: number, clientY: number) {
    const rect = surfaceRef.current?.getBoundingClientRect();
    if (!rect || rect.width < 1 || rect.height < 1) return null;
    return {
      x: Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (clientY - rect.top) / rect.height)),
    };
  }

  function hitAnnotation(point: { x: number; y: number }) {
    const marks = annotations.filter((item) => item.page === currentPage && item.type !== "text").slice().reverse();
    for (const mark of marks) {
      if (mark.type === "highlight") {
        if (point.x >= mark.x && point.y >= mark.y && point.x <= mark.x + mark.w && point.y <= mark.y + mark.h) {
          return mark.id;
        }
      }
      if (mark.type === "draw" && mark.points.some((spot) => Math.hypot(spot.x - point.x, spot.y - point.y) < 0.02)) {
        return mark.id;
      }
    }
    return null;
  }

  function trackPointer(startEvent: { clientX: number; clientY: number; pointerId: number }, onMove: (point: { x: number; y: number }) => void, onUp: (point: { x: number; y: number }) => void) {
    const pointerId = startEvent.pointerId;
    const move = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return;
      const point = clientToPage(event.clientX, event.clientY);
      if (point) onMove(point);
    };
    const up = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      const point = clientToPage(event.clientX, event.clientY) ?? clientToPage(startEvent.clientX, startEvent.clientY);
      if (point) onUp(point);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }

  function onOverlayDown(event: React.PointerEvent<SVGSVGElement>) {
    const activeTool = toolRef.current;
    if (activeTool === "text") return;
    const point = clientToPage(event.clientX, event.clientY);
    if (!point) return;
    const page = currentPage;
    const inkColor = colorRef.current;
    const width = strokeWidth;

    if (activeTool === "select") {
      const hit = hitAnnotation(point);
      setSelectedId(hit);
      setEditingId(null);
      if (!hit) return;
      const origin = annotationsRef.current.find((item) => item.id === hit);
      if (!origin) return;
      dragRef.current = { id: hit, pointer: point, origin: structuredClone(origin) };
      trackPointer(event, (next) => {
        const drag = dragRef.current;
        if (!drag) return;
        const dx = next.x - drag.pointer.x;
        const dy = next.y - drag.pointer.y;
        setAnnotations((items) =>
          items.map((item) => {
            if (item.id !== drag.id) return item;
            if (drag.origin.type === "highlight") return { ...drag.origin, x: drag.origin.x + dx, y: drag.origin.y + dy };
            if (drag.origin.type === "draw") {
              return { ...drag.origin, points: drag.origin.points.map((spot) => ({ x: spot.x + dx, y: spot.y + dy })) };
            }
            return item;
          }),
        );
      }, () => {
        const drag = dragRef.current;
        dragRef.current = null;
        if (!drag) return;
        const moved = annotationsRef.current.find((item) => item.id === drag.id);
        if (moved && JSON.stringify(moved) !== JSON.stringify(drag.origin)) {
          past.current.push({
            kind: "annotations",
            annotations: cloneAnnotations(annotationsRef.current.map((item) => (item.id === drag.origin.id ? drag.origin : item))),
          });
          future.current = [];
          syncHistoryFlags();
        }
      });
      return;
    }

    if (activeTool === "highlight") {
      highlightStart.current = point;
      setDraftRect({ id: "draft", type: "highlight", page, x: point.x, y: point.y, w: 0, h: 0, color: inkColor });
      trackPointer(event, (next) => {
        const start = highlightStart.current;
        if (!start) return;
        setDraftRect({
          id: "draft",
          type: "highlight",
          page,
          x: Math.min(start.x, next.x),
          y: Math.min(start.y, next.y),
          w: Math.abs(next.x - start.x),
          h: Math.abs(next.y - start.y),
          color: inkColor,
        });
      }, (next) => {
        const start = highlightStart.current;
        highlightStart.current = null;
        setDraftRect(null);
        if (!start) return;
        const rect: HighlightAnnotation = {
          id: crypto.randomUUID(),
          type: "highlight",
          page,
          x: Math.min(start.x, next.x),
          y: Math.min(start.y, next.y),
          w: Math.abs(next.x - start.x),
          h: Math.abs(next.y - start.y),
          color: inkColor,
        };
        if (rect.w > 0.01 && rect.h > 0.008) pushAnnotations([...annotationsRef.current, rect]);
      });
    }

    if (activeTool === "draw") {
      const ink: DrawAnnotation = { id: "draft", type: "draw", page, points: [point], color: inkColor, width };
      draftInkRef.current = ink;
      setDraftInk(ink);
      trackPointer(event, (next) => {
        const current = draftInkRef.current;
        if (!current) return;
        const last = current.points[current.points.length - 1];
        if (last && Math.hypot(last.x - next.x, last.y - next.y) < 0.002) return;
        const updated = { ...current, points: [...current.points, next] };
        draftInkRef.current = updated;
        setDraftInk(updated);
      }, () => {
        const finished = draftInkRef.current;
        draftInkRef.current = null;
        setDraftInk(null);
        if (finished && finished.points.length > 1) {
          pushAnnotations([...annotationsRef.current, { ...finished, id: crypto.randomUUID() }]);
        }
      });
    }
  }

  function commitOrigin(origin: Annotation) {
    const moved = annotationsRef.current.find((item) => item.id === origin.id);
    if (!moved || JSON.stringify(moved) === JSON.stringify(origin)) return;
    past.current.push({
      kind: "annotations",
      annotations: cloneAnnotations(annotationsRef.current.map((item) => (item.id === origin.id ? origin : item))),
    });
    if (past.current.length > 40) past.current.shift();
    future.current = [];
    syncHistoryFlags();
  }

  function queueZoom(next: number) {
    const rounded = Math.round(clamp(next, MIN_ZOOM, MAX_ZOOM) * 100) / 100;
    const displayed = clamp(zoomRef.current ?? fitScaleRef.current, MIN_ZOOM, MAX_ZOOM);
    if (Math.abs(rounded - displayed) < 0.001) {
      zoomAnchor.current = null;
      return;
    }
    setZoom(rounded);
  }

  function zoomAboutCenter(factor: number) {
    const current = zoomRef.current ?? fitScaleRef.current;
    const stage = stageRef.current?.getBoundingClientRect();
    const surface = surfaceRef.current?.getBoundingClientRect();
    if (current <= 0 || !stage || !surface || surface.width < 1) return;
    const clientX = stage.left + stage.width / 2;
    const clientY = stage.top + stage.height / 2;
    zoomAnchor.current = {
      nx: clamp((clientX - surface.left) / surface.width, 0, 1),
      ny: clamp((clientY - surface.top) / surface.height, 0, 1),
      clientX,
      clientY,
    };
    queueZoom(current * factor);
  }

  function fitPageWidth() {
    if (zoomRef.current === null) {
      zoomAnchor.current = null;
      return;
    }
    const stage = stageRef.current?.getBoundingClientRect();
    const surface = surfaceRef.current?.getBoundingClientRect();
    if (stage && surface && surface.width > 1) {
      const clientX = stage.left + stage.width / 2;
      const clientY = stage.top + stage.height / 2;
      zoomAnchor.current = {
        nx: clamp((clientX - surface.left) / surface.width, 0, 1),
        ny: clamp((clientY - surface.top) / surface.height, 0, 1),
        clientX,
        clientY,
      };
    }
    setZoom(null);
  }

  function changeTextSize(nextSize: number) {
    const size = clamp(Math.round(nextSize), MIN_TEXT_SIZE, MAX_TEXT_SIZE);
    setTextSize(size);
    const selected = annotationsRef.current.find((item) => item.id === selectedId);
    if (!selected || selected.type !== "text" || selected.size === size) return;
    pushAnnotations(
      annotationsRef.current.map((item) => (item.id === selected.id && item.type === "text" ? { ...item, size } : item)),
    );
  }

  function addText(event: React.PointerEvent<HTMLDivElement>) {
    if (tool !== "text" || event.target !== event.currentTarget) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    const rawX = (event.clientX - rect.left) / rect.width;
    const rawY = (event.clientY - rect.top) / rect.height;
    const w = Math.min(0.46, 110 / pagePts.w);
    const h = Math.min(0.16, (textSize * 1.55) / pagePts.h);
    const annotation: TextAnnotation = {
      id: crypto.randomUUID(),
      type: "text",
      page: currentPage,
      x: clamp(rawX, 0, Math.max(0, 1 - w)),
      y: clamp(rawY, 0, Math.max(0, 1 - h)),
      w,
      h,
      text: "Note",
      size: textSize,
      color,
    };
    ignoreTextBlur.current = true;
    pushAnnotations([...annotations, annotation]);
    setSelectedId(annotation.id);
    setEditingId(annotation.id);
    window.setTimeout(() => {
      ignoreTextBlur.current = false;
    }, 300);
  }

  function updateText(id: string, text: string) {
    setAnnotations((current) => current.map((item) => (item.id === id && item.type === "text" ? { ...item, text } : item)));
  }

  function beginTextDrag(event: React.PointerEvent, item: TextAnnotation) {
    if (toolRef.current !== "select" && toolRef.current !== "text") return;
    if (editingId === item.id) return;
    event.preventDefault();
    event.stopPropagation();
    const start = clientToPage(event.clientX, event.clientY);
    if (!start) return;
    const origin = structuredClone(item);
    const wasSelected = selectedId === item.id;
    let moved = false;
    setSelectedId(item.id);
    dragRef.current = { id: item.id, pointer: start, origin };
    trackPointer(
      event,
      (next) => {
        const dx = next.x - start.x;
        const dy = next.y - start.y;
        const surface = surfaceRef.current;
        const pixels = Math.hypot(dx * (surface?.clientWidth ?? 1), dy * (surface?.clientHeight ?? 1));
        if (pixels < 2) return;
        moved = true;
        const placed = moveTextBox(origin, dx, dy);
        setAnnotations((current) => {
          const next = current.map((mark) => (mark.id === item.id && mark.type === "text" ? placed : mark));
          annotationsRef.current = next;
          return next;
        });
      },
      () => {
        dragRef.current = null;
        if (moved) commitOrigin(origin);
        else if (wasSelected) setEditingId(item.id);
      },
    );
  }

  function beginTextResize(event: React.PointerEvent, item: TextAnnotation, handle: TextHandle) {
    event.preventDefault();
    event.stopPropagation();
    const origin = structuredClone(item);
    setSelectedId(item.id);
    setEditingId(null);
    trackPointer(
      event,
      (point) => {
        const next = resizeTextBox(origin, handle, point, pagePtsRef.current);
        setAnnotations((current) => {
          const updated = current.map((mark) => (mark.id === item.id && mark.type === "text" ? next : mark));
          annotationsRef.current = updated;
          return updated;
        });
      },
      () => commitOrigin(origin),
    );
  }

  const pageAnnotations = annotations.filter((item) => item.page === currentPage);
  const selectedText = pageAnnotations.find((item): item is TextAnnotation => item.id === selectedId && item.type === "text");
  const shownTextSize = selectedText?.size ?? textSize;

  return (
    <div className="flex h-[calc(100dvh-4.25rem)] min-h-0 flex-col">
      <div className="sticky top-16 z-30 border-b border-border bg-background/95 backdrop-blur">
        <div className="flex flex-wrap items-center gap-2 px-3 py-2">
          <ToolButton pressed={tool === "select"} onPointerDown={() => applyTool("select")}>
            Select
          </ToolButton>
          <ToolButton pressed={tool === "text"} onPointerDown={() => applyTool("text")}>
            Text
          </ToolButton>
          <ToolButton pressed={tool === "highlight"} onPointerDown={() => applyTool("highlight")}>
            Highlight
          </ToolButton>
          <ToolButton pressed={tool === "draw"} onPointerDown={() => applyTool("draw")}>
            Draw
          </ToolButton>
          <span className="mx-1 hidden h-6 w-px bg-border sm:block" />
          {(tool === "highlight" ? HIGHLIGHTS : INKS).map((swatch) => (
            <button
              key={swatch}
              type="button"
              aria-label={`Color ${swatch}`}
              className="size-7 rounded-full border border-black/10"
              style={{ background: swatch, outline: color === swatch ? "2px solid #1c1915" : undefined, outlineOffset: 2 }}
              onClick={() => setColor(swatch)}
            />
          ))}
          {tool === "text" || selectedText ? (
            <div className="flex items-center gap-1" role="group" aria-label="Text size">
              <Button type="button" size="sm" variant="outline" aria-label="Smaller text" onClick={() => changeTextSize(shownTextSize - 1)}>
                A−
              </Button>
              <span className="w-8 text-center text-xs tabular-nums">{shownTextSize}</span>
              <Button type="button" size="sm" variant="outline" aria-label="Larger text" onClick={() => changeTextSize(shownTextSize + 1)}>
                A+
              </Button>
            </div>
          ) : null}
          {tool === "draw" ? (
            <div className="flex items-center gap-1">
              {STROKE_WIDTHS.map((width) => (
                <Button key={width} type="button" size="sm" variant={strokeWidth === width ? "default" : "outline"} onClick={() => setStrokeWidth(width)}>
                  {width}
                </Button>
              ))}
            </div>
          ) : null}
          <span className="mx-1 hidden h-6 w-px bg-border md:block" />
          <div className="flex items-center gap-1" role="group" aria-label="Zoom" data-zoom={displayScale > 0 ? Math.round(displayScale * 100) : 0}>
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="Zoom out"
              disabled={!bytes || displayScale <= MIN_ZOOM + 0.001}
              onClick={() => zoomAboutCenter(1 / ZOOM_FACTOR)}
            >
              <Minus />
            </Button>
            <span className="w-12 text-center text-xs tabular-nums">{displayScale > 0 ? `${Math.round(displayScale * 100)}%` : "—"}</span>
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="Zoom in"
              disabled={!bytes || displayScale >= MAX_ZOOM - 0.001}
              onClick={() => zoomAboutCenter(ZOOM_FACTOR)}
            >
              <Plus />
            </Button>
            <Button type="button" size="sm" variant={zoom === null ? "default" : "outline"} aria-label="Fit width" disabled={!bytes} onClick={fitPageWidth}>
              Fit width
            </Button>
          </div>
          <Button type="button" variant="outline" size="icon" aria-label="Undo" disabled={!canUndo} onClick={undo}>
            <Undo2 />
          </Button>
          <Button type="button" variant="outline" size="icon" aria-label="Redo" disabled={!canRedo} onClick={redo}>
            <Redo2 />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label="Delete selected mark"
            disabled={!selectedId}
            onClick={() => {
              if (!selectedId) return;
              pushAnnotations(annotations.filter((item) => item.id !== selectedId));
              setSelectedId(null);
              setEditingId(null);
            }}
          >
            <Trash2 />
          </Button>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" disabled={!bytes} onClick={() => mergeRef.current?.click()}>
              Add PDF
            </Button>
            <Button
              type="button"
              disabled={!bytes}
              onClick={async (event) => {
                event.preventDefault();
                event.stopPropagation();
                if (!bytes) return;
                try {
                  const source = new Uint8Array(bytes.byteLength);
                  source.set(bytes);
                  const saved = await burnAnnotations(source, annotationsRef.current);
                  const stem = fileName.replace(/\.pdf$/i, "");
                  downloadBytes(saved, `${stem}-edited.pdf`, "application/pdf");
                  toast.success("Downloaded. No watermark.");
                } catch (reason) {
                  toast.error(reason instanceof Error ? reason.message : "Could not save the PDF.");
                }
              }}
            >
              Download PDF
            </Button>
          </div>
        </div>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="application/pdf,.pdf"
        className="sr-only"
        onChange={(event) => {
          void onFile(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
      <input
        ref={mergeRef}
        type="file"
        accept="application/pdf,.pdf"
        className="sr-only"
        onChange={(event) => {
          void onMerge(event.target.files?.[0]);
          event.target.value = "";
        }}
      />

      {!bytes ? (
        <div className="flex flex-1 items-center justify-center px-5 py-10">
          <div
            className={`w-full max-w-xl rounded-3xl border border-dashed px-6 py-12 text-center ${dragOver ? "border-pine bg-pine/5" : "border-border bg-card"}`}
            onDragOver={(event) => {
              event.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragOver(false);
              void onFile(event.dataTransfer.files?.[0]);
            }}
          >
            <p className="font-heading text-3xl">Open a PDF</p>
            <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-muted-foreground">
              Add text, highlight, draw, delete or reorder pages, then download the file. It stays in this browser. No watermark.
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-2">
              <Button type="button" className="h-11 px-4" onClick={() => fileRef.current?.click()}>
                Choose PDF
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-11 px-4"
                onClick={async () => {
                  const sample = await makeSamplePdf();
                  openBytes(sample, "north-lot-notes.pdf");
                }}
              >
                Open a sample
              </Button>
            </div>
            {error ? <p className="mt-4 text-sm text-clay">{error}</p> : null}
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <aside className="flex gap-2 overflow-x-auto border-b border-border bg-card p-3 md:w-44 md:flex-col md:overflow-y-auto md:border-r md:border-b-0">
            {Array.from({ length: pageCount }, (_, index) => (
              <div
                key={`${fileName}-${docVersion}-${index}`}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  const from = Number(event.dataTransfer.getData("text/plain"));
                  if (Number.isInteger(from)) void movePage(from, index);
                }}
                className={`w-28 shrink-0 rounded-xl border p-2 md:w-auto ${currentPage === index + 1 ? "border-pine" : "border-border"}`}
              >
                <button
                  type="button"
                  draggable
                  className="block w-full"
                  onClick={() => setCurrentPage(index + 1)}
                  onDragStart={(event) => {
                    event.dataTransfer.setData("text/plain", String(index));
                    event.dataTransfer.effectAllowed = "move";
                  }}
                  aria-label={`Page ${index + 1}`}
                >
                  <canvas ref={(node) => { thumbRefs.current[index] = node; }} className="mx-auto h-auto max-h-36 w-full bg-white" />
                  <span className="mt-1 block text-center text-xs">Page {index + 1}</span>
                </button>
                <div className="mt-1 flex justify-center gap-1">
                  <Button type="button" size="sm" variant="ghost" aria-label="Move page up" onClick={() => void movePage(index, Math.max(0, index - 1))}>
                    Up
                  </Button>
                  <Button type="button" size="sm" variant="ghost" aria-label="Move page down" onClick={() => void movePage(index, Math.min(pageCount - 1, index + 1))}>
                    Down
                  </Button>
                  <Button type="button" size="sm" variant="ghost" aria-label="Delete page" onClick={() => void deletePage(index)}>
                    Del
                  </Button>
                </div>
              </div>
            ))}
          </aside>
          <div
            ref={stageRef}
            className="relative min-h-0 flex-1 overflow-auto bg-[#e7e1d6] p-4 md:p-8"
            style={{ scrollbarGutter: "stable" }}
          >
            {loading && pageCount === 0 ? (
              <p className="mb-3 flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Opening PDF
              </p>
            ) : null}
            {error ? <p className="mb-3 text-sm text-clay">{error}</p> : null}
            <div className="mx-auto w-fit">
              <div
                ref={surfaceRef}
                data-page-surface=""
                className="relative bg-white shadow-md"
                style={{ width: stageSize.w || undefined, height: stageSize.h || undefined }}
              >
                <canvas key={docVersion} ref={canvasRef} className="block h-full w-full" />
                <svg
                  viewBox={`0 0 ${Math.max(stageSize.w, 1)} ${Math.max(stageSize.h, 1)}`}
                  preserveAspectRatio="none"
                  className={`absolute inset-0 h-full w-full ${tool === "draw" || tool === "highlight" ? "touch-none" : ""}`}
                  onPointerDown={onOverlayDown}
                >
                  {pageAnnotations.filter((item) => item.type === "highlight").map((item) => (
                    <rect
                      key={item.id}
                      x={item.x * stageSize.w}
                      y={item.y * stageSize.h}
                      width={Math.max(0, item.w * stageSize.w)}
                      height={Math.max(0, item.h * stageSize.h)}
                      fill={item.color}
                      fillOpacity={0.38}
                      stroke={selectedId === item.id ? "#1C1915" : "transparent"}
                      pointerEvents="none"
                    />
                  ))}
                  {draftRect ? (
                    <rect
                      x={draftRect.x * stageSize.w}
                      y={draftRect.y * stageSize.h}
                      width={Math.max(0, draftRect.w * stageSize.w)}
                      height={Math.max(0, draftRect.h * stageSize.h)}
                      fill={draftRect.color}
                      fillOpacity={0.38}
                      pointerEvents="none"
                    />
                  ) : null}
                  {pageAnnotations.filter((item): item is DrawAnnotation => item.type === "draw").map((item) => (
                    <polyline
                      key={item.id}
                      points={item.points.map((point) => `${point.x * stageSize.w},${point.y * stageSize.h}`).join(" ")}
                      fill="none"
                      stroke={item.color}
                      strokeWidth={item.width * displayScale}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      pointerEvents="none"
                    />
                  ))}
                  {draftInk ? (
                    <polyline
                      points={draftInk.points.map((point) => `${point.x * stageSize.w},${point.y * stageSize.h}`).join(" ")}
                      fill="none"
                      stroke={draftInk.color}
                      strokeWidth={draftInk.width * displayScale}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      pointerEvents="none"
                    />
                  ) : null}
                </svg>
                <div className="absolute inset-0" style={{ pointerEvents: tool === "text" ? "auto" : "none" }} onPointerDown={addText}>
                  {pageAnnotations.filter((item): item is TextAnnotation => item.type === "text").map((item) => {
                    const interactive = tool === "select" || tool === "text";
                    const selected = selectedId === item.id;
                    return (
                      <div
                        key={item.id}
                        data-text-box=""
                        data-x={item.x}
                        data-y={item.y}
                        data-w={item.w}
                        data-h={item.h}
                        data-size={item.size}
                        className="absolute"
                        style={{
                          left: `${item.x * 100}%`,
                          top: `${item.y * 100}%`,
                          width: `${item.w * 100}%`,
                          height: `${item.h * 100}%`,
                          pointerEvents: interactive ? "auto" : "none",
                        }}
                      >
                        {editingId === item.id ? (
                          <textarea
                            autoFocus
                            value={item.text}
                            aria-label="Annotation text"
                            className="h-full w-full resize-none bg-white/95 p-0 outline outline-1 outline-pine"
                            style={{
                              color: item.color,
                              fontSize: item.size * displayScale,
                              lineHeight: 1.3,
                              fontFamily: "Helvetica, Arial, sans-serif",
                            }}
                            onChange={(event) => updateText(item.id, event.target.value)}
                            onFocus={(event) => {
                              if (event.currentTarget.value === "Note") event.currentTarget.select();
                            }}
                            onBlur={() => {
                              if (ignoreTextBlur.current) return;
                              if (!item.text.trim()) {
                                setAnnotations((current) => current.filter((mark) => mark.id !== item.id));
                                setSelectedId(null);
                              }
                              setEditingId(null);
                            }}
                            onPointerDown={(event) => event.stopPropagation()}
                          />
                        ) : (
                          <button
                            type="button"
                            className="h-full w-full overflow-hidden text-left whitespace-pre-wrap break-words"
                            style={{
                              color: item.color,
                              fontSize: item.size * displayScale,
                              lineHeight: 1.3,
                              fontFamily: "Helvetica, Arial, sans-serif",
                              cursor: tool === "select" ? "grab" : "text",
                              outline: selected ? "1px dashed #1c1915" : "1px solid transparent",
                            }}
                            onPointerDown={(event) => beginTextDrag(event, item)}
                            onDoubleClick={(event) => {
                              event.stopPropagation();
                              setSelectedId(item.id);
                              setEditingId(item.id);
                            }}
                          >
                            {item.text}
                          </button>
                        )}
                        {selected && interactive
                          ? TEXT_HANDLES.map((handle) => (
                              <button
                                key={handle.id}
                                type="button"
                                aria-label={`Resize text box from the ${handle.id} handle`}
                                className="absolute z-20 size-2.5 border border-[#1c1915] bg-white"
                                style={{
                                  left: handle.x,
                                  top: handle.y,
                                  transform: "translate(-50%, -50%)",
                                  cursor: handle.cursor,
                                }}
                                onPointerDown={(event) => beginTextResize(event, item, handle.id)}
                              />
                            ))
                          : null}
                      </div>
                    );
                  })}
                </div>
              </div>
              <p className="mt-3 text-center text-xs text-muted-foreground">
                Page {currentPage} of {pageCount}. Use +/−, Fit width, pinch, or Ctrl+scroll to zoom. Arrow keys nudge a selected mark, and the handles resize text. V select, T text, H highlight, D draw.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ToolButton({
  pressed,
  onPointerDown,
  children,
}: {
  pressed: boolean;
  onPointerDown: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant={pressed ? "default" : "outline"}
      aria-pressed={pressed}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        onPointerDown();
      }}
    >
      {children}
    </Button>
  );
}
