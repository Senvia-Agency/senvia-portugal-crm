export interface FailureSummary {
  readonly flow_id: string; readonly flow_ids: readonly string[]; readonly organization_id: string; readonly owner_id: string;
  readonly failed: number; readonly summary_date: string; readonly claim_token: string;
}
export interface SummaryDependencies {
  readonly authorize: (request: Request) => Promise<boolean>;
  readonly claim: () => Promise<readonly FailureSummary[]>;
  readonly notify: (summary: FailureSummary) => Promise<boolean>;
  readonly settle: (summary: FailureSummary, success: boolean) => Promise<void>;
  readonly now: () => Date;
}
export async function handleFailureSummary(request: Request, dependencies: SummaryDependencies): Promise<Response> {
  const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  if (!await dependencies.authorize(request)) return reply({ error: 'Não autorizado.' }, 401);
  const hour = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Lisbon', hour: '2-digit', hourCycle: 'h23' }).format(dependencies.now());
  if (hour !== '09') return reply({ sent: 0, skipped: 'fora do horário do resumo' });
  const summaries = await dependencies.claim();
  let sent = 0;
  for (const summary of summaries) {
    let success = false;
    try { success = await dependencies.notify(summary); }
    catch (error) { if (!(error instanceof Error)) throw error; }
    await dependencies.settle(summary, success);
    if (success) sent += 1;
  }
  return reply({ sent, failed: summaries.length - sent });
}
