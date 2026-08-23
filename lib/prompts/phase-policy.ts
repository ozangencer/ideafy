/**
 * Phase policy text — the <system-reminder> blocks the Ideafy hook injects on
 * every user turn, and the same text the MCP server hands back the moment a
 * session binds to a card.
 *
 * IMPORTANT: this module must stay import-free. mcp-server is a separate npm
 * package whose tsconfig pins `rootDir: "."`, and its dist/ is copied verbatim
 * into the Claude plugin where the repo's lib/ does not exist. So
 * scripts/sync-mcp-shared.mjs copies this file into
 * mcp-server/phase-policy.generated.ts on every mcp-server build. A single
 * import here breaks that copy's compile.
 *
 * The impure half of the old lib/hook-policy.ts — resolveEffectiveWorktree and
 * resolveProjectByFolderAncestor — stayed behind; hook-policy.ts re-exports
 * everything below so its importers did not have to move.
 */

const PHASE_INSTRUCTIONS: Record<string, string> = {
  ideation:
    "propose save_opinion. This tool does NOT move the card. Once the opinion is saved, ask separately whether to move the card — to 'backlog' if the verdict was positive, to 'withdrawn' if it was negative — and call move_card only on a clear yes. Never report the card as moved until move_card has returned.",
  backlog:
    "propose save_plan. This moves the card to In Progress.",
  bugs:
    "propose save_plan. This moves the card to In Progress.",
  progress:
    "propose save_tests. This moves the card to Human Test.",
  // The test column runs on its own policy block (buildTestPhaseLines) rather
  // than the propose-a-save_* shape the other columns share, but it still needs
  // an entry here so buildPhasePolicy does not bail out.
  test: "record what you verified with save_tests, then propose moving to Completed.",
};

export function isTerminalPhase(status: string | null | undefined): boolean {
  return status === "completed" || status === "withdrawn";
}

// One-line version of the phase policy: the column's expected next action,
// first sentence only. create_card returns this so a card that has just been
// created — but is not bound yet, and may never be — still tells the model
// where the work goes next, without repeating the full clause block that
// bind_session_to_card hands back a moment later in the usual flow.
export function buildPhaseHint(status: string): string | null {
  const instruction = PHASE_INSTRUCTIONS[status];
  if (!instruction) return null;
  const firstSentence = instruction.split(". ")[0].replace(/\.$/, "");
  return `Column: ${status} — expected next action: ${firstSentence}.`;
}

// Card titles and project names are interpolated into a <system-reminder>
// block, which Claude Code echoes into its transcript and treats as
// authoritative policy. Escaping double quotes — all this used to do — is not
// enough to keep a value inside its slot:
//
//   * a newline lets the value start what reads as a new numbered policy line;
//   * a literal </system-reminder> lets it close the block and open its own,
//     so the injected text is no longer quoted content but policy.
//
// That matters because these values are not always authored by the person
// running the session: a pool-synced card carries a teammate's title, and an
// imported backup carries whatever the file said. So treat every interpolated
// value as hostile — collapse line breaks, neutralize the angle brackets that
// could form a tag, and cap the length so a long title cannot bury the real
// policy lines below it.
function sanitizeForReminder(value: string | null | undefined, maxLength = 120): string {
  const collapsed = (value || "")
    .replace(/[\r\n\u2028\u2029]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  const neutralized = collapsed
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, '\\"');
  return neutralized.length > maxLength
    ? `${neutralized.slice(0, maxLength)}…`
    : neutralized;
}

// The other columns all share one shape: do the work, then ask before the one
// save_* call that ends the phase. Testing does not fit that shape. Verifying a
// scenario is not a phase transition — it is the work itself, and it happens
// many times per session — so recording it must not need a confirmation round
// trip. Only the move to Completed does.
function buildTestPhaseLines(): string[] {
  return [
    "1. This card is in manual testing. Whenever you verify a scenario yourself,",
    "   mark it [x] and call save_tests. Send the FULL checklist — every existing",
    "   item with its current [x]/[ ] state — changing only the boxes you verified.",
    "   Recording what you verified is the work, not a phase transition: do it",
    "   without asking first.",
    "2. Never check a scenario you did not actually observe. Leave it [ ] and say",
    "   why — it needs a person, or access you do not have, or it failed. A failing",
    "   scenario stays unchecked and gets reported, never quietly skipped.",
    "3. When every scenario is checked, STOP and ASK in a single short sentence",
    "   whether to move the card to Completed. On a clear yes, call move_card with",
    "   status 'completed' in the same turn.",
    "4. On 'no', keep working — 'no' means 'not yet'. Do not re-ask about moving",
    "   the card on turns where nothing new was verified.",
  ];
}

