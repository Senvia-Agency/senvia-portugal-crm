import { z } from 'npm:zod@3.25.76';

export const draftSchema = z.object({
  suggested_reply: z.string().trim().min(1).max(2000),
  confidence: z.number().min(0).max(1),
  motivo: z.string().trim().min(1).max(500),
}).strict();
export type ReplyDraft = z.infer<typeof draftSchema>;
export interface DraftAnalysis {
  readonly branch: 'review';
  readonly draft: ReplyDraft;
  readonly variables: Readonly<Record<string, string | number>>;
}
export function draftAnalysis(value: unknown): DraftAnalysis | null {
  const parsed = draftSchema.safeParse(value);
  if (!parsed.success) return null;
  const draft = parsed.data;
  return {
    branch: 'review', draft,
    variables: {
      otto_confianca: draft.confidence,
      otto_motivo_revisao: draft.motivo,
    },
  };
}
