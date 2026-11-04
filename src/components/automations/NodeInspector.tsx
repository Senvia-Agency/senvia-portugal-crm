import { useRef, useState } from 'react';
import {
  FileText, Film, Image as ImageIcon, Loader2, Plus, Trash2, Upload, X,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { SearchableCombobox } from '@/components/ui/searchable-combobox';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import {
  CONDITION_FIELD_OPTIONS, CONDITION_OPERATOR_OPTIONS, LOOKUP_OPERATORS, MESSAGE_BUFFER_DEFAULT_SECONDS,
  MESSAGE_BUFFER_MAX_SECONDS, NUMERIC_OPERATORS, SALE_STATUS_OPTIONS, TRIGGER_TYPES,
  VALUELESS_OPERATORS, WAIT_UNIT_OPTIONS, formatReplyOptions, getNodeLabel, normalizeConditionOperator,
} from '@/lib/automation-nodes';
import { TriggerPicker } from '@/components/automations/TriggerPicker';
import { ConfiguredWorkflowForm } from '@/components/automations/ConfiguredWorkflowForm';
import { useFlowVariables } from '@/components/automations/FlowIoContext';
import { createId, isJsonConfigValid, isWebhookUrlValid } from '@/lib/automation-graph';
import { VariableChips } from '@/components/automations/VariableChips';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { usePipelineStages, type PipelineStage } from '@/hooks/usePipelineStages';
import { useContactLists } from '@/hooks/useContactLists';
import { useEmailTemplates } from '@/hooks/useEmailTemplates';
import { useTeamMembers } from '@/hooks/useTeam';
import { isNativeEvolution, useMessagingChannels } from '@/hooks/useMessagingChannels';
import type {
  AutomationGraph, AutomationGraphNode, AutomationMediaAttachment, AutomationNodeConfig, AutomationNodeType,
  AutomationReentryPolicy, AutomationTriggerType, AutomationWaitUnit, ConditionOperator, WaitReplyRule,
} from '@/types/automations';
import { useLanguage } from '@/i18n';

interface NodeInspectorProps {
  node: AutomationGraphNode;
  graph: AutomationGraph;
  isEntry: boolean;
  onChange: (config: AutomationNodeConfig) => void;
  onChangeTrigger?: (type: AutomationTriggerType) => void;
  /** The flow's reentry policy, shown on message triggers as «Só uma vez por número». */
  reentry?: { policy: AutomationReentryPolicy; onChange: (policy: AutomationReentryPolicy) => void };
}

/** Triggers fired by a contact writing — where "once" means once per phone number. */
const MESSAGE_TRIGGERS: AutomationNodeType[] = ['message_received', 'whatsapp_keyword'];

/**
 * The step's settings — the middle column of NodeDetailsView. Used to be a
 * 360px panel over the canvas with its own header and delete button; those
 * now belong to the full-screen view around it.
 */
export function NodeInspector({ node, graph, isEntry, onChange, onChangeTrigger, reentry }: NodeInspectorProps) {
  const { t } = useLanguage();
  const config = node.config ?? {};
  const set = (patch: Partial<AutomationNodeConfig>) => onChange({ ...config, ...patch });

  // A legacy/system trigger (trial_*, stripe_*…) is not in the catalogue the
  // picker offers; say which one it is instead of showing nothing selected.
  const legacyTrigger = isEntry && !TRIGGER_TYPES.includes(node.type as AutomationTriggerType);

  return (
    <div className="space-y-5">
      {isEntry && onChangeTrigger && (
        <Field label="Gatilho">
          {legacyTrigger && (
            <Helper>
              {t('Gatilho atual:')} <strong>{getNodeLabel(node.type)}</strong> {t('(gatilho do sistema). Escolher outro abaixo substitui-o.')}
            </Helper>
          )}
          <TriggerPicker
            value={node.type as AutomationTriggerType}
            onChange={onChangeTrigger}
            gridClassName="sm:grid-cols-2"
          />
          <Helper>
            {t('Trocar o gatilho substitui a ligação com o resto do sistema — o fluxo deixa de responder ao anterior assim que guardar.')}
          </Helper>
        </Field>
      )}
      <NodeConfigForm node={node} config={config} graph={graph} set={set} />
      {isEntry && reentry && MESSAGE_TRIGGERS.includes(node.type) && (
        <OncePerNumberField node={node} policy={reentry.policy} onChange={reentry.onChange} />
      )}
    </div>
  );
}

/**
 * The flow's reentry policy, in the trigger where n8n would put it. On means
 * "once" (never again for this number); off means the trigger fires every
 * time and the steps after it decide who carries on. Off is
 * `after_completion`, not `always`: the engine never runs two at once for the
 * same conversation whichever is chosen, and «Depois de terminar» is what
 * Definições calls exactly that.
 */
function OncePerNumberField({ node, policy, onChange }: {
  node: AutomationGraphNode;
  policy: AutomationReentryPolicy;
  onChange: (policy: AutomationReentryPolicy) => void;
}) {
  const { t } = useLanguage();
  const once = policy === 'once';
  return (
    <div className="space-y-1.5 rounded-lg border border-border bg-background p-3">
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor="trigger-once-per-number" className="text-sm font-medium">
          {t('Só uma vez por número')}
        </Label>
        <Switch
          id="trigger-once-per-number"
          checked={once}
          onCheckedChange={(checked) => onChange(checked ? 'once' : 'after_completion')}
        />
      </div>
      <Helper>
        {once
          ? t('Cada número entra nesta automação uma vez e nunca mais, mesmo que volte a escrever daqui a um mês.')
          : node.type === 'whatsapp_keyword'
            ? t('Arranca sempre que a mensagem tiver uma das palavras-chave. Para escolher quem segue, põe uma Condição logo a seguir ao gatilho.')
            : t('Arranca sempre que a pessoa escrever. Para escolher quem segue, põe uma Condição logo a seguir ao gatilho: o ramo «Não» sem ligação termina ali.')}
      </Helper>
      <Helper>
        {t('Ligado ou desligado, nunca correm duas ao mesmo tempo para o mesmo número: enquanto uma decorre, o que a pessoa escrever fica só na Caixa de Entrada. É a mesma opção que «Quem pode voltar a entrar», em Definições.')}
      </Helper>
    </div>
  );
}

// ── Config forms ────────────────────────────────────────────────────────────

interface FormProps {
  node: AutomationGraphNode;
  graph: AutomationGraph;
  config: AutomationNodeConfig;
  set: (patch: Partial<AutomationNodeConfig>) => void;
}

function NodeConfigForm({ node, config, graph, set }: FormProps) {
  const { t } = useLanguage();
  const { data: stages } = usePipelineStages();
  const { data: lists } = useContactLists();
  const { data: templates } = useEmailTemplates();
  const { data: members } = useTeamMembers();

  // Refs for the variable chips — they insert at the field's caret position.
  const emailSubjectRef = useRef<HTMLInputElement>(null);
  const emailHtmlRef = useRef<HTMLTextAreaElement>(null);
  const taskTitleRef = useRef<HTMLInputElement>(null);
  const taskDescriptionRef = useRef<HTMLTextAreaElement>(null);

  switch (node.type) {
    // ── Triggers ──
    case 'configured_workflow':
      return <ConfiguredWorkflowForm config={config} graph={graph} set={set} />;

    case 'lead_created':
      return (
        <>
          <Hint>{t('Este fluxo arranca sempre que uma nova lead é criada na organização.')}</Hint>
          <Field label="Origem (opcional)">
            <Input
              value={(config.source as string) ?? ''}
              onChange={(e) => set({ source: e.target.value })}
              placeholder={t('Ex.: Facebook Ads')}
            />
            <Helper>{t('Deixe vazio para arrancar com leads de qualquer origem.')}</Helper>
          </Field>
        </>
      );

    case 'lead_created_hot':
    case 'lead_created_warm':
    case 'lead_created_cold':
      return (
        <Hint>
          {node.type === 'lead_created_hot'
            ? t('Arranca quando uma nova lead é classificada como quente pela IA.')
            : node.type === 'lead_created_cold'
              ? t('Arranca quando uma nova lead é classificada como fria pela IA.')
              : t('Arranca quando uma nova lead é classificada como morna pela IA.')}
          {' '}{t('A classificação usa as “Regras de Qualificação por IA” do formulário (ou da organização, consoante o modo escolhido nas definições). Sem regras configuradas, toda a lead entra como morna — os gatilhos quente/fria nunca disparam nesse caso.')}
        </Hint>
      );

    case 'lead_status_changed':
      return (
        <>
          <Field label="De (opcional)">
            <StageSelect
              value={(config.from_stage_id as string) ?? ''}
              stages={stages}
              placeholder="Qualquer etapa"
              onChange={(value) => set({ from_stage_id: value })}
            />
          </Field>
          <Field label="Para">
            <StageSelect
              value={(config.to_stage_id as string) ?? ''}
              stages={stages}
              placeholder="Qualquer etapa"
              onChange={(value) => set({ to_stage_id: value })}
            />
          </Field>
        </>
      );

    case 'form_submitted':
      return (
        <Field label="Slug do formulário">
          <Input
            value={config.form_slug ?? ''}
            onChange={(e) => set({ form_slug: e.target.value })}
            placeholder={t('Ex.: pedido-orcamento')}
          />
          <Helper>{t('Deixe vazio para reagir a qualquer formulário público.')}</Helper>
        </Field>
      );

    case 'message_received':
      return (
        <>
          <WhatsappChannelField
            config={config}
            set={set}
            label="Caixa"
            autoLabel="Qualquer caixa de WhatsApp"
            helper="Arranca quando um contacto escreve para esta caixa e não está a meio de outra automação à espera da resposta dele."
          />
          <Field label="Juntar mensagens seguidas">
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={0}
                max={MESSAGE_BUFFER_MAX_SECONDS}
                className="w-24"
                value={config.buffer_seconds ?? MESSAGE_BUFFER_DEFAULT_SECONDS}
                onChange={(e) => {
                  const seconds = Number(e.target.value);
                  set({
                    buffer_seconds: Number.isFinite(seconds)
                      ? Math.min(MESSAGE_BUFFER_MAX_SECONDS, Math.max(0, Math.round(seconds)))
                      : MESSAGE_BUFFER_DEFAULT_SECONDS,
                  });
                }}
              />
              <span className="text-sm text-muted-foreground">{t('segundos sem mensagens novas')}</span>
            </div>
            <Helper>
              {t('Quem escreve «Olá» · «tudo bem?» · «queria saber o preço» recebe uma resposta, não três: a automação espera este silêncio e arranca uma vez, com as mensagens todas em')}
              {' '}<code>{'{{mensagem_inicial}}'}</code>. {t('Com 0 arranca logo na primeira. Máximo {{max}}.', { max: MESSAGE_BUFFER_MAX_SECONDS })}
            </Helper>
          </Field>
          <Hint>
            {t('Se a mensagem tiver a palavra-chave de outra automação, ganha essa e esta não arranca.')}
          </Hint>
        </>
      );

    case 'whatsapp_keyword':
      return (
        <Field label="Palavras-chave">
          <KeywordsInput
            value={config.keywords ?? []}
            onChange={(keywords) => set({ keywords })}
          />
          <Helper>{t('Escreva e prima Enter (ou vírgula) para adicionar. A mensagem recebida só precisa de conter uma delas.')}</Helper>
        </Field>
      );

    case 'sale_status_changed':
      return (
        <Field label="Novo estado da venda">
          <Select value={config.to_status ?? ''} onValueChange={(value) => set({ to_status: value })}>
            <SelectTrigger><SelectValue placeholder={t('Escolher estado')} /></SelectTrigger>
            <SelectContent>
              {SALE_STATUS_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>{t(option.label)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      );

    case 'list_joined':
      return (
        <Field label="Lista">
          <Select value={config.list_id ?? ''} onValueChange={(value) => set({ list_id: value })}>
            <SelectTrigger><SelectValue placeholder={t('Escolher lista')} /></SelectTrigger>
            <SelectContent>
              {(lists ?? []).map((list) => (
                <SelectItem key={list.id} value={list.id}>{list.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      );

    case 'sale_renewal_due_today':
      return <Hint>{t('Este fluxo arranca no dia em que uma venda com renovação chega à data de renovar.')}</Hint>;

    case 'sale_renewal_due_in_2_days':
      return <Hint>{t('Este fluxo arranca 2 dias antes da data de renovação de uma venda.')}</Hint>;

    // ── Actions ──
    case 'send_whatsapp':
      return <WhatsappForm config={config} set={set} />;

    case 'send_email':
      return (
        <>
          {/* An org can hold dozens of templates, and their names differ by a
              word ("Trial • Dia 7" vs "Trial · Dia 7 — Diferenciadores"), so a
              plain list is the wrong tool: typing beats scrolling here. */}
          <Field label="Template">
            <SearchableCombobox
              options={(templates ?? []).map((template) => ({
                value: template.id,
                label: template.name,
              }))}
              value={config.template_id ?? null}
              onValueChange={(value) => set({ template_id: value ?? undefined })}
              placeholder={t('Escolher template')}
              searchPlaceholder={t('Pesquisar template...')}
              emptyText={t('Nenhum template com esse nome.')}
              emptyValue="__custom__"
              emptyLabel={t('Conteúdo próprio')}
            />
          </Field>

          {!config.template_id && (
            <>
              <Field label="Assunto">
                <Input
                  ref={emailSubjectRef}
                  value={config.subject ?? ''}
                  onChange={(e) => set({ subject: e.target.value })}
                  placeholder={t('Ex.: A sua proposta está pronta')}
                />
                <VariableChips
                  targetRef={emailSubjectRef}
                  value={config.subject ?? ''}
                  onChange={(subject) => set({ subject })}
                />
              </Field>
              <Field label="Conteúdo HTML">
                <Textarea
                  ref={emailHtmlRef}
                  value={config.html ?? ''}
                  onChange={(e) => set({ html: e.target.value })}
                  placeholder={t('<p>Olá {{nome}},</p>')}
                  rows={8}
                  className="font-mono text-xs"
                />
                <VariableChips
                  targetRef={emailHtmlRef}
                  value={config.html ?? ''}
                  onChange={(html) => set({ html })}
                />
              </Field>
            </>
          )}
        </>
      );

    case 'wait':
      return (
        <Field label="Esperar">
          <div className="flex gap-2">
            <Input
              type="number"
              min={1}
              className="w-24"
              value={config.duration ?? 1}
              onChange={(e) => set({ duration: Number(e.target.value) })}
            />
            <Select
              value={config.unit ?? 'hours'}
              onValueChange={(value) => set({ unit: value as AutomationWaitUnit })}
            >
              <SelectTrigger className="flex-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {WAIT_UNIT_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>{t(option.label)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </Field>
      );

    case 'wait_reply':
      return <WaitReplyForm config={config} set={set} />;

    case 'condition':
      return <ConditionForm config={config} set={set} stages={stages} />;

    case 'move_stage':
      return (
        <Field label="Mover para a etapa">
          <StageSelect
            // The engine reads `stage` (the stage KEY). Legacy configs stored
            // the stage id — resolve it so the select still shows the choice.
            value={config.stage ?? stages?.find((s) => s.id === config.stage_id)?.key ?? ''}
            stages={stages}
            by="key"
            placeholder="Escolher etapa"
            onChange={(value) => set({ stage: value })}
          />
        </Field>
      );

    case 'assign_user':
      return (
        <Field label="Atribuir a">
          <Select value={config.user_id ?? ''} onValueChange={(value) => set({ user_id: value })}>
            <SelectTrigger><SelectValue placeholder={t('Escolher utilizador')} /></SelectTrigger>
            <SelectContent>
              {(members ?? []).map((member) => (
                <SelectItem key={member.user_id} value={member.user_id}>
                  {member.full_name || member.email}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      );

    case 'add_to_list':
      return (
        <Field label="Lista">
          <Select value={config.list_id ?? ''} onValueChange={(value) => set({ list_id: value })}>
            <SelectTrigger><SelectValue placeholder={t('Escolher lista')} /></SelectTrigger>
            <SelectContent>
              {(lists ?? []).map((list) => (
                <SelectItem key={list.id} value={list.id}>{list.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      );

    case 'create_task':
      return (
        <>
          <Field label="Título da tarefa">
            <Input
              ref={taskTitleRef}
              value={config.title ?? ''}
              onChange={(e) => set({ title: e.target.value })}
              placeholder={t('Ex.: Ligar à lead')}
            />
            <VariableChips
              targetRef={taskTitleRef}
              value={config.title ?? ''}
              onChange={(title) => set({ title })}
            />
          </Field>
          <Field label="Descrição (opcional)">
            <Textarea
              ref={taskDescriptionRef}
              value={config.description ?? ''}
              onChange={(e) => set({ description: e.target.value })}
              placeholder={t('Contexto para quem vai tratar da tarefa')}
              rows={3}
            />
            <VariableChips
              targetRef={taskDescriptionRef}
              value={config.description ?? ''}
              onChange={(description) => set({ description })}
            />
          </Field>
          <Field label="Prazo (dias)">
            <Input
              type="number"
              min={0}
              value={config.due_in_days ?? 1}
              onChange={(e) => set({ due_in_days: Number(e.target.value) })}
            />
          </Field>
          <Field label="Responsável (opcional)">
            <Select
              // The engine reads `user_id`; `assigned_to` is the legacy key.
              value={config.user_id ?? config.assigned_to ?? ''}
              onValueChange={(value) => set({ user_id: value })}
            >
              <SelectTrigger><SelectValue placeholder={t('Responsável da lead')} /></SelectTrigger>
              <SelectContent>
                {(members ?? []).map((member) => (
                  <SelectItem key={member.user_id} value={member.user_id}>
                    {member.full_name || member.email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </>
      );

    case 'webhook':
      return <WebhookForm config={config} set={set} />;

    case 'end':
      return <Hint>{t('O fluxo termina aqui para este contacto. Não são executados mais passos.')}</Hint>;

    default:
      return <Hint>{t('Este passo não tem opções configuráveis.')}</Hint>;
  }
}

// ── webhook ─────────────────────────────────────────────────────────────────

/**
 * Headers and body are free text but must end up as JSON, so both are parsed on
 * every keystroke and flagged inline. Typing is never blocked — the same checks
 * run in `validateGraph`, which is what actually holds back "Ativar".
 */
function WebhookForm({ config, set }: { config: AutomationNodeConfig; set: FormProps['set'] }) {
  const { t } = useLanguage();
  const url = config.url ?? '';
  const urlInvalid = !!url.trim() && !isWebhookUrlValid(url);
  const headersInvalid = !isJsonConfigValid(config.headers);
  const bodyInvalid = !isJsonConfigValid(config.body);

  return (
    <>
      <Field label="URL">
        <Input
          value={url}
          onChange={(e) => set({ url: e.target.value })}
          placeholder={t('https://exemplo.com/hook')}
          className={cn(urlInvalid && INVALID_FIELD_CLASS)}
          aria-invalid={urlInvalid}
        />
        {urlInvalid && <FieldError>{t('Endereço inválido — comece por https://')}</FieldError>}
      </Field>
      <Field label="Método">
        <Select
          value={config.method ?? 'POST'}
          onValueChange={(value) => set({ method: value as AutomationNodeConfig['method'] })}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {['POST', 'GET', 'PUT', 'PATCH'].map((method) => (
              <SelectItem key={method} value={method}>{method}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field label="Cabeçalhos (JSON)">
        <Textarea
          value={config.headers ?? ''}
          onChange={(e) => set({ headers: e.target.value })}
          placeholder='{"Authorization": "Bearer …"}'
          rows={3}
          className={cn('font-mono text-xs', headersInvalid && INVALID_FIELD_CLASS)}
          aria-invalid={headersInvalid}
        />
        {headersInvalid && <FieldError>{t('JSON inválido')}</FieldError>}
      </Field>
      <Field label="Corpo (JSON)">
        <Textarea
          value={config.body ?? ''}
          onChange={(e) => set({ body: e.target.value })}
          placeholder='{"nome": "{{nome}}"}'
          rows={4}
          className={cn('font-mono text-xs', bodyInvalid && INVALID_FIELD_CLASS)}
          aria-invalid={bodyInvalid}
        />
        {bodyInvalid && <FieldError>{t('JSON inválido')}</FieldError>}
      </Field>
      <Helper>{t('Pode usar variáveis como {{token}} dentro dos valores.', { token: '{{nome}}' })}</Helper>
    </>
  );
}

// ── send_whatsapp ───────────────────────────────────────────────────────────

/**
 * One node carries the whole conversation: the message goes out and, when the
 * wait is on, the run parks until the contact answers — then takes the branch
 * matching what they said (button, keyword or option number). Splitting that
 * across two nodes is what people kept getting wrong, so it lives here.
 */
function WhatsappForm({ config, set }: { config: AutomationNodeConfig; set: FormProps['set'] }) {
  const { t } = useLanguage();
  const messageRef = useRef<HTMLTextAreaElement>(null);
  const waitsForReply = config.wait_reply === true;

  const toggleWait = (checked: boolean) => {
    if (!checked) {
      // Everything the wait owns goes with it — a leftover `rules` array would
      // keep phantom branches alive in the saved graph. The now-orphaned branch
      // edges are pruned by the editor in the same pass.
      set({
        wait_reply: undefined,
        rules: undefined,
        timeout_amount: undefined,
        timeout_unit: undefined,
        timeout: undefined,
      });
      return;
    }
    set({
      wait_reply: true,
      timeout_amount: config.timeout_amount ?? config.timeout?.value ?? 24,
      timeout_unit: config.timeout_unit ?? config.timeout?.unit ?? 'hours',
      timeout: undefined,
      // Seed one option so the node branches — and validates — straight away.
      rules: config.rules?.length
        ? config.rules
        : [{ id: createId('r'), label: 'Opção 1', keywords: [] }],
    });
  };

  return (
    <>
      <WhatsappChannelField config={config} set={set} />

      <Field label="Mensagem">
        <Textarea
          ref={messageRef}
          value={config.message ?? ''}
          onChange={(e) => set({ message: e.target.value })}
          placeholder={t('Olá {{nome}}, obrigado pelo seu contacto!')}
          rows={6}
        />
        <VariableChips
          targetRef={messageRef}
          value={config.message ?? ''}
          onChange={(message) => set({ message })}
        />
      </Field>

      <Field label="Anexo (opcional)">
        <WhatsappMediaField config={config} set={set} />
      </Field>

      <div className="space-y-1.5 rounded-lg border border-border bg-background p-3">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="whatsapp-wait-reply" className="text-sm font-medium">
            {t('Aguardar resposta')}
          </Label>
          <Switch
            id="whatsapp-wait-reply"
            checked={waitsForReply}
            onCheckedChange={toggleWait}
          />
        </div>
        <Helper>
          {t('O contacto responde e o fluxo segue por caminhos diferentes conforme a resposta.')}
        </Helper>
      </div>

      {waitsForReply && <ReplyRulesEditor config={config} set={set} />}
    </>
  );
}

// ── send_whatsapp: which number sends ───────────────────────────────────────

const AUTO_CHANNEL = '__auto__';

/**
 * Which WhatsApp caixa: the one a message goes out from, or — on the
 * «Mensagem recebida» trigger — the one listened to. Only caixas linked by QR
 * code: the engine sends through Evolution and only those report incoming
 * messages to it. Left on the first option, any/the first connected one.
 */
function WhatsappChannelField({
  config, set,
  label = 'Enviar pelo número',
  autoLabel = 'Automático (primeira caixa ligada)',
  helper = 'Envios automáticos têm um travão por número: 6 s entre mensagens e no máximo 200 por dia.',
}: {
  config: AutomationNodeConfig;
  set: FormProps['set'];
  label?: string;
  autoLabel?: string;
  helper?: string;
}) {
  const { t } = useLanguage();
  const { data: channels = [] } = useMessagingChannels();
  const whatsapp = channels.filter((c) => c.channel_type === 'whatsapp' && isNativeEvolution(c) && !c.archived_at);
  const chosen = typeof config.channel_id === 'string' ? config.channel_id : '';
  const chosenGone = !!chosen && !whatsapp.some((c) => c.id === chosen);
  const noneConnected = !whatsapp.some((c) => c.status === 'connected');

  return (
    <Field label={label}>
      <Select
        value={chosen || AUTO_CHANNEL}
        onValueChange={(v) => set({ channel_id: v === AUTO_CHANNEL ? undefined : v })}
      >
        <SelectTrigger className="h-9">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={AUTO_CHANNEL}>{t(autoLabel)}</SelectItem>
          {whatsapp.map((c) => (
            <SelectItem key={c.id} value={c.id}>
              {(c.label || 'WhatsApp') + (c.phone_number ? ` · +${c.phone_number}` : '')}
              {c.status !== 'connected' ? ` ${t('(desligada)')}` : ''}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {noneConnected ? (
        <FieldError>{t('Não há nenhuma caixa de WhatsApp ligada. Liga um número por QR code em Definições → Integrações.')}</FieldError>
      ) : chosenGone ? (
        <FieldError>{t('A caixa escolhida já não existe. Escolhe outra.')}</FieldError>
      ) : (
        <Helper>{t(helper)}</Helper>
      )}
    </Field>
  );
}

// ── send_whatsapp: media upload ─────────────────────────────────────────────

const MAX_MEDIA_BYTES = 16 * 1024 * 1024;

const MEDIA_KIND_ICONS = { image: ImageIcon, video: Film, document: FileText } as const;

function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.ceil(bytes / 1024))} KB`;
}

function mediaKindFromMime(mimetype: string): AutomationMediaAttachment['kind'] {
  if (mimetype.startsWith('image/')) return 'image';
  if (mimetype.startsWith('video/')) return 'video';
  return 'document';
}

/**
 * Real file upload to the `automation-media` bucket (public read; RLS requires
 * the path to start with the organization id). Replaces the old URL input —
 * the legacy `media_url` is still shown as an attachment if present.
 */
function WhatsappMediaField({ config, set }: { config: AutomationNodeConfig; set: FormProps['set'] }) {
  const { t } = useLanguage();
  const { organization } = useAuth();
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const media = config.media?.url ? config.media : undefined;
  const legacyUrl = !media && config.media_url ? String(config.media_url) : null;

  const handleFile = async (file: File) => {
    if (!organization?.id) {
      toast.error(t('Sem organização ativa'));
      return;
    }
    if (file.size > MAX_MEDIA_BYTES) {
      toast.error(t('Ficheiro demasiado grande'), { description: t('O limite do WhatsApp é 16 MB.') });
      return;
    }

    setIsUploading(true);
    try {
      // RLS requires the org id as the first path segment. Strip accents and
      // anything storage keys dislike from the file name.
      const sanitized = file.name
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^\w.-]/g, '_');
      const path = `${organization.id}/${crypto.randomUUID()}-${sanitized}`;

      const { error } = await supabase.storage
        .from('automation-media')
        .upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: false });
      if (error) throw error;

      const { data } = supabase.storage.from('automation-media').getPublicUrl(path);
      const mimetype = file.type || 'application/octet-stream';

      set({
        media: {
          url: data.publicUrl,
          path,
          mimetype,
          filename: file.name,
          kind: mediaKindFromMime(mimetype),
          size: file.size,
        },
        // The upload replaces any legacy URL.
        media_url: undefined,
      });
    } catch (error) {
      console.error('Error uploading automation media:', error);
      toast.error(t('Erro ao carregar o ficheiro'));
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleRemove = () => {
    // The file stays in storage. Messages this step already sent point at it —
    // the conversation in the Caixa de Entrada shows them from there — and
    // deleting it turned those into "a imagem já não está disponível".
    set({ media: undefined, media_url: undefined });
  };

  if (media || legacyUrl) {
    const kind = media?.kind ?? 'document';
    const KindIcon = MEDIA_KIND_ICONS[kind] ?? FileText;
    const filename = media?.filename ?? legacyUrl?.split('/').pop() ?? t('anexo');

    return (
      <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-2.5 py-2">
        <KindIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground" title={filename}>
          {filename}
        </span>
        {media?.size !== undefined && (
          <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
            {formatFileSize(media.size)}
          </span>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive"
          onClick={handleRemove}
          title={t('Remover anexo')}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    );
  }

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,video/*,application/pdf"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
        }}
      />
      <Button
        type="button"
        variant="outline"
        className="w-full"
        disabled={isUploading}
        onClick={() => fileInputRef.current?.click()}
      >
        {isUploading ? (
          <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> {t('A carregar…')}</>
        ) : (
          <><Upload className="mr-2 h-4 w-4" /> {t('Carregar ficheiro')}</>
        )}
      </Button>
      <Helper>{t('Imagem, vídeo ou PDF enviado junto com a mensagem. Máximo 16 MB.')}</Helper>
    </>
  );
}

// ── Waiting for the reply ───────────────────────────────────────────────────

/**
 * The standalone wait. Since `send_whatsapp` can now ask and wait by itself,
 * this node is for the leftover case: the question went out somewhere else
 * (an earlier step, a person, another tool) and the flow only needs to listen.
 */
function WaitReplyForm({ config, set }: { config: AutomationNodeConfig; set: FormProps['set'] }) {
  const { t } = useLanguage();
  const questionRef = useRef<HTMLTextAreaElement>(null);

  return (
    <>
      <Hint>
        {t('Este passo não envia mensagem nenhuma por si só. Para perguntar e esperar, use um passo «Enviar WhatsApp» com «Aguardar resposta» ligado.')}
      </Hint>

      <Field label="Pergunta (opcional)">
        <Textarea
          ref={questionRef}
          value={config.question ?? ''}
          onChange={(e) => set({ question: e.target.value })}
          placeholder={t('Ex.: Quer que lhe ligue para explicar?')}
          rows={4}
        />
        <VariableChips
          targetRef={questionRef}
          value={config.question ?? ''}
          onChange={(question) => set({ question })}
        />
        <Helper>
          {t('Se preencher, é enviada quando o fluxo chega aqui. Deixe vazio se a pergunta já foi feita num passo anterior.')}
        </Helper>
      </Field>

      <ReplyRulesEditor config={config} set={set} />
    </>
  );
}

/**
 * Buttons, branches and timeout — the part shared by the standalone
 * `wait_reply` node and by a `send_whatsapp` that waits for the answer. Both
 * write the same engine keys: rules / timeout_amount+unit.
 */
function ReplyRulesEditor({
  config, set,
}: {
  config: AutomationNodeConfig;
  set: FormProps['set'];
}) {
  const { t } = useLanguage();
  const rules = config.rules ?? [];
  // Engine contract: timeout_amount / timeout_unit. The nested `timeout`
  // object is a legacy shape older editors saved — read it as a fallback and
  // clear it on the first write.
  const timeoutAmount = config.timeout_amount ?? config.timeout?.value ?? 24;
  const timeoutUnit = (config.timeout_unit ?? config.timeout?.unit ?? 'hours') as AutomationWaitUnit;

  const updateTimeout = (patch: { amount?: number; unit?: AutomationWaitUnit }) => {
    set({
      timeout_amount: patch.amount ?? timeoutAmount,
      timeout_unit: patch.unit ?? timeoutUnit,
      timeout: undefined,
    });
  };

  const updateRule = (id: string, patch: Partial<WaitReplyRule>) => {
    set({ rules: rules.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)) });
  };

  const addRule = () => {
    set({
      rules: [
        ...rules,
        { id: createId('r'), label: `Opção ${rules.length + 1}`, keywords: [] },
      ],
    });
  };

  const removeRule = (id: string) => {
    set({ rules: rules.filter((rule) => rule.id !== id) });
  };

  return (
    <>
      {/*
        Havia aqui um interruptor "Enviar como botões". Foi removido: o WhatsApp
        deixou de entregar botões interativos em contas normais, e falha da pior
        maneira — a API aceita o envio e responde OK, portanto ficava registado
        como enviado e a mensagem nunca chegava a ninguém. As opções vão
        numeradas no texto e responder «1»/«2» escolhe o caminho na mesma.
      */}
      <Field label="Opções no fim da mensagem">
        <Select
          value={config.options_style ?? 'emoji'}
          onValueChange={(value) => set({ options_style: value as AutomationNodeConfig['options_style'] })}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="emoji">{t('Numeradas com emoji (1️⃣ Sim)')}</SelectItem>
            <SelectItem value="number">{t('Numeradas (1. Sim)')}</SelectItem>
            <SelectItem value="none">{t('Não mostrar — a mensagem já explica')}</SelectItem>
          </SelectContent>
        </Select>
        {(() => {
          const preview = formatReplyOptions(rules, config.options_style ?? 'emoji');
          return preview ? (
            <div className="rounded-lg border border-border bg-muted/40 px-3 py-2">
              <p className="text-[11px] font-medium text-muted-foreground">{t('Acrescentado no fim da mensagem:')}</p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">{preview}</p>
            </div>
          ) : (
            <Helper>{t('Nada é acrescentado: só sai o texto que escreveste.')}</Helper>
          );
        })()}
        <Helper>
          {t('Em qualquer caso, o contacto pode responder com o número («1», «2»…), com o nome da opção ou com uma das palavras-chave dela.')}
        </Helper>
      </Field>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t('Respostas possíveis')}
          </Label>
          <Button variant="outline" size="sm" className="h-7" onClick={addRule}>
            <Plus className="mr-1 h-3.5 w-3.5" />
            {t('Opção')}
          </Button>
        </div>

        {!rules.length && (
          <p className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
            {t('Sem opções. Adicione uma para ramificar consoante o que o contacto responder — cada opção cria um caminho próprio no fluxo.')}
          </p>
        )}

        {rules.map((rule, index) => (
          <div key={rule.id} className="space-y-2 rounded-lg border border-border bg-background p-3">
            <div className="flex items-center gap-2">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-bold text-muted-foreground">
                {index + 1}
              </span>
              <Input
                value={rule.label}
                onChange={(e) => updateRule(rule.id, { label: e.target.value })}
                placeholder={t('Texto do botão')}
                maxLength={20}
                className="h-8 flex-1"
              />
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                onClick={() => removeRule(rule.id)}
                title={t('Remover opção')}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
            <Helper>{t('É o texto do botão (máx. 20 caracteres) e o rótulo do caminho no fluxo.')}</Helper>
            <div className="space-y-1">
              <Label className="text-[11px] font-medium text-muted-foreground">{t('Palavras-chave')}</Label>
              <KeywordsInput
                value={rule.keywords ?? []}
                onChange={(keywords) => updateRule(rule.id, { keywords })}
              />
            </div>
          </div>
        ))}
      </div>

      <Field label="Se não responder em">
        <div className="flex gap-2">
          <Input
            type="number"
            min={1}
            className="w-24"
            value={timeoutAmount}
            onChange={(e) => updateTimeout({ amount: Number(e.target.value) })}
          />
          <Select
            value={timeoutUnit}
            onValueChange={(value) => updateTimeout({ unit: value as AutomationWaitUnit })}
          >
            <SelectTrigger className="flex-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              {WAIT_UNIT_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>{t(option.label)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Helper>{t('Passado este tempo sem resposta, o fluxo segue pelo caminho «Sem resposta».')}</Helper>
      </Field>
    </>
  );
}

// ── condition ───────────────────────────────────────────────────────────────

const CUSTOM_FIELD_SENTINEL = '__custom__';

function ConditionForm({
  config, set, stages,
}: {
  config: AutomationNodeConfig;
  set: FormProps['set'];
  stages: PipelineStage[] | undefined;
}) {
  const { t } = useLanguage();
  const field = config.field ?? '';
  // The fields on offer are what THIS flow carries — the trigger's record and
  // what earlier steps added (see NodeDetailsView) — not a fixed list.
  const flowFields = useFlowVariables();
  const fieldOptions = flowFields
    ? flowFields.map((item) => ({ value: item.key, label: item.label }))
    : CONDITION_FIELD_OPTIONS;
  const isKnownField = fieldOptions.some((option) => option.value === field);
  // Telefones comparam-se pelos últimos 9 dígitos, com ou sem indicativo.
  const isPhoneField = /telefone|phone|whatsapp/i.test(field);
  // "Outro campo…" stays revealed while the free-text input is empty.
  const [customFieldMode, setCustomFieldMode] = useState(() => !!field && !isKnownField);
  const showCustomInput = customFieldMode || (!!field && !isKnownField);

  const operator = normalizeConditionOperator(config.operator);
  const isValueless = VALUELESS_OPERATORS.includes(operator);
  const isNumeric = NUMERIC_OPERATORS.includes(operator);

  return (
    <>
      <Field label="Campo">
        <Select
          value={showCustomInput ? CUSTOM_FIELD_SENTINEL : field}
          onValueChange={(value) => {
            if (value === CUSTOM_FIELD_SENTINEL) {
              setCustomFieldMode(true);
              set({ field: '' });
            } else {
              setCustomFieldMode(false);
              set({ field: value });
            }
          }}
        >
          <SelectTrigger><SelectValue placeholder={t('Escolher campo')} /></SelectTrigger>
          <SelectContent>
            {fieldOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>{t(option.label)}</SelectItem>
            ))}
            <SelectItem value={CUSTOM_FIELD_SENTINEL}>{t('Outro campo…')}</SelectItem>
          </SelectContent>
        </Select>
        {showCustomInput && (
          <Input
            value={field}
            onChange={(e) => set({ field: e.target.value })}
            placeholder={t('Nome do campo (ex.: nif)')}
          />
        )}
      </Field>

      <Field label="Condição">
        <Select
          value={operator}
          onValueChange={(value) => set({ operator: value as ConditionOperator })}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {CONDITION_OPERATOR_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>{t(option.label)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {LOOKUP_OPERATORS.includes(operator) && (
          isPhoneField || /email/i.test(field) ? (
            <Helper>
              {isPhoneField
                ? t('Procura este telefone (os últimos 9 dígitos, por isso «+351», espaços e traços não contam) na base de dados da organização.')
                : t('Procura este email na base de dados da organização.')}
              {' '}{t('Quando existe, os passos seguintes podem usar {{a}}, {{b}} e {{c}}.', { a: '{{cliente_nome}}', b: '{{lead_nome}}', c: '{{encontrado_em}}' })}
            </Helper>
          ) : (
            <FieldError>{t('Escolhe o campo Telefone ou Email: é por eles que o contacto é procurado.')}</FieldError>
          )
        )}
      </Field>

      {!isValueless && (
        <Field label="Valor">
          {field === 'status' && !isNumeric ? (
            <StageSelect
              value={config.value ?? ''}
              stages={stages}
              by="key"
              placeholder="Escolher etapa"
              onChange={(value) => set({ value })}
            />
          ) : (
            <Input
              type={isNumeric ? 'number' : 'text'}
              value={config.value ?? ''}
              onChange={(e) => set({ value: e.target.value })}
              placeholder={isNumeric ? '0' : isPhoneField ? '912 345 678' : t('Valor a comparar')}
            />
          )}
          {isPhoneField && !isValueless && (
            <Helper>
              {t('Compara os últimos 9 dígitos: «+351 912 345 678», «912345678» e «351912345678» contam como o mesmo número.')}
            </Helper>
          )}
        </Field>
      )}

      <Hint>
        {t('O fluxo segue pelo ramo')} <strong>{t('Sim')}</strong> {t('quando a condição se verifica e por')}{' '}
        <strong>{t('Não')}</strong> {t('caso contrário.')}
      </Hint>
    </>
  );
}

// ── Small building blocks ───────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  const { t } = useLanguage();
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {t(label)}
      </Label>
      {children}
    </div>
  );
}

function Helper({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] leading-snug text-muted-foreground">{children}</p>;
}

/** Red outline paired with `FieldError` for inline validation. */
const INVALID_FIELD_CLASS = 'border-destructive focus-visible:ring-destructive';

function FieldError({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] font-medium leading-snug text-destructive">{children}</p>;
}

function Hint({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-lg bg-muted/60 p-3 text-xs leading-relaxed text-muted-foreground">
      {children}
    </p>
  );
}

function StageSelect({
  value, stages, placeholder, onChange, by = 'id',
}: {
  value: string;
  stages: PipelineStage[] | undefined;
  placeholder: string;
  onChange: (value: string) => void;
  /** Which stage property backs the option value — ids for trigger configs, keys for the engine. */
  by?: 'id' | 'key';
}) {
  const { t } = useLanguage();
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger><SelectValue placeholder={t(placeholder)} /></SelectTrigger>
      <SelectContent>
        {(stages ?? []).map((stage) => (
          <SelectItem key={stage.id} value={by === 'key' ? stage.key : stage.id}>
            {stage.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * Tag-style keyword editor: Enter or comma adds a chip, Backspace on an empty
 * input removes the last one.
 */
function KeywordsInput({
  value, onChange, className,
}: {
  value: string[];
  onChange: (value: string[]) => void;
  className?: string;
}) {
  const { t } = useLanguage();
  const [draft, setDraft] = useState('');

  const commitDraft = (raw: string) => {
    const parts = raw
      .split(',')
      .map((keyword) => keyword.trim())
      .filter(Boolean)
      .filter((keyword) => !value.includes(keyword));
    if (parts.length) onChange([...value, ...parts]);
    setDraft('');
  };

  return (
    <div
      className={cn(
        'flex min-h-9 flex-wrap items-center gap-1.5 rounded-md border border-input bg-background px-2 py-1.5',
        'focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background',
        className,
      )}
    >
      {value.map((keyword) => (
        <span
          key={keyword}
          className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-foreground"
        >
          {keyword}
          <button
            type="button"
            className="text-muted-foreground transition-colors hover:text-destructive"
            onClick={() => onChange(value.filter((k) => k !== keyword))}
            title={t('Remover {{name}}', { name: keyword })}
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            commitDraft(draft);
          } else if (e.key === 'Backspace' && !draft && value.length) {
            onChange(value.slice(0, -1));
          }
        }}
        onBlur={() => draft.trim() && commitDraft(draft)}
        placeholder={value.length ? '' : t('sim, quero, interessado')}
        className="min-w-[80px] flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground"
      />
    </div>
  );
}
