import Link from "next/link";

export function MarketingFooter() {
  return (
    <footer className="relative border-t border-border/50">
      {/* Gradient top border */}
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-border to-transparent" />

      <div className="max-w-6xl mx-auto px-6">
        {/* Upper row: logo + nav */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 py-8">
          <Link href="/" className="text-lg font-semibold text-foreground tracking-tight">
            ideafy
          </Link>
          <div className="flex items-center gap-6 text-sm text-muted-foreground">
            <a href="#features" className="hover:text-foreground transition-colors">
              Features
            </a>
            <a href="#execution-pipeline" className="hover:text-foreground transition-colors">
              Pipeline
            </a>
            <Link href="/app" className="hover:text-foreground transition-colors">
              App
            </Link>
            <a
              href="https://github.com/ozangencer/ideafy"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-foreground transition-colors"
            >
              GitHub
            </a>
          </div>
        </div>

        {/* Lower row: copyright */}
        <div className="border-t border-border/30 py-6 text-center text-xs text-muted-foreground">
          &copy; {new Date().getFullYear()} ideafy. All rights reserved.
        </div>
      </div>
    </footer>
  );
}
