/**
 * How long an implementation run may take before it is killed, by the card's
 * complexity. A flat 10 minutes killed a high-complexity plan while the run was
 * still reading the files it had to change (IDE-356), so larger cards get more
 * room. Other phases keep the runner's default: planning, retest and verify
 * read and write no more for a big card than for a small one.
 */
const IMPLEMENTATION_TIMEOUT_MINUTES: Record<string, number> = {
  trivial: 10,
  low: 10,
  medium: 20,
  high: 30,
  very_high: 45,
};

export function autonomousRunTimeoutMs(
  phase: string,
  complexity: string | null | undefined,
): number | undefined {
  if (phase !== "implementation") return undefined;
  const minutes = IMPLEMENTATION_TIMEOUT_MINUTES[complexity ?? ""] ?? 20;
  return minutes * 60 * 1000;
}
