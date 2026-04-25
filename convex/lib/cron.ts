import { CronExpressionParser } from "cron-parser";

export function nextRunFromCron(
  cron: string,
  tz: string,
  from: Date = new Date(),
): number {
  const expr = CronExpressionParser.parse(cron, { tz, currentDate: from });
  return expr.next().getTime();
}

export const MIN_CRON_INTERVAL_MS = 60 * 60 * 1000;

export function validateCron(
  cron: string,
  tz: string,
  minIntervalMs = MIN_CRON_INTERVAL_MS,
): { ok: true } | { ok: false; reason: string } {
  let expr;
  try {
    expr = CronExpressionParser.parse(cron, { tz });
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "invalid cron",
    };
  }
  // Sample the next 5 fires; if any consecutive pair is closer than
  // minIntervalMs, the schedule is too frequent.
  const fires = expr.take(5).map((d) => d.getTime());
  for (let i = 1; i < fires.length; i++) {
    const gap = fires[i] - fires[i - 1];
    if (gap < minIntervalMs) {
      return {
        ok: false,
        reason: `recurring schedules must be at least ${Math.round(
          minIntervalMs / 60000,
        )} minutes apart; this cron fires every ${Math.round(gap / 60000)} minutes`,
      };
    }
  }
  return { ok: true };
}

const ISO_OFFSET_RE = /(?:Z|[+-]\d{2}:?\d{2})$/;

// Parse an ISO 8601 datetime. If it has a Z/offset suffix, use it as-is.
// Otherwise interpret it as wall time in `tz`.
export function parseIsoInTz(iso: string, tz: string): number | null {
  const trimmed = iso.trim();
  if (ISO_OFFSET_RE.test(trimmed)) {
    const t = Date.parse(trimmed);
    return Number.isFinite(t) ? t : null;
  }

  const m = trimmed.match(
    /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/,
  );
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  const utcGuess = Date.UTC(+y, +mo - 1, +d, +h, +mi, s ? +s : 0);

  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = Object.fromEntries(
    dtf
      .formatToParts(new Date(utcGuess))
      .filter((p) => p.type !== "literal")
      .map((p) => [p.type, p.value]),
  );
  const tzWallMs = Date.UTC(
    +parts.year,
    +parts.month - 1,
    +parts.day,
    +parts.hour === 24 ? 0 : +parts.hour,
    +parts.minute,
    +parts.second,
  );
  return utcGuess - (tzWallMs - utcGuess);
}
