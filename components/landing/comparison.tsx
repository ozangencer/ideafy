"use client";

import { SectionWrapper } from "./section-wrapper";
import { Check, Minus } from "lucide-react";

const rows = [
  { feature: "Task tracking", linear: true, notion: true, ideafy: true },
  { feature: "AI code execution", linear: false, notion: false, ideafy: true },
  { feature: "Git worktree isolation", linear: false, notion: false, ideafy: true },
  { feature: "Auto test generation", linear: false, notion: false, ideafy: true },
  { feature: "MCP agent integration", linear: false, notion: false, ideafy: true },
  { feature: "AI idea evaluation", linear: false, notion: "basic", ideafy: true },
  { feature: "Local-first / self-hosted", linear: false, notion: false, ideafy: true },
  { feature: "Multi-AI platform", linear: false, notion: false, ideafy: true },
  { feature: "Team collaboration", linear: true, notion: true, ideafy: true },
];

function Cell({ value }: { value: boolean | string }) {
  if (value === true)
    return <Check className="w-4 h-4 text-emerald-400 mx-auto" />;
  if (value === false)
    return <Minus className="w-4 h-4 text-muted-foreground/30 mx-auto" />;
  return (
    <span className="text-xs text-muted-foreground mx-auto block text-center">
      {value}
    </span>
  );
}

export function Comparison() {
  return (
    <SectionWrapper className="py-24 px-6">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-12">
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-foreground">
            Beyond project management
          </h2>
          <p className="mt-4 text-muted-foreground text-lg">
            Other tools track what needs to be done. ideafy does it.
          </p>
        </div>

        <div className="rounded-xl border border-border/50 overflow-hidden gradient-border backdrop-blur-sm bg-card/30">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/50 bg-muted/20">
                <th className="text-left font-medium text-muted-foreground px-5 py-3">
                  Feature
                </th>
                <th className="text-center font-medium text-muted-foreground px-4 py-3 w-24">
                  Linear
                </th>
                <th className="text-center font-medium text-muted-foreground px-4 py-3 w-24">
                  Notion
                </th>
                <th className="text-center font-semibold px-4 py-3 w-24">
                  <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 via-primary to-purple-400">
                    ideafy
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr
                  key={row.feature}
                  className={`hover:bg-white/[0.02] transition-colors ${
                    i < rows.length - 1 ? "border-b border-border/30" : ""
                  }`}
                >
                  <td className="px-5 py-3 text-foreground/80">
                    {row.feature}
                  </td>
                  <td className="px-4 py-3">
                    <Cell value={row.linear} />
                  </td>
                  <td className="px-4 py-3">
                    <Cell value={row.notion} />
                  </td>
                  <td className="px-4 py-3 bg-primary/[0.03]">
                    <Cell value={row.ideafy} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </SectionWrapper>
  );
}
