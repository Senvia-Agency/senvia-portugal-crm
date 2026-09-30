import { useRef, useState } from 'react';
import {
  FileText, Film, HelpCircle, Image as ImageIcon, Loader2, Plus, Trash2, Upload, X,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { SearchableCombobox } from '@/components/ui/searchable-combobox';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import {
  CONDITION_FIELD_OPTIONS, CONDITION_OPERATOR_OPTIONS, NUMERIC_OPERATORS,
  SALE_STATUS_OPTIONS, TRIGGER_TYPES, VALUELESS_OPERATORS, WAIT_UNIT_OPTIONS,
  getNodeDefinition, getNodeStyle, humanizeNodeType, normalizeConditionOperator,
} from '@/lib/automation-nodes';
import { createId, isJsonConfigValid, isWebhookUrlValid } from '@/lib/automation-graph';
import { VariableChips } from '@/components/automations/VariableChips';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { usePipelineStages, type PipelineStage } from '@/hooks/usePipelineStages';
import { useContactLists } from '@/hooks/useContactLists';
import { useEmailTemplates } from '@/hooks/useEmailTemplates';
import { useTeamMembers } from '@/hooks/useTeam';
import type {
  AutomationGraphNode, AutomationMediaAttachment, AutomationNodeConfig,
  AutomationTriggerType, AutomationWaitUnit, ConditionOperator, WaitReplyRule,
} from '@/types/automations';

interface NodeInspectorProps {
  node: AutomationGraphNode;
  isEntry: boolean;
  onChange: (config: AutomationNodeConfig) => void;
  onChangeTrigger?: (type: AutomationTriggerType) => void;
  onDelete: () => void;
  onClose: () => void;
}

/** Right-hand configuration panel for the selected node. */
export function NodeInspector({
  node, isEntry, onChange, onChangeTrigger, onDelete, onClose,
}: NodeInspectorProps) {
  const definition = getNodeDefinition(node.type);
  const style = getNodeStyle(node.type);
  const Icon = definition?.icon ?? HelpCircle;
  const config = node.config ?? {};

  const set = (patch: Partial<AutomationNodeConfig>) => onChange({ ...config, ...patch });

  // The entry node's own type IS the flow's trigger — offer the same curated
  // list CreateFlowDialog uses. A legacy/system trigger (trial_*, stripe_*…)
  // outside that list is kept as the current selection instead of vanishing.
  const triggerOptions = TRIGGER_TYPES.includes(node.type as AutomationTriggerType)
    ? TRIGGER_TYPES
    : [node.type as AutomationTriggerType, ...TRIGGER_TYPES];

  return (
    <aside
      className={cn(
        'absolute inset-y-0 right-0 z-10 flex w-full flex-col border-l border-border bg-card',
        'shadow-lg sm:w-[360px]',
      )}
    >
      <div className="flex items-start gap-3 border-b border-border p-4">
        <span
          className={cn(
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-full ring-[2.5px]',
            style.bg,
            style.ring,
          )}
        >
          <Icon className={cn('h-5 w-5', style.icon)} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground">
            {definition?.label ?? humanizeNodeType(node.type)}
          </p>
          <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{definition?.description}</p>
        </div>
        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="space-y-4 p-4">
          {isEntry && onChangeTrigger && (
            <Field label="Gatilho">
              <Select
                value={node.type}
                onValueChange={(value) => onChangeTrigger(value as AutomationTriggerType)}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {triggerOptions.map((type) => (
                    <SelectItem key={type} value={type}>
                      {getNodeDefinition(type)?.label ?? humanizeNodeType(type)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Helper>
                Trocar o gatilho substitui a ligação com o resto do sistema — o fluxo deixa de
                responder ao anterior assim que guardar.
              </Helper>
            </Field>
          )}
          <NodeConfigForm node={node} config={config} set={set} />
        </div>
      </ScrollArea>

      {!isEntry && (
        <div className="border-t border-border p-4">
          <Button variant="outline" className="w-full text-destructive hover:text-destructive" onClick={onDelete}>
            <Trash2 className="mr-2 h-4 w-4" />
            Eliminar passo
          </Button>
        </div>
      )}
    </aside>
  );
}

// ── Config forms ────────────────────────────────────────────────────────────

interface FormProps {
  node: AutomationGraphNode;
  config: AutomationNodeConfig;
  set: (patch: Partial<AutomationNodeConfig>) => void;
}

function NodeConfigForm({ node, config, set }: FormProps) {
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
    case 'lead_created':
      return (
        <>
          <Hint>Este fluxo arranca sempre que uma nova lead é criada na organização.</Hint>
          <Field label="Origem (opcional)">
            <Input
              value={(config.source as string) ?? ''}
              onChange={(e) => set({ source: e.target.value })}
              placeholder="Ex.: Facebook Ads"
            />
            <Helper>Deixe vazio para arrancar com leads de qualquer origem.</Helper>
          </Field>
        </>
      );

    case 'lead_created_hot':
    case 'lead_created_warm':
    case 'lead_created_cold':
      return (
        <Hint>
          Arranca quando uma nova lead é classificada como {' '}
          {node.type === 'lead_created_hot' ? 'quente' : node.type === 'lead_created_cold' ? 'fria' : 'morna'}
          {' '}pela IA. A classificação usa as &ldquo;Regras de Qualificação por IA&rdquo; do formulário (ou da
          organização, consoante o modo escolhido nas definições). Sem regras configuradas, toda a lead entra
          como morna — os gatilhos quente/fria nunca disparam nesse caso.
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
            placeholder="Ex.: pedido-orcamento"
          />
          <Helper>Deixe vazio para reagir a qualquer formulário público.</Helper>
        </Field>
      );

    case 'whatsapp_keyword':
      return (
        <Field label="Palavras-chave">
          <KeywordsInput
            value={config.keywords ?? []}
            onChange={(keywords) => set({ keywords })}
          />
          <Helper>Escreva e prima Enter (ou vírgula) para adicionar. A mensagem recebida só precisa de conter uma delas.</Helper>
        </Field>
      );

    case 'sale_status_changed':
      return (
        <Field label="Novo estado da venda">
          <Select value={config.to_status ?? ''} onValueChange={(value) => set({ to_status: value })}>
            <SelectTrigger><SelectValue placeholder="Escolher estado" /></SelectTrigger>
            <SelectContent>
              {SALE_STATUS_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      );

    case 'list_joined':
      return (
        <Field label="Lista">
          <Select value={config.list_id ?? ''} onValueChange={(value) => set({ list_id: value })}>
            <SelectTrigger><SelectValue placeholder="Escolher lista" /></SelectTrigger>
            <SelectContent>
              {(lists ?? []).map((list) => (
                <SelectItem key={list.id} value={list.id}>{list.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      );

    case 'sale_renewal_due_today':
      return <Hint>Este fluxo arranca no dia em que uma venda com renovação chega à data de renovar.</Hint>;

    case 'sale_renewal_due_in_2_days':
      return <Hint>Este fluxo arranca 2 dias antes da data de renovação de uma venda.</Hint>;

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
              placeholder="Escolher template"
              searchPlaceholder="Pesquisar template..."
              emptyText="Nenhum template com esse nome."
              emptyValue="__custom__"
              emptyLabel="Conteúdo próprio"
            />
          </Field>

          {!config.template_id && (
            <>
              <Field label="Assunto">
                <Input
                  ref={emailSubjectRef}
                  value={config.subject ?? ''}
                  onChange={(e) => set({ subject: e.target.value })}
                  placeholder="Ex.: A sua proposta está pronta"
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
                  placeholder="<p>Olá {{nome}},</p>"
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
                  <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
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
            <SelectTrigger><SelectValue placeholder="Escolher utilizador" /></SelectTrigger>
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
            <SelectTrigger><SelectValue placeholder="Escolher lista" /></SelectTrigger>
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
              placeholder="Ex.: Ligar à lead"
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
              placeholder="Contexto para quem vai tratar da tarefa"
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
              <SelectTrigger><SelectValue placeholder="Responsável da lead" /></SelectTrigger>
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
      return <Hint>O fluxo termina aqui para este contacto. Não são executados mais passos.</Hint>;

    default:
      return <Hint>Este passo não tem opções configuráveis.</Hint>;
  }
}

// ── webhook ─────────────────────────────────────────────────────────────────

/**
 * Headers and body are free text but must end up as JSON, so both are parsed on
 * every keystroke and flagged inline. Typing is never blocked — the same checks
 * run in `validateGraph`, which is what actually holds back "Ativar".
 */
function WebhookForm({ config, set }: { config: AutomationNodeConfig; set: FormProps['set'] }) {
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
          placeholder="https://exemplo.com/hook"
          className={cn(urlInvalid && INVALID_FIELD_CLASS)}
          aria-invalid={urlInvalid}
        />
        {urlInvalid && <FieldError>Endereço inválido — comece por https://</FieldError>}
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
        {headersInvalid && <FieldError>JSON inválido</FieldError>}
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
        {bodyInvalid && <FieldError>JSON inválido</FieldError>}
      </Field>
      <Helper>Pode usar variáveis como {'{{nome}}'} dentro dos valores.</Helper>
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
      <Field label="Mensagem">
        <Textarea
          ref={messageRef}
          value={config.message ?? ''}
          onChange={(e) => set({ message: e.target.value })}
          placeholder="Olá {{nome}}, obrigado pelo seu contacto!"
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
            Aguardar resposta
          </Label>
          <Switch
            id="whatsapp-wait-reply"
            checked={waitsForReply}
            onCheckedChange={toggleWait}
          />
        </div>
        <Helper>
          O contacto responde e o fluxo segue por caminhos diferentes conforme a resposta.
        </Helper>
      </div>

      {waitsForReply && <ReplyRulesEditor config={config} set={set} />}
    </>
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
  const { organization } = useAuth();
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const media = config.media?.url ? config.media : undefined;
  const legacyUrl = !media && config.media_url ? String(config.media_url) : null;

  const handleFile = async (file: File) => {
    if (!organization?.id) {
      toast.error('Sem organização ativa');
      return;
    }
    if (file.size > MAX_MEDIA_BYTES) {
      toast.error('Ficheiro demasiado grande', { description: 'O limite do WhatsApp é 16 MB.' });
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
      toast.error('Erro ao carregar o ficheiro');
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleRemove = () => {
    // Best-effort cleanup — the message config no longer references the file
    // either way, and RLS lets org members delete their own uploads.
    if (media?.path) {
      void supabase.storage.from('automation-media').remove([media.path]);
    }
    set({ media: undefined, media_url: undefined });
  };

  if (media || legacyUrl) {
    const kind = media?.kind ?? 'document';
    const KindIcon = MEDIA_KIND_ICONS[kind] ?? FileText;
    const filename = media?.filename ?? legacyUrl?.split('/').pop() ?? 'anexo';

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
          title="Remover anexo"
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
          <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> A carregar…</>
        ) : (
          <><Upload className="mr-2 h-4 w-4" /> Carregar ficheiro</>
        )}
      </Button>
      <Helper>Imagem, vídeo ou PDF enviado junto com a mensagem. Máximo 16 MB.</Helper>
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
  const questionRef = useRef<HTMLTextAreaElement>(null);

  return (
    <>
      <Hint>
        Este passo não envia mensagem nenhuma por si só. Para perguntar <em>e</em> esperar, use um
        passo «Enviar WhatsApp» com «Aguardar resposta» ligado.
      </Hint>

      <Field label="Pergunta (opcional)">
        <Textarea
          ref={questionRef}
          value={config.question ?? ''}
          onChange={(e) => set({ question: e.target.value })}
          placeholder="Ex.: Quer que lhe ligue para explicar?"
          rows={4}
        />
        <VariableChips
          targetRef={questionRef}
          value={config.question ?? ''}
          onChange={(question) => set({ question })}
        />
        <Helper>
          Se preencher, é enviada quando o fluxo chega aqui. Deixe vazio se a pergunta já foi feita
          num passo anterior.
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
      <div className="rounded-lg border border-border bg-muted/40 p-3">
        <Helper>
          As opções aparecem numeradas na mensagem e o contacto responde «1», «2»… — também
          reconhecemos as palavras-chave de cada opção.
        </Helper>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Respostas possíveis
          </Label>
          <Button variant="outline" size="sm" className="h-7" onClick={addRule}>
            <Plus className="mr-1 h-3.5 w-3.5" />
            Opção
          </Button>
        </div>

        {!rules.length && (
          <p className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
            Sem opções. Adicione uma para ramificar consoante o que o contacto responder — cada
            opção cria um caminho próprio no fluxo.
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
                placeholder="Texto do botão"
                maxLength={20}
                className="h-8 flex-1"
              />
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                onClick={() => removeRule(rule.id)}
                title="Remover opção"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
            <Helper>É o texto do botão (máx. 20 caracteres) e o rótulo do caminho no fluxo.</Helper>
            <div className="space-y-1">
              <Label className="text-[11px] font-medium text-muted-foreground">Palavras-chave</Label>
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
                <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Helper>Passado este tempo sem resposta, o fluxo segue pelo caminho «Sem resposta».</Helper>
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
  const field = config.field ?? '';
  const isKnownField = CONDITION_FIELD_OPTIONS.some((option) => option.value === field);
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
          <SelectTrigger><SelectValue placeholder="Escolher campo" /></SelectTrigger>
          <SelectContent>
            {CONDITION_FIELD_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
            ))}
            <SelectItem value={CUSTOM_FIELD_SENTINEL}>Outro campo…</SelectItem>
          </SelectContent>
        </Select>
        {showCustomInput && (
          <Input
            value={field}
            onChange={(e) => set({ field: e.target.value })}
            placeholder="Nome do campo (ex.: nif)"
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
              <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
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
              placeholder={isNumeric ? '0' : 'Valor a comparar'}
            />
          )}
        </Field>
      )}

      <Hint>
        O fluxo segue pelo ramo <strong>Sim</strong> quando a condição se verifica e por{' '}
        <strong>Não</strong> caso contrário.
      </Hint>
    </>
  );
}

// ── Small building blocks ───────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
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
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger><SelectValue placeholder={placeholder} /></SelectTrigger>
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
            title={`Remover ${keyword}`}
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
        placeholder={value.length ? '' : 'sim, quero, interessado'}
        className="min-w-[80px] flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground"
      />
    </div>
  );
}
