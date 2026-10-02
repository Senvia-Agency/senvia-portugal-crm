export type MetaMessageSendPlan<TAttachment> =
  | {
      readonly kind: 'attachment';
      readonly attachment: TAttachment;
      readonly caption: string | null;
      readonly replyToMid: string | null;
    }
  | {
      readonly kind: 'text';
      readonly text: string;
      readonly replyToMid: string | null;
    };

interface CreateMetaMessageSendPlanInput<TAttachment> {
  readonly attachments: readonly TAttachment[];
  readonly text: string;
  readonly replyToMid: string | null;
}

export function createMetaMessageSendPlan<TAttachment>({
  attachments,
  text,
  replyToMid,
}: CreateMetaMessageSendPlanInput<TAttachment>): readonly MetaMessageSendPlan<TAttachment>[] {
  const message = text.trim();

  if (attachments.length === 0) {
    return message ? [{ kind: 'text', text: message, replyToMid }] : [];
  }

  return attachments.map((attachment, index) => ({
    kind: 'attachment' as const,
    attachment,
    caption: index === 0 && message ? message : null,
    replyToMid: index === 0 ? replyToMid : null,
  }));
}
