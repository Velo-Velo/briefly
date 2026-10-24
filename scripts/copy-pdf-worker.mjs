import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.join(root, "node_modules/pdfjs-dist/build/pdf.worker.min.mjs");
const dest = path.join(root, "public/pdf.worker.min.mjs");

await mkdir(path.dirname(dest), { recursive: true });
await copyFile(src, dest);
