/**
 * How a plan treats the card's AI Opinion.
 *
 * The opinion is the evaluation the user already read and accepted, so its
 * recommendations are the starting point of the plan, not a side note. Every
 * surface that writes a plan (the autonomous phase prompt, the terminal
 * launcher, the Solution chat) states the same rule so the three stay in step.
 *
 * Zero imports on purpose: the rule is plain text that both server routes and
 * the mcp-server tests can pull in without the `@/` alias.
 */
export const AI_OPINION_PLANNING_RULE = `Base the plan on the card's AI Opinion (\`aiOpinion\`, with \`aiVerdict\`). It is the evaluation the user accepted, so its recommendations and cautions are the default approach:
- Build the plan on the solution it recommends and carry its concerns into Edge Cases.
- If the code forces you off one of its recommendations, do not drop it silently — say in one sentence inside the plan why you deviated.
- If the verdict is negative, do not follow it blindly either: bring its risks into the plan and answer each objection explicitly.
- If the description was changed after the opinion and the two conflict, the description wins; name the conflict in one sentence.
- If \`aiOpinion\` is empty, plan from the description as usual.`;
