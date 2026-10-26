export type EmailSignatureMode = 'new' | 'reply' | 'replyAll' | 'forward';

export interface MailboxEmailSignature {
  readonly id: string;
  readonly name: string;
  readonly html: string;
}

export interface MailboxSignatureMetadata {
  readonly signatures?: readonly MailboxEmailSignature[];
  readonly signature_default_new?: string | null;
  readonly signature_default_reply?: string | null;
}

interface ResolveEmailSignatureInput {
  readonly mode: EmailSignatureMode;
  readonly metadata: MailboxSignatureMetadata | null | undefined;
  readonly profileSignature: string | null | undefined;
}

/** The caixa's default signature for this kind of message, else the profile one ('' when none). */
export function resolveEmailSignatureSource({ mode, metadata, profileSignature }: ResolveEmailSignatureInput): string {
  const signatures = metadata?.signatures ?? [];
  const defaultSignatureId = mode === 'reply' || mode === 'replyAll'
    ? metadata?.signature_default_reply
    : metadata?.signature_default_new;
  const mailboxSignature = defaultSignatureId
    ? signatures.find((signature) => signature.id === defaultSignatureId)?.html
    : undefined;
  return mailboxSignature?.trim() || profileSignature?.trim() || '';
}

export function resolveEmailSignatureHtml(input: ResolveEmailSignatureInput): string {
  const signature = resolveEmailSignatureSource(input);
  return signature ? `<br><br><div class="senvia-signature">--<br>${signature}</div>` : '';
}