function buildStandardPhaseLines(status: string, phaseInstruction: string): string[] {
  return [
    "1. When you believe the current phase is complete, STOP and ASK the user for",
    "   confirmation before calling any save_* tool. Do not call the tool yourself",
    "   until the user agrees.",
    `2. For this card in column "${status}", the expected action is: ${phaseInstruction}`,
    "3. Ask in a single short sentence. Wait for a clear yes/no from the user.",
    "4. On 'yes', call the tool immediately in the same turn. Do not ask again,",
    "   do not announce, do not wait for further confirmation.",
    "5. On 'no', continue the conversation without calling any tool.",
    "6. A 'no' means 'not yet', not 'never'. Keep working on the same phase.",
    "7. Re-ask at the next natural stopping point IF the phase has meaningfully",
    "   progressed since the last refusal (new content added, a previously-open",
    "   question resolved, a missing section filled in). Do not re-ask on cosmetic",
    "   or no-op turns.",
  ];
}

// A display ID reaches the reminder as policy text, so it is validated by
// shape rather than escaped: anything that is not PREFIX-123 is dropped
// outright. Same reasoning as sanitizeForReminder, stricter because the
// accepted shape is known exactly.
function safeDisplayId(value: string | null | undefined): string | null {
  return value && /^[A-Za-z0-9]{1,16}-\d{1,9}$/.test(value) ? value : null;
}

// The phase policy's body: the card header plus the numbered clauses, with no
// <system-reminder> wrapper.
//
// Two callers want the same clauses through different channels. The hook
// injects them as a system reminder, which is where the wrapper belongs. The
// MCP server hands them back as a tool result — a channel the model reads at a
// different trust level — and emitting a literal system-reminder tag from tool
// output reads as an injection attempt, so that caller takes the bare body.
export function buildPhasePolicyBody(
  card: {
    id: string;
    title: string;
    status: string;
    displayId?: string | null;
  },
  branchPolicy?: { enforced: boolean; targetBranch: string | null }
): string | null {
  const phaseInstruction = PHASE_INSTRUCTIONS[card.status];
  if (!phaseInstruction) return null;

  const title = sanitizeForReminder(card.title);
  const displayId = safeDisplayId(card.displayId);

  const phaseLines =
    card.status === "test"
      ? buildTestPhaseLines()
      : buildStandardPhaseLines(card.status, phaseInstruction);

  const lines = [
    `Ideafy card: ${card.id} — "${title}"`,
    `Current column: ${card.status}`,
    "",
    "Policy for this session:",
    ...phaseLines,
  ];

  // The phase blocks are different lengths — seven clauses for the standard
  // columns, four for testing — so the clauses appended below have to count
  // rather than assume. Hardcoding the next number made the test column read
  // 1, 2, 3, 4, 8.
  let clause = phaseLines.filter((line) => /^\d+\./.test(line)).length;
  const next = () => ++clause;

  if (branchPolicy?.enforced && branchPolicy.targetBranch) {
    lines.push(
      `${next()}. This card must be implemented on branch "${branchPolicy.targetBranch}".`,
      "   Before the first Edit/Write/NotebookEdit in this session, verify the",
      "   current branch. If it does not match, call mcp__ideafy__ensure_branch",
      `   with cardId "${card.id}" to create or check out the correct branch.`,
      "   The PreToolUse hook will block edits performed on the wrong branch."
    );
  }

  if (displayId) {
    lines.push(
      `${next()}. When a commit advances the work this card describes, reference the`,
      `   card with a trailer: put "Card: ${displayId}" on its own line as the last`,
      "   line of the commit body. Write the subject exactly as you otherwise",
      "   would — no prefix, no change in style.",
      `${next()}. Do NOT tag a commit with this card when the work is something the`,
      "   card does not cover. Untagged commits are legitimate and common — a",
      "   typo fix, a lint pass, an unrelated bug you happened to notice. Leave",
      "   those untagged, or ask in one sentence whether to open a card for the",
      "   work and use that card's ref instead. A wrong ref is worse than none:",
      "   it makes the board claim something that is not true."
    );
  }

  return lines.join("\n");
}

