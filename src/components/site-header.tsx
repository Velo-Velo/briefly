"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "cn";

const links = [
  { href: "/summarize", label: "Summarize" },
  { href: "/pdf", label: "Edit PDF" },
];

export function SiteHeader() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-40 border-b border-border/80 bg-background/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-5">
        <Link href="/" className="flex items-center gap-2 rounded-lg">
          <span className="grid size-8 place-items-center rounded-lg bg-pine text-sm font-semibold text-primary-foreground">
            B
          </span>
          <span className="font-heading text-xl tracking-tight">Briefly</span>
        </Link>
        <nav aria-label="Primary" className="flex items-center gap-1 text-sm">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                "rounded-lg px-3 py-2 text-foreground/80 hover:bg-muted hover:text-foreground",
                pathname === link.href && "bg-muted font-medium text-foreground",
              )}
              aria-current={pathname === link.href ? "page" : undefined}
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
