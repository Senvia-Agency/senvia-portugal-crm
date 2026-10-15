import { z } from 'zod';

const address = z.object({ name: z.string().optional(), address: z.string() });
export const emailRecoverySchema = z.object({
  id: z.string(), savedDraftId: z.string().nullable(),
  to: z.array(address), cc: z.array(address), bcc: z.array(address),
  subject: z.string(), bodyHtml: z.string(),
  inReplyTo: z.string().nullable(), replyMessageId: z.string().nullable(),
});
type RecoveryAddress = { readonly name: string; readonly address: string };
export type EmailRecovery = {
  readonly id: string; readonly savedDraftId: string | null;
  readonly to: RecoveryAddress[]; readonly cc: RecoveryAddress[]; readonly bcc: RecoveryAddress[];
  readonly subject: string; readonly bodyHtml: string;
  readonly inReplyTo: string | null; readonly replyMessageId: string | null;
};
const recoveryList = z.array(emailRecoverySchema);

// Per-tab recovery avoids exposing another signed-in user's drafts. No messages are sent here.
function read(key: string): string | null {
  try { return window.sessionStorage.getItem(key); }
  catch (error) { console.warn('[Inbox draft] Recovery storage unavailable', error instanceof Error ? error.name : 'unknown'); return null; }
}
function write(key: string, value: string | null): boolean {
  try {
    if (value === null) window.sessionStorage.removeItem(key);
    else window.sessionStorage.setItem(key, value);
    return true;
  } catch (error) {
    console.warn('[Inbox draft] Could not protect draft', error instanceof Error ? error.name : 'unknown');
    return false;
  }
}
export function readMessageDraft(scope: string, conversation: string): string {
  return read(`senvia:message-draft:${scope}:${conversation}`) ?? '';
}
export function writeMessageDraft(scope: string, conversation: string, text: string): boolean {
  return write(`senvia:message-draft:${scope}:${conversation}`, text || null);
}
export function readEmailRecoveries(scope: string, channel: string): EmailRecovery[] {
  const raw = read(`senvia:email-recovery:${scope}:${channel}`);
  if (!raw) return [];
  try {
    const result = recoveryList.safeParse(JSON.parse(raw));
    if (!result.success) return [];
    // This project's non-strictNullChecks config makes Zod fields appear optional.
    const addresses = (items: z.infer<typeof address>[] = []): RecoveryAddress[] => items.map(item => ({ address: item.address ?? '', name: item.name ?? '' }));
    return result.data.map(item => ({ id: item.id ?? '', savedDraftId: item.savedDraftId ?? null,
      to: addresses(item.to), cc: addresses(item.cc), bcc: addresses(item.bcc),
      subject: item.subject ?? '', bodyHtml: item.bodyHtml ?? '',
      inReplyTo: item.inReplyTo ?? null, replyMessageId: item.replyMessageId ?? null }));
  } catch (error) {
    console.warn('[Inbox draft] Invalid recovery record', error instanceof Error ? error.name : 'unknown');
    return [];
  }
}
export function writeEmailRecovery(scope: string, channel: string, draft: EmailRecovery): boolean {
  const drafts = readEmailRecoveries(scope, channel).filter(item => item.id !== draft.id);
  return write(`senvia:email-recovery:${scope}:${channel}`, JSON.stringify([...drafts, draft]));
}
export function removeEmailRecovery(scope: string, channel: string, id: string): boolean {
  const drafts = readEmailRecoveries(scope, channel).filter(item => item.id !== id);
  return write(`senvia:email-recovery:${scope}:${channel}`, drafts.length ? JSON.stringify(drafts) : null);
}
