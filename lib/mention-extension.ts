// Backwards-compatible barrel. Implementation now lives under `@/lib/mentions/*`.
// Kept in place so external imports (including cloud repo) continue to resolve.

export {
  SkillMention,
  McpMention,
  UnifiedMention,
  CardMention,
  DocumentMention,
} from "./mentions/nodes";
export type {
  MentionOptions,
  UnifiedMentionOptions,
  CardMentionOptions,
  DocumentMentionOptions,
} from "./mentions/nodes";
