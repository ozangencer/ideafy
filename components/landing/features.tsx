"use client";

import { SectionWrapper } from "./section-wrapper";
import { motion } from "framer-motion";
import {
  Play,
  Terminal,
  GitBranch,
  FlaskConical,
  Lightbulb,
  Cable,
  Users,
  MessageSquare,
  Brain,
  Server,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

/* ── Hero features: each gets a full-width sub-section ── */

interface HeroFeature {
  icon: LucideIcon;
  label: string;
  title: string;
  description: string;
  detail: string;
  accent: string; // tailwind color token
}

const heroFeatures: HeroFeature[] = [
  {
    icon: Play,
    label: "Autonomous",
    title: "Click play. Ship code.",
    description:
      "Claude reads the card, plans the solution, writes code in an isolated worktree, and generates test scenarios. Multi-phase pipeline: Planning, Implementation, Re-test.",
    detail: "Cards move through columns automatically. You review and merge.",
    accent: "blue",
  },
  {
    icon: Terminal,
    label: "Interactive",
    title: "Plan before you build.",
    description:
      "Open a terminal session with Claude in plan mode. Discuss architecture, refine scope, ask questions. When you're ready, hit execute.",
    detail: "Full control over every decision. AI assists, you decide.",
    accent: "orange",
  },
  {
    icon: GitBranch,
    label: "Isolation",
    title: "Every task, its own branch.",
    description:
      "Each card gets a dedicated git worktree. Main stays clean. Squash-merge when ready, auto-rollback if anything breaks. Conflict detection built in.",
    detail: "No more 'it works on my branch' surprises.",
    accent: "green",
  },
  {
    icon: FlaskConical,
    label: "Testing",
    title: "Tests write themselves.",
    description:
      "Implementation phase automatically outputs test scenarios. Human Test column for manual verification. Test Together mode for AI-guided interactive testing.",
    detail: "Move to Completed only when tests pass.",
    accent: "purple",
  },
];

const accentMap: Record<string, { border: string; bg: string; text: string; glow: string }> = {
  blue:   { border: "border-blue-500/20",   bg: "bg-blue-500/10",   text: "text-blue-400",   glow: "shadow-[0_0_20px_rgba(59,130,246,0.12)]" },
  orange: { border: "border-orange-500/20", bg: "bg-orange-500/10", text: "text-orange-400", glow: "shadow-[0_0_20px_rgba(249,115,22,0.12)]" },
  green:  { border: "border-green-500/20",  bg: "bg-green-500/10",  text: "text-green-400",  glow: "shadow-[0_0_20px_rgba(34,197,94,0.12)]" },
  purple: { border: "border-purple-500/20", bg: "bg-purple-500/10", text: "text-purple-400", glow: "shadow-[0_0_20px_rgba(168,85,247,0.12)]" },
};

/* ── Secondary features: compact row ── */

interface CompactFeature {
  icon: LucideIcon;
  title: string;
  description: string;
}

const compactFeatures: CompactFeature[] = [
  {
    icon: Lightbulb,
    title: "AI Ideation & Scoring",
    description: "YAGNI analysis, priority scores, and honest verdicts before writing a line of code.",
  },
  {
    icon: Cable,
    title: "MCP Native",
    description: "Claude manages cards via MCP tools during execution. Install with one click per project.",
  },
  {
    icon: MessageSquare,
    title: "Per-Section Chat",
    description: "Chat with AI on each card tab. Mention skills, MCPs, documents, or other cards.",
  },
  {
    icon: Brain,
    title: "Multi-Platform",
    description: "Claude Code, Gemini CLI, Codex CLI. Per-card platform override.",
  },
  {
    icon: Users,
    title: "Teams & Cloud Pool",
    description: "Push tasks to cloud, pull and claim as a team. Role-based access.",
  },
  {
    icon: Server,
    title: "Dev Server per Worktree",
    description: "Isolated dev servers on auto-allocated ports. Test before merging.",
  },
];

/* ── Component ── */

export function Features() {
  return (
    <section id="features" className="py-24 px-6">
      <div className="max-w-5xl mx-auto">
        {/* Section header */}
        <SectionWrapper className="text-center mb-20">
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-foreground">
            Not a tracker. An execution engine.
          </h2>
          <p className="mt-4 text-muted-foreground text-lg max-w-2xl mx-auto">
            Linear tracks tasks. ideafy runs them. Every card is an executable
            unit with its own branch, plan, tests, and AI conversation.
          </p>
        </SectionWrapper>

        {/* Hero features - alternating layout */}
        <div className="space-y-28">
          {heroFeatures.map((feature, i) => {
            const colors = accentMap[feature.accent];
            const isEven = i % 2 === 0;

            return (
              <motion.div
                key={feature.title}
                initial={{ opacity: 0, y: 40 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-100px" }}
                transition={{ duration: 0.6, ease: "easeOut" }}
                className={`flex flex-col md:flex-row items-center gap-10 md:gap-16 ${
                  !isEven ? "md:flex-row-reverse" : ""
                }`}
              >
                {/* Text side */}
                <div className="flex-1 min-w-0">
                  <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-full border ${colors.border} ${colors.bg} text-xs font-medium ${colors.text} mb-4`}>
                    <feature.icon className="w-3.5 h-3.5" />
                    {feature.label}
                  </div>
                  <h3 className="text-2xl sm:text-3xl font-bold text-foreground tracking-tight mb-4">
                    {feature.title}
                  </h3>
                  <p className="text-muted-foreground leading-relaxed mb-3">
                    {feature.description}
                  </p>
                  <p className="text-sm text-muted-foreground/60">
                    {feature.detail}
                  </p>
                </div>

                {/* Visual side - abstract card */}
                <div className="flex-1 w-full max-w-sm">
                  <div className={`relative rounded-xl border ${colors.border} bg-card/40 p-6 ${colors.glow}`}>
                    <div className={`w-10 h-10 rounded-lg ${colors.bg} border ${colors.border} flex items-center justify-center mb-5`}>
                      <feature.icon className={`w-5 h-5 ${colors.text}`} />
                    </div>
                    {/* Skeleton lines to suggest UI */}
                    <div className="space-y-3">
                      <div className="h-2 rounded-full bg-foreground/[0.06] w-3/4" />
                      <div className="h-2 rounded-full bg-foreground/[0.04] w-full" />
                      <div className="h-2 rounded-full bg-foreground/[0.04] w-5/6" />
                      <div className="h-2 rounded-full bg-foreground/[0.03] w-2/3" />
                    </div>
                    <div className={`mt-5 h-1 rounded-full ${colors.bg} w-1/3`} />
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>

        {/* Compact secondary features */}
        <motion.div
          initial={{ opacity: 0, y: 32 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="mt-28 border-t border-border/40 pt-16"
        >
          <h3 className="text-center text-lg font-semibold text-foreground mb-10">
            And everything else you need
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-8">
            {compactFeatures.map((feature) => (
              <div key={feature.title} className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-muted/40 flex items-center justify-center shrink-0 mt-0.5">
                  <feature.icon className="w-4 h-4 text-muted-foreground" />
                </div>
                <div>
                  <h4 className="text-sm font-medium text-foreground mb-1">
                    {feature.title}
                  </h4>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {feature.description}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </motion.div>
      </div>
    </section>
  );
}
