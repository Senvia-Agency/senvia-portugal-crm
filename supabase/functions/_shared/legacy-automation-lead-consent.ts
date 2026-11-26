// Automações por template (process-automation e a sua fila): uma lead com
// automation_enabled = false não recebe nenhum e-mail automático. O motor de
// fluxos (automation-engine) já respeitava este campo; o sistema antigo não, e a
// 25/11/2026 leads de prospeção com a automação desligada receberam o e-mail de
// boas-vindas. Falha fechada: se não for possível confirmar, não envia.

export type LeadFlagLookup = (leadId: string) => PromiseLike<{
  data: { automation_enabled?: boolean | null } | null; error: { message: string } | null;
}>;

export const isLeadTrigger = (triggerType: string): boolean => triggerType.startsWith('lead_');

/** Id da lead a que um evento diz respeito, ou null quando o gatilho não é de lead. */
export function leadIdForTrigger(triggerType: string, record: Readonly<Record<string, unknown>>): string | null {
  if (!isLeadTrigger(triggerType)) return null;
  return typeof record.id === 'string' && record.id ? record.id : null;
}

/**
 * true quando a lead não autoriza automações. Usa o registo do evento e confirma o
 * estado atual na base (o registo pode já estar desatualizado quando a fila envia).
 * `lookup` tem de ler a lead só dentro da organização do evento.
 */
export async function leadAutomationBlocked(
  lookup: LeadFlagLookup, leadId: string | null, record?: Readonly<Record<string, unknown>>,
): Promise<boolean> {
  if (record?.automation_enabled === false) return true;
  if (!leadId) return false;
  const { data, error } = await lookup(leadId);
  if (error) throw new Error('Não foi possível confirmar a autorização de automações da lead');
  return data?.automation_enabled === false;
}
