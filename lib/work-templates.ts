/**
 * Work templates live in the settings table as one JSON value under
 * `work_templates`. Pure code with no fs or DB import: the settings route, the
 * Generate route and the settings modal all read the same list through it.
 */

import { DEFAULT_WORK_TEMPLATES, type WorkTemplate } from "./types";

export const WORK_TEMPLATES_SETTING_KEY = "work_templates";

/** ".docx", "docx" and " .DOCX " all mean the same file type. */
export function normalizeOutputExt(value: unknown): string {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  const bare = raw.replace(/^\.+/, "").replace(/[^a-z0-9]/g, "");
  return bare ? `.${bare}` : ".md";
}

/**
 * Whatever the stored value is — null, a hand-edited row, a list from an older
 * build — hand back a usable list. Entries without a name are dropped, ids are
 * made unique, and an empty result becomes the default Output template so
 * Generate always has something to run with.
 */
export function normalizeWorkTemplates(value: unknown): WorkTemplate[] {
  let parsed: unknown = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      parsed = null;
    }
  }
  if (!Array.isArray(parsed)) return DEFAULT_WORK_TEMPLATES;

  const seen = new Set<string>();
  const templates: WorkTemplate[] = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object") continue;
    const raw = entry as Record<string, unknown>;
    const name = typeof raw.name === "string" ? raw.name.trim() : "";
    if (!name) continue;
    let id = typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : slugify(name);
    while (seen.has(id)) id = `${id}-${templates.length + 1}`;
    seen.add(id);
    const skill = typeof raw.skill === "string" && raw.skill.trim() ? raw.skill.trim() : null;
    templates.push({
      id,
      name,
      skill,
      promptPreset: typeof raw.promptPreset === "string" ? raw.promptPreset : "",
      outputExt: normalizeOutputExt(raw.outputExt),
    });
  }
  return templates.length ? templates : DEFAULT_WORK_TEMPLATES;
}

/** The card's template, or the first one when it has none or it was deleted. */
export function resolveWorkTemplate(
  templates: WorkTemplate[],
  templateId: string | null | undefined
): WorkTemplate {
  const list = templates.length ? templates : DEFAULT_WORK_TEMPLATES;
  return list.find((t) => t.id === templateId) ?? list[0];
}

export function newWorkTemplateId(): string {
  return `tpl-${Math.random().toString(36).slice(2, 10)}`;
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "template"
  );
}
