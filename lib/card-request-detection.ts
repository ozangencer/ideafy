// Does this turn's user message already ask for an Ideafy card?
//
// The answer is a HINT for the creation-offer policy, never a command, and the
// split matters. "kart aç dememe rağmen hook yine soruyor" is a complaint
// ABOUT card creation, not a request FOR one — and it contains every keyword a
// real request contains. No keyword list can tell those apart, so a match only
// strengthens the wording the model reads; the model still decides from the
// message itself. Getting this wrong in the other direction is the expensive
// case: a false positive that reads as a command would open a card on the turn
// where the user was asking why cards keep getting opened.
//
// Matching runs on the lowercased prompt so Turkish uppercase input folds into
// the same patterns. JS lowercases "I" to "i" rather than to "ı", which is why
// the suffix classes below accept both.
const CARD_REQUEST_PATTERNS: RegExp[] = [
  // TR: "kart aç", "bir kart açabilirsin", "kartı oluştur", "kart ekle"
  /kart[ıi]?\s+(a[çc]|olu[şs]tur|yarat|ekle)/,
  // EN: "create a card", "open a new card", "add an ideafy card"
  /\b(create|open|make|add|start)\s+(a|an|the)?\s*(new\s+)?(ideafy\s+)?card\b/,
  // EN: "card for this", "a card for it"
  /\bcard\s+for\s+(this|it|that)\b/,
  // TR: "bunu ideafy'a ekle", "ideafy'e kaydet" — "kart" kelimesi geçmeden
  /ideafy['’]?\w*\s+(\w+\s+)?(ekle|kaydet|at)\b/,
];

export function promptLooksLikeCardRequest(
  prompt: string | null | undefined
): boolean {
  if (!prompt || typeof prompt !== "string") return false;
  const text = prompt.toLowerCase();
  return CARD_REQUEST_PATTERNS.some((pattern) => pattern.test(text));
}
