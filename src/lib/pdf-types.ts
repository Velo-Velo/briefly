export type PdfTool = "select" | "text" | "highlight" | "draw";

export type TextAnnotation = {
  id: string;
  type: "text";
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  size: number;
  color: string;
};

export type HighlightAnnotation = {
  id: string;
  type: "highlight";
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
};

export type DrawAnnotation = {
  id: string;
  type: "draw";
  page: number;
  points: { x: number; y: number }[];
  color: string;
  width: number;
};

export type Annotation = TextAnnotation | HighlightAnnotation | DrawAnnotation;

export class PdfEditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PdfEditError";
  }
}
