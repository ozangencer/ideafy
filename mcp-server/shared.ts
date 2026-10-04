// The one place this server reaches into the repo's lib/.
//
// esbuild bundles lib/ into dist/index.js, so the server runs the same
// prompt text and card operations as the app. Under tsx — the test suite, and
// `npx tsx mcp-server/index.ts` when dist/ is missing — lib/ loads as
// CommonJS (it sits under the Next app's package, which has no "type":
// "module") and Node parks its named exports on `default`. A plain named
// import fails there, so every lib/ import goes through this file and is
// unwrapped once.
//
// Whatever is imported here ends up in the plugin bundle. Only import-free
// modules, modules that use nothing but node built-ins (lib/artifact-links)
// and lib/card-ops/ belong here — never lib/db, drizzle or anything that
// reaches better-sqlite3 or Next (__tests__/bundle-deps.test.ts fails the
// build if one does).

import * as testStyleNs from "../lib/prompts/test-style";
import * as phasePolicyNs from "../lib/prompts/phase-policy";
import * as opinionNs from "../lib/prompts/opinion";
import * as priorDecisionsNs from "../lib/prompts/prior-decisions";
import * as cardLinksNs from "../lib/card-links";
import * as chainOrderNs from "../lib/chain-order";
import * as planFilesNs from "../lib/plan-files";
import * as cardOpsNs from "../lib/card-ops";
import * as opinionMarkersNs from "../lib/opinion-markers";
import * as evaluationNs from "../lib/prompts/evaluation";
import * as artifactLinksNs from "../lib/artifact-links";

function unwrap<T extends object>(ns: T): T {
  return (Reflect.get(ns, "default") as T | undefined) ?? ns;
}

export const { buildTestStyleContract } = unwrap(testStyleNs);
export const { buildPhaseHint, buildPhasePolicyBody } = unwrap(phasePolicyNs);
export const { AI_OPINION_PLANNING_RULE } = unwrap(opinionNs);
export const { PRIOR_DECISIONS_RULE, CHAIN_IMPLEMENTATION_RULE } = unwrap(priorDecisionsNs);
export const { linkCardReferences } = unwrap(cardLinksNs);
export const { buildChainContext, compareByChainOrder, isFinished, placeAfter } = unwrap(chainOrderNs);
export const { extractPlanFiles, htmlToText, normalizePath, pathsOverlap } = unwrap(planFilesNs);
export const {
  transaction,
  moveCard,
  completedAtFor,
  completedAtOnCreate,
  isStatus,
  statusAfterPlan,
  statusAfterTests,
  saveOpinion,
  listQueueRows,
  queueDisplayId,
  queueKindOf,
  queuedRunsInWorktree,
  enqueueCard,
  dequeueCard,
  clearQueue,
  DEFAULT_GROUP_COLOR,
  CardGroupError,
  normalizeGroupCode,
  normalizeGroupId,
  getGroup,
  listGroups,
  assertGroupAssignable,
  createGroup,
  updateGroup,
  deleteGroup,
  moveCardInChain,
} = unwrap(cardOpsNs);
export const { normalizeComplexity, describeOpinionMarkers } = unwrap(opinionMarkersNs);
export const { EVALUATION_OUTPUT_SCHEMA, EVALUATION_HEADINGS_RULE, buildEvaluationGuide } = unwrap(evaluationNs);
export const { cardArtifactDir, materializeArtifactFences, persistCardArtifacts } = unwrap(artifactLinksNs);

export type { CardResolver, LinkedCard } from "../lib/card-links";
export type { ChainCardRef, ChainContext } from "../lib/chain-order";
export type {
  SqlDb,
  Statement,
  MoveCardResult,
  QueueRow,
  EnqueueResult,
  ClearedQueueCard,
  CardGroupRow,
  ChainMove,
} from "../lib/card-ops";
