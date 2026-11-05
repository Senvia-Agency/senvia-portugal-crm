export interface AutomationRetryFailure {
  readonly status?: number;
  readonly message?: string;
}

export interface AutomationRetryState {
  readonly attempts: number;
  readonly next_attempt_at: string;
}

export type AutomationRetryDecision =
  | Readonly<{ kind: 'retry'; state: AutomationRetryState; wakeAt: Date }>
  | Readonly<{ kind: 'fail'; reason: 'disabled' | 'invalid_policy' | 'invalid_state' | 'not_transient' | 'attempts_exhausted' }>;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function transient(failure: AutomationRetryFailure): boolean {
  if (failure.status !== undefined) {
    return failure.status === 408 || failure.status === 429 || (failure.status >= 500 && failure.status <= 599);
  }
  const message = failure.message ?? '';
  const explicitStatus = message.match(/(?:HTTP|status|c[oó]digo)\s*[:=]?\s*(\d{3})\b/i);
  if (explicitStatus) return transient({ status: Number(explicitStatus[1]) });
  return /\b(timeout|timed out|ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN)\b|\b(?:WhatsApp|canal|channel)\b.{0,40}\b(?:desligad[oa]|desconectad[oa]|disconnected|offline)\b/i.test(message);
}

export function decideAutomationRetry(
  policy: unknown,
  previousState: unknown,
  failure: AutomationRetryFailure,
  now: Date,
): AutomationRetryDecision {
  if (policy === undefined || policy === null || policy === false) return { kind: 'fail', reason: 'disabled' };
  if (!record(policy)) return { kind: 'fail', reason: 'invalid_policy' };
  const maximum = policy.max_attempts;
  const interval = policy.interval_minutes;
  if (typeof maximum !== 'number' || !Number.isInteger(maximum) || maximum < 1 || maximum > 5
    || typeof interval !== 'number' || !Number.isFinite(interval) || interval < 1 || interval > 60) {
    return { kind: 'fail', reason: 'invalid_policy' };
  }
  const count = previousState === undefined || previousState === null
    ? 0 : record(previousState) ? previousState.attempts : undefined;
  if (typeof count !== 'number' || !Number.isInteger(count) || count < 0 || !Number.isFinite(now.getTime())) {
    return { kind: 'fail', reason: 'invalid_state' };
  }
  if (!transient(failure)) return { kind: 'fail', reason: 'not_transient' };
  const attempts = count + 1;
  if (attempts >= maximum) return { kind: 'fail', reason: 'attempts_exhausted' };
  const wakeAt = new Date(now.getTime() + interval * 60_000);
  return { kind: 'retry', wakeAt, state: { attempts, next_attempt_at: wakeAt.toISOString() } };
}
