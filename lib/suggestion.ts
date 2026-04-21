// Backwards-compatible barrel. Implementation now lives under `@/lib/mentions/*`.
// Kept in place so external imports (including cloud repo) continue to resolve.

export {
  createSuggestion,
  createUnifiedSuggestion,
  createCardSuggestion,
  createDocumentSuggestion,
} from "./mentions/suggestions";
