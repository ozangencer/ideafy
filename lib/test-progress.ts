export function parseTestProgress(html: string): { checked: number; total: number } | null {
  if (!html) return null;

  // data-checked attribute'larını say
  const checkedMatches = html.match(/data-checked="true"/g);
  const uncheckedMatches = html.match(/data-checked="false"/g);

  const checked = checkedMatches?.length || 0;
  const unchecked = uncheckedMatches?.length || 0;
  const total = checked + unchecked;

  if (total === 0) return null;
  return { checked, total };
}
