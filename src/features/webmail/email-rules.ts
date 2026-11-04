// Email rules of a caixa (email_rules): shape, labels and checks shared by the editor and the list.
// The gateway applies them to new Inbox mail (email-gateway/src/rules.js); the database repeats
// these checks (email_rule_shape_ok), so what the editor accepts is what gets saved.

export type RuleField = 'from' | 'to' | 'cc' | 'subject' | 'body' | 'has_attachments';
export type RuleOperator = 'contains' | 'not_contains' | 'equals' | 'starts_with' | 'ends_with';
export type RuleActionType = 'move' | 'mark_read' | 'flag' | 'archive' | 'trash' | 'spam';

export interface RuleCondition { readonly field: RuleField; readonly operator: RuleOperator; readonly value: string }
export interface RuleAction { readonly type: RuleActionType; readonly folderId?: string }

export interface EmailRule {
  readonly id: string;
  readonly channel_id: string;
  readonly name: string;
  readonly enabled: boolean;
  readonly position: number;
  readonly match_all: boolean;
  readonly conditions: readonly RuleCondition[];
  readonly actions: readonly RuleAction[];
  readonly stop_processing: boolean;
  readonly match_count: number;
  readonly last_matched_at: string | null;
}

export type RuleDraft = Pick<EmailRule, 'name' | 'match_all' | 'conditions' | 'actions' | 'stop_processing'>;

export const MAX_RULES = 50;
export const MAX_CONDITIONS = 10;
export const MAX_ACTIONS = 5;

export const FIELD_LABELS: Record<RuleField, string> = {
  from: 'Remetente', to: 'Para', cc: 'Cc', subject: 'Assunto', body: 'Texto do email', has_attachments: 'Tem anexos',
};
export const OPERATOR_LABELS: Record<RuleOperator, string> = {
  contains: 'contém', not_contains: 'não contém', equals: 'é igual a', starts_with: 'começa por', ends_with: 'acaba em',
};
export const ACTION_LABELS: Record<RuleActionType, string> = {
  move: 'Mover para a pasta', mark_read: 'Marcar como lido', flag: 'Marcar com estrela',
  archive: 'Arquivar', trash: 'Mover para o Lixo', spam: 'Marcar como spam',
};
/** Actions that take the message out of the Inbox: one per rule. */
export const DESTINATIONS: readonly RuleActionType[] = ['move', 'archive', 'trash', 'spam'];

/** Translator for the texts below (the UI passes i18n's t); by default the pt-PT text with its {{values}} filled in. */
export type Translate = (text: string, options?: Record<string, unknown>) => string;
const ptPT: Translate = (text, options) => text.replace(/\{\{(\w+)\}\}/g, (_, key: string) => String(options?.[key] ?? ''));

export const emptyCondition = (): RuleCondition => ({ field: 'from', operator: 'contains', value: '' });
export const emptyRule = (): RuleDraft => ({
  name: '', match_all: true, conditions: [emptyCondition()], actions: [{ type: 'mark_read' }], stop_processing: false,
});

/** Changing the field keeps the condition valid: "Tem anexos" only takes "é igual a" Sim/Não. */
export function withField(condition: RuleCondition, field: RuleField): RuleCondition {
  if (field === 'has_attachments') return { field, operator: 'equals', value: 'true' };
  if (condition.field === 'has_attachments') return { field, operator: 'contains', value: '' };
  return { ...condition, field };
}

/** Why the rule cannot be saved yet, or null. `folderIds` are the folders a rule may move mail to. */
export function ruleDraftError(draft: RuleDraft, folderIds: ReadonlySet<string>, t: Translate = ptPT): string | null {
  const name = draft.name.trim();
  if (!name) return t('Dê um nome à regra.');
  if (name.length > 60) return t('O nome tem no máximo 60 caracteres.');
  if (draft.conditions.length === 0) return t('Junte pelo menos uma condição.');
  if (draft.conditions.length > MAX_CONDITIONS) return t('No máximo {{n}} condições.', { n: MAX_CONDITIONS });
  for (const condition of draft.conditions) {
    const value = condition.value.trim();
    if (!value) return t('Escreva o valor da condição "{{field}}".', { field: t(FIELD_LABELS[condition.field]) });
    if (value.length > 200) return t('Cada valor tem no máximo 200 caracteres.');
  }
  if (draft.actions.length === 0) return t('Escolha pelo menos uma ação.');
  if (draft.actions.length > MAX_ACTIONS) return t('No máximo {{n}} ações.', { n: MAX_ACTIONS });
  const types = draft.actions.map(action => action.type);
  if (new Set(types).size !== types.length) return t('Cada ação só pode aparecer uma vez.');
  if (types.filter(type => DESTINATIONS.includes(type)).length > 1) return t('Um email só pode ir para uma pasta: escolha só uma de Mover, Arquivar, Lixo ou Spam.');
  const move = draft.actions.find(action => action.type === 'move');
  if (move && (!move.folderId || !folderIds.has(move.folderId))) return t('Escolha a pasta para onde mover.');
  return null;
}

/** The draft as stored: trimmed values, folder only on "move". */
export function cleanDraft(draft: RuleDraft): RuleDraft {
  return {
    name: draft.name.trim(),
    match_all: draft.match_all,
    stop_processing: draft.stop_processing,
    conditions: draft.conditions.map(condition => ({ field: condition.field, operator: condition.operator, value: condition.value.trim() })),
    actions: draft.actions.map(action => (action.type === 'move' ? { type: 'move', folderId: action.folderId } : { type: action.type })),
  };
}

function describeCondition(condition: RuleCondition, t: Translate): string {
  if (condition.field === 'has_attachments') return condition.value === 'true' ? t('tem anexos') : t('não tem anexos');
  return `${t(FIELD_LABELS[condition.field]).toLowerCase()} ${t(OPERATOR_LABELS[condition.operator])} "${condition.value}"`;
}

/** One line for the list: "Se remetente contém "x" e assunto … → Marcar como lido, Mover para "Faturas"". */
export function describeRule(rule: Pick<EmailRule, 'match_all' | 'conditions' | 'actions'>, folderName: (id: string) => string | null, t: Translate = ptPT): string {
  const joined = rule.conditions.map(condition => describeCondition(condition, t)).join(rule.match_all ? ` ${t('e')} ` : ` ${t('ou')} `);
  const actions = rule.actions.map(action => {
    if (action.type !== 'move') return t(ACTION_LABELS[action.type]);
    const name = action.folderId ? folderName(action.folderId) : null;
    return name ? t('Mover para "{{name}}"', { name }) : t('Mover para uma pasta que já não existe');
  });
  return t('Se {{conditions}} → {{actions}}', { conditions: joined, actions: actions.join(', ') });
}

/** A "move" whose folder was deleted since: the gateway skips that move. */
export function ruleHasMissingFolder(rule: Pick<EmailRule, 'actions'>, folderIds: ReadonlySet<string>): boolean {
  return rule.actions.some(action => action.type === 'move' && (!action.folderId || !folderIds.has(action.folderId)));
}
