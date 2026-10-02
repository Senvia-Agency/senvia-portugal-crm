export const emailMessageActions = ['move_to_trash', 'delete_permanently'] as const;

export type EmailMessageAction = (typeof emailMessageActions)[number];

export interface MailboxActionClient {
  mailboxOpen(path: string): Promise<unknown>;
  messageMove(uids: readonly number[], targetPath: string, options: { readonly uid: true }): Promise<MailboxMoveResult | false>;
  messageDelete(uids: readonly number[], options: { readonly uid: true }): Promise<boolean>;
}

export interface MailboxMoveResult {
  readonly uidMap?: ReadonlyMap<number, number>;
}

export interface MailboxActionInput {
  readonly action: EmailMessageAction;
  readonly sourcePath: string;
  readonly sourceIsTrash: boolean;
  readonly targetPath?: string;
  readonly uids: readonly number[];
}

export async function applyMailboxAction(
  client: MailboxActionClient,
  input: MailboxActionInput,
): Promise<ReadonlyMap<number, number> | void> {
  if (input.uids.length === 0) throw new Error('Não há mensagens para processar.');
  if (input.action === 'delete_permanently' && !input.sourceIsTrash) {
    throw new Error('A eliminação permanente só é permitida no Lixo.');
  }

  await client.mailboxOpen(input.sourcePath);

  if (input.action === 'move_to_trash') {
    if (!input.targetPath) throw new Error('A pasta Lixo não está disponível nesta conta.');
    const moved = await client.messageMove(input.uids, input.targetPath, { uid: true });
    if (!moved) throw new Error('O servidor de correio não confirmou a deslocação para o Lixo.');
    return moved.uidMap ?? new Map();
  }

  const deleted = await client.messageDelete(input.uids, { uid: true });
  if (!deleted) throw new Error('O servidor de correio não confirmou a eliminação permanente.');
}
