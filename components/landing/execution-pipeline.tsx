"use client";

import { SectionWrapper } from "./section-wrapper";
import { motion } from "framer-motion";
import { ChevronDown } from "lucide-react";

const phases = [
  {
    phase: "Ideation",
    label: "Evaluate",
    description: "AI scores your idea against the product narrative. YAGNI check, priority, complexity, honest verdict.",
    color: "bg-violet-500",
    textColor: "text-violet-400",
    borderColor: "border-violet-500/20",
    bgColor: "bg-violet-500/[0.03]",
  },
  {
    phase: "Planning",
    label: "Plan",
    description: "Claude analyzes the codebase, identifies files to change, and outputs a structured implementation plan.",
    color: "bg-yellow-500",
    textColor: "text-yellow-400",
    borderColor: "border-yellow-500/20",
    bgColor: "bg-yellow-500/[0.03]",
  },
  {
    phase: "Implementation",
    label: "Build",
    description: "Code is written in an isolated git worktree. Branch auto-created. Test scenarios generated on completion.",
    color: "bg-blue-500",
    textColor: "text-blue-400",
    borderColor: "border-blue-500/20",
    bgColor: "bg-blue-500/[0.03]",
  },
  {
    phase: "Testing",
    label: "Verify",
    description: "Human Test column with generated scenarios. Test Together mode for AI-guided verification. Re-test on demand.",
    color: "bg-emerald-500",
    textColor: "text-emerald-400",
    borderColor: "border-emerald-500/20",
    bgColor: "bg-emerald-500/[0.03]",
  },
  {
    phase: "Ship",
    label: "Merge",
    description: "Squash-merge from worktree to main. Conflict detection, auto-rebase, rollback support. Clean up and done.",
    color: "bg-foreground",
    textColor: "text-foreground/70",
    borderColor: "border-foreground/20",
    bgColor: "bg-foreground/[0.02]",
  },
];

export function ExecutionPipeline() {
  return (
    <SectionWrapper id="execution-pipeline" className="py-24 px-6">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-16">
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-foreground">
            From idea to merged code
          </h2>
          <p className="mt-4 text-muted-foreground text-lg max-w-2xl mx-auto">
            Each card moves through a multi-phase execution pipeline.
            Autonomous or interactive at every step.
          </p>
        </div>

        <div className="space-y-0">
          {phases.map((phase, i) => (
            <div key={phase.phase}>
              <motion.div
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4, delay: i * 0.08 }}
                className={`group relative flex items-start gap-5 p-5 rounded-xl border ${phase.borderColor} ${phase.bgColor} hover:bg-card/50 transition-all duration-300`}
              >
                {/* Phase dot */}
                <div className={`shrink-0 w-12 h-12 rounded-xl ${phase.bgColor} border ${phase.borderColor} flex items-center justify-center`}>
                  <div className={`w-3 h-3 rounded-full ${phase.color}`} />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-3 mb-1">
                    <span className={`text-xs font-mono uppercase tracking-wider ${phase.textColor}`}>
                      {phase.phase}
                    </span>
                    <span className="text-xs px-2 py-0.5 rounded-md bg-muted/50 text-muted-foreground">
                      {phase.label}
                    </span>
                  </div>
                  <p className="text-sm text-foreground/80 leading-relaxed">
                    {phase.description}
                  </p>
                </div>
              </motion.div>

              {/* Connector between cards */}
              {i < phases.length - 1 && (
                <div className="flex justify-center py-1.5">
                  <ChevronDown className="w-4 h-4 text-muted-foreground/20" />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </SectionWrapper>
  );
}
