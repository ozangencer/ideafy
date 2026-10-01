import type { ProcessType, SectionType } from "@/lib/types";

// Shared by the activity bell (server) and the OS banner (renderer) so the
// same run reads the same way in both places. Client-safe: no db imports.

export const SECTION_LABEL: Record<SectionType, string> = {
  detail: "Detail",
  opinion: "AI Opinion",
  solution: "Solution",
  tests: "Tests",
};

export const PROCESS_LABEL: Record<ProcessType, string> = {
  autonomous: "Autonomous task",
  "quick-fix": "Quick Fix",
  evaluate: "AI Opinion",
  generate: "Generate",
  chat: "Chat",
};
