import { useMemo, useState } from 'react';
import { AlertTriangle, ArrowDown, ArrowUp, ListFilter, Loader2, Pencil, Plus, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { intlLocale, useLanguage } from '@/i18n';
import {
  ACTION_LABELS, DESTINATIONS, FIELD_LABELS, MAX_ACTIONS, MAX_CONDITIONS, MAX_RULES, OPERATOR_LABELS, cleanDraft, describeRule,
  emptyCondition, emptyRule, ruleDraftError, ruleHasMissingFolder, withField,
  type EmailRule, type RuleAction, type RuleActionType, type RuleCondition, type RuleDraft, type RuleField, type RuleOperator,
} from './email-rules';
import { describeWebmailError } from './webmail-api';
import { useMailRuleActions, useMailRules } from './useWebmail';
import { isSubfolderOf, type MailAccount, type WebmailFolder } from './webmail-model';

interface FolderOption { readonly id: string; readonly name: string; readonly depth: number }

/** "Mover para" offers the caixa's own folders; Arquivo, Spam and Lixo have their own actions. */
function moveTargets(folders: readonly WebmailFolder[], channelId: string): FolderOption[] {
  const custom = folders.filter(folder => folder.channel_id === channelId && folder.role === 'custom')
    .sort((a, b) => a.path.localeCompare(b.path, 'pt'));
  return custom.map(folder => ({ id: folder.id, name: folder.name, depth: custom.filter(other => isSubfolderOf(folder, other)).length }));
}

const when = (value: string) => new Date(value).toLocaleString(intlLocale(), { dateStyle: 'short', timeStyle: 'short' });

export function MailRulesPanel({ account, folders }: { account: MailAccount; folders: readonly WebmailFolder[] }) {
  const rules = useMailRules(account.id);
  const { t } = useLanguage();
  const actions = useMailRuleActions(account.id);
  const targets = useMemo(() => moveTargets(folders, account.id), [folders, account.id]);
  const targetIds = useMemo(() => new Set(targets.map(target => target.id)), [targets]);
  const folderName = (id: string) => targets.find(target => target.id === id)?.name ?? null;
  const [editing, setEditing] = useState<{ id: string | null; draft: RuleDraft } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const list = rules.data ?? [];

  const fail = (title: string) => (error: unknown) => toast.error(title, { description: describeWebmailError(error) });
  const move = (index: number, step: -1 | 1) => {
    const ids = list.map(rule => rule.id);
    [ids[index], ids[index + step]] = [ids[index + step], ids[index]];
    actions.reorder.mutate(ids, { onError: fail(t('Não foi possível mudar a ordem')) });
  };

  if (rules.error) return <p role="alert" className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{describeWebmailError(rules.error)}</p>;
  if (rules.isLoading) return <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label={t('A carregar')} />;

  if (editing) return <RuleEditor key={editing.id ?? 'new'} initial={editing.draft} targets={targets} targetIds={targetIds}
    saving={actions.create.isPending || actions.update.isPending}
    onCancel={() => setEditing(null)}
    onSave={draft => {
      const done = { onSuccess: () => { toast.success(t('Regra guardada')); setEditing(null); }, onError: fail(t('Não foi possível guardar a regra')) };
      if (editing.id) actions.update.mutate({ id: editing.id, patch: draft }, done);
      else actions.create.mutate({ position: Math.min(1000, list.reduce((last, rule) => Math.max(last, rule.position + 1), 0)), draft }, done);
    }} />;

  const full = list.length >= MAX_RULES;
  return <div className="space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <p className="max-w-xl text-sm text-muted-foreground">
        {t('As regras atuam em cada email novo que chega à Entrada desta caixa, pela ordem da lista. Os emails que já lá estão não mudam.')}
        {' '}{t('São da caixa: valem para toda a equipa que a usa e guardam-se logo.')}
      </p>
      {list.length > 0 && <Button className="rounded-full" disabled={full} onClick={() => setEditing({ id: null, draft: emptyRule() })}>
        <Plus className="mr-2 h-4 w-4" />{t('Nova regra')}
      </Button>}
    </div>
    {full && <p className="text-xs text-muted-foreground">{t('Esta caixa já tem {{n}} regras, o máximo.', { n: MAX_RULES })}</p>}

    {list.length === 0 ? <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed p-10 text-center">
      <ListFilter className="h-8 w-8 text-primary" aria-hidden="true" />
      <p className="text-sm text-muted-foreground">{t('Ainda não há regras nesta caixa. Por exemplo: mover para a pasta "Faturas" os emails cujo assunto contém "fatura".')}</p>
      <Button className="rounded-full" onClick={() => setEditing({ id: null, draft: emptyRule() })}><Plus className="mr-2 h-4 w-4" />{t('Criar regra')}</Button>
    </div> : <ol className="space-y-2" aria-label={t('Regras, pela ordem em que se aplicam')}>
      {list.map((rule, index) => {
        const missing = ruleHasMissingFolder(rule, targetIds);
        return <li key={rule.id} className={cn('rounded-2xl border p-4', !rule.enabled && 'bg-muted/40')}>
          <div className="flex items-start gap-3">
            <Switch checked={rule.enabled} className="mt-0.5" aria-label={rule.enabled ? t('Desligar a regra {{name}}', { name: rule.name }) : t('Ligar a regra {{name}}', { name: rule.name })}
              disabled={actions.update.isPending}
              onCheckedChange={enabled => actions.update.mutate({ id: rule.id, patch: { enabled } }, { onError: fail(t('Não foi possível mudar a regra')) })} />
            <div className="min-w-0 flex-1">
              <p className={cn('truncate text-sm font-medium', !rule.enabled && 'text-muted-foreground')}>{rule.name}</p>
              <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{describeRule(rule, folderName, t)}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {rule.match_count > 0 ? `${t(rule.match_count === 1 ? 'Atuou {{n}} vez' : 'Atuou {{n}} vezes', { n: rule.match_count })}${rule.last_matched_at ? ` · ${t('última {{when}}', { when: when(rule.last_matched_at) })}` : ''}` : t('Ainda não atuou')}
                {rule.stop_processing && ` · ${t('para aqui')}`}
              </p>
              {missing && <p className="mt-1 flex items-center gap-1.5 text-xs text-amber-600">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />{t('A pasta desta regra já não existe: edite-a para escolher outra.')}
              </p>}
            </div>
            <div className="flex shrink-0 items-center">
              <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full" disabled={index === 0 || actions.reorder.isPending} aria-label={t('Subir')} onClick={() => move(index, -1)}><ArrowUp className="h-4 w-4" /></Button>
              <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full" disabled={index === list.length - 1 || actions.reorder.isPending} aria-label={t('Descer')} onClick={() => move(index, 1)}><ArrowDown className="h-4 w-4" /></Button>
              <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full" aria-label={t('Editar a regra {{name}}', { name: rule.name })} onClick={() => setEditing({ id: rule.id, draft: toDraft(rule) })}><Pencil className="h-4 w-4" /></Button>
              <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full text-destructive hover:text-destructive" aria-label={t('Apagar a regra {{name}}', { name: rule.name })} onClick={() => setConfirmDelete(rule.id)}><Trash2 className="h-4 w-4" /></Button>
            </div>
          </div>
          {confirmDelete === rule.id && <div className="mt-3 flex flex-wrap items-center justify-end gap-2 rounded-xl bg-destructive/5 p-3 text-sm" role="alert">
            <span className="mr-auto">{t('Apagar a regra "{{name}}"? Os emails não mudam.', { name: rule.name })}</span>
            <Button variant="outline" size="sm" className="rounded-full" onClick={() => setConfirmDelete(null)}>{t('Cancelar')}</Button>
            <Button size="sm" className="rounded-full bg-destructive text-destructive-foreground hover:bg-destructive/90" disabled={actions.remove.isPending}
              onClick={() => actions.remove.mutate(rule.id, { onSuccess: () => { toast.success(t('Regra apagada')); setConfirmDelete(null); }, onError: fail(t('Não foi possível apagar a regra')) })}>
              {t('Apagar')}
            </Button>
          </div>}
        </li>;
      })}
    </ol>}
  </div>;
}

const toDraft = (rule: EmailRule): RuleDraft => ({
  name: rule.name, match_all: rule.match_all, stop_processing: rule.stop_processing, conditions: rule.conditions, actions: rule.actions,
});

function RuleEditor({ initial, targets, targetIds, saving, onCancel, onSave }: {
  initial: RuleDraft; targets: readonly FolderOption[]; targetIds: ReadonlySet<string>; saving: boolean;
  onCancel: () => void; onSave: (draft: RuleDraft) => void;
}) {
  const { t } = useLanguage();
  const [draft, setDraft] = useState<RuleDraft>(initial);
  const [tried, setTried] = useState(false);
  const error = ruleDraftError(draft, targetIds, t);
  const patch = (next: Partial<RuleDraft>) => setDraft(current => ({ ...current, ...next }));
  const setCondition = (index: number, next: RuleCondition) => patch({ conditions: draft.conditions.map((condition, at) => (at === index ? next : condition)) });
  const setAction = (index: number, next: RuleAction) => patch({ actions: draft.actions.map((action, at) => (at === index ? next : action)) });
  // Each action once, and one destination per rule: the menu only offers what still fits.
  const available = (index: number) => {
    const others = draft.actions.filter((_, at) => at !== index).map(action => action.type);
    const hasDestination = others.some(type => DESTINATIONS.includes(type));
    return (Object.keys(ACTION_LABELS) as RuleActionType[]).filter(type => !others.includes(type) && !(hasDestination && DESTINATIONS.includes(type)));
  };
  const nextAction = available(draft.actions.length)[0];

  return <form className="space-y-6" onSubmit={event => { event.preventDefault(); setTried(true); if (!error) onSave(cleanDraft(draft)); }}>
    <div className="space-y-1.5">
      <Label htmlFor="rule-name">{t('Nome da regra')}</Label>
      <Input id="rule-name" value={draft.name} maxLength={60} placeholder={t('Ex.: Faturas de fornecedores')} autoFocus onChange={event => patch({ name: event.target.value })} />
    </div>

    <fieldset className="space-y-3">
      <legend className="mb-2 flex flex-wrap items-center gap-2 text-sm font-medium">
        {t('Quando chega um email que cumpre')}
        <Select value={draft.match_all ? 'all' : 'any'} onValueChange={value => patch({ match_all: value === 'all' })}>
          <SelectTrigger className="h-8 w-auto rounded-full" aria-label={t('Todas ou qualquer uma das condições')}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('todas as condições')}</SelectItem>
            <SelectItem value="any">{t('qualquer uma das condições')}</SelectItem>
          </SelectContent>
        </Select>
      </legend>
      {draft.conditions.map((condition, index) => <div key={index} className="grid gap-2 rounded-2xl border p-3 sm:grid-cols-[10rem_9rem_minmax(0,1fr)_auto] sm:items-center sm:border-0 sm:p-0">
        <Select value={condition.field} onValueChange={value => setCondition(index, withField(condition, value as RuleField))}>
          <SelectTrigger aria-label={t('Campo da condição {{n}}', { n: index + 1 })}><SelectValue /></SelectTrigger>
          <SelectContent>{(Object.keys(FIELD_LABELS) as RuleField[]).map(field => <SelectItem key={field} value={field}>{t(FIELD_LABELS[field])}</SelectItem>)}</SelectContent>
        </Select>
        {condition.field === 'has_attachments' ? <>
          <span className="hidden text-sm text-muted-foreground sm:block">{t('é')}</span>
          <Select value={condition.value} onValueChange={value => setCondition(index, { ...condition, value })}>
            <SelectTrigger aria-label={t('Tem anexos, condição {{n}}', { n: index + 1 })}><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="true">{t('Sim')}</SelectItem><SelectItem value="false">{t('Não')}</SelectItem></SelectContent>
          </Select>
        </> : <>
          <Select value={condition.operator} onValueChange={value => setCondition(index, { ...condition, operator: value as RuleOperator })}>
            <SelectTrigger aria-label={t('Comparação da condição {{n}}', { n: index + 1 })}><SelectValue /></SelectTrigger>
            <SelectContent>{(Object.keys(OPERATOR_LABELS) as RuleOperator[]).map(operator => <SelectItem key={operator} value={operator}>{t(OPERATOR_LABELS[operator])}</SelectItem>)}</SelectContent>
          </Select>
          <Input value={condition.value} maxLength={200} aria-label={t('Valor da condição {{n}}', { n: index + 1 })}
            placeholder={condition.field === 'from' ? t('Ex.: @fornecedor.pt') : condition.field === 'subject' ? t('Ex.: fatura') : ''}
            onChange={event => setCondition(index, { ...condition, value: event.target.value })} />
        </>}
        <Button type="button" variant="ghost" size="icon" className="h-9 w-9 justify-self-end rounded-full" disabled={draft.conditions.length === 1}
          aria-label={t('Tirar a condição {{n}}', { n: index + 1 })} onClick={() => patch({ conditions: draft.conditions.filter((_, at) => at !== index) })}><X className="h-4 w-4" /></Button>
      </div>)}
      <Button type="button" variant="ghost" size="sm" className="rounded-full text-primary" disabled={draft.conditions.length >= MAX_CONDITIONS}
        onClick={() => patch({ conditions: [...draft.conditions, emptyCondition()] })}><Plus className="mr-2 h-4 w-4" />{t('Juntar condição')}</Button>
    </fieldset>

    <fieldset className="space-y-3">
      <legend className="mb-2 text-sm font-medium">{t('Fazer isto')}</legend>
      {draft.actions.map((action, index) => <div key={index} className="grid gap-2 rounded-2xl border p-3 sm:grid-cols-[14rem_minmax(0,1fr)_auto] sm:items-center sm:border-0 sm:p-0">
        <Select value={action.type} onValueChange={value => setAction(index, { type: value as RuleActionType })}>
          <SelectTrigger aria-label={t('Ação {{n}}', { n: index + 1 })}><SelectValue /></SelectTrigger>
          <SelectContent>{available(index).map(type => <SelectItem key={type} value={type}>{t(ACTION_LABELS[type])}</SelectItem>)}</SelectContent>
        </Select>
        {action.type === 'move' ? (targets.length === 0
          ? <p className="text-xs text-muted-foreground">{t('Ainda não há pastas nesta caixa. Crie uma em "Pastas", na barra lateral do email.')}</p>
          : <Select value={action.folderId ?? ''} onValueChange={folderId => setAction(index, { type: 'move', folderId })}>
            <SelectTrigger aria-label={t('Pasta de destino')}><SelectValue placeholder={t('Escolha a pasta')} /></SelectTrigger>
            <SelectContent>{targets.map(target => <SelectItem key={target.id} value={target.id}>{' '.repeat(target.depth)}{target.name}</SelectItem>)}</SelectContent>
          </Select>) : <span className="hidden sm:block" />}
        <Button type="button" variant="ghost" size="icon" className="h-9 w-9 justify-self-end rounded-full" disabled={draft.actions.length === 1}
          aria-label={t('Tirar a ação {{n}}', { n: index + 1 })} onClick={() => patch({ actions: draft.actions.filter((_, at) => at !== index) })}><X className="h-4 w-4" /></Button>
      </div>)}
      <Button type="button" variant="ghost" size="sm" className="rounded-full text-primary" disabled={draft.actions.length >= MAX_ACTIONS || !nextAction}
        onClick={() => nextAction && patch({ actions: [...draft.actions, { type: nextAction }] })}><Plus className="mr-2 h-4 w-4" />{t('Juntar ação')}</Button>
    </fieldset>

    <label className="flex items-start gap-3 rounded-2xl border p-4">
      <Checkbox checked={draft.stop_processing} onCheckedChange={value => patch({ stop_processing: value === true })} className="mt-0.5" />
      <span><span className="block text-sm font-medium">{t('Parar aqui')}</span>
        <span className="block text-xs text-muted-foreground">{t('Quando esta regra atua, as regras seguintes não se aplicam a esse email.')}</span></span>
    </label>

    {tried && error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <div className="flex justify-end gap-2">
      <Button type="button" variant="outline" className="rounded-full" disabled={saving} onClick={onCancel}>{t('Cancelar')}</Button>
      <Button type="submit" className="rounded-full" disabled={saving}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{t('Guardar regra')}</Button>
    </div>
  </form>;
}