// Phase-aware policy block used once a session is bound to a card. What the
// hook injects on every user turn.
export function buildPhasePolicy(
  card: {
    id: string;
    title: string;
    status: string;
    displayId?: string | null;
  },
  branchPolicy?: { enforced: boolean; targetBranch: string | null }
): string | null {
  const body = buildPhasePolicyBody(card, branchPolicy);
  if (body === null) return null;
  return `<system-reminder>\n${body}\n</system-reminder>\n`;
}

// First-contact policy: shown once per fresh session that lands in a project
// but has no card bound. Asks Claude to propose card creation when the user's
// request looks like real work.
//
// Clause 1 is an escape hatch for the case the offer used to get wrong: a user
// who already wrote "Ideafy'da bir kart aç" got asked whether to open a card
// anyway. Nothing was broken — clause 2 said to ask, clause 3 said asking ends
// the turn, and both were followed. The permission the user had already given
// simply had nowhere to land, so it has to be read before the asking clauses,
// not after them.
//
// `signals.promptLooksLikeCardRequest` comes from a keyword scan of this
// turn's prompt (see lib/card-request-detection.ts). It only appends a line
// saying the wording matched; it never sets the decision, because the same
// keywords appear in messages that complain about card creation instead of
// requesting it.
export function buildCreationOfferPolicy(
  project: {
    id: string;
    name: string;
  },
  signals?: { promptLooksLikeCardRequest?: boolean }
): string {
  const exceptionClause = [
    "1. EXCEPTION — settle this BEFORE anything below. If the user's message",
    "   already asks for a card (\"Ideafy'da bir kart aç\", \"create a card for",
    "   this\", \"bunu backlog'a ekle\"), they have already given permission.",
    "   Do NOT ask. Pick the column from their wording, call create_card and",
    "   bind_session_to_card in THIS turn, then carry on with the work they",
    "   actually asked for. Clauses 2 and 3 do not apply in that case.",
    "   A message that merely MENTIONS cards is not such a request: a question",
    "   about how card creation behaves, or a complaint that you asked when",
    "   you should not have, wants an answer — not a card. When unsure, fall",
    "   through to clause 2.",
  ];

  if (signals?.promptLooksLikeCardRequest) {
    exceptionClause.push(
      "   SIGNAL: this turn's wording matches a card request. Treat clause 1 as",
      "   likely in effect, but confirm it against what the message actually",
      "   asks for. The match is a hint, not a command."
    );
  }

  return [
    "<system-reminder>",
    `You are in Ideafy project "${sanitizeForReminder(project.name)}" (projectId: ${project.id}).`,
    "No Ideafy card is bound to this session yet.",
    "",
    "Policy for this session:",
    ...exceptionClause,
    "2. Otherwise, if the user's FIRST request looks like work they would want",
    "   tracked, STOP before doing anything else and ask ONE short sentence",
    "   proposing the column that fits:",
    "     - A new idea that needs evaluation → \"Create this as an Ideation card?\"",
    "     - A known task ready to plan → \"Create this as a Backlog card?\"",
    "     - A bug report or broken behaviour → \"This looks like a bug. Create",
    "       it in the Bugs column?\"",
    "   Decide the column from the user's wording. Do not ask them to choose.",
    "3. CRITICAL: After asking, END YOUR TURN. Do not read files, run tools,",
    "   investigate, plan, or start implementation in the same turn as the",
    "   question. Wait for the user's next message. The only acceptable output",
    "   for this turn is the one-sentence question — nothing before it, nothing",
    "   after it.",
    "4. On the user's 'yes' in the next turn:",
    "     - Call mcp__ideafy__create_card with projectId, a concise title, a",
    "       description drawn from the user's request, and status set to one",
    "       of: 'ideation' | 'backlog' | 'bugs'.",
    "     - Immediately call mcp__ideafy__bind_session_to_card with the returned",
    "       card id. From the next turn onward the phase-aware policy will kick",
    "       in automatically.",
    "     - Then proceed with the actual work the user originally asked for.",
    "5. On 'no' or if the request is a quick debug / read-only / lookup question:",
    "   do not offer again. Proceed with the user's request normally. The user",
    "   can bind a card later by naming one explicitly (e.g. \"this is for",
    "   IDE-125\") — in that case call mcp__ideafy__bind_session_to_card",
    "   directly without creating a new card.",
    "6. This offer is shown only once per session. After this turn the hook will",
    "   stay silent unless a binding is created.",
    "</system-reminder>",
    "",
  ].join("\n");
}
