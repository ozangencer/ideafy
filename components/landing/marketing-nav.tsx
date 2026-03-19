"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";

export function MarketingNav() {
  const [scrolled, setScrolled] = useState(false);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <motion.header
      initial={{ opacity: 0, y: -16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className={`fixed top-0 left-0 right-0 z-50 border-b transition-colors duration-300 ${
        scrolled
          ? "border-white/[0.08] bg-background/80 backdrop-blur-2xl"
          : "border-white/[0.06] bg-background/60 backdrop-blur-2xl"
      }`}
    >
      <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
        <Link href="/" className="text-lg font-semibold text-foreground tracking-tight">
          ideafy
        </Link>

        {/* Desktop nav */}
        <nav className="hidden sm:flex items-center gap-6">
          <a href="#features" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
            Features
          </a>
          <a href="#execution-pipeline" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
            Pipeline
          </a>
          <Link
            href="/app"
            className="text-sm font-medium px-4 py-2 rounded-lg bg-foreground text-background hover:bg-foreground/90 transition-colors"
          >
            Get Started
          </Link>
        </nav>

        {/* Mobile hamburger */}
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="sm:hidden relative w-6 h-5 flex flex-col justify-between"
          aria-label="Toggle menu"
        >
          <span
            className={`block h-0.5 w-6 bg-foreground rounded transition-all duration-300 origin-center ${
              isOpen ? "rotate-45 translate-y-[9px]" : ""
            }`}
          />
          <span
            className={`block h-0.5 w-6 bg-foreground rounded transition-all duration-300 ${
              isOpen ? "opacity-0 scale-x-0" : ""
            }`}
          />
          <span
            className={`block h-0.5 w-6 bg-foreground rounded transition-all duration-300 origin-center ${
              isOpen ? "-rotate-45 -translate-y-[9px]" : ""
            }`}
          />
        </button>
      </div>

      {/* Mobile drawer */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25 }}
            className="sm:hidden overflow-hidden backdrop-blur-2xl bg-background/95 border-t border-white/[0.06]"
          >
            <nav className="flex flex-col gap-1 px-6 py-4">
              <a
                href="#features"
                onClick={() => setIsOpen(false)}
                className="py-2.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                Features
              </a>
              <a
                href="#execution-pipeline"
                onClick={() => setIsOpen(false)}
                className="py-2.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                Pipeline
              </a>
              <Link
                href="/app"
                onClick={() => setIsOpen(false)}
                className="mt-2 text-sm font-medium px-4 py-2.5 rounded-lg bg-foreground text-background hover:bg-foreground/90 transition-colors text-center"
              >
                Get Started
              </Link>
            </nav>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.header>
  );
}
