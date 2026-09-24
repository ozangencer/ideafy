// ─────────────────────────────────────────────────────────────────────────
// GENERATED FILE — DO NOT EDIT.
//
// Verbatim copy of lib/prompts/opinion.ts, written by
// scripts/sync-mcp-shared.mjs on every mcp-server build. Edit the source,
// not this file; anything you change here is overwritten on the next build.
// ─────────────────────────────────────────────────────────────────────────

/**
 * How a plan treats the card's AI Opinion.
 *
 * The opinion is the evaluation the user already read and accepted, so its
 * recommendations are the starting point of the plan, not a side note. Every
 * surface that writes a plan states the same rule so they stay in step: the
 * autonomous phase prompt, the terminal launcher and the Solution chat inside
 * Ideafy, plus get_card and save_plan in the MCP server for a session the user
 * opened by hand, where none of the in-app prompts ever run.
 *
 * Zero imports on purpose: scripts/sync-mcp-shared.mjs copies this file
 * verbatim into mcp-server/opinion.generated.ts, which has to compile inside
 * mcp-server without the `@/` alias or the repo's lib/.
 */
export const AI_OPINION_PLANNING_RULE = `Base the plan on the card's AI Opinion (\`aiOpinion\`, with \`aiVerdict\`). It is the evaluation the user accepted, so its recommendations and cautions are the default approach:
- Build the plan on the solution it recommends and carry its concerns into Edge Cases.
- If the code forces you off one of its recommendations, do not drop it silently — say in one sentence inside the plan why you deviated.
- If the verdict is negative, do not follow it blindly either: bring its risks into the plan and answer each objection explicitly.
- If the description was changed after the opinion and the two conflict, the description wins; name the conflict in one sentence.
- If \`aiOpinion\` is empty, plan from the description as usual.`;
