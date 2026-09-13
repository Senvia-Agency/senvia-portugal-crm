export interface RecipientSuggestion {
  name: string;
  address: string;
  source: 'crm' | 'recent' | 'sent';
}

interface SentRecipients {
  to_addresses?: unknown;
  cc_addresses?: unknown;
  bcc_addresses?: unknown;
  date?: string | null;
}

/** Accept only structured mailbox addresses; malformed historical payloads are ignored. */
function addresses(value: unknown): Array<{ name: string; address: string }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap(item => {
    if (!item || typeof item.address !== 'string') return [];
    const address = item.address.trim().toLowerCase();
    if (!/^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(address)) return [];
    return [{ address, name: typeof item.name === 'string' ? item.name.trim() : '' }];
  });
}

export function buildRecipientHistory(rows: SentRecipients[]): RecipientSuggestion[] {
  const result = new Map<string, RecipientSuggestion>();
  const sorted = [...rows].sort((a, b) => (Date.parse(b.date || '') || 0) - (Date.parse(a.date || '') || 0));
  for (const row of sorted) {
    for (const item of [...addresses(row.to_addresses), ...addresses(row.cc_addresses), ...addresses(row.bcc_addresses)]) {
      const previous = result.get(item.address);
      if (!previous) result.set(item.address, { ...item, name: item.name || item.address, source: 'sent' });
      else if (previous.name === previous.address && item.name) previous.name = item.name;
    }
  }
  return [...result.values()];
}

/** One bounded, body-free read shared by all three composer inputs. RLS still applies. */
export async function loadRecipientHistory(
  db: { from: (table: string) => any },
  organizationId: string,
  channelId: string,
  userId: string,
): Promise<RecipientSuggestion[]> {
  const [messages, commands] = await Promise.all([
    db.from('email_messages')
      .select('to_addresses, cc_addresses, date, email_folders!inner(role)')
      .eq('organization_id', organizationId).eq('channel_id', channelId)
      .eq('email_folders.role', 'sent').order('date', { ascending: false }).limit(1000),
    // Bcc history is personal: never suggest another mailbox member's hidden recipients.
    db.from('email_commands')
      .select('to_addresses:payload->to, cc_addresses:payload->cc, bcc_addresses:payload->bcc, date:created_at')
      .eq('organization_id', organizationId).eq('channel_id', channelId)
      .eq('created_by', userId).eq('type', 'send').eq('status', 'done')
      .order('created_at', { ascending: false }).limit(1000),
  ]);
  if (messages.error) throw messages.error;
  if (commands.error) throw commands.error;
  return buildRecipientHistory([...(messages.data || []), ...(commands.data || [])]);
}

export function matchRecipients(term: string, history: RecipientSuggestion[], contacts: RecipientSuggestion[]): RecipientSuggestion[] {
  const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const search = normalize(term.trim());
  if (search.length < 2) return [];
  const result = new Map<string, RecipientSuggestion>();
  for (const item of [...history, ...contacts]) {
    const address = item.address.trim().toLowerCase();
    if (!normalize(`${item.name} ${address}`).includes(search)) continue;
    const previous = result.get(address);
    if (!previous) result.set(address, { ...item, address });
    else if (previous.name === previous.address && item.name !== item.address) previous.name = item.name;
  }
  return [...result.values()].slice(0, 8);
}
