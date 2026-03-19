"use client";

import Link from "next/link";
import { SectionWrapper } from "./section-wrapper";
import { ArrowRight } from "lucide-react";

export function CtaFooter() {
  return (
    <SectionWrapper className="relative py-24 px-6 overflow-hidden">
      {/* Gradient background */}
      <div className="absolute inset-0 -z-10">
        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] rounded-full bg-primary/[0.06] blur-[120px]" />
      </div>
      <div className="absolute inset-0 -z-10 bg-gradient-to-t from-primary/[0.05] via-transparent to-transparent" />

      <div className="max-w-3xl mx-auto text-center">
        <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-foreground">
          Stop tracking. Start shipping.
        </h2>
        <p className="mt-4 text-muted-foreground text-lg max-w-xl mx-auto">
          Self-host in minutes. Open source, free forever for solo builders.
        </p>
        <div className="mt-8 flex items-center justify-center gap-4 flex-wrap">
          <Link
            href="/app"
            className="inline-flex items-center gap-2 px-8 py-3.5 rounded-lg bg-foreground text-background font-medium text-sm hover:bg-foreground/90 transition-all shadow-[0_0_20px_rgba(94,106,210,0.3)] hover:shadow-[0_0_30px_rgba(94,106,210,0.5)]"
          >
            Get Started
            <ArrowRight className="w-4 h-4" />
          </Link>
          <a
            href="https://github.com/ozangencer/ideafy"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-8 py-3.5 rounded-lg border border-border text-foreground font-medium text-sm hover:bg-muted/50 transition-colors"
          >
            View on GitHub
          </a>
        </div>
      </div>
    </SectionWrapper>
  );
}
