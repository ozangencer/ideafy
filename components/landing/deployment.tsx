"use client";

import { SectionWrapper } from "./section-wrapper";
import { Laptop, Cloud, Check, Shield, HardDrive, Eye, Globe } from "lucide-react";

const options = [
  {
    icon: Laptop,
    title: "Solo Builder",
    subtitle: "Open source & self-hosted. Free forever.",
    badge: "Free",
    points: [
      "SQLite database, single file backup",
      "Works offline, no external dependencies",
      "Electron app or browser at localhost",
      "Claude Code, Gemini CLI, or Codex CLI",
    ],
  },
  {
    icon: Cloud,
    title: "Small Team",
    subtitle: "Add Supabase for cloud sync",
    badge: null,
    points: [
      "Everything in Solo, plus team features",
      "Cloud Pool: push, pull, and claim tasks",
      "Role-based access: owner, admin, member",
      "Notifications, assignees, team invites",
    ],
  },
];

const trustSignals = [
  { icon: Globe, label: "Open Source" },
  { icon: HardDrive, label: "Self-Hosted" },
  { icon: Shield, label: "Local-First" },
  { icon: Eye, label: "Privacy-First" },
];

export function Deployment() {
  return (
    <SectionWrapper className="py-24 px-6">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-12">
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-foreground">
            Your infra, your data
          </h2>
          <p className="mt-4 text-muted-foreground text-lg max-w-xl mx-auto">
            Self-hosted by design. Start solo with SQLite, add Supabase when you need a team.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {options.map((option) => (
            <div
              key={option.title}
              className="p-6 rounded-xl border border-border/50 bg-card/40 backdrop-blur-sm gradient-border hover:shadow-[0_0_40px_rgba(94,106,210,0.08)] transition-all duration-300"
            >
              <div className="w-10 h-10 rounded-lg bg-muted/40 flex items-center justify-center mb-4">
                <option.icon className="w-5 h-5 text-foreground/60" />
              </div>
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-semibold text-foreground">
                  {option.title}
                </h3>
                {option.badge && (
                  <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                    {option.badge}
                  </span>
                )}
              </div>
              <p className="text-sm text-muted-foreground mt-1 mb-4">
                {option.subtitle}
              </p>
              <ul className="space-y-2">
                {option.points.map((point) => (
                  <li
                    key={point}
                    className="flex items-start gap-2.5 text-sm text-foreground/70"
                  >
                    <Check className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                    {point}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Trust signals */}
        <div className="mt-8 grid grid-cols-2 sm:grid-cols-4 gap-3">
          {trustSignals.map((signal) => (
            <div
              key={signal.label}
              className="flex items-center justify-center gap-2 px-4 py-3 rounded-lg border border-border/30 bg-card/20 backdrop-blur-sm text-sm text-muted-foreground"
            >
              <signal.icon className="w-4 h-4 text-primary/60" />
              {signal.label}
            </div>
          ))}
        </div>
      </div>
    </SectionWrapper>
  );
}
