"use client";

import { useState } from "react";
import { SectionWrapper } from "./section-wrapper";
import { motion, AnimatePresence } from "framer-motion";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Kanban, Users, SquareKanban } from "lucide-react";
import Image from "next/image";

const screenshots = [
  {
    id: "board",
    label: "Kanban Board",
    icon: Kanban,
    description: "Six-column pipeline from Ideation to Completed. Drag, execute, ship.",
    src: "/screenshots/board.png",
    alt: "ideafy kanban board with 6 columns and task cards",
  },
  {
    id: "pool",
    label: "Team Pool",
    icon: Users,
    description: "Cloud-synced task queue. Push, pull, and claim work across your team.",
    src: "/screenshots/pool.png",
    alt: "ideafy team pool view showing shared tasks",
  },
  {
    id: "card",
    label: "Card Detail",
    icon: SquareKanban,
    description: "Plan, solution, tests, and AI chat. Everything in one place.",
    src: "/screenshots/card.png",
    alt: "ideafy card modal showing solution plan",
  },
];

export function ScreenshotShowcase() {
  const [active, setActive] = useState("board");
  const current = screenshots.find((s) => s.id === active) ?? screenshots[0];

  return (
    <SectionWrapper className="py-24 px-6">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-12">
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-foreground">
            See it in action
          </h2>
          <p className="mt-4 text-muted-foreground text-lg max-w-lg mx-auto">
            Linear-inspired interface, designed for speed.
          </p>
        </div>

        {/* shadcn Tabs as switcher */}
        <div className="flex justify-center mb-4">
          <Tabs value={active} onValueChange={setActive}>
            <TabsList className="bg-muted/50 border border-border/40 h-10 p-1 gap-1">
              {screenshots.map((s) => (
                <TabsTrigger
                  key={s.id}
                  value={s.id}
                  className="gap-2 px-4 text-xs data-[state=active]:bg-background data-[state=active]:shadow-sm"
                >
                  <s.icon className="w-3.5 h-3.5" />
                  {s.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>

        {/* Active tab description */}
        <AnimatePresence mode="wait">
          <motion.p
            key={current.id + "-desc"}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2 }}
            className="text-center text-sm text-muted-foreground mb-8"
          >
            {current.description}
          </motion.p>
        </AnimatePresence>

        {/* Browser frame */}
        <div className="relative">
          {/* Ambient glow */}
          <div className="absolute -inset-10 bg-gradient-to-b from-primary/[0.05] to-transparent blur-3xl -z-10 pointer-events-none" />

          <div className="relative rounded-xl border border-border/50 overflow-hidden bg-background shadow-[0_25px_60px_-12px_rgba(0,0,0,0.5)]">
            {/* Browser chrome */}
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border/50 bg-muted/20">
              <div className="flex gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full bg-foreground/10" />
                <div className="w-2.5 h-2.5 rounded-full bg-foreground/10" />
                <div className="w-2.5 h-2.5 rounded-full bg-foreground/10" />
              </div>
              <div className="flex-1 flex justify-center">
                <div className="px-4 py-1 rounded-md bg-background/60 border border-border/30 text-[11px] text-muted-foreground font-mono">
                  localhost:3000/app
                </div>
              </div>
              <div className="w-[54px]" /> {/* Spacer to center URL */}
            </div>

            {/* Screenshot */}
            <div className="relative aspect-[16/10] bg-background">
              <AnimatePresence mode="wait">
                <motion.div
                  key={current.id}
                  initial={{ opacity: 0, scale: 0.98 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 1.02 }}
                  transition={{ duration: 0.3, ease: "easeOut" }}
                  className="absolute inset-0"
                >
                  <Image
                    src={current.src}
                    alt={current.alt}
                    fill
                    className="object-cover object-top"
                    priority={current.id === "board"}
                  />
                </motion.div>
              </AnimatePresence>
            </div>
          </div>

          {/* Bottom reflection/fade */}
          <div className="absolute bottom-0 left-0 right-0 h-24 bg-gradient-to-t from-background to-transparent pointer-events-none" />
        </div>
      </div>
    </SectionWrapper>
  );
}
