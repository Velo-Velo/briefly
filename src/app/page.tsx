import Link from "next/link";

const steps = [
  {
    title: "Summarize YouTube",
    href: "/summarize",
    kicker: "Captions in",
    body: "Paste a public video link. Briefly reads the caption track and writes an overview, key points, and sections.",
    points: ["Mind map on the page", "PowerPoint and Word", "SVG, PNG, Markdown, or JSON"],
  },
  {
    title: "Edit a PDF",
    href: "/pdf",
    kicker: "Stays on this device",
    body: "Open a PDF, mark it up, and download the result. The file is rendered and saved in your browser.",
    points: ["Text, highlight, and ink", "Delete or reorder pages", "Append another PDF"],
  },
];

export default function Home() {
  return (
    <div>
      <section className="border-b border-border">
        <div className="mx-auto grid max-w-6xl gap-10 px-5 py-14 md:grid-cols-12 md:py-20">
          <div className="md:col-span-7">
            <p className="text-sm font-medium tracking-wide text-pine">Free YouTube summarizer and free PDF editor</p>
            <h1 className="mt-3 max-w-xl font-heading text-5xl leading-[1.02] tracking-tight text-balance md:text-6xl">
              A brief from the video. A pen for the PDF.
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-8 text-muted-foreground">
              Turn a captioned YouTube link into notes you can keep, or mark up a PDF and download it clean.
              No account, no watermark, and nothing to upgrade.
            </p>
          </div>
          <div className="flex flex-col justify-end gap-3 md:col-span-5">
            <Link
              href="/summarize"
              className="rounded-2xl border border-border bg-card px-5 py-4 transition hover:border-pine"
            >
              <span className="text-xs font-medium tracking-wide text-pine">Start here</span>
              <span className="mt-1 block font-heading text-2xl">Summarize YouTube</span>
              <span className="mt-1 block text-sm leading-6 text-muted-foreground">
                Link in, brief out — including a mind map, slides, and a Word doc.
              </span>
            </Link>
            <Link
              href="/pdf"
              className="rounded-2xl border border-border bg-card px-5 py-4 transition hover:border-clay"
            >
              <span className="text-xs font-medium tracking-wide text-clay">Or open a file</span>
              <span className="mt-1 block font-heading text-2xl">Edit PDF</span>
              <span className="mt-1 block text-sm leading-6 text-muted-foreground">
                Highlight, write, draw, reorder pages, and download.
              </span>
            </Link>
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-4 px-5 py-12 md:grid-cols-2 md:py-16">
        {steps.map((step) => (
          <article key={step.href} className="flex flex-col rounded-3xl border border-border bg-card p-6">
            <p className="text-xs font-medium tracking-wide text-muted-foreground">{step.kicker}</p>
            <h2 className="mt-2 font-heading text-3xl">{step.title}</h2>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">{step.body}</p>
            <ul className="mt-4 grid gap-2 text-sm">
              {step.points.map((point) => (
                <li key={point} className="flex gap-2">
                  <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-pine" />
                  <span>{point}</span>
                </li>
              ))}
            </ul>
            <Link href={step.href} className="mt-6 text-sm font-medium text-pine underline-offset-4 hover:underline">
              Open {step.title}
            </Link>
          </article>
        ))}
      </section>

      <section className="border-t border-border bg-card/60">
        <div className="mx-auto grid max-w-6xl gap-8 px-5 py-12 md:grid-cols-3">
          <div>
            <h2 className="font-heading text-2xl">How it stays free</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              The useful path does not sit behind an account. Optional AI is only a server setting.
            </p>
          </div>
          <div>
            <h3 className="font-medium">Captions, then a brief</h3>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Without an API key, Briefly lifts headings and bullets straight from the transcript. With
              OPENAI_API_KEY, the same page can write a tighter abstractive summary.
            </p>
          </div>
          <div>
            <h3 className="font-medium">PDFs never upload</h3>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              pdf.js draws the pages and pdf-lib writes your marks into a new file on download. Private,
              age-restricted, or captionless videos can still be summarized from a pasted transcript.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
