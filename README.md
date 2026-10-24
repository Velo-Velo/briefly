# Briefly

Briefly is a free YouTube summarizer and a PDF editor. Paste a public YouTube link to turn captions into an overview, key points, sections, and a mind map, or open a PDF in the browser to mark it up, reorder pages, and download the result. PDFs stay on the device.

Requires Node.js 22.x.

```bash
npm install
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000).

`OPENAI_API_KEY` is optional. Summaries are built from the transcript on their own. Set `OPENAI_API_KEY` in the environment when you want the same page to request an abstractive summary. An optional `OPENAI_MODEL` overrides the default model (`gpt-4o-mini`). Do not commit `.env` files.
