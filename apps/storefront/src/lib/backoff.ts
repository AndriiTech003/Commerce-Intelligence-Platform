export interface PollSchedule {
  initialMs: number;
  factor: number;
  maxMs: number;
  totalMs: number;
}

export const ORDER_POLL: PollSchedule = { initialMs: 1000, factor: 1.5, maxMs: 5000, totalMs: 60000 };

export function nextPollDelay(previousMs: number | null, schedule: PollSchedule = ORDER_POLL): number {
  if (previousMs === null) return schedule.initialMs;
  return Math.min(schedule.maxMs, Math.round(previousMs * schedule.factor));
}

export function shouldKeepPolling(
  status: string,
  elapsedMs: number,
  schedule: PollSchedule = ORDER_POLL,
): boolean {
  return status === 'pending_payment' && elapsedMs < schedule.totalMs;
}

export function pollDelays(schedule: PollSchedule = ORDER_POLL): number[] {
  const delays: number[] = [];
  let elapsed = 0;
  let delay: number | null = null;
  while (true) {
    delay = nextPollDelay(delay, schedule);
    if (elapsed + delay > schedule.totalMs) break;
    elapsed += delay;
    delays.push(delay);
  }
  return delays;
}
