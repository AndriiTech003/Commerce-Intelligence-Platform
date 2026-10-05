export interface Period {
  from: Date;
  to: Date;
}

export function resolvePeriod(
  from: string | undefined,
  to: string | undefined,
  defaultDays = 30,
  now = new Date(),
): Period {
  const end = to ? new Date(to) : now;
  const start = from ? new Date(from) : new Date(end.getTime() - defaultDays * 86400_000);
  return { from: start, to: end };
}

export function previousPeriod(period: Period): Period {
  const length = period.to.getTime() - period.from.getTime();
  return { from: new Date(period.from.getTime() - length), to: new Date(period.from.getTime()) };
}

export function deltaPct(current: number, previous: number | null): number | null {
  if (previous === null) return null;
  if (previous === 0) return current === 0 ? 0 : null;
  return Math.round(((current - previous) / previous) * 10000) / 100;
}

export function metric(current: number, previous: number | null) {
  return { value: current, previous, deltaPct: deltaPct(current, previous) };
}

export function funnelSteps(levels: Array<{ level: number; users: number }>, steps: readonly string[]) {
  const reached = steps.map((_, index) =>
    levels.filter((l) => l.level >= index + 1).reduce((sum, l) => sum + l.users, 0),
  );
  return steps.map((step, index) => ({
    step,
    users: reached[index]!,
    conversionFromPrev:
      index === 0
        ? null
        : reached[index - 1]! > 0
          ? Math.round((reached[index]! / reached[index - 1]!) * 10000) / 100
          : 0,
  }));
}

export function toClickHouseDateTime(date: Date): string {
  return date.toISOString().replace('T', ' ').replace('Z', '');
}

export function cohortMatrix(rows: Array<{ cohort: string; week: number; users: number }>, weeks: number) {
  const byCohort = new Map<string, Map<number, number>>();
  for (const row of rows) {
    const map = byCohort.get(row.cohort) ?? new Map<number, number>();
    map.set(row.week, row.users);
    byCohort.set(row.cohort, map);
  }
  return [...byCohort.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([cohort, map]) => {
      const size = map.get(0) ?? 0;
      const retention = Array.from({ length: weeks }, (_, w) =>
        size > 0 ? Math.round(((map.get(w) ?? 0) / size) * 10000) / 100 : 0,
      );
      return { cohort, size, retention };
    });
}
