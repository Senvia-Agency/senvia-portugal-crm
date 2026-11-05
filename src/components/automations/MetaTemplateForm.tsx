import { useMessagingChannels } from '@/hooks/useMessagingChannels';
import { useWhatsAppTemplates } from '@/hooks/useMetaInbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { AutomationNodeConfig } from '@/types/automations';

export function MetaTemplateForm({ config, set }: { config: AutomationNodeConfig; set: (patch: Partial<AutomationNodeConfig>) => void }) {
  const { data: channels = [] } = useMessagingChannels();
  const official = channels.filter(channel => channel.provider === 'meta' && channel.channel_type === 'whatsapp' && !channel.archived_at);
  const { data: templates = [], isLoading } = useWhatsAppTemplates(config.channel_id ?? null);
  const supported = templates.filter(template => template.components.every(component =>
    (component.type.toUpperCase() !== 'HEADER' || !component.format || component.format === 'TEXT')
    && component.type.toUpperCase() !== 'BUTTONS'));
  const selected = supported.find(template => template.name === config.template_name && template.language === config.language);
  return <div className="space-y-4">
    <div className="space-y-1.5"><Label>Caixa WhatsApp oficial</Label><Select value={config.channel_id ?? ''} onValueChange={(channel_id) => set({ channel_id, template_name: undefined, language: undefined, components: undefined })}><SelectTrigger><SelectValue placeholder="Escolher caixa" /></SelectTrigger><SelectContent>{official.map(channel => <SelectItem key={channel.id} value={channel.id}>{channel.label || channel.phone_number || 'WhatsApp oficial'}</SelectItem>)}</SelectContent></Select></div>
    <div className="space-y-1.5"><Label>Modelo aprovado</Label><Select value={selected?.id ?? ''} disabled={!config.channel_id || isLoading} onValueChange={(id) => {
      const template = supported.find(item => item.id === id);
      if (!template) return;
      const components: NonNullable<AutomationNodeConfig['components']> = [];
      for (const component of template.components) {
        const kind = component.type.toLowerCase();
        if (kind !== 'header' && kind !== 'body') continue;
        const indices = [...(component.text ?? '').matchAll(/\{\{(\d+)\}\}/g)].map(match => Number(match[1]));
        const count = Math.max(0, ...indices);
        if (count) components.push({ type: kind, parameters: Array.from({ length: count }, () => '') });
      }
      set({ template_name: template.name, language: template.language, components });
    }}><SelectTrigger><SelectValue placeholder={isLoading ? 'A carregar…' : 'Escolher modelo'} /></SelectTrigger><SelectContent>{supported.map(template => <SelectItem key={template.id} value={template.id}>{template.name} · {template.language}</SelectItem>)}</SelectContent></Select></div>
    {config.channel_id && !isLoading && !supported.length && <p className="text-sm text-muted-foreground">Sem modelos de texto aprovados nesta caixa. Sincronize os modelos nas definições de mensagens.</p>}
    {selected && <div className="space-y-2 rounded-lg border border-border p-3">{selected.components.map((component, index) => component.text ? <p key={index} className="whitespace-pre-wrap text-sm">{component.text}</p> : null)}</div>}
    {(config.components ?? []).map((component, componentIndex) => <div key={component.type} className="space-y-3">{component.parameters.map((parameter, parameterIndex) => <div key={parameterIndex} className="space-y-1.5"><Label>{component.type === 'body' ? 'Corpo' : 'Cabeçalho'} · variável {parameterIndex + 1}</Label><Input value={parameter} placeholder="Pode usar {{nome}}" onChange={(event) => set({ components: (config.components ?? []).map((item, index) => index === componentIndex ? { ...item, parameters: item.parameters.map((value, position) => position === parameterIndex ? event.target.value : value) } : item) })} /></div>)}</div>)}
    <p className="text-sm text-muted-foreground">Usa a conversa deste contacto na caixa selecionada. Modelos com botões ou cabeçalhos de ficheiro não são suportados neste passo.</p>
  </div>;
}
