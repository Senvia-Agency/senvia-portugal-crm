export class InvalidAutomationReentry extends Error {}

export function readReentryCooldownDays(value: unknown): number {
  if (value === undefined) return 0;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 3660) {
    throw new InvalidAutomationReentry('O intervalo de reentrada deve ser um número inteiro entre 0 e 3660 dias.');
  }
  return value;
}

export function reentryCooldownDecision(
  days: number,
  completedAt: string | null | undefined,
  now: Date,
): Readonly<{ allowed: boolean; eligibleAt: Date | null }> {
  const interval = readReentryCooldownDays(days);
  if (!Number.isFinite(now.getTime())) throw new InvalidAutomationReentry('O instante de reentrada é inválido.');
  if (interval === 0 || completedAt === null || completedAt === undefined) return { allowed: true, eligibleAt: null };
  const completed = Date.parse(completedAt);
  if (!Number.isFinite(completed)) throw new InvalidAutomationReentry('A data de fim do último percurso é inválida.');
  const eligibleAt = new Date(completed + interval * 86_400_000);
  if (!Number.isFinite(eligibleAt.getTime())) throw new InvalidAutomationReentry('O intervalo de reentrada ultrapassa o limite de datas suportado.');
  return { allowed: now.getTime() >= eligibleAt.getTime(), eligibleAt };
}
