"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight, Play, Terminal } from "lucide-react";

const terminalLines = [
  { text: "> Planning solution...", delay: 0 },
  { text: "> Creating worktree: feat/dark-mode", delay: 0.6 },
  { text: "> Writing 3 files...", delay: 1.2 },
  { text: "> Tests generated. Moving to Human Test.", delay: 1.8 },
];

const particles = [
  { size: 3, top: "15%", left: "8%", delay: 0 },
  { size: 2, top: "25%", right: "12%", delay: 1.5 },
  { size: 4, top: "60%", left: "5%", delay: 3 },
  { size: 2, top: "70%", right: "8%", delay: 2 },
  { size: 3, top: "40%", right: "4%", delay: 4 },
  { size: 2, top: "80%", left: "15%", delay: 1 },
];

export function Hero() {
  return (
    <section className="relative pt-32 pb-24 px-6 overflow-hidden">
      {/* Ambient gradient blobs */}
      <div className="absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[1200px] h-[600px] rounded-full bg-gradient-to-b from-primary/[0.08] to-transparent blur-[100px]" />
        <div className="absolute top-20 left-1/4 w-[600px] h-[400px] rounded-full bg-blue-500/[0.04] blur-[120px]" />
        <div className="absolute top-40 right-1/4 w-[500px] h-[350px] rounded-full bg-purple-500/[0.04] blur-[100px]" />
      </div>

      {/* Floating particles - hidden on mobile */}
      {particles.map((p, i) => (
        <div
          key={i}
          className="absolute hidden md:block rounded-full bg-primary/30 animate-float"
          style={{
            width: p.size,
            height: p.size,
            top: p.top,
            left: p.left,
            right: p.right,
            animationDelay: `${p.delay}s`,
          }}
        />
      ))}

      <div className="max-w-5xl mx-auto text-center">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-border/60 bg-muted/30 text-xs text-muted-foreground mb-8">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
            Open source &middot; Self-hosted &middot; Local-first
          </div>
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="text-5xl sm:text-6xl lg:text-7xl font-bold tracking-tight text-foreground leading-[1.1]"
        >
          The kanban that{" "}
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 via-primary to-purple-400">
            writes code.
          </span>
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="mt-6 text-lg sm:text-xl text-muted-foreground max-w-3xl mx-auto leading-relaxed"
        >
          Describe a task. Click execute. AI plans the solution, writes the code
          in an isolated git worktree, generates tests, and moves the card forward.
          You review and ship.
        </motion.p>

        {/* Execution mode pills */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.25 }}
          className="mt-8 flex items-center justify-center gap-3 flex-wrap"
        >
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-blue-500/20 bg-blue-500/5 text-sm text-blue-400">
            <Play className="w-3.5 h-3.5" />
            Autonomous mode
          </div>
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-orange-500/20 bg-orange-500/5 text-sm text-orange-400">
            <Terminal className="w-3.5 h-3.5" />
            Interactive planning
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.3 }}
          className="mt-10 flex items-center justify-center gap-4"
        >
          <Link
            href="/app"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-foreground text-background font-medium text-sm hover:bg-foreground/90 transition-all shadow-[0_0_20px_rgba(94,106,210,0.3)] hover:shadow-[0_0_30px_rgba(94,106,210,0.5)]"
          >
            Get Started
            <ArrowRight className="w-4 h-4" />
          </Link>
          <a
            href="#execution-pipeline"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-lg border border-border text-foreground font-medium text-sm hover:bg-muted/50 transition-colors"
          >
            See how it works
          </a>
        </motion.div>

        {/* Terminal Execution Mockup */}
        <motion.div
          initial={{ opacity: 0, y: 32 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.5 }}
          className="mt-16 max-w-2xl mx-auto"
        >
          <div className="relative gradient-border rounded-xl animate-float" style={{ animationDuration: "8s" }}>
            <div className="relative rounded-xl bg-card/80 border border-border/50 shadow-[0_0_60px_rgba(94,106,210,0.15)] overflow-hidden backdrop-blur-sm">
              {/* Terminal top bar */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-border/50">
                <div className="flex items-center gap-3">
                  <div className="flex gap-1.5">
                    <div className="w-2.5 h-2.5 rounded-full bg-red-500/60" />
                    <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/60" />
                    <div className="w-2.5 h-2.5 rounded-full bg-green-500/60" />
                  </div>
                  <span className="text-xs text-muted-foreground font-medium">
                    KAN-42: Add dark mode support
                  </span>
                </div>
                <span className="text-[10px] px-2 py-0.5 rounded-md bg-yellow-500/10 text-yellow-400 border border-yellow-500/20">
                  In Progress
                </span>
              </div>

              {/* Terminal body */}
              <div className="p-4 font-mono text-sm space-y-2">
                {terminalLines.map((line, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.3, delay: 0.8 + line.delay }}
                    className="text-left"
                  >
                    <span className={i === terminalLines.length - 1 ? "text-emerald-400" : "text-muted-foreground"}>
                      {line.text}
                    </span>
                  </motion.div>
                ))}
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: [0, 1, 0] }}
                  transition={{ duration: 1, repeat: Infinity, delay: 2.8 }}
                  className="text-left"
                >
                  <span className="text-primary">_</span>
                </motion.div>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
