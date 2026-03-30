export type SessionTip = "plan" | "impl" | "fix" | "eval" | "ideate" | "test" | "auto" | "retest" | "chat";
export type SessionMod = "auto" | "int" | "stream";

export function generateSlug(title: string): string {
  const words = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3);

  let slug = words.join("-");
  if (slug.length > 20) {
    slug = slug.substring(0, 20).replace(/-$/, "");
  }
  return slug;
}

export function generateSessionName(
  card: { taskNumber: number | null; title: string },
  project: { idPrefix: string } | null | undefined,
  tip: SessionTip,
  mod: SessionMod,
): string | null {
  if (!project || !card.taskNumber) return null;
  const displayId = `${project.idPrefix}-${card.taskNumber}`;
  const slug = generateSlug(card.title);
  return `${displayId}_${tip}_${mod}_${slug}`;
}
